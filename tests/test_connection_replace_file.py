"""Pruebas de POST /api/connections/{id}/replace-file.

Antes, cada archivo nuevo creaba una Conexión (Fuente) separada porque no
había forma de actualizar el contenido de una ya subida — eso llevaba a
Fuentes duplicadas en "Mis Flujos" cada vez que llegaba una versión más
nueva del mismo archivo. Este endpoint reemplaza el contenido SIN cambiar
el id de la conexión, así el Proceso que la usa como origen sigue intacto
y pasa a leer los datos nuevos.
"""
import pytest


@pytest.fixture
def client():
    import backend.main
    from fastapi.testclient import TestClient
    return TestClient(backend.main.app)


def _upload_csv(client, name, content):
    res = client.post("/api/connections/upload", data={"name": name},
                       files={"file": (f"{name}.csv", content, "text/csv")})
    assert res.status_code == 200, res.text
    return res.json()


def test_replace_file_manda_el_id_de_conexion(client):
    conn = _upload_csv(client, "precios_v1", "sku,price\n1,100\n")
    res = client.post(f"/api/connections/{conn['id']}/replace-file",
                       files={"file": ("precios_v2.csv", "sku,price\n1,200\n", "text/csv")})
    assert res.status_code == 200, res.text
    assert res.json()["id"] == conn["id"]


def test_replace_file_actualiza_los_datos_leidos(client):
    conn = _upload_csv(client, "precios_v1", "sku,price\n1,100\n")
    client.post(f"/api/connections/{conn['id']}/replace-file",
                files={"file": ("precios_v2.csv", "sku,price\n1,200\n", "text/csv")})
    meta = client.get(f"/api/connections/{conn['id']}/metadata")
    assert meta.status_code == 200, meta.text
    assert "price" in meta.json()["sheets"]["CSV Data"]


def test_replace_file_actualiza_file_updated_at(client):
    conn = _upload_csv(client, "precios_v1", "sku,price\n1,100\n")
    assert conn["file_updated_at"] is not None
    res = client.post(f"/api/connections/{conn['id']}/replace-file",
                       files={"file": ("precios_v2.csv", "sku,price\n1,200\n", "text/csv")})
    assert res.json()["file_updated_at"] is not None


def test_replace_file_rechaza_conexion_no_local(client):
    res = client.post("/api/connections/", json={
        "name": "Google Sheet Test", "connection_type": "google_sheets",
        "google_sheet_url": "https://docs.google.com/spreadsheets/d/abc123/edit",
    })
    conn_id = res.json()["id"]
    res = client.post(f"/api/connections/{conn_id}/replace-file",
                       files={"file": ("nuevo.csv", "sku,price\n1,100\n", "text/csv")})
    assert res.status_code == 400


def test_replace_file_conexion_inexistente(client):
    res = client.post("/api/connections/999999/replace-file",
                       files={"file": ("nuevo.csv", "sku,price\n1,100\n", "text/csv")})
    assert res.status_code == 404
