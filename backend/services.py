from googleapiclient.discovery import build
from google.oauth2 import service_account
import os
import pandas as pd

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
        "http_headers": connection.http_headers
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

    # Google Sheets logic usando api existente (para metadata es más simple directo por ahora)
    service = get_sheets_service()
    if not service:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Faltan credenciales de Google Sheets en el servidor (GOOGLE_CREDENTIALS_JSON no configurado).")
        
    sheet_metadata = service.spreadsheets().get(spreadsheetId=connection.spreadsheet_id).execute()
    sheets = sheet_metadata.get('sheets', '')
    
    result = {}
    for sheet in sheets:
        title = sheet['properties']['title']
        range_name = f"{title}!A1:Z1"
        response = service.spreadsheets().values().get(
            spreadsheetId=connection.spreadsheet_id, range=range_name).execute()
        
        headers = response.get('values', [[]])[0] if response.get('values') else []
        result[title] = headers
        
    return result

def get_sheet_data(connection, range_name: str):
    """Obtiene los datos usando los conectores modulares."""
    connector = _create_connector(connection)
    
    # Extraer el nombre de la hoja de range_name (ej: "Inventario!A1:Z" -> "Inventario")
    sheet_name = range_name.split('!')[0] if '!' in range_name else range_name
    
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

    # 1. Limpiar el rango actual
    service.spreadsheets().values().clear(
        spreadsheetId=spreadsheet_id,
        range=f"{sheet_name}!A1:Z"
    ).execute()

    # 2. Escribir los datos nuevos
    body = {"values": data}
    result = service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=range_name,
        valueInputOption="USER_ENTERED",
        body=body
    ).execute()

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

    # 2. Añadir nuevas filas al final
    if new_rows:
        current_bottom_row = total_rows_before + 1 # si hay 100 filas (incluyendo header), empieza en 101
        
        for row_data in new_rows:
            # Reconstruir la fila según el orden de headers
            new_row_values = []
            for h in headers:
                new_row_values.append(row_data["fields"].get(h, ""))
                
            updates.append({
                "range": f"{sheet_name}!A{current_bottom_row}",
                "values": [new_row_values]
            })
            current_bottom_row += 1

    # Ejecutar Batch Update
    if updates:
        body = {
            "valueInputOption": "USER_ENTERED",
            "data": updates
        }
        result = service.spreadsheets().values().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body=body
        ).execute()
        return {"total_updates": result.get("totalUpdatedCells", 0)}
    
    return {"total_updates": 0}

from .models import Project, Connection

def _get_master_info(db):
    project = db.query(Project).first()
    if not project or not project.master_connection_id:
        return None, None, None
    master_conn = db.query(Connection).filter(Connection.id == project.master_connection_id).first()
    return project, master_conn, project.master_sheet_name

def _get_sheet_headers(connection, sheet_name):
    """Devuelve la lista de encabezados de una hoja concreta de una conexión.
    Lanza HTTPException si no se pudo leer la metadata (para no validar a ciegas)."""
    from fastapi import HTTPException
    try:
        metadata = get_sheet_metadata(connection)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"No se pudo leer la conexión '{connection.name}': {str(e)}")

    if sheet_name not in metadata:
        hojas = ", ".join(metadata.keys()) or "(ninguna)"
        raise HTTPException(
            status_code=400,
            detail=f"La hoja '{sheet_name}' no existe en la conexión '{connection.name}'. Hojas disponibles: {hojas}."
        )
    return metadata.get(sheet_name, [])


def _normalize_col(name):
    """Normaliza un nombre de columna: minúsculas, sin acentos ni espacios/símbolos."""
    import unicodedata
    s = unicodedata.normalize("NFKD", str(name))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return "".join(ch for ch in s.lower() if ch.isalnum())


