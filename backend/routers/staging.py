from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
import json
from .. import models, schemas
from ..database import get_db
from ..services import write_sheet_data

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
