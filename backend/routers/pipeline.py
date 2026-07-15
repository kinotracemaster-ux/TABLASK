"""Estado del pipeline para el Home visual (MEJORAS_TABLASK §5).

Arma en un solo llamado la foto [Fuentes] → [MAESTRA] → [Destinos], cada caja
con su semáforo y "última corrida hace X", para entender el sistema de un
vistazo. Solo LEE estado ya registrado (ExecutionLog + last_pushed_at de las
suscripciones Shopify); no dispara ninguna sincronización.

Semáforos (status):
  green  → última corrida OK
  red    → última corrida con error
  amber  → nunca corrió / sin datos aún (acción pendiente)
  paused → pausado por el usuario (is_active = False)
"""
import json
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])

# Eventos que representan una "corrida" real de un proceso (no el staging previo).
_RUN_EVENTS = ("WRITE_SUCCESS", "WRITE_ERROR", "STAGE_ERROR")


def _last_run_for_process(db: Session, process_id: int) -> Optional[models.ExecutionLog]:
    return (
        db.query(models.ExecutionLog)
        .filter(
            models.ExecutionLog.process_id == process_id,
            models.ExecutionLog.event_type.in_(_RUN_EVENTS),
        )
        .order_by(models.ExecutionLog.created_at.desc())
        .first()
    )


def _source_status(proc: models.Process, last_run: Optional[models.ExecutionLog]) -> tuple:
    """(status, last_run_iso, message)."""
    if not proc.is_active:
        return "paused", (last_run.created_at.isoformat() if last_run else None), "Pausado"
    if last_run is None:
        return "amber", None, "Sin correr todavía"
    if last_run.event_type == "WRITE_SUCCESS":
        return "green", last_run.created_at.isoformat(), last_run.message
    return "red", last_run.created_at.isoformat(), last_run.message


def _shopify_status(sub: models.ShopifySubscription) -> tuple:
    if not sub.is_active:
        return "paused", (sub.last_pushed_at.isoformat() if sub.last_pushed_at else None), "Pausado"
    if not sub.last_pushed_at:
        return "amber", None, "Sin enviar todavía"
    errors = []
    try:
        errors = (json.loads(sub.last_push_summary) or {}).get("errors", []) if sub.last_push_summary else []
    except (ValueError, TypeError):
        errors = []
    if errors:
        return "red", sub.last_pushed_at.isoformat(), f"{len(errors)} error(es) en el último envío"
    return "green", sub.last_pushed_at.isoformat(), "Enviado"


@router.get("")
def get_pipeline(db: Session = Depends(get_db)):
    # ── Maestra ──
    project = db.query(models.Project).filter(models.Project.master_connection_id.isnot(None)).first()
    master = {"linked": False}
    if project and project.master_connection_id:
        master_conn = db.query(models.Connection).filter(
            models.Connection.id == project.master_connection_id
        ).first()
        total_rows = None
        try:
            from ..services import get_sheet_data
            raw = get_sheet_data(master_conn, f"{project.master_sheet_name}!A1:Z")
            total_rows = max(len(raw) - 1, 0) if raw else 0
        except Exception:
            total_rows = None  # no romper el home si Sheets no responde
        master = {
            "linked": True,
            "name": master_conn.name if master_conn else None,
            "sheet_name": project.master_sheet_name,
            "sku_column": project.master_sku_column,
            "total_rows": total_rows,
        }

    # ── Fuentes (Procesos) ──
    sources = []
    for proc in db.query(models.Process).all():
        last_run = _last_run_for_process(db, proc.id)
        status, last_iso, message = _source_status(proc, last_run)
        src_conn = db.query(models.Connection).filter(models.Connection.id == proc.source_connection_id).first()
        sources.append({
            "id": proc.id,
            "name": proc.name,
            "type": src_conn.connection_type if src_conn else None,
            "is_active": proc.is_active,
            "status": status,
            "last_run": last_iso,
            "message": message,
        })

    # ── Destinos (Suscripciones Sheets + Shopify + Exportaciones CSV) ──
    destinations = []
    if project:
        for sub in db.query(models.FieldSubscription).filter(
            models.FieldSubscription.project_id == project.id
        ).all():
            # Las suscripciones a hojas hijas se propagan solas con cada sync.
            destinations.append({
                "id": f"sub-{sub.id}",
                "name": sub.name,
                "kind": "sheet",
                "status": "green" if sub.is_active else "paused",
                "last_run": None,
                "message": "Se actualiza con cada sync" if sub.is_active else "Pausado",
            })

    for sub in db.query(models.ShopifySubscription).all():
        status, last_iso, message = _shopify_status(sub)
        destinations.append({
            "id": f"shop-{sub.id}",
            "name": sub.name,
            "kind": "shopify",
            "status": status,
            "last_run": last_iso,
            "message": message,
        })

    # Canales API genéricos: mismo criterio de semáforo que Shopify
    # (last_pushed_at + errores del último resumen).
    for sub in db.query(models.ApiSubscription).all():
        if not sub.is_active:
            status, last_iso, message = "paused", (sub.last_pushed_at.isoformat() if sub.last_pushed_at else None), "Pausado"
        elif not sub.last_pushed_at:
            status, last_iso, message = "amber", None, "Sin enviar todavía"
        else:
            try:
                ok = (json.loads(sub.last_push_summary) or {}).get("ok", True) if sub.last_push_summary else True
            except (ValueError, TypeError):
                ok = True
            if ok:
                status, last_iso, message = "green", sub.last_pushed_at.isoformat(), "Enviado"
            else:
                status, last_iso, message = "red", sub.last_pushed_at.isoformat(), "El último envío falló"
        destinations.append({
            "id": f"api-{sub.id}",
            "name": sub.name,
            "kind": "api",
            "status": status,
            "last_run": last_iso,
            "message": message,
        })

    if project:
        for exp in db.query(models.ExportFormat).filter(
            models.ExportFormat.project_id == project.id
        ).all():
            destinations.append({
                "id": f"csv-{exp.id}",
                "name": exp.name,
                "kind": "csv",
                "status": "green",
                "last_run": None,
                "message": "Descarga CSV a demanda",
            })

    # Resumen para el semáforo global (útil para un badge en el menú a futuro).
    def _rollup(items):
        st = [i["status"] for i in items]
        if "red" in st:
            return "red"
        if "amber" in st:
            return "amber"
        return "green"

    return {
        "master": master,
        "sources": sources,
        "destinations": destinations,
        "summary": {
            "sources_status": _rollup(sources) if sources else "amber",
            "destinations_status": _rollup(destinations) if destinations else "amber",
            "sources_count": len(sources),
            "destinations_count": len(destinations),
        },
    }
