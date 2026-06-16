from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from .. import models, schemas
from ..database import get_db

router = APIRouter(
    prefix="/api/logs",
    tags=["logs"],
    responses={404: {"description": "Not found"}},
)

def log_event(db: Session, event_type: str, status: str, message: str, process_id: int = None, batch_id: str = None, technical_detail: str = None, rows_affected: int = 0, duration_ms: int = 0):
    """Función utilitaria para guardar un registro en la base de datos de manera uniforme."""
    log_entry = models.ExecutionLog(
        process_id=process_id,
        batch_id=batch_id,
        event_type=event_type,
        status=status,
        message=message,
        technical_detail=technical_detail,
        rows_affected=rows_affected,
        duration_ms=duration_ms
    )
    db.add(log_entry)
    db.commit()
    db.refresh(log_entry)
    return log_entry

@router.get("/", response_model=List[schemas.ExecutionLog])
def read_logs(skip: int = 0, limit: int = 100, process_id: int = None, db: Session = Depends(get_db)):
    """Obtiene el historial de ejecuciones y errores."""
    query = db.query(models.ExecutionLog)
    if process_id:
        query = query.filter(models.ExecutionLog.process_id == process_id)
    # Ordenar más recientes primero
    logs = query.order_by(models.ExecutionLog.created_at.desc()).offset(skip).limit(limit).all()
    return logs
