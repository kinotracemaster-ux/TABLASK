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
import csv
import io
import json
import os
from datetime import datetime
from typing import List, Optional, Tuple

from . import models


class ActualizarError(Exception):
    pass


# Multiplicador de la web de Poedagar sobre el precio del SYS: 1401-1 vale
# 130.000 en el SYS y 364.000 en la web (× 2,8). Ojo: el × 1,4 es sobre el
# precio de Kyte, que ya es SYS × 2.
MULT_POEDAGAR = float(os.getenv("TABLASK_MULT_POEDAGAR", "2.8"))
# Por ahora se valida SOLO Poedagar: del archivo del SYS (trae todas las
# marcas) quedan los códigos que están en la web o cuya descripción la nombra.
MARCA = os.getenv("TABLASK_MARCA", "POEDAGAR").strip().upper()

# Encabezados del archivo del SYS (INVENTARIO_POEDAGAR): Artículo, Descripción,
# Exist. unidades, Precio. Se comparan normalizados (intelligent_engine).
SKU_FUENTE = ("artículo", "articulo", "código", "codigo", "sku", "referencia", "ref")
PRECIO_PREFERIDO = ("precio base", "precio", "price", "precio_base")
STOCK_PREFERIDO = ("stock", "exist. unidades", "existencias", "existencia", "inventario", "cantidad")


def conexiones_candidatas(db) -> list:
    """Conexiones de archivo que alimentan alguna Fuente activa."""
    ids = {p.source_connection_id for p in
           db.query(models.Process).filter(models.Process.is_active == True).all()}  # noqa: E712
    if not ids:
        return []
    return (db.query(models.Connection)
            .filter(models.Connection.id.in_(ids), models.Connection.connection_type == "local_file")
            .order_by(models.Connection.id).all())


def _preferencia(conn) -> tuple:
    """Entre varias Fuentes de archivo, la de Poedagar/SYS y la más usada."""
    nombre = (conn.name or "").upper()
    return ("POEDAGAR" in nombre, "SYS" in nombre or "EXIST" in nombre or "INVENTARIO" in nombre,
            conn.file_updated_at or datetime.min, conn.id)


def conexion_destino(db, cfg) -> Optional[models.Connection]:
    """Dónde cae el archivo subido: la elegida en Administración o, si no hay,
    la Fuente activa de tipo archivo que más pinta de ser la del SYS de
    Poedagar. None solo si no hay ninguna (la primera subida la crea)."""
    if cfg.upload_connection_id:
        conn = db.query(models.Connection).filter(models.Connection.id == cfg.upload_connection_id).first()
        if conn and conn.connection_type == "local_file":
            return conn
    candidatas = conexiones_candidatas(db)
    return max(candidatas, key=_preferencia) if candidatas else None


def maestra_enlazada(db):
    return db.query(models.Project).filter(models.Project.master_connection_id.isnot(None)).first()


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


# ───────────────────────────────────── configuración por defecto (Poedagar)
def _buscar(headers, preferidos, grupo=None, excluir=()) -> Optional[str]:
    """Primer encabezado que coincide (normalizado) con la lista de
    preferidos; si no, el ÚNICO del grupo semántico. Nunca adivina entre dos."""
    from .intelligent_engine import _normalize_header, get_semantic_group
    norm = {h: _normalize_header(h) for h in headers if h}
    for pref in preferidos:
        for h, n in norm.items():
            if n == pref:
                return h
    if grupo:
        del_grupo = [h for h, n in norm.items()
                     if get_semantic_group(h) == grupo and not any(x in n for x in excluir)]
        if len(del_grupo) == 1:
            return del_grupo[0]
    return None


