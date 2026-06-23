from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
import json
from .. import models, schemas
from ..database import get_db
from ..services import write_sheet_data, write_sheet_data_surgical

router = APIRouter(
    prefix="/api/staging",
    tags=["staging"],
    responses={404: {"description": "Not found"}},
)

@router.get("/pending", response_model=List[schemas.StagingBatch])
def get_pending_batches(db: Session = Depends(get_db)):
    """Obtiene todos los lotes de datos pendientes de revisión."""
    return db.query(models.StagingBatch)\
        .filter(models.StagingBatch.status == "pending")\
        .order_by(models.StagingBatch.created_at.desc())\
        .all()

@router.post("/{batch_id}/approve")
def approve_batch(batch_id: int, db: Session = Depends(get_db)):
    """Aprueba un lote y escribe sus datos en la Tabla Maestra (Google Sheets)."""
    batch = db.query(models.StagingBatch).filter(models.StagingBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch no encontrado")
    if batch.status != "pending":
        raise HTTPException(status_code=400, detail="El batch no está pendiente")
        
    process = db.query(models.Process).filter(models.Process.id == batch.process_id).first()
    if not process:
        raise HTTPException(status_code=404, detail="Proceso asociado no encontrado")
        
    # Obtener info de la maestra
    project = db.query(models.Project).filter(models.Project.master_connection_id.isnot(None)).first()
    if not project or not project.master_connection_id:
        raise HTTPException(status_code=400, detail="No hay tabla maestra enlazada.")
        
    master_conn = db.query(models.Connection).filter(models.Connection.id == project.master_connection_id).first()
    
    try:
        # Deserializar datos normalizados
        master_raw = json.loads(batch.normalized_data)
        
        # Escribir a Google Sheets
        write_result = write_sheet_data(master_conn.spreadsheet_id, project.master_sheet_name, master_raw)
        
        # Marcar como aprobado
        batch.status = "approved"
        batch.reviewed_at = datetime.utcnow()
        batch.reviewed_by = "user" # TODO: Tomar del auth
        db.commit()
        
        # Loggear éxito
        from .logs import log_event
        log_event(db, "WRITE_SUCCESS", "success", f"Batch {batch_id} aprobado y escrito en Sheets.", process.id, str(batch_id), json.dumps(write_result))
        
        return {"message": "Batch aprobado exitosamente", "result": write_result}
    except Exception as e:
        import traceback
        from .logs import log_event
        log_event(db, "WRITE_ERROR", "error", f"Error al escribir Batch {batch_id} a Sheets: {str(e)}", process.id, str(batch_id), traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Error escribiendo a Sheets: {str(e)}")

@router.post("/{batch_id}/reject")
def reject_batch(batch_id: int, db: Session = Depends(get_db)):
    """Rechaza un lote de datos."""
    batch = db.query(models.StagingBatch).filter(models.StagingBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch no encontrado")
        
    batch.status = "rejected"
    batch.reviewed_at = datetime.utcnow()
    batch.reviewed_by = "user" # TODO: Tomar del auth
    db.commit()
    
    from .logs import log_event
    log_event(db, "REJECTED", "info", f"Batch {batch_id} rechazado.", batch.process_id, str(batch_id))
    
    return {"message": "Batch rechazado exitosamente"}

from fastapi import BackgroundTasks
from pydantic import BaseModel

class BulkExecuteRequest(BaseModel):
    batch_ids: List[int]

@router.post("/execute-bulk")
def execute_bulk_batches(req: BulkExecuteRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Ejecuta varios lotes aprobados usando escritura quirúrgica y lanza la propagación."""
    project = db.query(models.Project).filter(models.Project.master_connection_id.isnot(None)).first()
    if not project or not project.master_connection_id:
        raise HTTPException(status_code=400, detail="No hay tabla maestra enlazada.")
        
    master_conn = db.query(models.Connection).filter(models.Connection.id == project.master_connection_id).first()
    
    batches = db.query(models.StagingBatch).filter(models.StagingBatch.id.in_(req.batch_ids)).all()
    if not batches:
        raise HTTPException(status_code=404, detail="No se encontraron los lotes especificados.")
        
    all_changes = []
    all_new_rows = []
    results = []
    errors = []
    
    now = datetime.utcnow()
    
    for batch in batches:
        process = db.query(models.Process).filter(models.Process.id == batch.process_id).first()
        
        # Validar expiración (Paso 1)
        if batch.expires_at and now > batch.expires_at:
            batch.status = "expired"
            errors.append({"process": process.name if process else f"Batch {batch.id}", "error": "El lote ha expirado. Vuelve a ejecutar la previsualización."})
            continue
            
        if batch.status != "pending":
            errors.append({"process": process.name if process else f"Batch {batch.id}", "error": f"El lote no está pendiente (estado actual: {batch.status})."})
            continue
            
        try:
            diff_summary = json.loads(batch.diff_result)
            master_raw = json.loads(batch.normalized_data)
            headers = master_raw[0]
            
            changes = diff_summary.get("changes", [])
            new_rows = diff_summary.get("new_rows", [])
            
            # Recuperar target explícito si el proceso lo tenía, si no, global
            target_sheet_name = process.target_sheet_name if (process and process.target_sheet_name) else project.master_sheet_name
            target_conn = db.query(models.Connection).filter(models.Connection.id == process.target_connection_id).first() if (process and process.target_connection_id) else master_conn
            
            total_rows_before = len(master_raw) - 1 - len(new_rows)
            
            if changes or new_rows:
                write_sheet_data_surgical(
                    spreadsheet_id=target_conn.spreadsheet_id,
                    sheet_name=target_sheet_name,
                    headers=headers,
                    changes=changes,
                    new_rows=new_rows,
                    total_rows_before=total_rows_before
                )
            
            batch.status = "approved"
            batch.reviewed_at = now
            batch.reviewed_by = "user"
            
            all_changes.extend(changes)
            all_new_rows.extend(new_rows)
            results.append({"process": process.name if process else f"Batch {batch.id}", "status": "success", "rows_updated": len(changes), "rows_added": len(new_rows)})
            
            from .logs import log_event
            log_event(db, "WRITE_SUCCESS", "success", f"Batch {batch.id} ejecutado quirúrgicamente.", batch.process_id, str(batch.id), None, len(changes) + len(new_rows))
            
        except Exception as e:
            import traceback
            from .logs import log_event
            log_event(db, "WRITE_ERROR", "error", f"Error ejecutando Batch {batch.id}: {str(e)}", batch.process_id, str(batch.id), traceback.format_exc())
            errors.append({"process": process.name if process else f"Batch {batch.id}", "error": str(e)})
            
    db.commit()
    
    # Propagar a hijas
    if all_changes or all_new_rows:
        from ..propagation import propagate_changes
        background_tasks.add_task(propagate_changes, project.id, all_changes, all_new_rows)
        
    return {
        "message": "Ejecución finalizada",
        "results": results,
        "errors": errors,
        "summary": {
            "processes_ok": len(results),
            "formats_ok": 0, # La distribución ocurre en background
            "rows_updated": sum(r.get("rows_updated", 0) for r in results),
            "rows_added": sum(r.get("rows_added", 0) for r in results)
        }
    }


class ResolveItem(BaseModel):
    sku: str            # el código del origen que NO cruzó
    action: str = "cross"  # por ahora solo "cross" (cruzar con un SKU existente)
    target_sku: str     # con qué SKU de la Maestra cruzarlo


class ResolveRequest(BaseModel):
    resolutions: List[ResolveItem]


@router.post("/{batch_id}/resolve")
def resolve_suspects(batch_id: int, req: ResolveRequest, db: Session = Depends(get_db)):
    """Microsistema 'No cruzaron': aplica decisiones de cruce sobre un lote
    pendiente. Por cada código que no cruzó y que el usuario manda a cruzar,
    sus datos pasan a actualizar la fila del SKU elegido en la Maestra (se
    convierte en una actualización) y deja de contar como 'no cruzó'.
    No escribe a Sheets todavía: solo deja el lote listo para aprobar/ejecutar.
    """
    batch = db.query(models.StagingBatch).filter(models.StagingBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch no encontrado")
    if batch.status != "pending":
        raise HTTPException(status_code=400, detail="El batch no está pendiente")

    process = db.query(models.Process).filter(models.Process.id == batch.process_id).first()
    if not process:
        raise HTTPException(status_code=404, detail="Proceso asociado no encontrado")

    sku_col_master = process.sku_column_master
    master_raw = json.loads(batch.normalized_data)
    diff = json.loads(batch.diff_result)
    if not master_raw:
        raise HTTPException(status_code=400, detail="El lote no tiene datos de la Maestra.")

    headers = master_raw[0]
    if sku_col_master not in headers:
        raise HTTPException(status_code=400, detail=f"La columna SKU '{sku_col_master}' no está en la Maestra.")
    sku_idx = headers.index(sku_col_master)

    # Índice SKU -> posición en master_raw (1 = primera fila de datos = Fila 2 en Sheets)
    idx_by_sku = {}
    for i, row in enumerate(master_raw[1:], start=1):
        v = (row[sku_idx] if sku_idx < len(row) else "").strip()
        if v:
            idx_by_sku.setdefault(v, i)

    suspects = diff.get("suspects", [])
    suspects_by_sku = {s["sku"]: s for s in suspects}
    changes = diff.get("changes", [])

    applied, not_found, no_suspect = [], [], []

    for r in req.resolutions:
        if r.action != "cross":
            continue
        susp = suspects_by_sku.get(r.sku)
        if not susp:
            no_suspect.append(r.sku)
            continue
        ti = idx_by_sku.get(r.target_sku)
        if ti is None:
            not_found.append(r.sku)
            continue

        row = master_raw[ti]
        if len(row) < len(headers):
            row = row + [""] * (len(headers) - len(row))

        for dst_col, val in susp.get("fields", {}).items():
            if dst_col not in headers:
                continue
            if dst_col == sku_col_master:
                continue  # NUNCA pisar el SKU del destino con el código del origen
            ci = headers.index(dst_col)
            old = row[ci]
            if old != val:
                changes.append({
                    "sku": r.target_sku,
                    "field": dst_col,
                    "old": old,
                    "new": val,
                    "row_index": ti
                })
                row[ci] = val

        master_raw[ti] = row
        applied.append(r.sku)

    # Quitar de 'no cruzaron' los que ya se cruzaron y recalcular contadores.
    remaining = [s for s in suspects if s["sku"] not in applied]
    diff["suspects"] = remaining
    diff["rows_suspect"] = len(remaining)
    diff["changes"] = changes
    diff["rows_to_update"] = len({c["row_index"] for c in changes})

    batch.normalized_data = json.dumps(master_raw, ensure_ascii=False)
    batch.diff_result = json.dumps(diff, ensure_ascii=False)
    db.commit()

    from .logs import log_event
    log_event(db, "RESOLVE", "info",
              f"Batch {batch_id}: {len(applied)} código(s) cruzados manualmente.",
              batch.process_id, str(batch_id), None, len(applied))

    return {
        "message": f"{len(applied)} código(s) cruzados.",
        "applied": applied,
        "not_found": not_found,
        "no_suspect": no_suspect,
        "diff": diff
    }
