from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List
import os
import shutil
from .. import models, schemas
from ..database import get_db

router = APIRouter(
    prefix="/api/connections",
    tags=["connections"],
)

@router.post("/", response_model=schemas.Connection)
def create_connection(conn: schemas.ConnectionCreate, db: Session = Depends(get_db)):
    spreadsheet_id = None
    if conn.google_sheet_url and "/d/" in conn.google_sheet_url:
        try:
            spreadsheet_id = conn.google_sheet_url.split("/d/")[1].split("/")[0]
        except IndexError:
            pass

    db_conn = models.Connection(
        name=conn.name,
        google_sheet_url=conn.google_sheet_url,
        spreadsheet_id=spreadsheet_id,
        connection_type=conn.connection_type,
        file_path=conn.file_path,
        http_url=conn.http_url,
        http_method=conn.http_method,
        http_headers=conn.http_headers
    )
    db.add(db_conn)
    db.commit()
    db.refresh(db_conn)
    return db_conn

@router.get("/", response_model=List[schemas.Connection])
def list_connections(db: Session = Depends(get_db)):
    return db.query(models.Connection).all()

@router.delete("/{conn_id}")
def delete_connection(conn_id: int, db: Session = Depends(get_db)):
    conn = db.query(models.Connection).filter(models.Connection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Conexión no encontrada")
    
    if conn.connection_type == "local_file" and conn.file_path and os.path.exists(conn.file_path):
        try:
            os.remove(conn.file_path)
        except Exception as e:
            print(f"No se pudo borrar el archivo {conn.file_path}: {e}")

    db.delete(conn)
    db.commit()
    return {"message": "Conexión eliminada"}

@router.post("/upload", response_model=schemas.Connection)
def upload_file_connection(
    name: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    upload_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
    os.makedirs(upload_dir, exist_ok=True)
    
    file_path = os.path.join(upload_dir, file.filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    db_conn = models.Connection(
        name=name,
        connection_type="local_file",
        file_path=file_path
    )
    db.add(db_conn)
    db.commit()
    db.refresh(db_conn)
    return db_conn

@router.get("/{conn_id}/metadata")
def get_connection_metadata(conn_id: int, db: Session = Depends(get_db)):
    conn = db.query(models.Connection).filter(models.Connection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Conexión no encontrada")
        
    from ..services import get_sheet_metadata
    try:
        sheets = get_sheet_metadata(conn)
        return {"sheets": sheets}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
