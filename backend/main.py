from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form
import os
import shutil
from datetime import datetime
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from . import models, schemas
from .database import engine, get_db

# Create DB tables
models.Base.metadata.create_all(bind=engine)

# Auto-migrate DB (agregando las columnas nuevas si faltan)
try:
    with engine.connect() as conn:
        from sqlalchemy import text
        conn.execute(text("ALTER TABLE projects ADD COLUMN master_connection_id INTEGER"))
        conn.execute(text("ALTER TABLE projects ADD COLUMN master_sheet_name VARCHAR"))
        conn.commit()
except Exception as e:
    print("Migraciones omitidas (ya existen las columnas o error benigno):", e)

try:
    with engine.connect() as conn:
        from sqlalchemy import text
        conn.execute(text("ALTER TABLE projects ADD COLUMN master_sku_column VARCHAR"))
        conn.commit()
        print("Migración master_sku_column aplicada.")
except Exception as e:
    print("Migración master_sku_column omitida (ya existe):", e)

try:
    with engine.connect() as conn:
        from sqlalchemy import text
        conn.execute(text("ALTER TABLE connections ADD COLUMN http_url VARCHAR"))
        conn.execute(text("ALTER TABLE connections ADD COLUMN http_method VARCHAR DEFAULT 'GET'"))
        conn.execute(text("ALTER TABLE connections ADD COLUMN http_headers TEXT"))
        conn.commit()
        print("Migraciones de conexiones aplicadas con éxito.")
except Exception as e:
    print("Migraciones omitidas para connections (ya existen las columnas o error benigno):", e)

try:
    with engine.connect() as conn:
        from sqlalchemy import text
        conn.execute(text("ALTER TABLE processes ADD COLUMN target_connection_id INTEGER"))
        conn.execute(text("ALTER TABLE processes ADD COLUMN target_sheet_name VARCHAR"))
        conn.commit()
        print("Migraciones de processes aplicadas con éxito.")
except Exception as e:
    print("Migraciones omitidas para processes (ya existen las columnas o error benigno):", e)

# Columnas Shopify (una conexión por tienda; cada ALTER en su propia transacción
# para que si una columna ya existe no aborte la creación de las demás).
for _col_sql in (
    "ALTER TABLE connections ADD COLUMN shopify_domain VARCHAR",
    "ALTER TABLE connections ADD COLUMN shopify_client_id VARCHAR",
    "ALTER TABLE connections ADD COLUMN shopify_client_secret VARCHAR",
    "ALTER TABLE connections ADD COLUMN shopify_access_token VARCHAR",
    "ALTER TABLE connections ADD COLUMN shopify_api_version VARCHAR",
):
    try:
        with engine.connect() as conn:
            from sqlalchemy import text
            conn.execute(text(_col_sql))
            conn.commit()
    except Exception as e:
        print(f"Migración Shopify omitida ({_col_sql.split('ADD COLUMN ')[1]}):", e)

app = FastAPI(title="Actualizar Tablas K API")

# CORS
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import traceback
from fastapi.responses import JSONResponse
from starlette.requests import Request

last_exception_traceback = "No ha ocurrido ningún error aún."

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    global last_exception_traceback
    error_msg = traceback.format_exc()
    last_exception_traceback = error_msg
    print("GLOBAL EXCEPTION:", error_msg)

    try:
        from .routers.logs import log_event
        db = next(get_db())
        log_event(
            db=db,
            event_type="UNHANDLED_EXCEPTION",
            status="error",
            message=f"Error inesperado: {str(exc)}",
            technical_detail=error_msg
        )
    except Exception as db_exc:
        print("Fallo al guardar log en DB:", db_exc)

    # No exponer el traceback al cliente en producción (fuga de información interna).
    # Solo se devuelve si DEBUG está activo explícitamente.
    content = {"detail": "Internal Server Error"}
    if os.getenv("DEBUG", "").lower() in ("1", "true", "yes"):
        content["traceback"] = error_msg

    return JSONResponse(status_code=500, content=content)


# ═══════════════════════════════════════════════════════════════════
# ██ FUNCIONES INTERNAS COMPARTIDAS (deben definirse ANTES de los routers)
# ═══════════════════════════════════════════════════════════════════

