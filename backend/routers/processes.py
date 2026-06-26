from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from ..services import _compute_master_sync, _get_master_info, _run_single_process
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

# ──────────────────────────────────────────────────────────────────────────
# Procesos preestablecidos (plantillas): crean un proceso ya configurado
# usando el cerebro de auto-mapeo (intelligent_engine), para no mapear a mano.
# ──────────────────────────────────────────────────────────────────────────
PRESETS = {
    "base_to_master": {
        "name": "Sincronizar Master ← BASE",
        "description": "Trae código, nombre, precio y stock de la hoja BASE y los refleja en la Master. Cruza por SKU normalizado y crea en la Master lo que falte.",
        "source_sheet_aliases": ["base"],
    }
}
# Nombres típicos de la columna llave (SKU/código) en el origen.
_SOURCE_KEY_ALIASES = {"codigo", "código", "code", "cod", "sku", "id", "ref", "referencia"}


@router.get("/presets")
def list_presets():
    """Catálogo de procesos preestablecidos disponibles."""
    return [{"id": k, "name": v["name"], "description": v["description"]} for k, v in PRESETS.items()]


@router.post("/presets/{preset_id}", response_model=schemas.Process)
def create_preset(preset_id: str, db: Session = Depends(get_db)):
    """Crea (o actualiza) un proceso a partir de una plantilla, auto-detectando
    hoja origen, columna llave y mapeo de campos con el cerebro de auto-mapeo."""
    preset = PRESETS.get(preset_id)
    if not preset:
        raise HTTPException(status_code=404, detail="Preset no encontrado")

    from ..services import get_sheet_metadata, get_sheet_data
    from ..intelligent_engine import auto_map_columns, detect_potential_keys

    project, master_conn, master_sheet = _get_master_info(db)
    if not project or not master_conn:
        raise HTTPException(status_code=400, detail="Configura primero la Tabla Maestra (conexión maestra).")

    meta = get_sheet_metadata(master_conn)  # {hoja: [encabezados]}
    low = {k.lower(): k for k in meta.keys()}  # nombre-en-minúsculas -> nombre real

    def _resolve_sheet(wanted, fallbacks):
        if wanted and wanted in meta:
            return wanted
        if wanted and wanted.lower() in low:
            return low[wanted.lower()]
        for cand in fallbacks:
            if cand in low:
                return low[cand]
        return None

    base_sheet = _resolve_sheet(None, preset["source_sheet_aliases"])
    if not base_sheet:
        raise HTTPException(status_code=400, detail=f"No encontré la hoja BASE. Hojas disponibles: {', '.join(meta.keys())}")

    # Resolver la hoja maestra de forma flexible: la configurada ('Maestra'),
    # o por nombre real ('Master'), tolerando mayúsculas/idioma.
    real_master = _resolve_sheet(master_sheet, ["master", "maestra"])
    if not real_master:
        raise HTTPException(status_code=400, detail=f"No encontré la hoja maestra (config: '{master_sheet}'). Hojas disponibles: {', '.join(meta.keys())}")
    # Auto-corregir la config del proyecto si el nombre real difiere (raíz del bug).
    if real_master != project.master_sheet_name:
        project.master_sheet_name = real_master
        db.commit()
    master_sheet = real_master

    base_headers = meta.get(base_sheet) or []
    master_headers = meta.get(master_sheet) or []
    if not base_headers:
        raise HTTPException(status_code=400, detail=f"La hoja '{base_sheet}' no tiene encabezados.")
    if not master_headers:
        raise HTTPException(status_code=400, detail=f"La hoja maestra '{master_sheet}' no tiene encabezados.")

    # Columna SKU en la Master: resolver contra los encabezados reales (tolerando
    # mayúsculas) y auto-corregir la config si difiere.
    configured_sku = project.master_sku_column
    sku_master = None
    if configured_sku:
        sku_master = next((h for h in master_headers if h.lower() == configured_sku.lower()), None)
    if not sku_master:
        sku_master = next((h for h in master_headers if h.lower() == "sku"), master_headers[0])
    if sku_master != project.master_sku_column:
        project.master_sku_column = sku_master
        db.commit()

    # Columna llave en BASE: por nombre; si no, detección por datos.
    sku_source = next((h for h in base_headers if h.strip().lower() in _SOURCE_KEY_ALIASES), None)
    if not sku_source:
        rows = get_sheet_data(master_conn, f"{base_sheet}!A1:Z")[1:60]
        keys = detect_potential_keys(base_headers, rows)
        sku_source = keys[0]["columna"] if keys and keys[0]["confianza"] > 0 else base_headers[0]

    # Mapeo automático del núcleo (excluye la llave).
    field_mappings = {}
    for s in auto_map_columns(base_headers, master_headers):
        if s["source_field"] == sku_source:
            continue
        if s["target_field"] and s["confidence"] in ("exact", "semantic"):
            field_mappings[s["source_field"]] = s["target_field"]

    # Idempotente: si ya existe el proceso de esta plantilla, se actualiza.
    proc = db.query(models.Process).filter(models.Process.name == preset["name"]).first()
    if proc is None:
        proc = models.Process(name=preset["name"], description=preset["description"])
        db.add(proc)
    proc.description = preset["description"]
    proc.source_connection_id = master_conn.id
    proc.source_sheet_name = base_sheet
    proc.target_connection_id = None   # usa la maestra global
    proc.target_sheet_name = None
    proc.sku_column_source = sku_source
    proc.sku_column_master = sku_master
    proc.field_mappings = json.dumps(field_mappings, ensure_ascii=False)
    proc.add_new_rows = True
    proc.is_active = True
    db.commit()
    db.refresh(proc)
    proc.field_mappings = json.loads(proc.field_mappings)
    return proc


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

@router.post("/{process_id}/preview")
def preview_process(process_id: int, db: Session = Depends(get_db)):
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

    result = _compute_master_sync(project, req, db)

    return {
        "process_name": proc.name,
        "rows_updated": result["rows_updated"],
        "rows_added": result["rows_added"],
        "rows_unchanged": result["rows_unchanged"],
        "rows_orphan": result.get("rows_orphan", 0),
        "coherence_index": result.get("coherence_index", 100),
        "total_origen": result["total_origen"],
        "total_maestra": result["total_maestra"],
        "detail_updated": result["detail_updated"],
        "detail_added": result.get("detail_added", []),
        "detail_unchanged": result["detail_unchanged"],
        "detail_orphan": result.get("detail_orphan", []),
    }

@router.post("/{process_id}/stage")
def stage_process(process_id: int, db: Session = Depends(get_db)):
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
            "total_origen": result.get("total_origen", 0)
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

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
# ... other imports ...
@router.post("/{process_id}/run")
def run_process(process_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    proc = db.query(models.Process).filter(models.Process.id == process_id).first()
    if not proc:
        raise HTTPException(status_code=404, detail="Proceso no encontrado")

    result = _run_single_process(proc, db)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result.get("error", "Error desconocido"))

    # Propagación asíncrona (Pilar 4/5)
    # propagate_changes abre su propia sesión de DB, por eso NO se le pasa `db`.
    project, _, _ = _get_master_info(db)
    if project:
        from ..propagation import propagate_changes
        background_tasks.add_task(propagate_changes, project.id, result.get("changes", []), result.get("new_rows", []))

    return result
