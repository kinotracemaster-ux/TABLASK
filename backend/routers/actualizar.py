"""Pantalla "Actualizar" (la de todos los días): subir el archivo del SYS, ver
qué va a cambiar, aprobar. La lógica vive en backend/actualizar.py; aprobar y
descartar usan los endpoints de siempre (/api/reviews/{id}/apply|discard)."""
import json
import os
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import avisos, models
from ..actualizar import (ActualizarError, conexion_destino, conexiones_candidatas, maestra_enlazada,
                          recibir_archivo, revisar_buzon_drive, ultimo_drive)
from ..database import get_db
from ..scheduler import get_or_create_config
from .connections import _solo_id_de_carpeta
from .reviews import _full

router = APIRouter(prefix="/api/actualizar", tags=["actualizar"])


def _tiendas_revisadas(db, cfg) -> list:
    """Destinos Shopify activos que entran en la revisión (nulo = todos)."""
    subs = db.query(models.ShopifySubscription).filter(models.ShopifySubscription.is_active == True).all()  # noqa: E712
    if not cfg.review_shopify_ids:
        return subs
    try:
        ids = set(json.loads(cfg.review_shopify_ids))
    except (ValueError, TypeError):
        return subs
    return [s for s in subs if s.id in ids]


def _estado(db) -> dict:
    cfg = get_or_create_config(db)
    conn = conexion_destino(db, cfg)
    r = db.query(models.DailyReview).order_by(models.DailyReview.id.desc()).first()
    return {
        # Sin Fuente del SYS igual está listo si hay Maestra: la primera subida la crea.
        "listo": conn is not None or maestra_enlazada(db) is not None,
        "tiendas": [s.name for s in _tiendas_revisadas(db, cfg)],
        "archivo": {
            "conexion_id": conn.id if conn else None,
            "conexion": conn.name if conn else None,
            "actualizado": conn.file_updated_at.isoformat() if conn and conn.file_updated_at else None,
        },
        "drive": {"carpeta": cfg.drive_folder_id, "ultimo": ultimo_drive(cfg)},
        "telegram": avisos.configurado(),
        "revision": _full(r) if r else None,
    }


@router.get("")
def estado(db: Session = Depends(get_db)):
    return _estado(db)


@router.post("/archivo")
def subir_archivo(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Sube el Excel del SYS y devuelve la revisión (no escribe nada en Shopify)."""
    nombre = file.filename or "archivo.xlsx"
    if not nombre.lower().endswith((".xlsx", ".xls", ".csv")):
        raise HTTPException(status_code=400, detail="El archivo tiene que ser .xlsx, .xls o .csv (el que baja el SYS).")
    try:
        rev, configurado = recibir_archivo(db, nombre, file.file.read(), trigger="archivo")
    except ActualizarError as e:
        raise HTTPException(status_code=400, detail=str(e))
    out = _full(rev)
    out["configurado"] = configurado
    return out


# ───────────────────────────────────────────── configuración (Administración)
class ConfigActualizar(BaseModel):
    upload_connection_id: Optional[int] = None
    drive_folder: Optional[str] = None   # id o link de la carpeta; "" = quitar
    tiendas: Optional[List[int]] = None  # destinos Shopify a actualizar; [] o todas = todas


@router.get("/config")
def ver_config(db: Session = Depends(get_db)):
    cfg = get_or_create_config(db)
    elegidas = _tiendas_revisadas(db, cfg)
    return {
        "upload_connection_id": cfg.upload_connection_id,
        "actual": (lambda c: {"id": c.id, "name": c.name} if c else None)(conexion_destino(db, cfg)),
        "tiendas": [{"id": s.id, "name": s.name, "multiplicador": s.price_multiplier or 1.0,
                     "elegida": s in elegidas}
                    for s in db.query(models.ShopifySubscription).filter(
                        models.ShopifySubscription.is_active == True).all()],  # noqa: E712
        "candidatas": [{"id": c.id, "name": c.name} for c in conexiones_candidatas(db)],
        "drive_folder_id": cfg.drive_folder_id,
        "drive_ultimo": ultimo_drive(cfg),
        "telegram": avisos.configurado(),
        "public_url": os.getenv("TABLASK_PUBLIC_URL") or None,
    }


@router.put("/config")
def guardar_config(req: ConfigActualizar, db: Session = Depends(get_db)):
    cfg = get_or_create_config(db)
    if req.upload_connection_id is not None:
        conn = db.query(models.Connection).filter(models.Connection.id == req.upload_connection_id).first()
        if not conn or conn.connection_type != "local_file":
            raise HTTPException(status_code=400, detail="Elegí una Fuente de tipo archivo.")
        cfg.upload_connection_id = conn.id
    if req.tiendas is not None:
        activas = {s.id for s in db.query(models.ShopifySubscription).filter(
            models.ShopifySubscription.is_active == True).all()}  # noqa: E712
        ids = sorted(set(req.tiendas) & activas)
        cfg.review_shopify_ids = json.dumps(ids) if ids and set(ids) != activas else None
    if req.drive_folder is not None:
        nueva = _solo_id_de_carpeta(req.drive_folder)
        if nueva != cfg.drive_folder_id:
            cfg.drive_folder_id = nueva
            cfg.drive_last_file = None  # carpeta nueva: el archivo de hoy cuenta como nuevo
    db.commit()
    return ver_config(db)


@router.post("/drive/revisar")
def revisar_drive_ahora(forzar: bool = False, db: Session = Depends(get_db)):
    """Mira la carpeta ya (sin esperar el tick de 5 min). forzar=1 reprocesa el último."""
    try:
        return revisar_buzon_drive(db, forzar=forzar)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"No se pudo leer la carpeta: {str(e)[:200]}")


@router.post("/aviso/prueba")
def aviso_prueba():
    if not avisos.configurado():
        raise HTTPException(status_code=400, detail="Faltan TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID en Railway.")
    if not avisos.enviar("TablasK: prueba de aviso. Si ves esto, los avisos funcionan."):
        raise HTTPException(status_code=502, detail="Telegram no aceptó el mensaje: revisá el token y el chat id.")
    return {"ok": True}

