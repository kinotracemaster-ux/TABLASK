from abc import ABC, abstractmethod
from typing import List, Dict, Any, Tuple

class BaseConnector(ABC):
    """
    Interfaz común para todos los conectores de entrada de datos (CSV, Google Sheets, HTTP, etc.).
    Garantiza que el motor de sincronización (sync_engine) no necesite saber de dónde vienen los datos.
    """

    def __init__(self, connection_config: Dict[str, Any]):
        """Inicializa el conector con su configuración específica."""
        self.config = connection_config

    @abstractmethod
    def fetch_data(self, source_path: str) -> List[Dict[str, Any]]:
        """
        Descarga o lee los datos crudos desde la fuente.
        
        Args:
            source_path: Ruta, URL o nombre de la hoja donde están los datos.
            
        Returns:
            Lista de diccionarios, donde cada diccionario representa una fila 
            (claves son nombres de columnas, valores son el dato).
        """
        pass

    @abstractmethod
    def normalize_data(self, raw_data: List[Dict[str, Any]], field_mappings: Dict[str, str]) -> List[Dict[str, Any]]:
        """
        Toma los datos crudos y los mapea a los nombres de columna de la Tabla Maestra.
        
        Args:
            raw_data: Los datos devueltos por fetch_data.
            field_mappings: Diccionario {"columna_origen": "columna_maestra"}.
            
        Returns:
            Lista de diccionarios estandarizados listos para ser procesados por el sync_engine.
        """
        pass

    def test_connection(self) -> Tuple[bool, str]:
        """
        Prueba que las credenciales y la configuración sean válidas.
        
        Returns:
            (Éxito, Mensaje de error/éxito)
        """
        return True, "OK"
