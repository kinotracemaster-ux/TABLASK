from googleapiclient.discovery import build
from google.oauth2 import service_account
import os
import re
import time
import difflib
import pandas as pd
from .sheets_retry import execute_with_retry


# --- Caché corta de lecturas de Sheets (para no pegar el límite de 60 lecturas/min) ---
# Clave: (spreadsheet_id, sheet_name) -> (timestamp, datos). TTL corto: colapsa
# relecturas de la misma hoja dentro de un mismo ciclo (ej. la Maestra al
# sincronizar varios procesos). Se invalida al escribir esa hoja.
_READ_CACHE = {}
_READ_CACHE_TTL = float(os.getenv("SHEETS_READ_CACHE_TTL", "45"))


def _cache_get(spreadsheet_id, sheet_name):
    entry = _READ_CACHE.get((spreadsheet_id, sheet_name))
    if entry and (time.time() - entry[0]) < _READ_CACHE_TTL:
        # copia defensiva para que quien la use no mute la versión cacheada
        return [list(row) for row in entry[1]]
    return None


def _cache_put(spreadsheet_id, sheet_name, data):
    _READ_CACHE[(spreadsheet_id, sheet_name)] = (time.time(), [list(row) for row in data])


def invalidate_read_cache(spreadsheet_id=None, sheet_name=None):
    """Borra la caché de lectura. Llamar tras escribir una hoja para que la
    próxima lectura traiga datos frescos."""
    if spreadsheet_id is None:
        _READ_CACHE.clear()
        return
    for key in list(_READ_CACHE.keys()):
        if key[0] == spreadsheet_id and (sheet_name is None or key[1] == sheet_name):
            _READ_CACHE.pop(key, None)


def normalize_sku_for_match(s: str) -> str:
    """Forma normalizada de un SKU/codigo SOLO para comparar (no para escribir).
    Unifica las diferencias más comunes que rompen el cruce exacto:
    - mayúsculas/minúsculas y espacios
    - decimales de Sheets: '1203.0' -> '1203'
    - ceros a la izquierda en numéricos: '01203' -> '1203'
    El valor real que se escribe en Sheets NUNCA se altera; esto es solo
    para detectar posibles typos/variantes del mismo producto.
    """
    s = (s or "").strip().lower()
    if not s:
        return ""
    # '1203.0' / '1203.00' -> '1203'
    if re.fullmatch(r"\d+\.0+", s):
        s = s.split(".")[0]
    # ceros a la izquierda en numéricos puros: '01203' -> '1203'
    if s.isdigit():
        s = s.lstrip("0") or "0"
    return s


def find_similar_sku(sku_val: str, master_norm_index: dict, master_len_buckets: dict,
                     threshold: float = 0.86):
    """Busca un SKU de la maestra parecido a `sku_val` (que NO cruzó exacto).
    Devuelve (sku_maestra_sugerido, motivo, similitud) o None.

    Estrategia en pasos para no ser O(N*M):
    1. Match normalizado exacto (dict): cubre diferencias de formato (.0, ceros,
       mayúsculas, espacios) — motivo 'formato', confianza máxima.
    2. Fuzzy SOLO de mismo largo (sustitución/transposición) usando
       SequenceMatcher: cubre typos reales (ej. '12O3' vs '1203'). NO se hace
       fuzzy de largo distinto porque en códigos cortos (ej. '7-59' vs '7-159',
       '708-1' vs '1708-1') una inserción/borrado casi siempre es OTRO producto:
       puntúa alto pero es un falso positivo.
    """
    norm = normalize_sku_for_match(sku_val)
    if not norm:
        return None

    # Paso 1: mismo SKU salvo formato.
    exact = master_norm_index.get(norm)
    if exact is not None and exact != sku_val:
        return (exact, "formato", 1.0)

    # Paso 1b: variante con sufijo. El origen trae 'base-1' / 'base_2' / 'base/3'
    # y la maestra tiene la 'base' sola → casi seguro es una variante no explícita
    # del mismo producto. Lookup directo por la base (barato y preciso).
    m = re.match(r"^(.+?)[-_/.\s].*$", norm)
    if m:
        base_hit = master_norm_index.get(m.group(1))
        if base_hit is not None and base_hit != sku_val:
            return (base_hit, "variante", 1.0)

    # Paso 2: fuzzy SOLO de mismo largo (typos por sustitución/transposición).
    candidates = master_len_buckets.get(len(norm), ())
    if not candidates:
        return None

    best_sku = None
    best_ratio = 0.0
    sm = difflib.SequenceMatcher()
    sm.set_seq2(norm)
    for cand_norm, cand_original in candidates:
        sm.set_seq1(cand_norm)
        # quick_ratio es barato y acota antes del ratio real
        if sm.quick_ratio() < threshold:
            continue
        r = sm.ratio()
        if r > best_ratio:
            best_ratio = r
            best_sku = cand_original

    if best_sku is not None and best_sku != sku_val and best_ratio >= threshold:
        return (best_sku, "similar", round(best_ratio, 3))
    return None

