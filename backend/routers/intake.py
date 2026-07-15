from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Header, Request
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
import json
import secrets
from .. import models, schemas
from ..database import get_db

# Mismo umbral del Guardián que usa el scheduler: sin humano que confirme,
# baja coincidencia + filas nuevas = probable formato de SKU roto → no escribir.
LOW_MATCH_THRESHOLD = 10.0

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

@router.put("/apps/{app_id}", response_model=schemas.ConnectedApp)
def update_connected_app(app_id: int, app_req: schemas.ConnectedAppCreate, db: Session = Depends(get_db)):
    """Actualiza la app conectada; en particular, vincularla a una Fuente
    (target_process_id) para que sus push entren por el túnel real."""
    app = db.query(models.ConnectedApp).filter(models.ConnectedApp.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="App no encontrada")
    if app_req.target_process_id:
        proc = db.query(models.Process).filter(models.Process.id == app_req.target_process_id).first()
        if not proc:
            raise HTTPException(status_code=400, detail="La Fuente (proceso) indicada no existe.")
    app.name = app_req.name
    app.target_project_id = app_req.target_project_id
    app.target_process_id = app_req.target_process_id
    app.is_active = app_req.is_active
    db.commit()
    db.refresh(app)
    return app


@router.delete("/apps/{app_id}")
def delete_connected_app(app_id: int, db: Session = Depends(get_db)):
    app = db.query(models.ConnectedApp).filter(models.ConnectedApp.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="App no encontrada")
    db.delete(app)
    db.commit()
    return {"message": "App eliminada"}

def _payload_to_table(data_list: List[Dict[str, Any]]) -> List[List[str]]:
    """JSON [{...}, ...] → matriz [[headers], [fila], ...]. Conserva el orden
    de llaves del primer registro (y agrega al final las que aparezcan luego)."""
    headers: List[str] = []
    for item in data_list:
        if isinstance(item, dict):
            for k in item.keys():
                if k not in headers:
                    headers.append(k)
    raw_table = [headers]
    for item in data_list:
        if isinstance(item, dict):
            raw_table.append([str(item.get(h, "") if item.get(h) is not None else "") for h in headers])
    return raw_table


def _run_pushed_sync(db, app, proc, raw_table, background_tasks):
    """Túnel real para datos empujados: mismo motor del sync manual/automático
    (_compute_master_sync con Lavadero), Guardián en modo automático (sin humano
    que confirme → si cruza <10% con filas nuevas, se salta), escritura
    quirúrgica y propagación en background (hijas + Shopify + canales API)."""
    from ..services import _compute_master_sync, write_sheet_data_surgical, invalidate_read_cache
    from .logs import log_event

    project = db.query(models.Project).filter(models.Project.master_connection_id.isnot(None)).first()
    if not project:
        raise HTTPException(status_code=400, detail="No hay tabla maestra enlazada.")

    field_mappings = json.loads(proc.field_mappings) if isinstance(proc.field_mappings, str) else proc.field_mappings

    src_headers = raw_table[0]
    if proc.sku_column_source not in src_headers:
        raise HTTPException(
            status_code=400,
            detail=(f"El payload no trae la columna llave '{proc.sku_column_source}' que espera la "
                    f"Fuente '{proc.name}'. Columnas recibidas: {src_headers[:20]}"),
        )

    invalidate_read_cache()  # leer la Maestra fresca

    req = schemas.MasterSyncRequest(
        source_connection_id=proc.source_connection_id,
        source_sheet_name=proc.source_sheet_name,
        target_connection_id=proc.target_connection_id,
        target_sheet_name=proc.target_sheet_name,
        sku_column_source=proc.sku_column_source,
        sku_column_master=proc.sku_column_master,
        field_mappings=field_mappings,
        add_new_rows=proc.add_new_rows,
    )
    result = _compute_master_sync(project, req, db, src_raw_override=raw_table)

    changes = result.get("changes", [])
    new_rows = result.get("new_rows", [])
    coherence = result.get("coherence_index", 100)

    # Guardián en automático (mismo umbral que el scheduler).
    if new_rows and coherence < LOW_MATCH_THRESHOLD:
        log_event(db, "INTAKE_PUSH_SKIP", "warning",
                  f"Push de '{app.name}' saltado: coincidencia {coherence}% con "
                  f"{len(new_rows)} filas nuevas (posible formato de SKU incorrecto). No se escribió nada.",
                  proc.id)
        return {
            "message": "Push recibido pero NO escrito: el Guardián detectó baja coincidencia de SKUs.",
            "written": False,
            "coherence_index": coherence,
            "rows_would_add": len(new_rows),
            "lavadero": result.get("lavadero"),
        }

    if changes or new_rows:
        master_raw = result["master_raw"]
        target_conn = result["master_conn"]
        write_sheet_data_surgical(
            spreadsheet_id=target_conn.spreadsheet_id,
            sheet_name=result["target_sheet_name"],
            headers=master_raw[0],
            changes=changes,
            new_rows=new_rows,
            total_rows_before=len(master_raw) - 1 - len(new_rows),
        )
        from ..propagation import propagate_changes
        background_tasks.add_task(propagate_changes, project.id, changes, new_rows)

    log_event(db, "INTAKE_PUSH_OK", "success",
              f"Push de '{app.name}' vía Fuente '{proc.name}': {len(changes)} cambios, "
              f"{len(new_rows)} filas nuevas.",
              proc.id, None, None, len(changes) + len(new_rows))

    return {
        "message": "Datos escritos en la Maestra por el túnel de la Fuente.",
        "written": bool(changes or new_rows),
        "rows_updated": result.get("rows_updated", 0),
        "rows_added": result.get("rows_added", 0),
        "rows_unchanged": result.get("rows_unchanged", 0),
        "coherence_index": coherence,
        "lavadero": result.get("lavadero"),
    }