def _mapeo_sys(headers_fuente, headers_maestra, sku_maestra) -> dict:
    """{sku_fuente, mappings} para el archivo del SYS → Maestra: solo precio y
    stock (el nombre de la Maestra no se pisa con la Descripción del SYS)."""
    sku = _buscar(headers_fuente, SKU_FUENTE)
    precio_f = _buscar(headers_fuente, ("precio",), "precio", excluir=("costo", "cost"))
    stock_f = _buscar(headers_fuente, STOCK_PREFERIDO, "stock") or \
        next((h for h in headers_fuente if str(h).strip().lower().startswith("exist")), None)
    precio_m = _buscar(headers_maestra, PRECIO_PREFERIDO, "precio", excluir=("costo", "cost"))
    stock_m = _buscar(headers_maestra, STOCK_PREFERIDO, "stock")
    mappings = {}
    if precio_f and precio_m:
        mappings[precio_f] = precio_m
    if stock_f and stock_m:
        mappings[stock_f] = stock_m
    if not sku or not sku_maestra or not mappings:
        faltan = [n for n, v in (("el código (Artículo)", sku), ("el SKU de la Maestra", sku_maestra),
                                 ("precio o stock", mappings)) if not v]
        raise ActualizarError(
            "No pude armar sola la Fuente del SYS: no encontré " + ", ".join(faltan) +
            f". Columnas del archivo: {', '.join(map(str, headers_fuente))[:300]}. "
            "Creala una vez en Administración → Actualizar Maestra.")
    return {"sku_fuente": sku, "mappings": mappings}


def preparar_fuente(db, nombre: str, contenido: bytes) -> Tuple[models.Connection, List[str]]:
    """Primera subida sin Fuente del SYS: la crea sola (conexión de archivo +
    Fuente activa hacia la Maestra) a partir del archivo recibido."""
    from .services import get_sheet_metadata, get_sheet_data
    from .scheduler import get_or_create_config

    project = maestra_enlazada(db)
    if not project:
        raise ActualizarError("Falta enlazar la Tabla Maestra (Administración → Tabla Maestra).")
    master_conn = db.query(models.Connection).filter(models.Connection.id == project.master_connection_id).first()
    master_rows = get_sheet_data(master_conn, f"{project.master_sheet_name}!A1:Z") or [[]]
    headers_maestra = [str(h) for h in (master_rows[0] if master_rows else [])]

    conn = models.Connection(name="SYS POEDAGAR", connection_type="local_file")
    db.add(conn)
    db.commit()
    guardar_archivo(db, conn, nombre, contenido)
    try:
        hojas = get_sheet_metadata(conn) or {}
        hoja, mapeo, ultimo_error = None, None, None
        for h, cols in hojas.items():
            try:
                mapeo = _mapeo_sys([str(c) for c in cols], headers_maestra, project.master_sku_column)
                hoja = h
                break
            except ActualizarError as e:
                ultimo_error = e
        if not hoja:
            raise ultimo_error or ActualizarError("El archivo no tiene hojas con datos.")
    except Exception:
        db.delete(conn)
        db.commit()
        raise

    db.add(models.Process(
        name="SYS POEDAGAR → Maestra", description="Creada sola por la pantalla Actualizar",
        source_connection_id=conn.id, source_sheet_name=hoja,
        sku_column_source=mapeo["sku_fuente"], sku_column_master=project.master_sku_column,
        field_mappings=json.dumps(mapeo["mappings"], ensure_ascii=False),
        add_new_rows=True, zero_missing_stock=False, is_active=True,
    ))
    cfg = get_or_create_config(db)
    cfg.upload_connection_id = conn.id
    db.commit()
    cols = ", ".join(f"{k} → {v}" for k, v in mapeo["mappings"].items())
    return conn, [f"Fuente 'SYS POEDAGAR' creada ({cols})"]


def tiendas_shopify(db) -> list:
    return db.query(models.Connection).filter(models.Connection.connection_type == "shopify").all()


