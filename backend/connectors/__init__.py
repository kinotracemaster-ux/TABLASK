from typing import Any, Dict
from .base import BaseConnector
from .google_sheets import GoogleSheetsConnector
from .local_file import LocalFileConnector
from .http_api import HttpApiConnector
from .shopify import ShopifyConnector

def get_connector(connection_type: str, config: Dict[str, Any]) -> BaseConnector:
    """
    Factory para obtener la instancia del conector adecuado según el tipo de conexión.
    """
    if connection_type == "google_sheets":
        return GoogleSheetsConnector(config)
    elif connection_type == "local_file":
        return LocalFileConnector(config)
    elif connection_type == "http_api":
        return HttpApiConnector(config)
    elif connection_type == "shopify":
        return ShopifyConnector(config)
    else:
        raise ValueError(f"Tipo de conexión no soportado: {connection_type}")