@router.post("/push")
async def receive_external_data(
    request: Request,
    background_tasks: BackgroundTasks,
    app: models.ConnectedApp = Depends(verify_api_key),
    db: Session = Depends(get_db)
):
    """
    Entrada por API EMPUJADA: un sistema externo manda su catálogo (JSON, un
    objeto o un array de objetos) cuando quiera, autenticado con su API key.

    - Si la app está vinculada a una Fuente (target_process_id), los datos
      entran por el TÚNEL REAL: Lavadero → Guardián → escritura quirúrgica a
      la Maestra → propagación (hijas + Shopify + canales API). Es el mismo
      motor del sync manual; solo cambia de dónde vienen las filas.
    - Sin Fuente vinculada, se conserva el comportamiento anterior: el lote
      queda encolado en Staging para revisión (sin escribir nada).
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    data_list = payload if isinstance(payload, list) else [payload]
    if not data_list:
        return {"message": "Payload empty", "rows_received": 0}

    raw_table = _payload_to_table(data_list)
    if len(raw_table) < 2:
        raise HTTPException(status_code=400, detail="El payload no trae registros con campos (se esperaban objetos JSON).")

    # ── Camino nuevo: túnel real vía la Fuente vinculada ──
    if app.target_process_id:
        proc = db.query(models.Process).filter(models.Process.id == app.target_process_id).first()
        if not proc:
            raise HTTPException(status_code=400, detail="La Fuente vinculada a esta app ya no existe. Revínculala en Conexiones de Apps.")
        if not proc.is_active:
            raise HTTPException(status_code=400, detail=f"La Fuente '{proc.name}' está pausada; reactívala para recibir push.")
        summary = _run_pushed_sync(db, app, proc, raw_table, background_tasks)
        summary["rows_received"] = len(data_list)
        return summary

    # ── Camino anterior (sin Fuente vinculada): encolar en Staging ──
    diff_summary = {
        "rows_to_update": len(raw_table) - 1,
        "rows_to_add": 0,
        "rows_unchanged": 0,
        "warnings": ["Datos recibidos de API Externa. Vincula esta app a una Fuente para que escriban solos por el túnel."]
    }
    batch = models.StagingBatch(
        process_id=None,
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
