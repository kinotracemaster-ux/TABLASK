from googleapiclient.discovery import build
from google.oauth2 import service_account

# Configuración de credenciales (Service Account)
SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
SERVICE_ACCOUNT_FILE = 'credentials.json'

def get_sheets_service():
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=SCOPES)
    return build('sheets', 'v4', credentials=creds)

def get_sheet_metadata(spreadsheet_id: str):
    """Obtiene los nombres de las hojas y sus encabezados (columnas)."""
    service = get_sheets_service()
    sheet_metadata = service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    sheets = sheet_metadata.get('sheets', '')
    
    result = {}
    for sheet in sheets:
        title = sheet['properties']['title']
        # Traemos solo la primera fila (A1:Z1) para leer los encabezados
        range_name = f"{title}!A1:Z1"
        response = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id, range=range_name).execute()
        
        headers = response.get('values', [[]])[0]
        result[title] = headers # Ej: {"Productos": ["Código", "Nombre", "Marca"]}
        
    return result