def _find_similar_columns(target, headers):
    """Busca columnas parecidas a 'target' dentro de 'headers'.

    Considera: igualdad ignorando mayúsculas/acentos/símbolos, subcadena,
    mismo grupo semántico y cercanía difusa. Devuelve nombres reales sugeridos
    ordenados por relevancia (sin duplicados)."""
    from .intelligent_engine import get_semantic_group
    import difflib

    t_norm = _normalize_col(target)
    if not t_norm:
        return []

    t_group = get_semantic_group(target)
    sugeridas = []

    def _add(h):
        if h not in sugeridas:
            sugeridas.append(h)

    # 1. Igualdad normalizada (p. ej. "Código" vs "codigo", "SKU " vs "sku")
    for h in headers:
        if _normalize_col(h) == t_norm:
            _add(h)

    # 2. Subcadena en cualquier sentido ("codigo" dentro de "codigo_producto")
    for h in headers:
        hn = _normalize_col(h)
        if hn and (t_norm in hn or hn in t_norm):
            _add(h)

    # 3. Mismo grupo semántico ("precio" ~ "valor", "stock" ~ "cantidad")
    if t_group:
        for h in headers:
            if get_semantic_group(h) == t_group:
                _add(h)

    # 4. Cercanía difusa como último recurso
    for h in difflib.get_close_matches(target, headers, n=3, cutoff=0.7):
        _add(h)

    return sugeridas


def _falta_columna_msg(rol, columna, hoja, headers):
    """Construye el mensaje de una columna faltante, sugiriendo parecidas si las hay."""
    similares = _find_similar_columns(columna, headers)
    base = f"La columna {rol} '{columna}' no existe en {hoja}."
    if similares:
        base += f" ¿Quisiste decir: {', '.join(similares)}?"
    base += f" Columnas disponibles: {', '.join(headers) or '(vacío)'}."
    return base


def _validate_process_mapping(proc, db):
    """Verifica concordancia EXACTA entre el mapeo del proceso y las tablas reales.

    Comprueba que:
      - La columna llave de origen existe (exacto) en la hoja origen.
      - La columna llave de destino existe (exacto) en la tabla maestra/destino.
      - Cada columna origen mapeada existe (exacto) en la hoja origen.

    Si algo no concuerda, lanza HTTPException 400 con el detalle, para que el
    proceso NO se cree/actualice y el usuario lo corrija primero.
    """
    from fastapi import HTTPException

    src_conn = db.query(Connection).filter(Connection.id == proc.source_connection_id).first()
    if not src_conn:
        raise HTTPException(status_code=404, detail="Conexión origen no encontrada.")

    # Resolver destino: explícito del proceso o la maestra global
    if proc.target_connection_id and proc.target_sheet_name:
        target_conn = db.query(Connection).filter(Connection.id == proc.target_connection_id).first()
        target_sheet = proc.target_sheet_name
    else:
        project, master_conn, master_sheet = _get_master_info(db)
        target_conn = master_conn
        target_sheet = master_sheet

    if not target_conn or not target_sheet:
        raise HTTPException(
            status_code=400,
            detail="No hay tabla maestra enlazada y el proceso no define un destino propio."
        )

    src_headers = _get_sheet_headers(src_conn, proc.source_sheet_name)
    master_headers = _get_sheet_headers(target_conn, target_sheet)

    problemas = []

    # 1. Llave de origen
    if proc.sku_column_source not in src_headers:
        problemas.append(_falta_columna_msg(
            "llave de ORIGEN", proc.sku_column_source,
            f"la hoja '{proc.source_sheet_name}'", src_headers))

    # 2. Llave de destino
    if proc.sku_column_master not in master_headers:
        problemas.append(_falta_columna_msg(
            "llave de DESTINO", proc.sku_column_master,
            "la tabla maestra", master_headers))

    # 3. Columnas de origen mapeadas
    field_mappings = proc.field_mappings
    if isinstance(field_mappings, str):
        import json as _json
        field_mappings = _json.loads(field_mappings)
    for src in field_mappings.keys():
        if src not in src_headers:
            problemas.append(_falta_columna_msg(
                "de origen mapeada", src,
                f"la hoja '{proc.source_sheet_name}'", src_headers))

    if problemas:
        raise HTTPException(
            status_code=400,
            detail="No se creó el proceso porque el mapeo no concuerda con las tablas. "
                   "Corrige lo siguiente y vuelve a intentar:\n- " + "\n- ".join(problemas)
        )