# Configuración de credenciales (Service Account)
SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
# En Railway u otro host, esto vendrá de variables de entorno o archivo seguro
SERVICE_ACCOUNT_FILE = os.getenv('GOOGLE_CREDENTIALS_FILE', '../credentials.json')

def get_sheets_service():
    creds_json = os.getenv('GOOGLE_CREDENTIALS_JSON')
    if creds_json:
        import json
        try:
            creds_dict = json.loads(creds_json)
            creds = service_account.Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
            return build('sheets', 'v4', credentials=creds)
        except Exception as e:
            print("Error cargando GOOGLE_CREDENTIALS_JSON:", e)
            return None

    if os.path.exists(SERVICE_ACCOUNT_FILE):
        creds = service_account.Credentials.from_service_account_file(
            SERVICE_ACCOUNT_FILE, scopes=SCOPES)
        return build('sheets', 'v4', credentials=creds)
    return None

from .connectors import get_connector

def _create_connector(connection):
    config = {
        "spreadsheet_id": connection.spreadsheet_id,
        "file_path": connection.file_path,
        "http_url": connection.http_url,
        "http_method": connection.http_method,
        "http_headers": connection.http_headers,
        "shopify_domain": connection.shopify_domain,
        "shopify_client_id": connection.shopify_client_id,
        "shopify_client_secret": connection.shopify_client_secret,
        "shopify_access_token": connection.shopify_access_token,
        "shopify_api_version": connection.shopify_api_version,
    }
    return get_connector(connection.connection_type, config)

def get_sheet_metadata(connection):
    """Obtiene los nombres de las hojas y sus encabezados usando conectores modulares."""
    if connection.connection_type == "local_file":
        # Simular comportamiento antiguo para compatibilidad
        result = {}
        if connection.file_path.endswith('.csv'):
            df = pd.read_csv(connection.file_path, nrows=0)
            result["CSV Data"] = df.columns.tolist()
        elif connection.file_path.endswith(('.xls', '.xlsx')):
            xls = pd.ExcelFile(connection.file_path)
            for sheet_name in xls.sheet_names:
                df = pd.read_excel(connection.file_path, sheet_name=sheet_name, nrows=0)
                result[sheet_name] = df.columns.tolist()
        return result

    if connection.connection_type == "shopify":
        # Shopify no tiene "hojas". Exponemos una pseudo-hoja "Products" con las
        # columnas planas (sku, price, inventory_quantity, ...) para el mapeo.
        connector = _create_connector(connection)
        return {"Products": connector.get_available_columns()}

    # Google Sheets logic usando api existente (para metadata es más simple directo por ahora)
    service = get_sheets_service()
    if not service:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Faltan credenciales de Google Sheets en el servidor (GOOGLE_CREDENTIALS_JSON no configurado).")
        
    sheet_metadata = execute_with_retry(service.spreadsheets().get(spreadsheetId=connection.spreadsheet_id))
    sheets = sheet_metadata.get('sheets', '')

    result = {}
    for sheet in sheets:
        title = sheet['properties']['title']
        range_name = f"{title}!A1:ZZZ1"
        response = execute_with_retry(service.spreadsheets().values().get(
            spreadsheetId=connection.spreadsheet_id, range=range_name))
        
        headers = response.get('values', [[]])[0] if response.get('values') else []
        result[title] = headers
        
    return result

