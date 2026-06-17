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
        background_tasks.add_task(propagate_changes, db, project.id, all_changes, all_new_rows)
        
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
