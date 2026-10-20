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

# La API pide clave (backend/auth.py). Se fija una de prueba y se hace que
# TODO TestClient la mande solo, para no tener que tocar los tests que ya
# existían. Los tests que prueban la clave en sí borran el header a mano.
CLAVE_DE_PRUEBA = "clave-de-prueba"
os.environ["TABLASK_PASSWORD"] = CLAVE_DE_PRUEBA

from starlette.testclient import TestClient as _TestClient  # noqa: E402

_orig_init = _TestClient.__init__


def _init_con_clave(self, *args, **kwargs):
    _orig_init(self, *args, **kwargs)
    self.headers.update({"X-TablasK-Key": CLAVE_DE_PRUEBA})


_TestClient.__init__ = _init_con_clave