def asegurar_tienda(db, conn: models.Connection) -> List[str]:
    """Si no hay ningún destino Shopify activo y hay UNA sola tienda
    conectada (la de Poedagar), crea el destino con precio del SYS × 2,8."""
    if db.query(models.ShopifySubscription).filter(models.ShopifySubscription.is_active == True).count():  # noqa: E712
        return []
    tiendas = tiendas_shopify(db)
    if len(tiendas) != 1:
        return []
    proc = (db.query(models.Process).filter(models.Process.source_connection_id == conn.id,
                                            models.Process.is_active == True).first())  # noqa: E712
    if not proc:
        return []
    mappings = json.loads(proc.field_mappings) if isinstance(proc.field_mappings, str) else proc.field_mappings
    from .intelligent_engine import get_semantic_group
    destinos = list((mappings or {}).values())
    precio = next((d for d in destinos if get_semantic_group(d) == "precio"), None)
    stock = next((d for d in destinos if get_semantic_group(d) == "stock"
                  or str(d).lower().startswith("exist")), None)
    if not precio and not stock:
        return []
    db.add(models.ShopifySubscription(
        name="Shopi-Poe", connection_id=tiendas[0].id, price_column_master=precio,
        stock_column_master=stock, price_multiplier=MULT_POEDAGAR, is_active=True))
    db.commit()
    return [f"Destino 'Shopi-Poe' creado para {tiendas[0].shopify_domain or tiendas[0].name} "
            f"(precio × {str(MULT_POEDAGAR).replace('.', ',')})"]


def _leer_filas(nombre: str, contenido: bytes) -> Tuple[List[str], List[dict]]:
    """(encabezados, filas) de la primera hoja que tenga columna de código."""
    import openpyxl
    from .connectors.local_file import LocalFileConnector
    lector = LocalFileConnector({"file_name": nombre, "file_content": contenido})
    try:
        hojas = ["CSV Data"]
        if not nombre.lower().endswith(".csv"):
            hojas = openpyxl.load_workbook(io.BytesIO(contenido), read_only=True).sheetnames
        for hoja in hojas:
            filas = lector.fetch_data(hoja)
            if filas and _buscar(list(filas[0].keys()), SKU_FUENTE):
                return list(filas[0].keys()), filas
    except Exception as e:  # archivo raro: no se filtra, la revisión dirá qué pasa
        print("No se pudo leer el archivo para filtrar la marca:", str(e)[:200])
    return [], []


def _codigos_web(db) -> Optional[set]:
    """SKU normalizados de las tiendas que se actualizan. None si no se pudo leer."""
    from .services import _create_connector
    from .sku_utils import normalize_sku_for_match
    from .scheduler import get_or_create_config
    cfg = get_or_create_config(db)
    subs = db.query(models.ShopifySubscription).filter(models.ShopifySubscription.is_active == True).all()  # noqa: E712
    if cfg.review_shopify_ids:
        try:
            ids = set(json.loads(cfg.review_shopify_ids))
            subs = [x for x in subs if x.id in ids]
        except (ValueError, TypeError):
            pass
    codigos, leidas = set(), 0
    for sub in subs:
        tienda = db.query(models.Connection).filter(models.Connection.id == sub.connection_id).first()
        if not tienda or tienda.connection_type != "shopify":
            continue
        try:
            for info in _create_connector(tienda).index_variants_by_sku().values():
                codigos.add(normalize_sku_for_match(str(info.get("sku") or "")))
            leidas += 1
        except Exception as e:
            print("No se pudieron leer los códigos de la tienda:", str(e)[:200])
    return codigos if leidas else None


