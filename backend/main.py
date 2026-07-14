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

# Columna transform_spec en export_formats (plantillas con transformaciones §11).
try:
    with engine.connect() as conn:
        from sqlalchemy import text
        conn.execute(text("ALTER TABLE export_formats ADD COLUMN transform_spec TEXT"))
        conn.commit()
        print("Migración transform_spec aplicada.")
except Exception as e:
    print("Migración transform_spec omitida (ya existe):", e)

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

from .routers import logs, staging, connections, processes, intake, subscriptions, intelligence, shopify_sync, shopify_master_sync, shopify_subscriptions, pipeline
app.include_router(logs.router)
app.include_router(staging.router)
app.include_router(connections.router)
app.include_router(processes.router)
app.include_router(intake.router)
app.include_router(subscriptions.router)
app.include_router(intelligence.router)
app.include_router(shopify_sync.router)
app.include_router(shopify_master_sync.router)
app.include_router(shopify_subscriptions.router)
app.include_router(pipeline.router)


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
from pydantic import BaseModel
from typing import Dict, List, Any
import json


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
        transform_spec=json.dumps(fmt.transform_spec, ensure_ascii=False) if fmt.transform_spec else None,
        output_type=fmt.output_type,
        output_spreadsheet_id=output_spreadsheet_id,
        output_sheet_name=fmt.output_sheet_name
    )
    db.add(db_fmt)
    db.commit()
    db.refresh(db_fmt)
    db_fmt.columns_mapping = json.loads(db_fmt.columns_mapping)
    db_fmt.transform_spec = json.loads(db_fmt.transform_spec) if db_fmt.transform_spec else None
    return db_fmt

@app.get("/api/exports/presets")
def list_export_presets():
    """Plantillas de salida predefinidas por canal (Shopify/Kyte/Effi/Catálogo)."""
    from .export_presets import get_presets
    return get_presets()

@app.get("/api/exports/", response_model=list[schemas.ExportFormat])
def read_export_formats(project_id: int = None, db: Session = Depends(get_db)):
    q = db.query(models.ExportFormat)
    if project_id:
        q = q.filter(models.ExportFormat.project_id == project_id)
    results = q.all()
    for r in results:
        r.columns_mapping = json.loads(r.columns_mapping)
        r.transform_spec = json.loads(r.transform_spec) if r.transform_spec else None
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

    conn = db.query(models.Connection).filter(models.Connection.id == fmt.source_connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Conexión de la Tabla Master no encontrada")

    raw_data = get_sheet_data(conn, f"{fmt.source_sheet_name}!A1:Z")
    if not raw_data:
        raise HTTPException(status_code=400, detail="La tabla master está vacía o no se pudo leer")

    master_headers = raw_data[0]
    master_rows = raw_data[1:]

    spec = json.loads(fmt.transform_spec) if fmt.transform_spec else None

    output = io.StringIO()
    writer = csv.writer(output)

    if spec:
        # Plantilla con transformaciones (§11): cada columna de salida se calcula
        # con su fórmula (field/concat/slug/price/const/template).
        from .export_engine import transform_headers, transform_row
        writer.writerow(transform_headers(spec))
        for row in master_rows:
            row_dict = {master_headers[i]: (row[i] if i < len(row) else "") for i in range(len(master_headers))}
            writer.writerow(transform_row(row_dict, spec))
    else:
        # Retrocompat: mapeo directo columna→columna (solo renombra).
        col_map: dict = json.loads(fmt.columns_mapping)
        writer.writerow(list(col_map.values()))
        for row in master_rows:
            row_dict = {master_headers[i]: (row[i] if i < len(row) else "") for i in range(len(master_headers))}
            writer.writerow([row_dict.get(master_col, "") for master_col in col_map.keys()])

    output.seek(0)
    filename = f"{fmt.name.replace(' ', '_').lower()}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.get("/api/projects/", response_model=list[schemas.Project])
def read_projects(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    projects = db.query(models.Project).offset(skip).limit(limit).all()
    return projects


# ═══════════════════════════════════════════════════════════════════
# ██ TABLA MAESTRA — Enlazada a Google Sheets
# ═══════════════════════════════════════════════════════════════════

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
