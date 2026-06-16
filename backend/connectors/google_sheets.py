import os
from typing import List, Dict, Any, Tuple
from googleapiclient.discovery import build
from google.oauth2 import service_account
from .base import BaseConnector

class GoogleSheetsConnector(BaseConnector):
    """Conector para importar datos desde Google Sheets."""
    
    def __init__(self, connection_config: Dict[str, Any]):
        super().__init__(connection_config)
        self.spreadsheet_id = self.config.get("spreadsheet_id")
        self.scopes = ['https://www.googleapis.com/auth/spreadsheets.readonly']
        
    def _get_service(self):
        """Inicializa el cliente de Google Sheets."""
        creds_json = os.getenv('GOOGLE_CREDENTIALS_JSON')
        if creds_json:
            import json
            creds_dict = json.loads(creds_json)
            creds = service_account.Credentials.from_service_account_info(creds_dict, scopes=self.scopes)
            return build('sheets', 'v4', credentials=creds)

        service_account_file = os.getenv('GOOGLE_CREDENTIALS_FILE', '../credentials.json')
        if os.path.exists(service_account_file):
            creds = service_account.Credentials.from_service_account_file(
                service_account_file, scopes=self.scopes)
            return build('sheets', 'v4', credentials=creds)
            
        raise ValueError("No se encontraron credenciales de Google Sheets configuradas.")

    def fetch_data(self, source_path: str) -> List[Dict[str, Any]]:
        """
        Lee los datos de la hoja especificada.
        source_path es el nombre de la hoja (sheet_name).
        """
        service = self._get_service()
        range_name = f"{source_path}!A1:Z" # O puedes especificar un rango mayor si lo necesitas
        
        response = service.spreadsheets().values().get(
            spreadsheetId=self.spreadsheet_id, range=range_name).execute()
        
        values = response.get('values', [])
        if not values:
            return []
            
        headers = values[0]
        data_rows = values[1:]
        
        result = []
        for row in data_rows:
            # Rellenar con strings vacíos si la fila tiene menos columnas que el header
            padded_row = row + [''] * (len(headers) - len(row))
            row_dict = {str(headers[i]).strip(): padded_row[i] for i in range(len(headers))}
            result.append(row_dict)
            
        return result

    def normalize_data(self, raw_data: List[Dict[str, Any]], field_mappings: Dict[str, str]) -> List[Dict[str, Any]]:
        """
        Aplica los mappings para estandarizar los nombres de las columnas.
        """
        normalized = []
        for row in raw_data:
            new_row = {}
            for src_col, master_col in field_mappings.items():
                # Si la columna fuente no existe en la fila, ponemos un string vacío
                new_row[master_col] = str(row.get(src_col, ""))
            normalized.append(new_row)
            
        return normalized

    def test_connection(self) -> Tuple[bool, str]:
        """Prueba si puede leer la metadata de la hoja."""
        try:
            service = self._get_service()
            service.spreadsheets().get(spreadsheetId=self.spreadsheet_id).execute()
            return True, "Conexión a Google Sheets exitosa."
        except Exception as e:
            return False, f"Fallo de conexión a Google Sheets: {str(e)}"