def filtrar_marca(db, nombre: str, contenido: bytes):
    """Deja del archivo del SYS solo lo de Poedagar: códigos que están en la
    web o con la marca en la descripción. Devuelve (nombre, contenido,
    skus_alcance | None, alertas). Si no puede decidir, no filtra y lo avisa."""
    from .review import _alert
    from .sku_utils import normalize_sku_for_match as norm

    headers, filas = _leer_filas(nombre, contenido)
    sku_col = _buscar(headers, SKU_FUENTE)
    if not sku_col:
        return nombre, contenido, None, []
    desc_col = _buscar(headers, ("descripción", "descripcion", "nombre", "producto"), "nombre")
    web = _codigos_web(db)

    quedan, en_web, por_marca = [], set(), []
    for f in filas:
        n = norm(str(f.get(sku_col) or ""))
        if not n:
            continue
        if web is not None and n in web:
            quedan.append(f)
            en_web.add(n)
        elif desc_col and MARCA in str(f.get(desc_col) or "").upper():
            quedan.append(f)
            por_marca.append(f.get(sku_col))

    alertas = []
    if not quedan:
        alertas.append(_alert("warning", f"No encontré filas de {MARCA.title()} en el archivo (ni códigos de la web "
                                         f"ni '{MARCA}' en la descripción): se revisa el archivo completo."))
        return nombre, contenido, None, alertas

    alcance = {norm(str(f.get(sku_col) or "")) for f in quedan}
    otras = len(filas) - len(quedan)
    alertas.append(_alert("info", f"Solo {MARCA.title()}: de {len(filas)} filas del archivo quedan {len(quedan)} "
                                  f"({len(en_web)} están en la web, {len(por_marca)} nuevas con '{MARCA}' en la "
                                  f"descripción). Se ignoran {otras} de otras marcas."))
    if web is not None:
        faltan_web = sorted(web - alcance - {""})
        if faltan_web:
            alertas.append(_alert("warning", f"{len(faltan_web)} producto(s) están en la web pero NO vienen en el "
                                             f"archivo: no se tocan (revisá si el SYS los tiene con otro código).",
                                  samples=faltan_web))
    else:
        alertas.append(_alert("warning", "No pude leer los códigos de la web: el filtro usó solo la descripción."))

    if otras == 0:
        return nombre, contenido, alcance, alertas
    salida = io.StringIO()
    w = csv.DictWriter(salida, fieldnames=headers, extrasaction="ignore")
    w.writeheader()
    w.writerows(quedan)
    base = os.path.splitext(os.path.basename(nombre or "archivo"))[0]
    return f"{base} (solo {MARCA}).csv", salida.getvalue().encode("utf-8"), alcance, alertas


def recibir_archivo(db, nombre: str, contenido: bytes, trigger: str):
    """Guarda el archivo en la Fuente del SYS (la crea si no hay), deja solo
    Poedagar y arma la revisión. Devuelve (revisión, cosas configuradas solas)."""
    from .review import run_review
    from .scheduler import get_or_create_config

    if not contenido:
        raise ActualizarError("El archivo está vacío.")
    cfg = get_or_create_config(db)
    conn = conexion_destino(db, cfg)
    configurado = []
    if not conn:
        conn, configurado = preparar_fuente(db, nombre, contenido)
    configurado += asegurar_tienda(db, conn)

    nombre_f, contenido_f, alcance, alertas = filtrar_marca(db, nombre, contenido)
    guardar_archivo(db, conn, nombre_f, contenido_f)
    hoja = "CSV Data" if nombre_f.lower().endswith(".csv") else None
    if hoja:  # el filtrado se guarda como CSV: las Fuentes de esta conexión leen esa hoja
        for p in db.query(models.Process).filter(models.Process.source_connection_id == conn.id).all():
            p.source_sheet_name = hoja
        db.commit()
    return run_review(db, trigger=trigger, solo_skus=alcance, alertas_previas=alertas), configurado


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
        rev, configurado = recibir_archivo(db, elegido["name"], drive.descargar(elegido["id"]), trigger="drive")
    except ActualizarError as e:
        avisos.enviar(f"TablasK: llegó '{elegido['name']}' al Drive pero no se pudo usar: {e}")
        return {"ran": False, "reason": str(e), "file": elegido.get("name")}

    report = json.loads(rev.report) if rev.report else {}
    avisos.enviar(avisos.texto_revision(report, rev.status, origen=elegido["name"]))
    return {"ran": True, "review_id": rev.id, "status": rev.status, "file": elegido.get("name"),
            "configurado": configurado}