def get_sheet_data(connection, range_name: str):
    """Obtiene los datos usando los conectores modulares."""
    # Extraer el nombre de la hoja de range_name (ej: "Inventario!A1:Z" -> "Inventario")
    sheet_name = range_name.split('!')[0] if '!' in range_name else range_name

    # Caché solo para Google Sheets (es el que tiene cuota). Local/HTTP no.
    cache_key = getattr(connection, "spreadsheet_id", None)
    if cache_key:
        cached = _cache_get(cache_key, sheet_name)
        if cached is not None:
            return cached

    connector = _create_connector(connection)
    # Obtener diccionarios y convertir a lista de listas para compatibilidad
    try:
        dict_data = connector.fetch_data(sheet_name)
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=f"Error en conector: {str(e)}")

    if not dict_data:
        return []

    # Convertir dict_data (lista de diccionarios) a lista de listas
    headers = list(dict_data[0].keys())
    result = [headers]
    for row in dict_data:
        result.append([str(row.get(h, "")) for h in headers])

    if cache_key:
        _cache_put(cache_key, sheet_name, result)

    return result

def write_sheet_data(spreadsheet_id: str, sheet_name: str, data: list) -> dict:
    """
    Escribe data (lista de listas, incluida cabecera) en un Google Sheet destino.
    Limpia el rango primero y luego escribe los datos frescos.
    data[0] debe ser la fila de cabeceras.
    """
    service = get_sheets_service()
    if not service:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Faltan credenciales de Google Sheets en el servidor (GOOGLE_CREDENTIALS_JSON no configurado).")

    range_name = f"{sheet_name}!A1"

    # 1. Limpiar el rango actual (A:ZZZ para no dejar columnas viejas sin borrar)
    execute_with_retry(service.spreadsheets().values().clear(
        spreadsheetId=spreadsheet_id,
        range=f"{sheet_name}!A:ZZZ"
    ))

    # 2. Escribir los datos nuevos
    # RAW (no USER_ENTERED): evita que Sheets reformatee los SKU (notación
    # científica, fechas, ceros a la izquierda), lo que rompía la coincidencia
    # de SKU y causaba productos duplicados en cada sincronización.
    body = {"values": data}
    result = execute_with_retry(service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=range_name,
        valueInputOption="RAW",
        body=body
    ))

    invalidate_read_cache(spreadsheet_id, sheet_name)
    return {"rows_written": result.get("updatedRows", 0)}

def column_index_to_letter(col_idx: int) -> str:
    """Convierte índice (0-based) a letra de columna (A, B, ..., Z, AA, AB...)"""
    letter = ""
    col_idx += 1
    while col_idx > 0:
        col_idx, remainder = divmod(col_idx - 1, 26)
        letter = chr(65 + remainder) + letter
    return letter