def _get_master_info(db):
    """Obtiene el proyecto, conexión maestra y nombre de hoja activos."""
    project = db.query(models.Project).filter(
        models.Project.master_connection_id.isnot(None)
    ).first()
    if not project:
        return None, None, None
    master_conn = db.query(models.Connection).filter(
        models.Connection.id == project.master_connection_id
    ).first()
    return project, master_conn, project.master_sheet_name

from .services import _run_single_process


# ═══════════════════════════════════════════════════════════════════
# ██ SEED: maestra enlazada por defecto (útil en previews con DB vacía)
# ═══════════════════════════════════════════════════════════════════

DEFAULT_MASTER_SPREADSHEET_ID = "1fjpAJUk_wfAR5lcxRza7Zqn18yLqh_w_Q-FmSfgtXTM"
DEFAULT_MASTER_SHEET_NAME = "Maestra"
DEFAULT_MASTER_SKU_COLUMN = "sku"

def _seed_default_master():
    """Si no hay ninguna maestra enlazada, crea la conexión y el enlace por defecto."""
    db = next(get_db())
    try:
        existing = db.query(models.Project).filter(
            models.Project.master_connection_id.isnot(None)
        ).first()
        if existing:
            return  # Ya hay una maestra enlazada, no tocar nada

        # Buscar (o crear) la conexión al sheet maestro por defecto
        conn = db.query(models.Connection).filter(
            models.Connection.spreadsheet_id == DEFAULT_MASTER_SPREADSHEET_ID
        ).first()
        if not conn:
            conn = models.Connection(
                name="MAESTRA KINO",
                google_sheet_url=f"https://docs.google.com/spreadsheets/d/{DEFAULT_MASTER_SPREADSHEET_ID}/edit",
                spreadsheet_id=DEFAULT_MASTER_SPREADSHEET_ID,
                connection_type="google_sheets"
            )
            db.add(conn)
            db.commit()
            db.refresh(conn)

        # Buscar (o crear) el proyecto y enlazar la maestra
        project = db.query(models.Project).first()
        if not project:
            project = models.Project(name="Global Project")
            db.add(project)
            db.commit()
            db.refresh(project)

        project.master_connection_id = conn.id
        project.master_sheet_name = DEFAULT_MASTER_SHEET_NAME
        project.master_sku_column = DEFAULT_MASTER_SKU_COLUMN
        db.commit()
        print(f"Seed: maestra por defecto enlazada (conn {conn.id}, hoja '{DEFAULT_MASTER_SHEET_NAME}', sku '{DEFAULT_MASTER_SKU_COLUMN}').")
    except Exception as e:
        print("Seed de maestra omitido (error benigno):", e)
    finally:
        db.close()

_seed_default_master()


# ═══════════════════════════════════════════════════════════════════
# ██ ROUTERS (deben importarse DESPUÉS de las funciones internas)
# ═══════════════════════════════════════════════════════════════════

from .routers import logs, staging, connections, processes, intake, subscriptions, intelligence, shopify_sync
app.include_router(logs.router)
app.include_router(staging.router)
app.include_router(connections.router)
app.include_router(processes.router)
app.include_router(intake.router)
app.include_router(subscriptions.router)
app.include_router(intelligence.router)
app.include_router(shopify_sync.router)


# --- Reset DB (Solo Desarrollo) ---
@app.post("/api/debug/reset-db")
def reset_database():
    # Endpoint destructivo: borra TODA la base de datos. Solo disponible si
    # ALLOW_DB_RESET está habilitado explícitamente (nunca en producción).
    if os.getenv("ALLOW_DB_RESET", "").lower() not in ("1", "true", "yes"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operación deshabilitada. Configura ALLOW_DB_RESET=true para habilitarla."
        )
    models.Base.metadata.drop_all(bind=engine)
    models.Base.metadata.create_all(bind=engine)
    return {"message": "Base de datos reseteada con éxito. Actualiza la página."}


# --- Projects ---
@app.post("/api/projects/", response_model=schemas.Project)
def create_project(project: schemas.ProjectCreate, db: Session = Depends(get_db)):
    db_project = models.Project(**project.model_dump(), user_id=1)
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project


from .services import get_sheet_metadata, get_sheet_data, write_sheet_data
from .sync_engine import process_sync
from pydantic import BaseModel
from typing import Dict, List, Any
import json


