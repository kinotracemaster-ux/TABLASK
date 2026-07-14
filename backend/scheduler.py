"""Piloto automático: corre todos los procesos activos cada X horas
(MEJORAS_TABLASK §5), sin que nadie tenga la app abierta.

Un thread daemon hace "tick" cada pocos minutos y compara `next_run_at` (que
vive en la DB) contra el reloj; cuando toca, ejecuta y reprograma. Como el
estado está en la DB, sobrevive reinicios del servidor.

Respeta el Guardián también en modo automático: si un proceso cruza muy pocos
SKUs y quiere crear muchas filas nuevas (probable formato de SKU roto), se
SALTA ese proceso y se registra una alerta, en vez de contaminar la Maestra
sin un humano que confirme.
"""
import json
import threading
import time
import traceback
from datetime import datetime, timedelta

from .database import SessionLocal
from . import models

TICK_SECONDS = 300          # cada 5 min revisa si toca correr
LOW_MATCH_THRESHOLD = 10.0  # coherence_index (%) por debajo del cual, con filas
                            # nuevas, se salta el proceso (mismo umbral que la UI)


def get_or_create_config(db):
    cfg = db.query(models.ScheduleConfig).first()
    if not cfg:
        cfg = models.ScheduleConfig(enabled=False, interval_hours=6)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


def run_scheduled_sync(db) -> dict:
    """Corre todos los procesos activos hacia la Maestra y propaga (incluye el
    push a las suscripciones Shopify). Devuelve un resumen. Reutiliza el mismo
    motor que el botón manual (_compute_master_sync), sin pasar por StagingBatch:
    en automático no hay confirmación humana, así que el Guardián decide."""
    from .services import _compute_master_sync, write_sheet_data_surgical, invalidate_read_cache
    from .routers.logs import log_event
    from .propagation import propagate_changes
    from . import schemas

    invalidate_read_cache()  # leer fresco

    project = db.query(models.Project).filter(models.Project.master_connection_id.isnot(None)).first()
    if not project:
        return {"ran": False, "reason": "No hay Maestra enlazada."}

    processes = db.query(models.Process).filter(models.Process.is_active == True).all()
    results = []
    all_changes, all_new_rows = [], []

    for proc in processes:
        try:
            field_mappings = json.loads(proc.field_mappings) if isinstance(proc.field_mappings, str) else proc.field_mappings
            req = schemas.MasterSyncRequest(
                source_connection_id=proc.source_connection_id,
                source_sheet_name=proc.source_sheet_name,
                target_connection_id=proc.target_connection_id,
                target_sheet_name=proc.target_sheet_name,
                sku_column_source=proc.sku_column_source,
                sku_column_master=proc.sku_column_master,
                field_mappings=field_mappings,
                add_new_rows=proc.add_new_rows,
            )
            result = _compute_master_sync(project, req, db)
            changes = result.get("changes", [])
            new_rows = result.get("new_rows", [])
            coherence = result.get("coherence_index", 100)

            # Guardián en automático: baja coincidencia + muchas filas nuevas → saltar.
            if new_rows and coherence < LOW_MATCH_THRESHOLD:
                log_event(db, "AUTO_SYNC_SKIP", "warning",
                          f"Auto-sync saltó '{proc.name}': coincidencia {coherence}% con "
                          f"{len(new_rows)} filas nuevas (posible formato de SKU incorrecto).",
                          proc.id)
                results.append({"process": proc.name, "skipped": True, "coherence": coherence})
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

            log_event(db, "AUTO_SYNC_OK", "success",
                      f"Auto-sync '{proc.name}': {len(changes)} cambios, {len(new_rows)} filas nuevas.",
                      proc.id, None, None, len(changes) + len(new_rows))
            results.append({"process": proc.name, "rows_updated": len(changes), "rows_added": len(new_rows)})

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


def _tick():
    """Un latido: si el piloto automático está activo y ya venció next_run_at,
    corre la sync y reprograma."""
    db = SessionLocal()
    try:
        cfg = db.query(models.ScheduleConfig).first()
        if not cfg or not cfg.enabled:
            return
        now = datetime.utcnow()
        if cfg.next_run_at and now < cfg.next_run_at:
            return  # todavía no toca

        summary = run_scheduled_sync(db)

        cfg.last_run_at = now
        cfg.next_run_at = now + timedelta(hours=max(cfg.interval_hours or 6, 1))
        cfg.last_summary = json.dumps(summary, ensure_ascii=False)
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