def write_sheet_data_surgical(spreadsheet_id: str, sheet_name: str, headers: list, changes: list, new_rows: list, total_rows_before: int) -> dict:
    """
    Escribe quirúrgicamente solo las celdas que cambiaron y añade nuevas filas.
    - changes: [{"field": "precio", "new": "120", "row_index": 1}, ...] (row_index 1 = Fila 2 en Sheet)
    - new_rows: [{"fields": {"precio": "90", "SKU": "NEW1"}}, ...]
    - total_rows_before: Cantidad de filas antes de añadir (para saber dónde apendizar)
    """
    service = get_sheets_service()
    if not service:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Faltan credenciales de Google Sheets.")

    updates = []
    
    # 1. Actualizaciones de celdas específicas
    # Agrupar por fila para minimizar el número de rangos si es posible, o simplemente mapear celdas
    for change in changes:
        try:
            col_idx = headers.index(change["field"])
            col_letter = column_index_to_letter(col_idx)
            # row_index 1 en array = Fila 2 en Google Sheets
            sheet_row = change["row_index"] + 1 
            range_name = f"{sheet_name}!{col_letter}{sheet_row}"
            
            updates.append({
                "range": range_name,
                "values": [[change["new"]]]
            })
        except ValueError:
            continue

    # 2. Añadir nuevas filas al final usando append.
    if new_rows:
        append_values = []
        for row_data in new_rows:
            new_row_values = [row_data["fields"].get(h, "") for h in headers]
            append_values.append(new_row_values)

        # Acotamos el rango-tabla a los datos reales (A1 : última_col última_fila).
        # Si solo se pasa "A1", Google busca la última fila con CUALQUIER contenido
        # en toda la hoja y pega ahí; si hay datos/formato residual muy abajo, las
        # filas nuevas se "desbordan" dejando un hueco gigante. Acotando el rango,
        # append escribe justo después de la última fila de datos real.
        last_col = column_index_to_letter(max(len(headers) - 1, 0))
        last_row = max(total_rows_before, 1)
        table_range = f"{sheet_name}!A1:{last_col}{last_row}"

        execute_with_retry(service.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=table_range,
            # RAW: preserva los SKU exactos también en filas nuevas (si no, Sheets
            # los deforma y la próxima sync los duplica).
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": append_values}
        ))

    # Ejecutar Batch Update
    if updates:
        body = {
            # RAW: preserva los SKU exactos (ver nota en write_sheet_data).
            "valueInputOption": "RAW",
            "data": updates
        }
        result = execute_with_retry(service.spreadsheets().values().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body=body
        ))
        invalidate_read_cache(spreadsheet_id, sheet_name)
        return {"total_updates": result.get("totalUpdatedCells", 0)}

    invalidate_read_cache(spreadsheet_id, sheet_name)
    return {"total_updates": 0}

from .models import Project, Connection

def _get_master_info(db):
    project = db.query(Project).first()
    if not project or not project.master_connection_id:
        return None, None, None
    master_conn = db.query(Connection).filter(Connection.id == project.master_connection_id).first()
    return project, master_conn, project.master_sheet_name

