"""Piloto automático: corre todos los procesos activos cada X horas
(MEJORAS_TABLASK §5), sin que nadie tenga la app abierta.

Un thread daemon hace "tick" cada pocos minutos y compara `next_run_at` (que
vive en la DB) contra el reloj; cuando toca, ejecuta y reprograma. Como el
estado está en la DB, sobrevive reinicios del servidor.

Respeta el Guardián también en modo automático: si las filas nuevas que quiere
crear son casi-idénticas a SKUs que ya están en la Maestra (probable formato de
SKU roto), SALTA ese proceso y registra una alerta, en vez de contaminar la
Maestra sin un humano que confirme. Los productos genuinamente nuevos (que no se
parecen a nada existente) SÍ se crean, aunque la coherencia sea baja.

Modos (ScheduleConfig.mode): "auto" escribe solo (lo de arriba); "review" arma
la Revisión diaria (backend/review.py): calcula qué cambiaría en la Maestra y
en las tiendas Shopify SIN escribir, y espera aprobación humana. Horario: cada
interval_hours, o una vez al día a la hora local daily_hour (TABLASK_TZ).
"""
import json
import os
import secrets
import threading
import time
import traceback
from datetime import datetime, timedelta, timezone

from .database import SessionLocal
from . import models

TICK_SECONDS = 300          # cada 5 min revisa si toca correr

# Zona horaria para "una vez al día a las X" (Colombia no tiene horario de
# verano, así que el fallback a UTC-5 fijo es exacto si falta tzdata).
TZ_NAME = os.getenv("TABLASK_TZ", "America/Bogota")


def _local_tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(TZ_NAME)
    except Exception:
        return timezone(timedelta(hours=-5))


def next_daily_run(now_utc: datetime, hour: int, tz=None) -> datetime:
    """Próxima vez que el reloj LOCAL marca `hour`:00, estrictamente después de
    `now_utc`. Entra y sale en UTC naive (como el resto de la app)."""
    tz = tz or _local_tz()
    local_now = now_utc.replace(tzinfo=timezone.utc).astimezone(tz)
    candidate = local_now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if candidate <= local_now:
        candidate = candidate + timedelta(days=1)
    return candidate.astimezone(timezone.utc).replace(tzinfo=None)


def compute_next_run(cfg, now_utc: datetime) -> datetime:
    """Una vez al día a la hora fijada (daily_hour) o cada interval_hours."""
    if cfg.daily_hour is not None:
        return next_daily_run(now_utc, int(cfg.daily_hour) % 24)
    return now_utc + timedelta(hours=max(cfg.interval_hours or 6, 1))


def get_or_create_config(db):
    cfg = db.query(models.ScheduleConfig).first()
    if not cfg:
        cfg = models.ScheduleConfig(enabled=False, interval_hours=6, mode="auto")
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    changed = False
    if not cfg.mode:
        cfg.mode = "auto"
        changed = True
    if not cfg.report_token:
        cfg.report_token = secrets.token_urlsafe(24)
        changed = True
    if changed:
        db.commit()
        db.refresh(cfg)
    return cfg


def build_sync_request(proc):
    """MasterSyncRequest de un Proceso guardado (lo usan el piloto automático y
    la Revisión diaria, para que ambos corran exactamente el mismo túnel)."""
    from . import schemas
    field_mappings = json.loads(proc.field_mappings) if isinstance(proc.field_mappings, str) else proc.field_mappings
    return schemas.MasterSyncRequest(
        source_connection_id=proc.source_connection_id,
        source_sheet_name=proc.source_sheet_name,
        target_connection_id=proc.target_connection_id,
        target_sheet_name=proc.target_sheet_name,
        sku_column_source=proc.sku_column_source,
        sku_column_master=proc.sku_column_master,
        field_mappings=field_mappings,
        add_new_rows=proc.add_new_rows,
        zero_missing_stock=proc.zero_missing_stock,
    )


