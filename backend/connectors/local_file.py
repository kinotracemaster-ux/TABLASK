import os
import io
import pandas as pd
from typing import List, Dict, Any, Tuple
from .base import BaseConnector

class LocalFileConnector(BaseConnector):
    """Conector para archivos locales CSV, XLS, XLSX."""

    def __init__(self, connection_config: Dict[str, Any]):
        super().__init__(connection_config)
        self.file_path = self.config.get("file_path")
        # Bytes del archivo guardados en la DB (persisten a los redeploys de
        # Railway, donde el disco es efímero). Si están, se leen de acá.
        self.file_content = self.config.get("file_content")
        # Nombre original (para deducir la extensión aunque leamos de bytes).
        self.file_name = self.config.get("file_name") or self.file_path or ""

    def _buffer(self):
        """Fuente legible por pandas: bytes en memoria si existen, si no la ruta
        en disco. Si no hay ninguno, el archivo se perdió (redeploy) y hay que
        volver a subirlo."""
        if self.file_content:
            return io.BytesIO(self.file_content)
        if self.file_path and os.path.exists(self.file_path):
            return self.file_path
        raise FileNotFoundError(
            "El archivo subido ya no está disponible (probablemente se perdió "
            "tras un redeploy del servidor). Volvé a subirlo para actualizar la fuente."
        )

    def _ext(self) -> str:
        name = (self.file_name or "").lower()
        return name[name.rfind('.'):] if '.' in name else ""

    def fetch_data(self, source_path: str) -> List[Dict[str, Any]]:
        """
        Lee el archivo local.
        source_path es ignorado para CSV, pero usado como nombre de hoja para Excel.
        """
        src = self._buffer()
        ext = self._ext()

        if ext == '.csv':
            df = pd.read_csv(src, dtype=str).fillna("")
        elif ext in ('.xls', '.xlsx'):
            sheet = source_path if source_path and source_path != "CSV Data" else 0
            df = pd.read_excel(src, sheet_name=sheet, dtype=str).fillna("")
        else:
            raise ValueError("Formato de archivo no soportado. Debe ser csv, xls o xlsx.")

        # Convertir a lista de diccionarios
        return df.to_dict('records')

    def normalize_data(self, raw_data: List[Dict[str, Any]], field_mappings: Dict[str, str]) -> List[Dict[str, Any]]:
        """
        Aplica los mappings para estandarizar los nombres de las columnas.
        """
        normalized = []
        for row in raw_data:
            new_row = {}
            for src_col, master_col in field_mappings.items():
                new_row[master_col] = str(row.get(src_col, ""))
            normalized.append(new_row)
        return normalized

    def test_connection(self) -> Tuple[bool, str]:
        if self.file_content:
            return True, "Archivo disponible (guardado en la base)."
        if self.file_path and os.path.exists(self.file_path):
            return True, f"Archivo encontrado: {self.file_path}"
        return False, "El archivo subido ya no está disponible: volvé a subirlo."