# --- Sync (legacy, mantenido por compatibilidad) ---
class SyncPreviewRequest(BaseModel):
    project_id: int
    target_connection_id: int
    target_sheet_name: str
    target_key: str
    source_connections: Dict[str, int]
    mappings: List[Dict[str, Any]]

@app.post("/api/sync/preview")
def preview_sync(req: SyncPreviewRequest, db: Session = Depends(get_db)):
    target_conn = db.query(models.Connection).filter(models.Connection.id == req.target_connection_id).first()
    if not target_conn: raise HTTPException(status_code=404, detail="Destino no encontrado")

    target_data = get_sheet_data(target_conn, f"{req.target_sheet_name}!A1:Z")

    source_datasets = {}
    for source_name, conn_id in req.source_connections.items():
        src_conn = db.query(models.Connection).filter(models.Connection.id == conn_id).first()
        if src_conn:
            source_datasets[source_name] = get_sheet_data(src_conn, f"{source_name}!A1:Z")

    result = process_sync(target_data, source_datasets, req.mappings, req.target_key)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    return result

@app.post("/api/sync/execute")
def execute_sync(req: SyncPreviewRequest, db: Session = Depends(get_db)):
    preview = preview_sync(req, db)

    target_conn = db.query(models.Connection).filter(models.Connection.id == req.target_connection_id).first()
    if not target_conn or not target_conn.spreadsheet_id:
        raise HTTPException(status_code=400, detail="La conexión destino no tiene un Google Sheet asociado para escribir.")

    preview_data = preview.get("preview_data", [])
    if preview_data and preview.get("rows_changed", 0) > 0:
        write_result = write_sheet_data(
            spreadsheet_id=target_conn.spreadsheet_id,
            sheet_name=req.target_sheet_name,
            data=preview_data
        )
    else:
        write_result = {"rows_written": 0, "note": "Sin cambios detectados, no se escribió nada."}

    db_log = models.SyncLog(
        project_id=req.project_id,
        rows_changed=preview.get("rows_changed", 0),
        rows_added=preview.get("rows_added", 0),
        errors=preview.get("errors", 0),
        status="success"
    )
    db.add(db_log)
    db.commit()
    db.refresh(db_log)

    return {
        "message": f"Sincronización ejecutada: {preview.get('rows_changed', 0)} filas actualizadas.",
        "log_id": db_log.id,
        "rows_changed": preview.get("rows_changed", 0),
        "rows_added": preview.get("rows_added", 0),
        "google_sheets_result": write_result
    }


# --- Export Formats ---
import csv
import io
from fastapi.responses import StreamingResponse

@app.post("/api/exports/", response_model=schemas.ExportFormat)
def create_export_format(fmt: schemas.ExportFormatCreate, db: Session = Depends(get_db)):
    import re
    output_spreadsheet_id = fmt.output_spreadsheet_id
    if output_spreadsheet_id and 'docs.google.com' in output_spreadsheet_id:
        match = re.search(r'/d/([a-zA-Z0-9-_]+)', output_spreadsheet_id)
        output_spreadsheet_id = match.group(1) if match else output_spreadsheet_id

    db_fmt = models.ExportFormat(
        name=fmt.name,
        description=fmt.description,
        project_id=fmt.project_id,
        source_connection_id=fmt.source_connection_id,
        source_sheet_name=fmt.source_sheet_name,
        columns_mapping=json.dumps(fmt.columns_mapping, ensure_ascii=False),
        output_type=fmt.output_type,
        output_spreadsheet_id=output_spreadsheet_id,
        output_sheet_name=fmt.output_sheet_name
    )
    db.add(db_fmt)
    db.commit()
    db.refresh(db_fmt)
    db_fmt.columns_mapping = json.loads(db_fmt.columns_mapping)
    return db_fmt

@app.get("/api/exports/", response_model=list[schemas.ExportFormat])
def read_export_formats(project_id: int = None, db: Session = Depends(get_db)):
    q = db.query(models.ExportFormat)
    if project_id:
        q = q.filter(models.ExportFormat.project_id == project_id)
    results = q.all()
    for r in results:
        r.columns_mapping = json.loads(r.columns_mapping)
    return results

