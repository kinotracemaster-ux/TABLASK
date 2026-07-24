"""Bandeja de Nuevos (cuarentena de altas).

Cuando una fuente trae un SKU que no cruza con la Maestra y el proceso tiene
add_new_rows=False, el registro no se escribe: queda retenido en PendingNewRecord.
Aquí se lista, se aprueba (se crea en la Maestra por el mismo túnel quirúrgico y
se propaga a los canales) o se rechaza. La decisión es por registro: el usuario
marca cuáles se crean ANTES de que existan los datos.
"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel
import json

from .. import models
from ..database import get_db
from ..services import (
    get_sheet_data,
    write_sheet_data_surgical,
    invalidate_read_cache,
)

router = APIRouter(
    prefix="/api/tray",
    tags=["tray"],
    responses={404: {"description": "Not found"}},
)


class TrayIdsRequest(BaseModel):
    ids: List[int]


def _serialize(rec: models.PendingNewRecord) -> dict:
    try:
        fields = json.loads(rec.fields) if rec.fields else {}
    except Exception:
        fields = {}
    return {
        "id": rec.id,
        "sku": rec.sku,
        "fields": fields,
        "source_label": rec.source_label,
        "process_id": rec.process_id,
        "target_connection_id": rec.target_connection_id,
        "target_sheet_name": rec.target_sheet_name,
        "sku_column_master": rec.sku_column_master,
        "status": rec.status,
        "created_at": rec.created_at.isoformat() if rec.created_at else None,
        "reviewed_at": rec.reviewed_at.isoformat() if rec.reviewed_at else None,
    }


@router.get("")
def list_tray(status: str = "pending", db: Session = Depends(get_db)):
    """Lista los registros de la Bandeja de Nuevos. Por defecto los pendientes."""
    q = db.query(models.PendingNewRecord)
    if status and status != "all":
        q = q.filter(models.PendingNewRecord.status == status)
    records = q.order_by(models.PendingNewRecord.created_at.desc()).all()
    pending_count = (
        db.query(models.PendingNewRecord)
        .filter(models.PendingNewRecord.status == "pending")
        .count()
    )
    return {"records": [_serialize(r) for r in records], "pending_count": pending_count}


@router.get("/count")
def tray_count(db: Session = Depends(get_db)):
    """Cuántos hay pendientes (para el badge de la UI)."""
    count = (
        db.query(models.PendingNewRecord)
        .filter(models.PendingNewRecord.status == "pending")
        .count()
    )
    return {"pending_count": count}


@router.post("/approve")
def approve_records(req: TrayIdsRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Aprueba registros: los crea en la Maestra por escritura quirúrgica y propaga
    a los canales. Cada registro guarda su destino, así que se agrupan por
    (conexión, hoja) para leer la Maestra una vez por destino."""
    if not req.ids:
        raise HTTPException(status_code=400, detail="No se indicaron registros.")

    records = (
        db.query(models.PendingNewRecord)
        .filter(
            models.PendingNewRecord.id.in_(req.ids),
            models.PendingNewRecord.status == "pending",
        )
        .all()
    )
    if not records:
        raise HTTPException(status_code=404, detail="No hay registros pendientes con esos IDs.")

    project = db.query(models.Project).filter(models.Project.master_connection_id.isnot(None)).first()

    # Agrupar por destino (conexión + hoja) para no releer la Maestra por cada fila.
    groups: dict = {}
    for rec in records:
        key = (rec.target_connection_id, rec.target_sheet_name)
        groups.setdefault(key, []).append(rec)

    now = datetime.utcnow()
    results = []
    errors = []
    propagations = []  # (project_id, new_rows) para propagar tras el commit

    invalidate_read_cache()  # leer la Maestra fresca

    for (conn_id, sheet_name), recs in groups.items():
        try:
            conn = db.query(models.Connection).filter(models.Connection.id == conn_id).first()
            if not conn:
                raise HTTPException(status_code=400, detail=f"La conexión destino {conn_id} ya no existe.")

            master_raw = get_sheet_data(conn, f"{sheet_name}!A1:Z")
            if not master_raw:
                raise HTTPException(status_code=400, detail=f"La hoja destino '{sheet_name}' está vacía o no existe.")
            headers = master_raw[0]

            # Sumar al set de headers cualquier columna que traigan los fields (por si
            # la Maestra creció). El write quirúrgico usa estos headers para ordenar.
            for rec in recs:
                fields = json.loads(rec.fields) if rec.fields else {}
                for col in fields.keys():
                    if col not in headers:
                        headers.append(col)

            new_rows = [{"fields": json.loads(rec.fields) if rec.fields else {}} for rec in recs]
            total_rows_before = len(master_raw) - 1

            write_sheet_data_surgical(
                spreadsheet_id=conn.spreadsheet_id,
                sheet_name=sheet_name,
                headers=headers,
                changes=[],
                new_rows=new_rows,
                total_rows_before=total_rows_before,
            )

            for rec in recs:
                rec.status = "approved"
                rec.reviewed_at = now
            results.append({"target": f"{conn.name} / {sheet_name}", "rows_added": len(new_rows)})

            if project:
                propagations.append((project.id, new_rows))

        except HTTPException as he:
            errors.append({"target": f"conn {conn_id} / {sheet_name}", "error": he.detail})
        except Exception as e:
            errors.append({"target": f"conn {conn_id} / {sheet_name}", "error": str(e)})

    db.commit()

    from .logs import log_event
    approved_total = sum(r.get("rows_added", 0) for r in results)
    if approved_total:
        log_event(db, "TRAY_APPROVE", "success",
                  f"Bandeja de Nuevos: {approved_total} registro(s) aprobado(s) y creado(s) en la Maestra.",
                  None, None, None, approved_total)

    # Propagar a hijas + canales, en background (mismo camino que el sync).
    if propagations:
        from ..propagation import propagate_changes
        for pid, new_rows in propagations:
            background_tasks.add_task(propagate_changes, pid, [], new_rows)

    return {
        "message": "Registros aprobados y creados en la Maestra.",
        "results": results,
        "errors": errors,
        "rows_added": approved_total,
    }


@router.post("/reject")
def reject_records(req: TrayIdsRequest, db: Session = Depends(get_db)):
    """Rechaza registros: quedan marcados como 'rejected' (no se crean). Se conserva
    el historial en vez de borrar, para poder auditar qué se descartó."""
    if not req.ids:
        raise HTTPException(status_code=400, detail="No se indicaron registros.")
    records = (
        db.query(models.PendingNewRecord)
        .filter(
            models.PendingNewRecord.id.in_(req.ids),
            models.PendingNewRecord.status == "pending",
        )
        .all()
    )
    now = datetime.utcnow()
    for rec in records:
        rec.status = "rejected"
        rec.reviewed_at = now
    db.commit()

    from .logs import log_event
    if records:
        log_event(db, "TRAY_REJECT", "info",
                  f"Bandeja de Nuevos: {len(records)} registro(s) rechazado(s).", None)
    return {"message": "Registros rechazados.", "rejected": len(records)}


@router.delete("/{record_id}")
def delete_record(record_id: int, db: Session = Depends(get_db)):
    """Borra definitivamente un registro de la bandeja (limpieza)."""
    rec = db.query(models.PendingNewRecord).filter(models.PendingNewRecord.id == record_id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Registro no encontrado.")
    db.delete(rec)
    db.commit()
    return {"message": "Registro borrado."}
