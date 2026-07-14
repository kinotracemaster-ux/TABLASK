from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List
from ..services import _compute_master_sync, _get_master_info, invalidate_read_cache
from .. import models, schemas
from ..database import get_db
from datetime import datetime, timedelta
import json

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
        target_connection_id=proc.target_connection_id,
        target_sheet_name=proc.target_sheet_name,
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
    # Los batches de staging son datos transitorios: se borran con el proceso.
    db.query(models.StagingBatch).filter(models.StagingBatch.process_id == process_id).delete()
    # Los logs de ejecución se conservan como historial; solo se desvinculan.
    db.query(models.ExecutionLog).filter(models.ExecutionLog.process_id == process_id).update({"process_id": None})
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
    db_proc.target_connection_id = proc.target_connection_id
    db_proc.target_sheet_name = proc.target_sheet_name
    db_proc.sku_column_source = proc.sku_column_source
    db_proc.sku_column_master = proc.sku_column_master
    db_proc.field_mappings = json.dumps(proc.field_mappings, ensure_ascii=False)
    db_proc.add_new_rows = proc.add_new_rows
    db_proc.is_active = proc.is_active
    db.commit()
    db.refresh(db_proc)
    db_proc.field_mappings = json.loads(db_proc.field_mappings)
    return db_proc

@router.post("/{process_id}/stage")
def stage_process(process_id: int, db: Session = Depends(get_db)):
    invalidate_read_cache()  # leer fresco: reflejar ediciones externas de BASE/Master
    proc = db.query(models.Process).filter(models.Process.id == process_id).first()
    if not proc:
        raise HTTPException(status_code=404, detail="Proceso no encontrado")

    project, master_conn, master_sheet = _get_master_info(db)
    if (not project or not master_conn) and not (proc.target_connection_id and proc.target_sheet_name):
        raise HTTPException(status_code=400, detail="No hay tabla maestra enlazada y el proceso no tiene destino propio.")

    field_mappings = json.loads(proc.field_mappings) if isinstance(proc.field_mappings, str) else proc.field_mappings

    req = schemas.MasterSyncRequest(
        source_connection_id=proc.source_connection_id,
        source_sheet_name=proc.source_sheet_name,
        target_connection_id=proc.target_connection_id,
        target_sheet_name=proc.target_sheet_name,
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
            "rows_orphan": result.get("rows_orphan", 0),
            "coherence_index": result.get("coherence_index", 100),
            "warnings": [],
            "changes": result.get("changes", []),
            "new_rows": result.get("new_rows", []),
            "detail_added": result.get("detail_added", []),
            "detail_orphan": result.get("detail_orphan", []),
            "total_rows_before": result.get("total_rows_before", 0),
            "total_origen": result.get("total_origen", 0),
            "lavadero": result.get("lavadero", {})
        }
        batch = models.StagingBatch(
            process_id=process_id,
            status="pending",
            normalized_data=json.dumps(master_raw, ensure_ascii=False),
            diff_result=json.dumps(diff_summary, ensure_ascii=False),
            expires_at=datetime.utcnow() + timedelta(minutes=30)
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