@app.delete("/api/exports/{export_id}")
def delete_export_format(export_id: int, db: Session = Depends(get_db)):
    fmt = db.query(models.ExportFormat).filter(models.ExportFormat.id == export_id).first()
    if not fmt:
        raise HTTPException(status_code=404, detail="Formato de salida no encontrado")
    db.delete(fmt)
    db.commit()
    return {"message": "Formato de salida eliminado"}

@app.get("/api/exports/{export_id}/download")
def download_export_csv(export_id: int, db: Session = Depends(get_db)):
    fmt = db.query(models.ExportFormat).filter(models.ExportFormat.id == export_id).first()
    if not fmt:
        raise HTTPException(status_code=404, detail="Formato de salida no encontrado")

    col_map: dict = json.loads(fmt.columns_mapping)
    conn = db.query(models.Connection).filter(models.Connection.id == fmt.source_connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Conexión de la Tabla Master no encontrada")

    raw_data = get_sheet_data(conn, f"{fmt.source_sheet_name}!A1:Z")
    if not raw_data:
        raise HTTPException(status_code=400, detail="La tabla master está vacía o no se pudo leer")

    master_headers = raw_data[0]
    master_rows = raw_data[1:]

    output = io.StringIO()
    writer = csv.writer(output)
    csv_headers = list(col_map.values())
    writer.writerow(csv_headers)

    for row in master_rows:
        row_dict = {master_headers[i]: (row[i] if i < len(row) else "") for i in range(len(master_headers))}
        csv_row = [row_dict.get(master_col, "") for master_col in col_map.keys()]
        writer.writerow(csv_row)

    output.seek(0)
    filename = f"{fmt.name.replace(' ', '_').lower()}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.post("/api/exports/{export_id}/push")
def push_export_to_sheets(export_id: int, db: Session = Depends(get_db)):
    fmt = db.query(models.ExportFormat).filter(models.ExportFormat.id == export_id).first()
    if not fmt:
        raise HTTPException(status_code=404, detail="Formato de salida no encontrado")
    if fmt.output_type != "google_sheets":
        raise HTTPException(status_code=400, detail="Este formato no tiene Google Sheet destino configurado")
    if not fmt.output_spreadsheet_id or not fmt.output_sheet_name:
        raise HTTPException(status_code=400, detail="Configura el Google Sheet destino primero")

    col_map: dict = json.loads(fmt.columns_mapping)
    conn = db.query(models.Connection).filter(models.Connection.id == fmt.source_connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Conexión de la Tabla Master no encontrada")

    raw_data = get_sheet_data(conn, f"{fmt.source_sheet_name}!A1:Z")
    if not raw_data:
        raise HTTPException(status_code=400, detail="La tabla master está vacía o no se pudo leer")

    master_headers = raw_data[0]
    master_rows = raw_data[1:]

    output_data = [list(col_map.values())]
    for row in master_rows:
        row_dict = {master_headers[i]: (row[i] if i < len(row) else "") for i in range(len(master_headers))}
        output_row = [row_dict.get(master_col, "") for master_col in col_map.keys()]
        output_data.append(output_row)

    result = write_sheet_data(
        spreadsheet_id=fmt.output_spreadsheet_id,
        sheet_name=fmt.output_sheet_name,
        data=output_data
    )

    return {
        "message": f"Datos enviados a Google Sheets '{fmt.output_sheet_name}' exitosamente",
        "rows_written": result.get("rows_written", len(output_data) - 1),
        "mocked": result.get("mocked", False)
    }


# --- Actualizar Todo ---
@app.post("/api/sync/run-all")
def run_all_exports(project_id: int, db: Session = Depends(get_db)):
    results = []
    errors = []

    all_formats = db.query(models.ExportFormat)\
        .filter(models.ExportFormat.project_id == project_id)\
        .all()

    if not all_formats:
        return {"message": "No hay formatos de salida configurados para este proyecto.", "results": []}

    for fmt in all_formats:
        try:
            col_map: dict = json.loads(fmt.columns_mapping)
            conn = db.query(models.Connection)\
                .filter(models.Connection.id == fmt.source_connection_id).first()
            if not conn:
                errors.append({"format": fmt.name, "error": "Conexión origen no encontrada"})
                continue

            raw_data = get_sheet_data(conn, f"{fmt.source_sheet_name}!A1:Z")
            if not raw_data:
                errors.append({"format": fmt.name, "error": "Tabla Master vacía o sin datos"})
                continue

            master_headers = raw_data[0]
            master_rows = raw_data[1:]

            output_data = [list(col_map.values())]
            for row in master_rows:
                row_dict = {master_headers[i]: (row[i] if i < len(row) else "") for i in range(len(master_headers))}
                output_row = [row_dict.get(mc, "") for mc in col_map.keys()]
                output_data.append(output_row)

            if fmt.output_type == "google_sheets" and fmt.output_spreadsheet_id and fmt.output_sheet_name:
                write_result = write_sheet_data(
                    spreadsheet_id=fmt.output_spreadsheet_id,
                    sheet_name=fmt.output_sheet_name,
                    data=output_data
                )
                results.append({
                    "format": fmt.name,
                    "type": "google_sheets",
                    "rows_written": write_result.get("rows_written", len(output_data) - 1),
                    "status": "success"
                })
            elif fmt.output_type == "csv_download":
                results.append({
                    "format": fmt.name,
                    "type": "csv_download",
                    "rows_ready": len(output_data) - 1,
                    "download_url": f"/api/exports/{fmt.id}/download",
                    "status": "ready"
                })

        except Exception as e:
            errors.append({"format": fmt.name, "error": str(e)})

    db_log = models.SyncLog(
        project_id=project_id,
        rows_changed=sum(r.get("rows_written", r.get("rows_ready", 0)) for r in results),
        rows_added=0,
        errors=len(errors),
        status="success" if not errors else "partial"
    )
    db.add(db_log)
    db.commit()

    return {
        "message": f"{len(results)} formato(s) actualizados, {len(errors)} error(es)",
        "results": results,
        "errors": errors,
        "log_id": db_log.id
    }

@app.get("/api/projects/", response_model=list[schemas.Project])
def read_projects(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    projects = db.query(models.Project).offset(skip).limit(limit).all()
    return projects


# ═══════════════════════════════════════════════════════════════════
# ██ TABLA MAESTRA — Enlazada a Google Sheets
# ═══════════════════════════════════════════════════════════════════

@app.post("/api/projects/{project_id}/master-link")
def link_master_table(project_id: int, req: schemas.MasterLinkRequest, db: Session = Depends(get_db)):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")

    conn = db.query(models.Connection).filter(models.Connection.id == req.master_connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Conexión maestra no encontrada")

    project.master_connection_id = req.master_connection_id
    project.master_sheet_name = req.master_sheet_name
    db.commit()

    return {"message": "Tabla maestra enlazada correctamente"}


@app.get("/api/master")
def get_global_master(db: Session = Depends(get_db)):
    project, master_conn, master_sheet = _get_master_info(db)
    if not project or not master_conn:
        raise HTTPException(status_code=404, detail="No hay tabla maestra enlazada.")

    raw = get_sheet_data(master_conn, f"{master_sheet}!A1:Z")
    if not raw or len(raw) == 0:
        return {"columns": [], "rows": [], "total_rows": 0, "master_connection_id": project.master_connection_id, "master_sheet_name": master_sheet}

    columns = raw[0]
    rows = raw[1:] if len(raw) > 1 else []
    return {
        "columns": columns,
        "rows": rows,
        "total_rows": len(rows),
        "master_connection_id": project.master_connection_id,
        "master_sheet_name": master_sheet,
        "master_sku_column": project.master_sku_column or ""
    }

@app.post("/api/master/link")
def link_global_master(req: schemas.MasterLinkRequest, db: Session = Depends(get_db)):
    project = db.query(models.Project).first()
    if not project:
        project = models.Project(name="Global Project")
        db.add(project)
        db.commit()
        db.refresh(project)

    conn = db.query(models.Connection).filter(models.Connection.id == req.master_connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Conexión maestra no encontrada")

    project.master_connection_id = req.master_connection_id
    project.master_sheet_name = req.master_sheet_name
    if req.master_sku_column:
        project.master_sku_column = req.master_sku_column
    db.commit()

    return {"message": "Tabla maestra enlazada correctamente"}

@app.post("/api/master/unlink")
def unlink_global_master(db: Session = Depends(get_db)):
    project, _, _ = _get_master_info(db)
    if not project:
        return {"message": "No hay tabla maestra para desvincular"}
    project.master_connection_id = None
    project.master_sheet_name = None
    db.commit()
    return {"message": "Tabla maestra desvinculada"}


@app.get("/api/projects/{project_id}/master")
def get_master_table(project_id: int, db: Session = Depends(get_db)):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project or not project.master_connection_id:
        raise HTTPException(status_code=404, detail="El proyecto no tiene una tabla maestra enlazada")

    master_conn = db.query(models.Connection).filter(models.Connection.id == project.master_connection_id).first()

    raw = get_sheet_data(master_conn, f"{project.master_sheet_name}!A1:Z")
    if not raw:
        return {"columns": [], "rows": [], "total_rows": 0}

    headers = raw[0]
    rows = []

    for i, row in enumerate(raw[1:]):
        row_dict = {"_id": i}
        for j, h in enumerate(headers):
            row_dict[h] = row[j] if j < len(row) else ""
        rows.append(row_dict)

    return {
        "columns": headers,
        "rows": rows,
        "total_rows": len(rows),
        "master_connection_id": project.master_connection_id,
        "master_sheet_name": project.master_sheet_name
    }


@app.post("/api/projects/{project_id}/master-sync-preview")
def preview_master_sync(project_id: int, req: schemas.MasterSyncRequest, db: Session = Depends(get_db)):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project or not project.master_connection_id:
        raise HTTPException(status_code=404, detail="El proyecto no tiene una tabla maestra enlazada")

    result = _compute_master_sync(project, req, db)

    return {
        "rows_updated": result["rows_updated"],
        "rows_added": result["rows_added"],
        "rows_unchanged": result["rows_unchanged"],
        "total_origen": result["total_origen"],
        "total_maestra": result["total_maestra"],
        "detail_updated": result["detail_updated"],
        "detail_added": result["detail_added"],
        "detail_unchanged": result["detail_unchanged"],
    }


@app.post("/api/projects/{project_id}/master-sync")
def sync_to_master(project_id: int, req: schemas.MasterSyncRequest, db: Session = Depends(get_db)):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project or not project.master_connection_id:
        raise HTTPException(status_code=404, detail="El proyecto no tiene una tabla maestra enlazada")

    result = _compute_master_sync(project, req, db)
    master_raw = result["master_raw"]
    master_conn = result["master_conn"]

    write_result = write_sheet_data(master_conn.spreadsheet_id, project.master_sheet_name, master_raw)

    return {
        "message": f"Sincronización completada: {result['rows_updated']} actualizadas, {result['rows_added']} nuevas.",
        "rows_updated": result["rows_updated"],
        "rows_added": result["rows_added"],
        "rows_unchanged": result["rows_unchanged"],
        "google_sheets_result": write_result
    }


@app.get("/api/projects/{project_id}/master-columns")
def get_master_columns_for_export(project_id: int, db: Session = Depends(get_db)):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project or not project.master_connection_id:
        return []

    master_conn = db.query(models.Connection).filter(models.Connection.id == project.master_connection_id).first()
    from .services import get_sheet_metadata
    metadata = get_sheet_metadata(master_conn)
    return metadata.get(project.master_sheet_name, [])


from fastapi import BackgroundTasks

@app.post("/api/run-all")
def run_all(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    ⚡ BOTÓN MAESTRO: Ejecuta todo el ciclo.
    1. Corre todos los procesos de importación activos (origen → maestra)
    2. Corre todos los formatos de salida tipo google_sheets (maestra → hojas destino)
    """
    project, master_conn, master_sheet = _get_master_info(db)
    if not project or not master_conn:
        raise HTTPException(status_code=400, detail="No hay tabla maestra enlazada.")

    import_results = []
    export_results = []
    errors = []

    # ── PASO 1: Importar (Procesos activos) ──
    active_processes = db.query(models.Process).filter(models.Process.is_active == True).all()
    all_changes = []
    all_new_rows = []
    
    for proc in active_processes:
        result = _run_single_process(proc, db)
        # Normalizar clave para que el frontend siempre vea "process"
        result["process"] = result.pop("process_name", proc.name)
        if result["status"] == "success":
            import_results.append(result)
            all_changes.extend(result.get("changes", []))
            all_new_rows.extend(result.get("new_rows", []))
        else:
            errors.append(result)
            
    # Propagación asíncrona (Pilar 4/5)
    if all_changes or all_new_rows:
        from .propagation import propagate_changes
        background_tasks.add_task(propagate_changes, project.id, all_changes, all_new_rows)

    # ── PASO 2: Distribuir (Formatos de salida) ──
    all_formats = db.query(models.ExportFormat).filter(
        models.ExportFormat.project_id == project.id
    ).all()

    for fmt in all_formats:
        try:
            col_map = json.loads(fmt.columns_mapping)

            raw_data = get_sheet_data(master_conn, f"{master_sheet}!A1:Z")
            if not raw_data:
                errors.append({"process": f"Formato: {fmt.name}", "status": "error", "error": "Maestra vacía"})
                continue

            master_headers = raw_data[0]
            master_rows = raw_data[1:]

            output_data = [list(col_map.values())]
            for row in master_rows:
                row_dict = {master_headers[i]: (row[i] if i < len(row) else "") for i in range(len(master_headers))}
                output_row = [row_dict.get(mc, "") for mc in col_map.keys()]
                output_data.append(output_row)

            if fmt.output_type == "google_sheets" and fmt.output_spreadsheet_id and fmt.output_sheet_name:
                wr = write_sheet_data(
                    spreadsheet_id=fmt.output_spreadsheet_id,
                    sheet_name=fmt.output_sheet_name,
                    data=output_data
                )
                export_results.append({
                    "process": f"📤 {fmt.name}",
                    "status": "success",
                    "type": "google_sheets",
                    "rows_written": wr.get("rows_written", len(output_data) - 1)
                })
            elif fmt.output_type == "csv_download":
                export_results.append({
                    "process": f"📤 {fmt.name}",
                    "status": "ready",
                    "type": "csv_download",
                    "rows_ready": len(output_data) - 1,
                    "download_url": f"/api/exports/{fmt.id}/download"
                })
        except Exception as e:
            errors.append({"process": f"Formato: {fmt.name}", "status": "error", "error": str(e)})

    total_updated = sum(r.get("rows_updated", 0) for r in import_results)
    total_added = sum(r.get("rows_added", 0) for r in import_results)

    return {
        "message": f"Ciclo completo: {len(import_results)} procesos + {len(export_results)} formatos ejecutados.",
        "import_results": import_results,
        "export_results": export_results,
        "errors": errors,
        "summary": {
            "processes_ok": len(import_results),
            "exports_ok": len(export_results),
            "errors": len(errors),
            "total_rows_updated": total_updated,
            "total_rows_added": total_added
        }
    }


# ═══════════════════════════════════════════════════════════════════
# ██ REFLEJO AUTOMÁTICO: detectar ediciones manuales en la Maestra
# ██ y propagarlas a las hojas hijas suscritas (Opción A: snapshot/diff)
# ═══════════════════════════════════════════════════════════════════

def _resolve_master_sku_column(db, project):
    """Devuelve la columna llave (SKU) de la maestra. Usa la guardada en el proyecto si existe."""
    if project.master_sku_column:
        return project.master_sku_column
    # Fallback: inferir desde los procesos activos (compatibilidad)
    processes = db.query(models.Process).filter(models.Process.is_active == True).all()
    counts = {}
    for p in processes:
        if p.sku_column_master:
            counts[p.sku_column_master] = counts.get(p.sku_column_master, 0) + 1
    if not counts:
        return None
    return max(counts, key=counts.get)


def _index_master_by_sku(master_conn, master_sheet, sku_column):
    """Lee la maestra y devuelve (headers, {sku: {columna: valor}})."""
    raw = get_sheet_data(master_conn, f"{master_sheet}!A1:Z")
    if not raw or len(raw) < 1:
        return [], {}
    headers = raw[0]
    if sku_column not in headers:
        raise HTTPException(
            status_code=400,
            detail=f"La columna llave '{sku_column}' no existe en la maestra."
        )
    sku_idx = headers.index(sku_column)
    by_sku = {}
    for row in raw[1:]:
        sku_val = row[sku_idx] if sku_idx < len(row) else ""
        if not sku_val:
            continue
        by_sku[sku_val] = {
            headers[i]: (row[i] if i < len(row) else "") for i in range(len(headers))
        }
    return headers, by_sku


@app.post("/api/master/sync-reflection")
def sync_master_reflection(db: Session = Depends(get_db)):
    """
    Detecta cambios hechos manualmente en la Tabla Maestra (comparando contra la
    última 'foto' guardada) y los propaga a las hojas hijas suscritas.
    La primera vez solo guarda la línea base, sin propagar.
    """
    project, master_conn, master_sheet = _get_master_info(db)
    if not project or not master_conn:
        raise HTTPException(status_code=400, detail="No hay tabla maestra enlazada.")

    sku_column = _resolve_master_sku_column(db, project)
    if not sku_column:
        raise HTTPException(
            status_code=400,
            detail="No se pudo determinar la columna llave (SKU) de la maestra. "
                   "Crea al menos un proceso activo que defina la columna SKU."
        )

    headers, current_by_sku = _index_master_by_sku(master_conn, master_sheet, sku_column)

    snapshot = db.query(models.MasterSnapshot).filter(
        models.MasterSnapshot.project_id == project.id
    ).first()

    # Primera vez: solo guardamos la línea base
    if not snapshot:
        snapshot = models.MasterSnapshot(
            project_id=project.id,
            sku_column=sku_column,
            snapshot_data=json.dumps(current_by_sku)
        )
        db.add(snapshot)
        db.commit()
        return {
            "status": "baseline_saved",
            "message": "Línea base guardada. A partir de ahora se detectarán los cambios manuales.",
            "skus_registrados": len(current_by_sku),
            "changes": 0,
            "new_rows": 0
        }

    previous_by_sku = json.loads(snapshot.snapshot_data) if snapshot.snapshot_data else {}

    # Calcular diferencias: columnas modificadas y filas nuevas
    changes = []
    new_rows = []
    for sku, fields in current_by_sku.items():
        if sku not in previous_by_sku:
            new_fields = {col: val for col, val in fields.items() if col != sku_column}
            new_rows.append({"sku": sku, "fields": new_fields})
            continue
        prev_fields = previous_by_sku[sku]
        for col, val in fields.items():
            if col == sku_column:
                continue
            if prev_fields.get(col, "") != val:
                changes.append({"sku": sku, "field": col, "old": prev_fields.get(col, ""), "new": val})

    active_subs = db.query(models.FieldSubscription).filter(
        models.FieldSubscription.project_id == project.id,
        models.FieldSubscription.is_active == True
    ).count()

    propagated = False
    if changes or new_rows:
        try:
            from .propagation import propagate_changes
            propagate_changes(project.id, changes, new_rows)
            propagated = True
        except Exception as e:
            print("Error en propagación de reflejo:", e)

    # Actualizar la foto al estado actual
    snapshot.sku_column = sku_column
    snapshot.snapshot_data = json.dumps(current_by_sku)
    snapshot.updated_at = datetime.utcnow()
    db.commit()

    return {
        "status": "synced",
        "message": (
            f"{len(changes)} campo(s) y {len(new_rows)} fila(s) nueva(s) propagados a "
            f"{active_subs} suscripción(es)."
            if (changes or new_rows) else
            "No se detectaron cambios desde la última sincronización."
        ),
        "changes": len(changes),
        "new_rows": len(new_rows),
        "active_subscriptions": active_subs,
        "propagated": propagated
    }


# ═══════════════════════════════════════════════════════════════════
# ██ COLUMNAS DE LA MAESTRA (para UI)
# ═══════════════════════════════════════════════════════════════════

@app.get("/api/master-columns")
def get_master_columns(db: Session = Depends(get_db)):
    project, master_conn, master_sheet = _get_master_info(db)
    if not project or not master_conn:
        return []
    from .services import get_sheet_metadata
    metadata = get_sheet_metadata(master_conn)
    return metadata.get(master_sheet, [])


# --- Frontend Serving (Railway Single Deployment) ---
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

frontend_dist = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "dist")

if os.path.exists(frontend_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

    @app.get("/{catchall:path}")
    def serve_react_app(catchall: str):
        file_path = os.path.join(frontend_dist, catchall)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(frontend_dist, "index.html"))
