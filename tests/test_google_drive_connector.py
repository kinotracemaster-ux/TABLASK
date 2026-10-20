"""Pruebas del conector de carpeta de Drive (backend/connectors/google_drive.py).

Lo crítico a fijar:
- Se toma el archivo MÁS RECIENTE de la carpeta (Kino sube uno nuevo cada vez,
  con otro nombre; no hay que reconfigurar nada).
- Los `.md` del proyecto y los temporales de Excel abierto (`~$...`) NO cuentan
  como fuente: son más nuevos que el archivo de verdad y se llevarían el puesto.
- El parseo es el MISMO que el de un archivo subido a mano, incluido el arreglo
  de los SKU que Excel guarda como fecha.
- El link de la carpeta se acepta tal cual se copia del navegador.

No tocan la red: se reemplazan `listar_archivos` y `descargar`.
"""
import io

import openpyxl
import pytest

from backend.connectors.google_drive import GoogleDriveConnector, elegir_archivo, es_archivo_fuente
from backend.routers.connections import _solo_id_de_carpeta


def archivo(nombre, cuando, fid="x"):
    return {"id": fid, "name": nombre, "modifiedTime": cuando}


# ─────────────────────────────────────────── qué archivo se elige
def test_se_toma_el_mas_reciente():
    elegido = elegir_archivo([
        archivo("BASE-SYS 19-oct.xlsx", "2026-10-19T10:00:00Z", "viejo"),
        archivo("BASE-SYS 20-oct.xlsx", "2026-10-20T10:00:00Z", "nuevo"),
        archivo("BASE-SYS 18-oct.csv", "2026-10-18T10:00:00Z", "masviejo"),
    ])
    assert elegido["id"] == "nuevo"


def test_los_md_del_proyecto_no_cuentan():
    # Los tres .md viven en la misma carpeta y son más nuevos.
    elegido = elegir_archivo([
        archivo("BASE-SYS.xlsx", "2026-10-20T08:00:00Z", "datos"),
        archivo("AVANCES_PROYECTO.md", "2026-10-20T23:00:00Z"),
        archivo("INFORME_POEDAGAR_cambios_e_inconsistencias.md", "2026-10-20T23:30:00Z"),
    ])
    assert elegido["id"] == "datos"


def test_el_temporal_de_excel_abierto_no_cuenta():
    # Si Kino deja el archivo abierto, Excel crea "~$BASE-SYS.xlsx" más nuevo.
    elegido = elegir_archivo([
        archivo("BASE-SYS.xlsx", "2026-10-20T08:00:00Z", "datos"),
        archivo("~$BASE-SYS.xlsx", "2026-10-20T09:00:00Z", "temporal"),
    ])
    assert elegido["id"] == "datos"


def test_carpeta_sin_archivos_utiles_devuelve_nada():
    assert elegir_archivo([]) is None
    assert elegir_archivo([archivo("notas.md", "2026-10-20T10:00:00Z")]) is None
    assert elegir_archivo([archivo("foto.png", "2026-10-20T10:00:00Z")]) is None


@pytest.mark.parametrize("nombre,sirve", [
    ("BASE-SYS.xlsx", True), ("base.XLSX", True), ("viejo.xls", True), ("datos.csv", True),
    ("~$BASE-SYS.xlsx", False), ("AVANCES.md", False), ("foto.png", False), ("", False),
])
def test_que_cuenta_como_fuente(nombre, sirve):
    assert es_archivo_fuente(nombre) is sirve


# ─────────────────────────────────────────── el link de la carpeta
def test_se_acepta_el_link_tal_cual_se_copia():
    esperado = "1VnglATl0m0-Bv0UlXMlJf3bSWLAqFVNj"
    assert _solo_id_de_carpeta(f"https://drive.google.com/drive/folders/{esperado}?usp=sharing") == esperado
    assert _solo_id_de_carpeta(f"https://drive.google.com/drive/folders/{esperado}") == esperado
    assert _solo_id_de_carpeta(f"  {esperado}  ") == esperado
    assert _solo_id_de_carpeta("") is None
    assert _solo_id_de_carpeta(None) is None


# ─────────────────────────────────────────── leer de verdad el archivo
def _excel(filas, nombre_hoja="Hoja1"):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = nombre_hoja
    for f in filas:
        ws.append(f)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@pytest.fixture
