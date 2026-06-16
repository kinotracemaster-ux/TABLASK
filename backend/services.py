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