def _compute_master_sync(project, req, db):
    from fastapi import HTTPException
    src_conn = db.query(Connection).filter(Connection.id == req.source_connection_id).first()
    if not src_conn:
        raise HTTPException(status_code=404, detail="Conexión origen no encontrada")
        
    src_raw = get_sheet_data(src_conn, f"{req.source_sheet_name}!A1:Z")
    if not src_raw or len(src_raw) < 2:
        raise HTTPException(status_code=400, detail="La tabla origen está vacía")
    
    src_headers = src_raw[0]
    
    if req.sku_column_source not in src_headers:
        raise HTTPException(status_code=400, detail=f"Columna '{req.sku_column_source}' no encontrada en el origen.")
    src_sku_idx = src_headers.index(req.sku_column_source)
    
    # Respetar destino explícito del proceso, o caer a la maestra global
    if getattr(req, 'target_connection_id', None) and getattr(req, 'target_sheet_name', None):
        master_conn = db.query(Connection).filter(Connection.id == req.target_connection_id).first()
        target_sheet_name = req.target_sheet_name
    else:
        master_conn = db.query(Connection).filter(Connection.id == project.master_connection_id).first()
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
    
    master_by_sku = {}
    # Índice por SKU NORMALIZADO: el cruce se hace por aquí para que la suciedad
    # de formato (1203.0 / 01203 / mayúsculas / espacios) no genere falsos
    # "no cruza". La normalización es SOLO para comparar; el SKU guardado no se toca.
    master_by_norm = {}          # normalizado -> {index, data, sku}
    master_norm_index = {}       # normalizado -> SKU original (compat con detección de parecidos)
    master_len_buckets = {}
    for i, row in enumerate(master_raw[1:]):
        sku_val = (row[master_sku_idx] if master_sku_idx < len(row) else "").strip()
        if sku_val:
            padded_row = row + [""] * (len(master_headers) - len(row))
            master_by_sku[sku_val] = {"index": i + 1, "data": padded_row}
            norm = normalize_sku_for_match(sku_val)
            if norm:
                master_by_norm.setdefault(norm, {"index": i + 1, "data": padded_row, "sku": sku_val})
                master_norm_index.setdefault(norm, sku_val)
                master_len_buckets.setdefault(len(norm), []).append((norm, sku_val))

    rows_updated = 0
    rows_added = 0
    rows_unchanged = 0
    rows_skipped = 0  # filas de origen descartadas por SKU vacío o inválido

    # Formato granular (El Guardián)
    granular_changes = []
    granular_new_rows = []
    granular_unchanged_skus = []
    matched_norms = set()  # SKUs normalizados de la Maestra que SÍ aparecen en BASE
    skipped_skus = []

    for src_row in src_raw[1:]:
        sku_val = (src_row[src_sku_idx] if src_sku_idx < len(src_row) else "").strip()
        if not sku_val:
            continue

        # Guard anti-basura: las filas-encabezado del proveedor (ej. "RELOJES 3D")
        # repiten el mismo texto en varias columnas (sku = name = categoría = marca).
        # Si el SKU coincide con el valor de 2+ columnas mapeadas de la misma fila,
        # casi seguro NO es un producto, sino una fila divisoria. Se descarta para
        # no crear "productos" basura ni duplicados.
        sku_norm = sku_val.lower()
        repeated_in_other_cols = 0
        for src_col in req.field_mappings.keys():
            if src_col not in src_headers:
                continue
            ci = src_headers.index(src_col)
            if ci == src_sku_idx:
                continue
            other_val = (src_row[ci] if ci < len(src_row) else "").strip().lower()
            if other_val and other_val == sku_norm:
                repeated_in_other_cols += 1
        if repeated_in_other_cols >= 2:
            rows_skipped += 1
            skipped_skus.append(sku_val)
            continue

        norm = normalize_sku_for_match(sku_val)
        mr_info = master_by_norm.get(norm)

        if mr_info is not None:
            # CRUZA (por SKU normalizado): se rellena el NÚCLEO. El enriquecimiento
            # (columnas que no están en field_mappings) nunca se toca.
            matched_norms.add(norm)
            mr_data = mr_info["data"]
            master_sku = mr_info["sku"]  # se conserva el SKU tal cual está en la Maestra
            changed = False

            for src_col, dst_col in req.field_mappings.items():
                if src_col in src_headers and dst_col in master_headers:
                    s_idx = src_headers.index(src_col)
                    m_idx = master_headers.index(dst_col)
                    new_val = src_row[s_idx] if s_idx < len(src_row) else ""
                    old_val = mr_data[m_idx]
                    if old_val != new_val:
                        granular_changes.append({
                            "sku": master_sku,
                            "field": dst_col,
                            "old": old_val,
                            "new": new_val,
                            "row_index": mr_info["index"]
                        })
                        mr_data[m_idx] = new_val
                        changed = True

            if changed:
                master_raw[mr_info["index"]] = mr_data
                rows_updated += 1
            else:
                rows_unchanged += 1
                granular_unchanged_skus.append(master_sku)

        else:
            # NO está en la Maestra: como "todo lo de BASE debe estar en Master",
            # se CREA con los datos de núcleo (el enriquecimiento queda vacío para
            # llenarse luego). Se indexa para no duplicar si BASE lo trae 2 veces.
            # El SKU va dentro de fields para que la escritura quirúrgica
            # (que arma la fila nueva desde fields) escriba el código.
            new_fields = {req.sku_column_master: sku_val}
            new_mr_data = [""] * len(master_headers)
            new_mr_data[master_sku_idx] = sku_val
            for src_col, dst_col in req.field_mappings.items():
                if src_col in src_headers and dst_col in master_headers:
                    s_idx = src_headers.index(src_col)
                    new_val = src_row[s_idx] if s_idx < len(src_row) else ""
                    new_mr_data[master_headers.index(dst_col)] = new_val
                    new_fields[dst_col] = new_val

            master_raw.append(new_mr_data)
            new_index = len(master_raw) - 1
            master_by_norm[norm] = {"index": new_index, "data": new_mr_data, "sku": sku_val}
            matched_norms.add(norm)
            rows_added += 1
            granular_new_rows.append({"sku": sku_val, "fields": new_fields})

    # Coherencia: SKUs que están en la Maestra pero NO llegaron desde BASE (huérfanos).
    granular_orphans = []
    for norm, info in master_by_norm.items():
        if norm not in matched_norms:
            granular_orphans.append(info["sku"])
    rows_orphan = len(granular_orphans)

    total_base = len(src_raw) - 1
    # Índice de coherencia: % de BASE que ya estaba en la Maestra ANTES de crear.
    ya_estaban = rows_updated + rows_unchanged
    coherence_index = round(100.0 * ya_estaban / total_base, 1) if total_base else 100.0

    return {
        "master_raw": master_raw,
        "master_conn": master_conn,
        "target_sheet_name": target_sheet_name,
        "rows_updated": rows_updated,
        "rows_added": rows_added,          # faltaban en Master y se crearon
        "rows_unchanged": rows_unchanged,
        "rows_skipped": rows_skipped,
        "rows_orphan": rows_orphan,        # en Master pero no en BASE (revisar)
        "coherence_index": coherence_index,
        "skipped_skus": skipped_skus,
        "total_origen": total_base,
        "total_maestra": len(master_raw) - 1,
        "detail_updated": granular_changes,
        "detail_added": granular_new_rows,
        "detail_unchanged": granular_unchanged_skus,
        "detail_orphan": granular_orphans,
        "changes": granular_changes,
        "new_rows": granular_new_rows,     # se escriben (BASE debe existir en Master)
        "unchanged_skus": granular_unchanged_skus,
        "orphans": granular_orphans
    }

