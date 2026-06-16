from fastapi import APIRouter, Depends, HTTPException, Header, Request
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
import json
import secrets
from .. import models, schemas
from ..database import get_db

router = APIRouter(
    prefix="/api/intake",
    tags=["intake"],
)

def verify_api_key(api_key: str = Header(None), db: Session = Depends(get_db)) -> models.ConnectedApp:
    """Verifica que el API key sea válido y devuelve la app."""
    if not api_key:
        raise HTTPException(status_code=401, detail="API Key is missing")
        
    app = db.query(models.ConnectedApp).filter(models.ConnectedApp.api_key == api_key, models.ConnectedApp.is_active == True).first()
    if not app:
        raise HTTPException(status_code=401, detail="Invalid or inactive API Key")
        
    return app

@router.post("/apps", response_model=schemas.ConnectedApp)
def create_connected_app(app_req: schemas.ConnectedAppCreate, db: Session = Depends(get_db)):
    """Crea una nueva App conectada y le asigna un API Key (Solo accesible desde el dashboard frontend)."""
    # Generar un API key seguro de 32 bytes (64 caracteres hex)
    api_key = secrets.token_hex(32)
    
    db_app = models.ConnectedApp(
        name=app_req.name,
        api_key=api_key,
        target_project_id=app_req.target_project_id,
        is_active=app_req.is_active
    )
    db.add(db_app)
    db.commit()
    db.refresh(db_app)
    return db_app

@router.get("/apps", response_model=List[schemas.ConnectedApp])
def list_connected_apps(db: Session = Depends(get_db)):
    """Lista las apps conectadas."""
    return db.query(models.ConnectedApp).all()

@router.delete("/apps/{app_id}")
def delete_connected_app(app_id: int, db: Session = Depends(get_db)):
    app = db.query(models.ConnectedApp).filter(models.ConnectedApp.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="App no encontrada")
    db.delete(app)
    db.commit()
    return {"message": "App eliminada"}

@router.post("/push")
async def receive_external_data(
    request: Request,
    app: models.ConnectedApp = Depends(verify_api_key),
    db: Session = Depends(get_db)
):
    """
    Recibe JSON (desde Shopify o webhooks) y lo encola en Staging.
    Para que sea agnóstico, acepta cualquier JSON y lo guarda.
    Si es un array, se considera un lote. Si es objeto, un solo item.
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    # Asegurarnos de que el payload sea una lista para procesarlo uniformemente
    data_list = payload if isinstance(payload, list) else [payload]
    
    if not data_list:
        return {"message": "Payload empty", "rows_received": 0}

    # Aquí podríamos mapear los campos, pero para hacerlo dinámico lo mandamos a Staging
    # Para Staging, normalizamos a un formato tabular de diccionario
    
    # Extraer todas las llaves únicas para formar los "headers"
    headers = set()
    for item in data_list:
        if isinstance(item, dict):
            headers.update(item.keys())
    
    headers = list(headers)
    
    # Construir la estructura raw para staging: [[header1, header2], [val1, val2]]
    raw_table = [headers]
    for item in data_list:
        if isinstance(item, dict):
            row = [str(item.get(h, "")) for h in headers]
            raw_table.append(row)
            
    # Calcular un diff_summary básico
    diff_summary = {
        "rows_to_update": len(raw_table) - 1,
        "rows_to_add": 0,
        "rows_unchanged": 0,
        "warnings": ["Datos recibidos de API Externa. Verifica mapeo de columnas."]
    }

    # Crear el Batch de Staging
    batch = models.StagingBatch(
        process_id=None, # No viene de un proceso manual
        status="pending",
        normalized_data=json.dumps(raw_table, ensure_ascii=False),
        diff_result=json.dumps(diff_summary, ensure_ascii=False)
    )
    
    db.add(batch)
    db.commit()
    db.refresh(batch)
    
    from .logs import log_event
    log_event(
        db=db, 
        event_type="WEBHOOK_RECEIVED", 
        status="success", 
        message=f"Datos recibidos desde app externa '{app.name}' ({len(data_list)} registros). Enviados a Staging.",
        process_id=None,
        batch_id=str(batch.id),
        rows_affected=len(data_list)
    )

    return {"message": "Datos recibidos y encolados en Staging", "batch_id": batch.id, "rows_received": len(data_list)}
