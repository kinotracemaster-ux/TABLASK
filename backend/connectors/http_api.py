import requests
import json
from typing import List, Dict, Any, Tuple
from .base import BaseConnector

class HttpApiConnector(BaseConnector):
    """Conector para importar datos desde APIs HTTP externas."""
    
    def __init__(self, connection_config: Dict[str, Any]):
        super().__init__(connection_config)
        self.url = self.config.get("http_url")
        self.method = self.config.get("http_method", "GET").upper()
        
        # Parsear headers
        raw_headers = self.config.get("http_headers", "{}")
        try:
            self.headers = json.loads(raw_headers) if raw_headers else {}
        except json.JSONDecodeError:
            self.headers = {}
            
    def fetch_data(self, source_path: str) -> List[Dict[str, Any]]:
        """
        Descarga los datos desde la URL HTTP.
        """
        if not self.url:
            raise ValueError("No se configuró URL para la conexión HTTP.")
            
        # Si source_path tiene un valor (no es vacío y no es "CSV Data"), lo usamos como query param adicional o ruta
        # pero por defecto la URL completa debe estar en http_url
        target_url = self.url
        
        response = requests.request(
            method=self.method,
            url=target_url,
            headers=self.headers
        )
        response.raise_for_status()
        
        data = response.json()
        
        # Si la API devuelve un dict como {"data": [...]}, intentamos extraer la lista
        if isinstance(data, dict):
            # Buscar la primera llave que contenga una lista
            for k, v in data.items():
                if isinstance(v, list):
                    return v
            return [data] # Si no hay lista, devolver el objeto como un solo registro
        elif isinstance(data, list):
            return data
        else:
            raise ValueError(f"Formato de respuesta no soportado: {type(data)}. Se esperaba un JSON (lista o diccionario).")

    def normalize_data(self, raw_data: List[Dict[str, Any]], field_mappings: Dict[str, str]) -> List[Dict[str, Any]]:
        """
        Estandariza las columnas.
        """
        normalized = []
        for row in raw_data:
            new_row = {}
            for src_col, master_col in field_mappings.items():
                # Soportar anidamiento básico (e.g. "customer.name" -> "Cliente")
                val = row
                for part in src_col.split('.'):
                    if isinstance(val, dict):
                        val = val.get(part, "")
                    else:
                        val = ""
                        break
                new_row[master_col] = str(val)
            normalized.append(new_row)
        return normalized

    def test_connection(self) -> Tuple[bool, str]:
        if not self.url:
            return False, "URL no configurada."
        try:
            # Hacer una petición head o get con timeout corto
            response = requests.request(self.method, self.url, headers=self.headers, timeout=5)
            response.raise_for_status()
            return True, f"Conexión exitosa. Código HTTP: {response.status_code}"
        except Exception as e:
            return False, f"Fallo al conectar: {str(e)}"