def _run_single_process(proc, db):
    import json
    from .schemas import MasterSyncRequest
    from .routers.logs import log_event
    import traceback
    
    project, master_conn, master_sheet = _get_master_info(db)
    if not project or not master_conn:
        return {"status": "error", "error": "No hay tabla maestra enlazada."}
    
    field_mappings = json.loads(proc.field_mappings) if isinstance(proc.field_mappings, str) else proc.field_mappings
    req = MasterSyncRequest(
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
        target_sheet_name = result["target_sheet_name"]
        target_conn = result["master_conn"]
        
        if result["rows_updated"] > 0 or result["rows_added"] > 0:
            total_rows_before = len(master_raw) - len(result["new_rows"])
            write_sheet_data_surgical(
                target_conn.spreadsheet_id, 
                target_sheet_name, 
                master_raw[0], # headers
                result["changes"],
                result["new_rows"],
                total_rows_before
            )
            
        log_event(db, "SYNC_PROCESS", "success", f"Proceso '{proc.name}' ejecutado directamente.", proc.id, None, None, result["rows_updated"] + result["rows_added"])
        
        return {
            "status": "success",
            "process_name": proc.name,
            "rows_updated": result["rows_updated"],
            "rows_added": result["rows_added"],
            "changes": result.get("changes", []),
            "new_rows": result.get("new_rows", [])
        }
    except Exception as e:
        log_event(db, "SYNC_ERROR", "error", f"Error ejecutando '{proc.name}': {str(e)}", proc.id, None, traceback.format_exc())
        return {"status": "error", "error": str(e)}
