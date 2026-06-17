from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form
import os
import shutil
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

    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error", "traceback": error_msg}
    )


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


def _compute_master_sync(project, req, db):
    """Lógica compartida: calcula el cruce origen→maestra sin escribir. Retorna el resultado."""
    from .services import get_sheet_data

    # 1. Leer Origen
    src_conn = db.query(models.Connection).filter(models.Connection.id == req.source_connection_id).first()
    if not src_conn:
        raise HTTPException(status_code=404, detail="Conexión origen no encontrada")

    src_raw = get_sheet_data(src_conn, f"{req.source_sheet_name}!A1:Z")
    if not src_raw or len(src_raw) < 2:
        raise HTTPException(status_code=400, detail="La tabla origen está vacía")

    src_headers = src_raw[0]

    if req.sku_column_source not in src_headers:
        raise HTTPException(status_code=400, detail=f"Columna '{req.sku_column_source}' no encontrada en el origen.")
    src_sku_idx = src_headers.index(req.sku_column_source)

    # 2. Leer Maestra / Destino
    if req.target_connection_id and req.target_sheet_name:
        master_conn = db.query(models.Connection).filter(models.Connection.id == req.target_connection_id).first()
        target_sheet_name = req.target_sheet_name
    else:
        master_conn = db.query(models.Connection).filter(models.Connection.id == project.master_connection_id).first()
        target_sheet_name = project.master_sheet_name
        
    master_raw = get_sheet_data(master_conn, f"{target_sheet_name}!A1:Z")

    if not master_raw:
        master_headers = [req.sku_column_master] + list(set(req.field_mappings.values()))
        master_raw = [master_headers]
    else:
        master_headers = master_raw[0]

    for dst_col in req.field_mappings.values():
        if dst_col not in master_headers:
            master_headers.append(dst_col)
    master_raw[0] = master_headers

    if req.sku_column_master not in master_headers:
        raise HTTPException(status_code=400, detail=f"Columna SKU '{req.sku_column_master}' no encontrada en la maestra")
    master_sku_idx = master_headers.index(req.sku_column_master)

    # Indexar la maestra actual por SKU
    master_by_sku = {}
    for i, row in enumerate(master_raw[1:]):
        sku_val = row[master_sku_idx] if master_sku_idx < len(row) else ""
        if sku_val:
            padded_row = row + [""] * (len(master_headers) - len(row))
            master_by_sku[sku_val] = {"index": i + 1, "data": padded_row}

    rows_updated = 0
    rows_added = 0
    rows_unchanged = 0
    detail_updated = []
    detail_added = []
    detail_unchanged = []

    # 3. Procesar datos del Origen y cruzar con la Maestra
    for src_row in src_raw[1:]:
        sku_val = src_row[src_sku_idx] if src_sku_idx < len(src_row) else ""
        if not sku_val:
            continue

        if sku_val in master_by_sku:
            mr_info = master_by_sku[sku_val]
            mr_data = mr_info["data"]
            changed = False
            changes_detail = {}

            for src_col, dst_col in req.field_mappings.items():
                if src_col in src_headers:
                    s_idx = src_headers.index(src_col)
                    m_idx = master_headers.index(dst_col)
                    new_val = src_row[s_idx] if s_idx < len(src_row) else ""
                    old_val = mr_data[m_idx]
                    if old_val != new_val:
                        changes_detail[dst_col] = {"antes": old_val, "después": new_val}
                        mr_data[m_idx] = new_val
                        changed = True

            if changed:
                master_raw[mr_info["index"]] = mr_data
                rows_updated += 1
                detail_updated.append({"sku": sku_val, "cambios": changes_detail})
            else:
                rows_unchanged += 1
                detail_unchanged.append(sku_val)

        elif req.add_new_rows:
            new_mr_data = [""] * len(master_headers)
            new_mr_data[master_sku_idx] = sku_val

            new_fields = {}
            for src_col, dst_col in req.field_mappings.items():
                if src_col in src_headers:
                    s_idx = src_headers.index(src_col)
                    m_idx = master_headers.index(dst_col)
                    new_val = src_row[s_idx] if s_idx < len(src_row) else ""
                    new_mr_data[m_idx] = new_val
                    new_fields[dst_col] = new_val

            master_raw.append(new_mr_data)
            rows_added += 1
            detail_added.append({"sku": sku_val, "datos": new_fields})

    return {
        "master_raw": master_raw,
        "master_conn": master_conn,
        "target_sheet_name": target_sheet_name,
        "rows_updated": rows_updated,
        "rows_added": rows_added,
        "rows_unchanged": rows_unchanged,
        "total_origen": len(src_raw) - 1,
        "total_maestra": len(master_raw) - 1,
        "detail_updated": detail_updated[:50],
        "detail_added": detail_added[:50],
        "detail_unchanged": detail_unchanged[:50],
    }


def _run_single_process(proc, db):
    """Ejecuta un proceso individual: calcula el diff y escribe en Google Sheets."""
    import json as _json
    from .services import write_sheet_data

    try:
        project, master_conn, master_sheet = _get_master_info(db)
        if not project or not master_conn:
            return {"process": proc.name, "status": "error", "error": "No hay tabla maestra enlazada."}

        field_mappings = _json.loads(proc.field_mappings) if isinstance(proc.field_mappings, str) else proc.field_mappings

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
        master_raw = result["master_raw"]
        target_sheet_name = result["target_sheet_name"]
        target_conn = result["master_conn"]

        if result["rows_updated"] > 0 or result["rows_added"] > 0:
            write_sheet_data(target_conn.spreadsheet_id, target_sheet_name, master_raw)

        return {
            "process_name": proc.name,
            "status": "success",
            "rows_updated": result["rows_updated"],
            "rows_added": result["rows_added"],
            "rows_unchanged": result["rows_unchanged"],
        }
    except Exception as e:
        return {
            "process_name": proc.name,
            "status": "error",
            "error": str(e),
            "traceback": traceback.format_exc()
        }


# ═══════════════════════════════════════════════════════════════════
# ██ ROUTERS (deben importarse DESPUÉS de las funciones internas)
# ═══════════════════════════════════════════════════════════════════

from .routers import logs, staging, connections, processes, intake
app.include_router(logs.router)
app.include_router(staging.router)
app.include_router(connections.router)
app.include_router(processes.router)
app.include_router(intake.router)


# --- Reset DB (Solo Desarrollo) ---
@app.post("/api/debug/reset-db")
def reset_database():
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
        "master_sheet_name": master_sheet
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
    raw = get_sheet_data(master_conn, f"{project.master_sheet_name}!A1:Z1")

    if raw and len(raw) > 0:
        return raw[0]
    return []


@app.post("/api/run-all")
def run_all_processes_and_exports(db: Session = Depends(get_db)):
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
    for proc in active_processes:
        result = _run_single_process(proc, db)
        # Normalizar clave para que el frontend siempre vea "process"
        result["process"] = result.pop("process_name", proc.name)
        if result["status"] == "success":
            import_results.append(result)
        else:
            errors.append(result)

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
# ██ COLUMNAS DE LA MAESTRA (para UI)
# ═══════════════════════════════════════════════════════════════════

@app.get("/api/master-columns")
def get_master_columns(db: Session = Depends(get_db)):
    project, master_conn, master_sheet = _get_master_info(db)
    if not project or not master_conn:
        return []
    raw = get_sheet_data(master_conn, f"{master_sheet}!A1:Z1")
    if raw and len(raw) > 0:
        return raw[0]
    return []


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
