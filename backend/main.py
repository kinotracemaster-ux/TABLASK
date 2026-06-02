from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form
import os
import shutil
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from . import models, schemas
from .database import engine, get_db

# Create DB tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Actualizar Tablas K API")

# CORS: en producción aceptamos cualquier origen (Railway + Vercel)
# En desarrollo local solo localhost:5173
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# El endpoint raíz ahora servirá el frontend de React (ver al final del archivo)

# --- Connections ---
@app.post("/api/connections/", response_model=schemas.Connection)
def create_connection(connection: schemas.ConnectionCreate, db: Session = Depends(get_db)):
    import re
    # Extract spreadsheet_id from URL
    match = re.search(r'/d/([a-zA-Z0-9-_]+)', connection.google_sheet_url)
    if not match:
        raise HTTPException(status_code=400, detail="URL de Google Sheets inválida")
    
    spreadsheet_id = match.group(1)
    
    db_connection = models.Connection(
        name=connection.name, 
        google_sheet_url=connection.google_sheet_url,
        spreadsheet_id=spreadsheet_id
    )
    db.add(db_connection)
    db.commit()
    db.refresh(db_connection)
    return db_connection

@app.post("/api/connections/upload", response_model=schemas.Connection)
def upload_connection(name: str = Form(...), file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not os.path.exists("uploads"):
        os.makedirs("uploads")
    
    file_path = f"uploads/{file.filename}"
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    db_connection = models.Connection(
        name=name,
        google_sheet_url=None,
        spreadsheet_id=None,
        user_id=1, # Mock user
        connection_type="local_file",
        file_path=file_path
    )
    db.add(db_connection)
    db.commit()
    db.refresh(db_connection)
    return db_connection

@app.get("/api/connections/", response_model=list[schemas.Connection])
def read_connections(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    connections = db.query(models.Connection).offset(skip).limit(limit).all()
    return connections

# --- Projects ---
@app.post("/api/projects/", response_model=schemas.Project)
def create_project(project: schemas.ProjectCreate, db: Session = Depends(get_db)):
    db_project = models.Project(**project.model_dump(), user_id=1)
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project

from .services import get_sheet_metadata, get_sheet_data
from .sync_engine import process_sync
from pydantic import BaseModel
from typing import Dict, List, Any

# --- Sheets Metadata ---
@app.get("/api/connections/{connection_id}/metadata")
def read_sheet_metadata(connection_id: int, db: Session = Depends(get_db)):
    try:
        connection = db.query(models.Connection).filter(models.Connection.id == connection_id).first()
        if not connection:
            raise HTTPException(status_code=404, detail="Conexión no encontrada")
        metadata = get_sheet_metadata(connection)
        return {"connection_id": connection_id, "sheets": metadata}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# --- Sync ---
class SyncPreviewRequest(BaseModel):
    project_id: int
    target_connection_id: int
    target_sheet_name: str
    target_key: str
    source_connections: Dict[str, int] # e.g. {"Productos": 1}
    mappings: List[Dict[str, Any]] # list of dicts

@app.post("/api/sync/preview")
def preview_sync(req: SyncPreviewRequest, db: Session = Depends(get_db)):
    target_conn = db.query(models.Connection).filter(models.Connection.id == req.target_connection_id).first()
    if not target_conn: raise HTTPException(status_code=404, detail="Destino no encontrado")
    
    # 1. Traer datos destino
    target_data = get_sheet_data(target_conn, f"{req.target_sheet_name}!A1:Z")
    
    # 2. Traer datos origen
    source_datasets = {}
    for source_name, conn_id in req.source_connections.items():
        src_conn = db.query(models.Connection).filter(models.Connection.id == conn_id).first()
        if src_conn:
            source_datasets[source_name] = get_sheet_data(src_conn, f"{source_name}!A1:Z")
        
    # 3. Procesar
    result = process_sync(target_data, source_datasets, req.mappings, req.target_key)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
        
    return result

@app.post("/api/sync/execute")
def execute_sync(req: SyncPreviewRequest, db: Session = Depends(get_db)):
    preview = preview_sync(req, db)
    
    # Guardar SyncLog
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
    
    return {"message": "Sincronización ejecutada con éxito", "log_id": db_log.id, "preview": preview}

# --- Export Formats ---
import json
import csv
import io
from fastapi.responses import StreamingResponse

@app.post("/api/exports/", response_model=schemas.ExportFormat)
def create_export_format(fmt: schemas.ExportFormatCreate, db: Session = Depends(get_db)):
    import re
    # Si viene una URL de Google Sheets como destino, extraer el ID
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
    # Parse JSON column mapping for each
    for r in results:
        r.columns_mapping = json.loads(r.columns_mapping)
    return results

@app.get("/api/exports/{export_id}/download")
def download_export_csv(export_id: int, db: Session = Depends(get_db)):
    """Genera y descarga un CSV en base a la plantilla de salida."""
    fmt = db.query(models.ExportFormat).filter(models.ExportFormat.id == export_id).first()
    if not fmt:
        raise HTTPException(status_code=404, detail="Formato de salida no encontrado")

    # Cargar el mapeo de columnas
    col_map: dict = json.loads(fmt.columns_mapping)  # {"col_master": "col_csv", ...}

    # Obtener conexión (Tabla Master)
    conn = db.query(models.Connection).filter(models.Connection.id == fmt.source_connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Conexión de la Tabla Master no encontrada")

    # Leer todos los datos de la hoja
    raw_data = get_sheet_data(conn, f"{fmt.source_sheet_name}!A1:Z")
    if not raw_data:
        raise HTTPException(status_code=400, detail="La tabla master está vacía o no se pudo leer")

    master_headers = raw_data[0]
    master_rows = raw_data[1:]

    # Filtrar y renombrar columnas
    output = io.StringIO()
    writer = csv.writer(output)

    # Cabeceras del CSV de salida (los valores del mapeo)
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
    """Empuja los datos transformados directamente a un Google Sheet destino."""
    from .services import write_sheet_data

    fmt = db.query(models.ExportFormat).filter(models.ExportFormat.id == export_id).first()
    if not fmt:
        raise HTTPException(status_code=404, detail="Formato de salida no encontrado")
    if fmt.output_type != "google_sheets":
        raise HTTPException(status_code=400, detail="Este formato no tiene Google Sheet destino configurado")
    if not fmt.output_spreadsheet_id or not fmt.output_sheet_name:
        raise HTTPException(status_code=400, detail="Configura el Google Sheet destino primero")

    col_map: dict = json.loads(fmt.columns_mapping)

    # Leer la Tabla Master origen
    conn = db.query(models.Connection).filter(models.Connection.id == fmt.source_connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Conexión de la Tabla Master no encontrada")

    raw_data = get_sheet_data(conn, f"{fmt.source_sheet_name}!A1:Z")
    if not raw_data:
        raise HTTPException(status_code=400, detail="La tabla master está vacía o no se pudo leer")

    master_headers = raw_data[0]
    master_rows = raw_data[1:]

    # Construir los datos con las columnas mapeadas
    output_data = [list(col_map.values())]  # fila de cabeceras
    for row in master_rows:
        row_dict = {master_headers[i]: (row[i] if i < len(row) else "") for i in range(len(master_headers))}
        output_row = [row_dict.get(master_col, "") for master_col in col_map.keys()]
        output_data.append(output_row)

    # Escribir al Google Sheet destino
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
    """
    Ejecuta TODOS los formatos de salida de tipo 'google_sheets' para un proyecto.
    También puede re-leer todas las fuentes y empujar a los destinos.
    """
    from .services import write_sheet_data

    results = []
    errors = []

    # Obtener todos los formatos del proyecto
    all_formats = db.query(models.ExportFormat)\
        .filter(models.ExportFormat.project_id == project_id)\
        .all()

    if not all_formats:
        return {"message": "No hay formatos de salida configurados para este proyecto.", "results": []}

    for fmt in all_formats:
        try:
            col_map: dict = json.loads(fmt.columns_mapping)

            # Leer la Tabla Master origen
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

            # Construir datos transformados
            output_data = [list(col_map.values())]
            for row in master_rows:
                row_dict = {master_headers[i]: (row[i] if i < len(row) else "") for i in range(len(master_headers))}
                output_row = [row_dict.get(mc, "") for mc in col_map.keys()]
                output_data.append(output_row)

            if fmt.output_type == "google_sheets" and fmt.output_spreadsheet_id and fmt.output_sheet_name:
                # Empujar a Google Sheet destino
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
                # Para CSV, simplemente indicamos que está listo para descargar
                results.append({
                    "format": fmt.name,
                    "type": "csv_download",
                    "rows_ready": len(output_data) - 1,
                    "download_url": f"/api/exports/{fmt.id}/download",
                    "status": "ready"
                })

        except Exception as e:
            errors.append({"format": fmt.name, "error": str(e)})

    # Registrar en SyncLog
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
# ═══════════════════════════════════════════════════════════════════
# ██ TABLA MAESTRA — Enlazada a Google Sheets
# ═══════════════════════════════════════════════════════════════════

@app.post("/api/projects/{project_id}/master-link")
def link_master_table(project_id: int, req: schemas.MasterLinkRequest, db: Session = Depends(get_db)):
    """Enlaza una conexión de Google Sheets para que actúe como la Tabla Maestra del proyecto."""
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


@app.get("/api/projects/{project_id}/master")
def get_master_table(project_id: int, db: Session = Depends(get_db)):
    """Obtiene los datos directamente de la Tabla Maestra (Google Sheet)."""
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


@app.post("/api/projects/{project_id}/master-sync")
def sync_to_master(project_id: int, req: schemas.MasterSyncRequest, db: Session = Depends(get_db)):
    """Sincroniza datos desde una tabla origen hacia la Tabla Maestra en Google Sheets."""
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project or not project.master_connection_id:
        raise HTTPException(status_code=404, detail="El proyecto no tiene una tabla maestra enlazada")
        
    # 1. Leer Origen
    src_conn = db.query(models.Connection).filter(models.Connection.id == req.source_connection_id).first()
    if not src_conn:
        raise HTTPException(status_code=404, detail="Conexión origen no encontrada")
        
    src_raw = get_sheet_data(src_conn, f"{req.source_sheet_name}!A1:Z")
    if not src_raw or len(src_raw) < 2:
        raise HTTPException(status_code=400, detail="La tabla origen está vacía")
    
    src_headers = src_raw[0]
    if req.sku_column_source not in src_headers:
        raise HTTPException(status_code=400, detail=f"Columna SKU '{req.sku_column_source}' no encontrada en el origen")
    src_sku_idx = src_headers.index(req.sku_column_source)
    
    # 2. Leer Maestra
    master_conn = db.query(models.Connection).filter(models.Connection.id == project.master_connection_id).first()
    master_raw = get_sheet_data(master_conn, f"{project.master_sheet_name}!A1:Z")
    
    if not master_raw:
        # Si la maestra está totalmente vacía, iniciamos con las columnas mapeadas + SKU
        master_headers = [req.sku_column_master] + list(set(req.field_mappings.values()))
        master_raw = [master_headers]
    else:
        master_headers = master_raw[0]
        
    # Asegurar que todas las columnas mapeadas existan en la maestra
    for dst_col in req.field_mappings.values():
        if dst_col not in master_headers:
            master_headers.append(dst_col)
            
    # Si agregamos columnas nuevas, hay que actualizar master_raw[0]
    master_raw[0] = master_headers
    
    if req.sku_column_master not in master_headers:
        raise HTTPException(status_code=400, detail=f"Columna SKU '{req.sku_column_master}' no encontrada en la maestra")
    master_sku_idx = master_headers.index(req.sku_column_master)
    
    # Indexar la maestra actual por SKU para fácil actualización
    master_by_sku = {}
    for i, row in enumerate(master_raw[1:]):
        sku_val = row[master_sku_idx] if master_sku_idx < len(row) else ""
        if sku_val:
            # Rellenar con vacíos si la fila es más corta que los headers
            padded_row = row + [""] * (len(master_headers) - len(row))
            master_by_sku[sku_val] = {"index": i + 1, "data": padded_row}
            
    rows_updated = 0
    rows_added = 0
    
    # 3. Procesar datos del Origen y cruzar con la Maestra
    for src_row in src_raw[1:]:
        sku_val = src_row[src_sku_idx] if src_sku_idx < len(src_row) else ""
        if not sku_val:
            continue
            
        if sku_val in master_by_sku:
            # Actualizar
            mr_info = master_by_sku[sku_val]
            mr_data = mr_info["data"]
            changed = False
            
            for src_col, dst_col in req.field_mappings.items():
                if src_col in src_headers:
                    s_idx = src_headers.index(src_col)
                    m_idx = master_headers.index(dst_col)
                    
                    new_val = src_row[s_idx] if s_idx < len(src_row) else ""
                    if mr_data[m_idx] != new_val:
                        mr_data[m_idx] = new_val
                        changed = True
            
            if changed:
                master_raw[mr_info["index"]] = mr_data
                rows_updated += 1
                
        elif req.add_new_rows:
            # Añadir nuevo
            new_mr_data = [""] * len(master_headers)
            new_mr_data[master_sku_idx] = sku_val
            
            for src_col, dst_col in req.field_mappings.items():
                if src_col in src_headers:
                    s_idx = src_headers.index(src_col)
                    m_idx = master_headers.index(dst_col)
                    new_val = src_row[s_idx] if s_idx < len(src_row) else ""
                    new_mr_data[m_idx] = new_val
                    
            master_raw.append(new_mr_data)
            rows_added += 1
            
    # 4. Escribir de vuelta a Google Sheets
    write_result = write_sheet_data(master_conn.spreadsheet_id, project.master_sheet_name, master_raw)
    
    return {
        "message": f"Sincronización a Maestra completada: {rows_updated} actualizadas, {rows_added} nuevas.",
        "rows_updated": rows_updated,
        "rows_added": rows_added,
        "google_sheets_result": write_result
    }


# --- Exportación desde Maestra ---
@app.get("/api/projects/{project_id}/master-columns")
def get_master_columns_for_export(project_id: int, db: Session = Depends(get_db)):
    """Devuelve las columnas de la Maestra leyendo los encabezados del Google Sheet enlazado."""
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project or not project.master_connection_id:
        return []
        
    master_conn = db.query(models.Connection).filter(models.Connection.id == project.master_connection_id).first()
    raw = get_sheet_data(master_conn, f"{project.master_sheet_name}!A1:Z1")
    
    if raw and len(raw) > 0:
        return raw[0]
    return []


# --- Frontend Serving (Railway Single Deployment) ---
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

frontend_dist = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "dist")

if os.path.exists(frontend_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

    @app.get("/{catchall:path}")
    def serve_react_app(catchall: str):
        file_path = os.path.join(frontend_dist, catchall)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        # Fallback to index.html for React Router
        return FileResponse(os.path.join(frontend_dist, "index.html"))
