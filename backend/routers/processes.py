from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
import json
from .. import models, schemas
from ..database import get_db
from ..main import _compute_master_sync

def _get_master_info(db: Session):
    project = db.query(models.Project).first()
    if not project or not project.master_connection_id:
        return None, None, None
    master_conn = db.query(models.Connection).filter(models.Connection.id == project.master_connection_id).first()
    return project, master_conn, project.master_sheet_name

def _run_single_process(proc, db: Session):
    project, master_conn, master_sheet = _get_master_info(db)
    if not project or not master_conn:
        return {"status": "error", "error": "No hay tabla maestra enlazada."}
    
    field_mappings = json.loads(proc.field_mappings) if isinstance(proc.field_mappings, str) else proc.field_mappings
    req = schemas.MasterSyncRequest(
        source_connection_id=proc.source_connection_id,
        source_sheet_name=proc.source_sheet_name,
        sku_column_source=proc.sku_column_source,
        sku_column_master=proc.sku_column_master,
        field_mappings=field_mappings,
        add_new_rows=proc.add_new_rows
    )
    
    try:
        result = _compute_master_sync(project, req, db)
        master_raw = result["master_raw"]
        
        # Guardar en la maestra
        from ..services import _create_connector
        connector = _create_connector(master_conn)
        
        # Determinar el rango
        sheet_range = f"{master_sheet}!A1:Z" if master_conn.connection_type == "google_sheets" else master_sheet
        
        # Conectores HTTP o locales pueden no soportar update_data igual que Sheets, pero asumimos su existencia
        if hasattr(connector, 'update_data'):
            connector.update_data(sheet_range, master_raw)
        else:
            return {"status": "error", "error": f"El conector {master_conn.connection_type} no soporta actualizaciones directas."}
            
        # Log event
        from .logs import log_event
        log_event(db, "SYNC_PROCESS", "success", f"Proceso '{proc.name}' ejecutado directamente.", proc.id, None, None, result["rows_updated"] + result["rows_added"])
        
        return {
            "status": "success", 
            "process_name": proc.name,
            "rows_updated": result["rows_updated"],
            "rows_added": result["rows_added"]
        }
    except Exception as e:
        import traceback
        from .logs import log_event
        log_event(db, "SYNC_ERROR", "error", f"Error ejecutando '{proc.name}': {str(e)}", proc.id, None, traceback.format_exc())
        return {"status": "error", "error": str(e)}

router = APIRouter(
    prefix="/api/processes",
    tags=["processes"],
)

@router.post("/", response_model=schemas.Process)
def create_process(proc: schemas.ProcessCreate, db: Session = Depends(get_db)):
    db_proc = models.Process(
        name=proc.name,
        description=proc.description,
        source_connection_id=proc.source_connection_id,
        source_sheet_name=proc.source_sheet_name,
        sku_column_source=proc.sku_column_source,
        sku_column_master=proc.sku_column_master,
        field_mappings=json.dumps(proc.field_mappings, ensure_ascii=False),
        add_new_rows=proc.add_new_rows,
        is_active=proc.is_active
    )
    db.add(db_proc)
    db.commit()
    db.refresh(db_proc)
    db_proc.field_mappings = json.loads(db_proc.field_mappings)
    return db_proc

@router.get("/", response_model=list[schemas.Process])
def list_processes(db: Session = Depends(get_db)):
    procs = db.query(models.Process).all()
    for p in procs:
        p.field_mappings = json.loads(p.field_mappings)
    return procs

@router.delete("/{process_id}")
def delete_process(process_id: int, db: Session = Depends(get_db)):
    proc = db.query(models.Process).filter(models.Process.id == process_id).first()
    if not proc:
        raise HTTPException(status_code=404, detail="Proceso no encontrado")
    db.delete(proc)
    db.commit()
    return {"message": "Proceso eliminado"}

