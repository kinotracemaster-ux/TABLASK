from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/subscriptions", tags=["subscriptions"])

@router.post("/", response_model=schemas.FieldSubscription)
def create_subscription(sub: schemas.FieldSubscriptionCreate, db: Session = Depends(get_db)):
    # Validar que el proyecto exista
    project = db.query(models.Project).filter(models.Project.id == sub.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
        
    import json
    db_sub = models.FieldSubscription(
        project_id=sub.project_id,
        target_connection_id=sub.target_connection_id,
        target_sheet_name=sub.target_sheet_name,
        sku_column_target=sub.sku_column_target,
        field_mappings=json.dumps(sub.field_mappings),
        is_active=sub.is_active,
        name=sub.name
    )
    
    db.add(db_sub)
    db.commit()
    db.refresh(db_sub)
    
    # Parse mappings back to dict for the response model
    db_sub.field_mappings = json.loads(db_sub.field_mappings)
    return db_sub

@router.get("/", response_model=List[schemas.FieldSubscription])
def get_subscriptions(project_id: int, db: Session = Depends(get_db)):
    subs = db.query(models.FieldSubscription).filter(
        models.FieldSubscription.project_id == project_id
    ).all()
    
    import json
    for s in subs:
        if isinstance(s.field_mappings, str):
            s.field_mappings = json.loads(s.field_mappings)
            
    return subs

@router.put("/{sub_id}", response_model=schemas.FieldSubscription)
def update_subscription(sub_id: int, sub_update: schemas.FieldSubscriptionCreate, db: Session = Depends(get_db)):
    db_sub = db.query(models.FieldSubscription).filter(models.FieldSubscription.id == sub_id).first()
    if not db_sub:
        raise HTTPException(status_code=404, detail="Suscripción no encontrada")
        
    import json
    db_sub.target_connection_id = sub_update.target_connection_id
    db_sub.target_sheet_name = sub_update.target_sheet_name
    db_sub.sku_column_target = sub_update.sku_column_target
    db_sub.field_mappings = json.dumps(sub_update.field_mappings)
    db_sub.is_active = sub_update.is_active
    db_sub.name = sub_update.name
    
    db.commit()
    db.refresh(db_sub)
    db_sub.field_mappings = json.loads(db_sub.field_mappings)
    return db_sub

@router.delete("/{sub_id}")
def delete_subscription(sub_id: int, db: Session = Depends(get_db)):
    db_sub = db.query(models.FieldSubscription).filter(models.FieldSubscription.id == sub_id).first()
    if not db_sub:
        raise HTTPException(status_code=404, detail="Suscripción no encontrada")
        
    db.delete(db_sub)
    db.commit()
    return {"message": "Suscripción eliminada"}