def _find_duplicate_keys(rows, key_idx):
    """Devuelve {valor_llave: [num_fila_en_sheet, ...]} para llaves que se repiten
    DENTRO de una misma hoja. num_fila es 1-based con cabecera (fila 2 = primer dato)."""
    from collections import OrderedDict
    seen = OrderedDict()
    for i, row in enumerate(rows[1:]):
        val = row[key_idx] if key_idx < len(row) else ""
        val = (val or "").strip()
        if not val:
            continue
        seen.setdefault(val, []).append(i + 2)  # +2: salta cabecera y pasa a 1-based
    return {k: v for k, v in seen.items() if len(v) > 1}


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
    
    # Detectar llaves duplicadas DENTRO de cada hoja (no debería haberlas).
    source_dup_keys = _find_duplicate_keys(src_raw, src_sku_idx)
    master_dup_keys = _find_duplicate_keys(master_raw, master_sku_idx)

    master_by_sku = {}
    for i, row in enumerate(master_raw[1:]):
        sku_val = row[master_sku_idx] if master_sku_idx < len(row) else ""
        if sku_val:
            padded_row = row + [""] * (len(master_headers) - len(row))
            master_by_sku[sku_val] = {"index": i + 1, "data": padded_row}

    rows_updated = 0
    rows_added = 0
    rows_unchanged = 0
    
    # Nuevo formato granular (El Guardián)
    granular_changes = []
    granular_new_rows = []
    granular_unchanged_skus = []
    
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
                        granular_changes.append({
                            "sku": sku_val,
                            "field": dst_col,
                            "old": old_val,
                            "new": new_val,
                            "row_index": mr_info["index"]  # Para escritura quirúrgica
                        })
                        mr_data[m_idx] = new_val
                        changed = True
            
            if changed:
                master_raw[mr_info["index"]] = mr_data
                rows_updated += 1
            else:
                rows_unchanged += 1
                granular_unchanged_skus.append(sku_val)
                
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
            granular_new_rows.append({"sku": sku_val, "fields": new_fields})
            
    # Llaves repetidas dentro de una misma hoja.
    # - En la MAESTRA suelen ser VARIANTES legítimas (el sufijo -1/-2/-3 vive en
    #   sistemas hijos como KYTE, no en la maestra): aviso informativo, no error.
    # - En el ORIGEN sí es serio: para cada SKU repetido gana la última fila leída.
    dup_warnings = []
    if master_dup_keys:
        total_filas = sum(len(v) for v in master_dup_keys.values())
        ejemplos = "; ".join(f"'{k}' ×{len(v)} (filas {', '.join(map(str, v))})"
                             for k, v in list(master_dup_keys.items())[:5])
        dup_warnings.append({
            "level": "info",
            "message": (
                f"{len(master_dup_keys)} código(s) de la maestra tienen varias filas "
                f"({total_filas} en total) — probablemente variantes del mismo producto. "
                f"El cruce por código exacto sólo actualiza UNA fila por código. Ej: {ejemplos}."
            ),
        })
    if source_dup_keys:
        ejemplos = "; ".join(f"'{k}' (filas {', '.join(map(str, v))})"
                             for k, v in list(source_dup_keys.items())[:5])
        dup_warnings.append({
            "level": "warn",
            "message": (
                f"El ORIGEN tiene {len(source_dup_keys)} llave(s) duplicada(s) en la misma hoja; "
                f"para cada código repetido gana la ÚLTIMA fila leída y las anteriores se pierden. "
                f"Ej: {ejemplos}."
            ),
        })

    return {
        "master_raw": master_raw,
        "master_conn": master_conn,
        "target_sheet_name": target_sheet_name,
        "rows_updated": rows_updated,
        "rows_added": rows_added,
        "rows_unchanged": rows_unchanged,
        "total_origen": len(src_raw) - 1,
        "total_maestra": len(master_raw) - 1,
        "detail_updated": granular_changes,
        "detail_added": granular_new_rows,
        "detail_unchanged": granular_unchanged_skus,
        "changes": granular_changes,
        "new_rows": granular_new_rows,
        "unchanged_skus": granular_unchanged_skus,
        "source_dup_keys": source_dup_keys,
        "master_dup_keys": master_dup_keys,
        "dup_warnings": dup_warnings,
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
            "rows_added": result["rows_added"]
        }
    except Exception as e:
        log_event(db, "SYNC_ERROR", "error", f"Error ejecutando '{proc.name}': {str(e)}", proc.id, None, traceback.format_exc())
        return {"status": "error", "error": str(e)}
