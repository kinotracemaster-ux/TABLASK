"""Config compartida de pytest: apunta la DB a un archivo temporal ANTES de
importar el backend, para que los tests no toquen la base real y arranquen
siempre limpios. Se ejecuta antes de recolectar los tests."""
import os
import pathlib
import tempfile

_TEST_DB = pathlib.Path(tempfile.gettempdir()) / "tablask_pytest.db"
if _TEST_DB.exists():
    _TEST_DB.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB}"