@router.put("/{process_id}", response_model=schemas.Process)
def update_process(process_id: int, proc: schemas.ProcessCreate, db: Session = Depends(get_db)):
    db_proc = db.query(models.Process).filter(models.Process.id == process_id).first()
    if not db_proc:
        raise HTTPException(status_code=404, detail="Proceso no encontrado")
    db_proc.name = proc.name
    db_proc.description = proc.description
    db_proc.source_connection_id = proc.source_connection_id
    db_proc.source_sheet_name = proc.source_sheet_name
    db_proc.sku_column_source = proc.sku_column_source
    db_proc.sku_column_master = proc.sku_column_master
    db_proc.field_mappings = json.dumps(proc.field_mappings, ensure_ascii=False)
    db_proc.add_new_rows = proc.add_new_rows
    db_proc.is_active = proc.is_active
    db.commit()
    db.refresh(db_proc)
    db_proc.field_mappings = json.loads(db_proc.field_mappings)
    return db_proc

@router.post("/{process_id}/preview")
def preview_process(process_id: int, db: Session = Depends(get_db)):
    proc = db.query(models.Process).filter(models.Process.id == process_id).first()
    if not proc:
        raise HTTPException(status_code=404, detail="Proceso no encontrado")

    project, master_conn, master_sheet = _get_master_info(db)
    if not project or not master_conn:
        raise HTTPException(status_code=400, detail="No hay tabla maestra enlazada.")

    field_mappings = json.loads(proc.field_mappings) if isinstance(proc.field_mappings, str) else proc.field_mappings

    req = schemas.MasterSyncRequest(
        source_connection_id=proc.source_connection_id,
        source_sheet_name=proc.source_sheet_name,
        sku_column_source=proc.sku_column_source,
        sku_column_master=proc.sku_column_master,
        field_mappings=field_mappings,
        add_new_rows=proc.add_new_rows
    )

    result = _compute_master_sync(project, req, db)

    return {
        "process_name": proc.name,
        "rows_updated": result["rows_updated"],
        "rows_added": result["rows_added"],
        "rows_unchanged": result["rows_unchanged"],
        "total_origen": result["total_origen"],
        "total_maestra": result["total_maestra"],
        "detail_updated": result["detail_updated"],
        "detail_added": result["detail_added"],
        "detail_unchanged": result["detail_unchanged"],
    }

@router.post("/{process_id}/stage")
def stage_process(process_id: int, db: Session = Depends(get_db)):
    proc = db.query(models.Process).filter(models.Process.id == process_id).first()
    if not proc:
        raise HTTPException(status_code=404, detail="Proceso no encontrado")

    project, master_conn, master_sheet = _get_master_info(db)
    if not project or not master_conn:
        raise HTTPException(status_code=400, detail="No hay tabla maestra enlazada.")

    field_mappings = json.loads(proc.field_mappings) if isinstance(proc.field_mappings, str) else proc.field_mappings

    req = schemas.MasterSyncRequest(
        source_connection_id=proc.source_connection_id,
        source_sheet_name=proc.source_sheet_name,
        sku_column_source=proc.sku_column_source,
        sku_column_master=proc.sku_column_master,
        field_mappings=field_mappings,
        add_new_rows=proc.add_new_rows
    )

    try:
        result = _compute_master_sync(project, req, db)
        master_raw = result["master_raw"]
        
        diff_summary = {
            "rows_to_update": result["rows_updated"],
            "rows_to_add": result["rows_added"],
            "rows_unchanged": result["rows_unchanged"],
            "warnings": []
        }
        
        batch = models.StagingBatch(
            process_id=process_id,
            status="pending",
            normalized_data=json.dumps(master_raw, ensure_ascii=False),
            diff_result=json.dumps(diff_summary, ensure_ascii=False)
        )
        db.add(batch)
        db.commit()
        db.refresh(batch)
        
        from .logs import log_event
        log_event(db, "STAGED", "info", f"Lote de staging {batch.id} creado para el proceso {proc.name}.", proc.id, str(batch.id), None, result["rows_updated"] + result["rows_added"])
        
        return {"message": f"Datos enviados a staging. Batch ID: {batch.id}", "batch_id": batch.id, "diff": diff_summary}
        
    except Exception as e:
        import traceback
        from .logs import log_event
        log_event(db, "STAGE_ERROR", "error", f"Error enviando proceso a staging: {str(e)}", proc.id, None, traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{process_id}/run")
def run_process(process_id: int, db: Session = Depends(get_db)):
    proc = db.query(models.Process).filter(models.Process.id == process_id).first()
    if not proc:
        raise HTTPException(status_code=404, detail="Proceso no encontrado")

    result = _run_single_process(proc, db)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result.get("error", "Error desconocido"))

    return result