def run_scheduled_sync(db) -> dict:
    """Corre todos los procesos activos hacia la Maestra y propaga (incluye el
    push a las suscripciones Shopify). Devuelve un resumen. Reutiliza el mismo
    motor que el botón manual (_compute_master_sync), sin pasar por StagingBatch:
    en automático no hay confirmación humana, así que el Guardián decide."""
    from .services import _compute_master_sync, write_sheet_data_surgical, invalidate_read_cache
    from .routers.logs import log_event
    from .propagation import propagate_changes

    invalidate_read_cache()  # leer fresco

    project = db.query(models.Project).filter(models.Project.master_connection_id.isnot(None)).first()
    if not project:
        return {"ran": False, "reason": "No hay Maestra enlazada."}

    processes = db.query(models.Process).filter(models.Process.is_active == True).all()
    results = []
    all_changes, all_new_rows = [], []

    for proc in processes:
        try:
            req = build_sync_request(proc)
            result = _compute_master_sync(project, req, db)
            changes = result.get("changes", [])
            new_rows = result.get("new_rows", [])
            coherence = result.get("coherence_index", 100)

            # Guardián inteligente en automático: se salta SOLO si las filas nuevas
            # parecen un formato de SKU roto (casi-idénticas a SKUs ya existentes),
            # no por baja coherencia a secas. Las altas legítimas de productos
            # nuevos pasan aunque la coherencia sea baja.
            if new_rows and result.get("new_rows_look_broken"):
                suspect = result.get("new_rows_suspect_ratio", 0)
                log_event(db, "AUTO_SYNC_SKIP", "warning",
                          f"Auto-sync saltó '{proc.name}': {len(new_rows)} filas nuevas y "
                          f"{int(suspect * 100)}% son casi-idénticas a SKUs existentes "
                          f"(probable formato de SKU roto), coincidencia {coherence}%.",
                          proc.id)
                results.append({"process": proc.name, "skipped": True, "coherence": coherence,
                                "new_rows_suspect_ratio": suspect})
                continue

            if changes or new_rows:
                master_raw = result["master_raw"]
                headers = master_raw[0]
                target_conn = result["master_conn"]
                target_sheet = result["target_sheet_name"]
                total_rows_before = len(master_raw) - 1 - len(new_rows)
                write_sheet_data_surgical(
                    spreadsheet_id=target_conn.spreadsheet_id,
                    sheet_name=target_sheet,
                    headers=headers,
                    changes=changes,
                    new_rows=new_rows,
                    total_rows_before=total_rows_before,
                )
                all_changes.extend(changes)
                all_new_rows.extend(new_rows)

            rows_zeroed = result.get("rows_zeroed", 0)
            zeroed_txt = f", {rows_zeroed} agotados" if rows_zeroed else ""
            log_event(db, "AUTO_SYNC_OK", "success",
                      f"Auto-sync '{proc.name}': {len(changes)} cambios, {len(new_rows)} filas nuevas{zeroed_txt}.",
                      proc.id, None, None, len(changes) + len(new_rows))
            results.append({"process": proc.name, "rows_updated": len(changes),
                            "rows_added": len(new_rows), "rows_zeroed": rows_zeroed})

        except Exception as e:
            log_event(db, "AUTO_SYNC_ERROR", "error",
                      f"Auto-sync falló en '{proc.name}': {str(e)[:200]}", proc.id, None, traceback.format_exc())
            results.append({"process": proc.name, "error": str(e)[:200]})

    # Propagar a hijas + push a Shopify (mismo camino que el manual).
    if all_changes or all_new_rows:
        propagate_changes(project.id, all_changes, all_new_rows)

    return {
        "ran": True,
        "processes": len(processes),
        "rows_updated": sum(r.get("rows_updated", 0) for r in results),
        "rows_added": sum(r.get("rows_added", 0) for r in results),
        "results": results,
    }


def run_for_mode(db, cfg, trigger: str) -> dict:
    """Corre lo que corresponde al modo del piloto: "review" arma la Revisión
    diaria (no escribe nada); "auto" sincroniza y escribe (comportamiento
    original). Devuelve un resumen apto para last_summary."""
    if (cfg.mode or "auto") == "review":
        from .review import run_review
        rev = run_review(db, trigger=trigger)
        report = json.loads(rev.report) if rev.report else {}
        return {"ran": True, "mode": "review", "review_id": rev.id, "status": rev.status,
                "totals": report.get("totals", {}), "reason": report.get("reason")}
    return run_scheduled_sync(db)


def _tick():
    """Un latido: si el piloto automático está activo y ya venció next_run_at,
    corre (sync o revisión, según el modo) y reprograma."""
    db = SessionLocal()
    try:
        cfg = db.query(models.ScheduleConfig).first()
        if not cfg or not cfg.enabled:
            return
        now = datetime.utcnow()
        if cfg.next_run_at and now < cfg.next_run_at:
            return  # todavía no toca

        summary = run_for_mode(db, cfg, trigger="programada")

        cfg.last_run_at = now
        cfg.next_run_at = compute_next_run(cfg, now)
        cfg.last_summary = json.dumps(summary, ensure_ascii=False, default=str)
        db.commit()
    except Exception as e:
        print("Error en el tick del scheduler:", e)
    finally:
        db.close()


def _loop():
    while True:
        time.sleep(TICK_SECONDS)
        try:
            _tick()
        except Exception as e:
            print("Scheduler loop error:", e)


_started = False


def start_scheduler():
    """Arranca el thread daemon una sola vez (idempotente)."""
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_loop, daemon=True, name="tablask-scheduler").start()
    print("Scheduler de sync automática iniciado (tick cada %ss)." % TICK_SECONDS)
