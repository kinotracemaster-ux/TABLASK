"""Pantalla "Actualizar": subir el archivo del SYS y listo.

Dos puertas, un solo camino:
  - Kino sube el Excel en la app, o
  - lo suelta en la carpeta de Drive "buzón" (el scheduler la mira cada 5 min).
En ambos casos el archivo REEMPLAZA el contenido de la conexión de archivo que
alimenta la Fuente del SYS (mismo id: los Procesos no se enteran) y se arma la
Revisión (backend/review.py): nada sale a Shopify sin "Aprobar".

Así la carpeta de Drive no es una Fuente aparte: es solo otra forma de entregar
el mismo archivo, y la revisión siempre compara contra lo mismo.
"""
import json
import os
from datetime import datetime
from typing import Optional

from . import models


class ActualizarError(Exception):
    pass


def conexiones_candidatas(db) -> list:
    """Conexiones de archivo que alimentan alguna Fuente activa."""
    ids = {p.source_connection_id for p in
           db.query(models.Process).filter(models.Process.is_active == True).all()}  # noqa: E712
    if not ids:
        return []
    return (db.query(models.Connection)
            .filter(models.Connection.id.in_(ids), models.Connection.connection_type == "local_file")
            .order_by(models.Connection.id).all())


def conexion_destino(db, cfg) -> Optional[models.Connection]:
    """Dónde cae el archivo subido: la elegida en Administración o, si no hay,
    la única Fuente activa de tipo archivo. Con varias y ninguna elegida, None
    (adivinar podría pisar la Fuente equivocada)."""
    if cfg.upload_connection_id:
        conn = db.query(models.Connection).filter(models.Connection.id == cfg.upload_connection_id).first()
        if conn and conn.connection_type == "local_file":
            return conn
    candidatas = conexiones_candidatas(db)
    return candidatas[0] if len(candidatas) == 1 else None


def guardar_archivo(db, conn: models.Connection, nombre: str, contenido: bytes) -> None:
    """Mismo efecto que "cambiar archivo" de la Fuente (connections.replace-file)."""
    if not contenido:
        raise ActualizarError("El archivo está vacío.")
    upload_dir = os.path.join(os.path.dirname(__file__), "uploads")
    file_path = os.path.join(upload_dir, os.path.basename(nombre or "archivo.xlsx"))
    try:
        os.makedirs(upload_dir, exist_ok=True)
        with open(file_path, "wb") as f:
            f.write(contenido)
    except Exception as e:
        print(f"No se pudo escribir el archivo en disco (se usará el guardado en DB): {e}")
    conn.file_path = file_path
    conn.file_content = contenido
    conn.file_updated_at = datetime.utcnow()
    db.commit()


def recibir_archivo(db, nombre: str, contenido: bytes, trigger: str) -> models.DailyReview:
    """Guarda el archivo en la Fuente del SYS y arma la revisión."""
    from .review import run_review
    from .scheduler import get_or_create_config

    cfg = get_or_create_config(db)
    conn = conexion_destino(db, cfg)
    if not conn:
        raise ActualizarError(
            "Todavía no está elegido a qué Fuente va el archivo. Pedile a quien administra "
            "TablasK que lo configure en Administración → Pantalla Actualizar.")
    guardar_archivo(db, conn, nombre, contenido)
    return run_review(db, trigger=trigger)


def ultimo_drive(cfg) -> dict:
    try:
        return json.loads(cfg.drive_last_file) if cfg.drive_last_file else {}
    except (ValueError, TypeError):
        return {}


def revisar_buzon_drive(db, forzar: bool = False) -> dict:
    """Si en la carpeta buzón hay un archivo más nuevo que el último procesado,
    lo baja, arma la revisión y avisa. Lo llama el scheduler en cada tick."""
    from .connectors.google_drive import GoogleDriveConnector, elegir_archivo
    from .scheduler import get_or_create_config
    from . import avisos

    cfg = get_or_create_config(db)
    if not cfg.drive_folder_id:
        return {"ran": False, "reason": "No hay carpeta de Drive configurada."}
    drive = GoogleDriveConnector({"drive_folder_id": cfg.drive_folder_id})
    elegido = elegir_archivo(drive.listar_archivos())
    if not elegido:
        return {"ran": False, "reason": "La carpeta no tiene archivos .xlsx, .xls o .csv."}

    previo = ultimo_drive(cfg)
    if not forzar and previo.get("id") == elegido.get("id") \
            and previo.get("modifiedTime") == elegido.get("modifiedTime"):
        return {"ran": False, "reason": "Sin archivos nuevos.", "file": elegido.get("name")}

    # Se marca ANTES de revisar: si la revisión falla, no se reintenta cada 5
    # minutos con el mismo archivo roto (el error queda en la revisión y en el aviso).
    cfg.drive_last_file = json.dumps({k: elegido.get(k) for k in ("id", "name", "modifiedTime")})
    db.commit()

    try:
        rev = recibir_archivo(db, elegido["name"], drive.descargar(elegido["id"]), trigger="drive")
    except ActualizarError as e:
        avisos.enviar(f"TablasK: llegó '{elegido['name']}' al Drive pero no se pudo usar: {e}")
        return {"ran": False, "reason": str(e), "file": elegido.get("name")}

    report = json.loads(rev.report) if rev.report else {}
    avisos.enviar(avisos.texto_revision(report, rev.status, origen=elegido["name"]))
    return {"ran": True, "review_id": rev.id, "status": rev.status, "file": elegido.get("name")}