def carpeta(monkeypatch):
    """Conector apuntando a una carpeta simulada, sin red."""
    contenido = _excel([
        ["Artículo", "Exist. unidades", "Precio"],
        ["685B-1", 67, 65000],
        ["3076-1", 8, 45000],
    ], "SYS INV")
    c = GoogleDriveConnector({"drive_folder_id": "carpeta-x"})
    monkeypatch.setattr(c, "listar_archivos", lambda: [
        archivo("BASE-SYS 20-oct.xlsx", "2026-10-20T10:00:00Z", "nuevo"),
        archivo("AVANCES_PROYECTO.md", "2026-10-20T23:00:00Z", "doc"),
    ])
    bajadas = []
    monkeypatch.setattr(c, "descargar", lambda fid: bajadas.append(fid) or contenido)
    c._bajadas = bajadas
    return c


def test_lee_las_filas_del_archivo_mas_reciente(carpeta):
    filas = carpeta.fetch_data("SYS INV")
    assert [f["Artículo"] for f in filas] == ["685B-1", "3076-1"]
    assert filas[0]["Exist. unidades"] == "67"      # sin el ".0" de Excel
    assert filas[0]["Precio"] == "65000"


def test_devuelve_hojas_y_columnas_para_el_mapeo(carpeta):
    assert carpeta.metadata() == {"SYS INV": ["Artículo", "Exist. unidades", "Precio"]}


def test_no_baja_el_archivo_dos_veces(carpeta):
    carpeta.metadata()
    carpeta.fetch_data("SYS INV")
    assert carpeta._bajadas == ["nuevo"]           # una sola bajada, cacheada


def test_un_sku_que_excel_guardo_como_fecha_se_lee_bien(monkeypatch):
    # Mismo arreglo que el lector de archivos subidos a mano: "9051-3" lo
    # autodetecta Excel como fecha y sin esto llegaría "9051-03-01 00:00:00".
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Artículo", "Exist. unidades"])
    ws.append(["9051-3", 16])
    ws.cell(row=2, column=1).value = __import__("datetime").datetime(9051, 3, 1)
    ws.cell(row=2, column=1).number_format = "yyyy-m"
    buf = io.BytesIO(); wb.save(buf)

    c = GoogleDriveConnector({"drive_folder_id": "f"})
    monkeypatch.setattr(c, "listar_archivos", lambda: [archivo("b.xlsx", "2026-10-20T10:00:00Z", "a")])
    monkeypatch.setattr(c, "descargar", lambda fid: buf.getvalue())
    assert c.fetch_data("Sheet")[0]["Artículo"] == "9051-3"


def test_carpeta_vacia_avisa_claro(monkeypatch):
    c = GoogleDriveConnector({"drive_folder_id": "f"})
    monkeypatch.setattr(c, "listar_archivos", lambda: [archivo("solo-notas.md", "2026-10-20T10:00:00Z")])
    with pytest.raises(ValueError, match="no tiene ningún archivo"):
        c.fetch_data("Hoja1")
    ok, mensaje = c.test_connection()
    assert ok is False and "no hay" in mensaje


def test_sin_carpeta_configurada_avisa(monkeypatch):
    c = GoogleDriveConnector({})
    with pytest.raises(ValueError, match="carpeta de Drive"):
        c.listar_archivos()


def test_prueba_de_conexion_dice_cual_archivo_tomaria(carpeta):
    ok, mensaje = carpeta.test_connection()
    assert ok is True and "BASE-SYS 20-oct.xlsx" in mensaje


# ─────────────────────────────────────────── alta desde la API
@pytest.fixture
def client():
    import backend.main
    from fastapi.testclient import TestClient
    return TestClient(backend.main.app)


def test_se_puede_crear_una_conexion_de_carpeta(client):
    esperado = "1VnglATl0m0-Bv0UlXMlJf3bSWLAqFVNj"
    conn = client.post("/api/connections/", json={
        "name": "Carpeta Poedagar", "connection_type": "google_drive",
        "drive_folder_id": f"https://drive.google.com/drive/folders/{esperado}?usp=sharing",
    }).json()
    assert conn["drive_folder_id"] == esperado      # guardó el id, no el link
    assert conn["connection_type"] == "google_drive"
    client.delete(f"/api/connections/{conn['id']}")
