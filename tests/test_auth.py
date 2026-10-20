"""Pruebas de la clave de acceso (backend/auth.py).

Lo crítico a fijar:
- Sin clave correcta, la API no contesta nada (antes estaba abierta en internet).
- Si la clave NO está configurada en el servidor, falla cerrada (503), no abierta.
- Los links que traen su propio candado siguen funcionando sin la clave, porque
  los usa un sistema externo: la descarga del CSV por canal (?token=) y el
  intake empujado por una app conectada (header api-key).
- El frontend se sigue sirviendo sin clave (si no, no habría dónde escribirla).
"""
import pytest

from backend import auth


@pytest.fixture
def client():
    import backend.main
    from fastapi.testclient import TestClient
    return TestClient(backend.main.app)


@pytest.fixture
def sin_clave(client):
    """El mismo cliente, pero sin el header que pone conftest."""
    client.headers.pop("X-TablasK-Key", None)
    return client


def test_sin_clave_la_api_no_contesta(sin_clave):
    for ruta in ("/api/connections/", "/api/master", "/api/shopify-subscriptions/", "/api/logs/"):
        r = sin_clave.get(ruta)
        assert r.status_code == 401, ruta
        assert r.json()["detail"] == auth.CLAVE_MALA


def test_clave_equivocada_tampoco(sin_clave):
    r = sin_clave.get("/api/connections/", headers={"X-TablasK-Key": "otra"})
    assert r.status_code == 401


def test_con_la_clave_correcta_pasa(client):
    assert client.get("/api/auth/check").json() == {"ok": True}
    assert client.get("/api/connections/").status_code == 200


def test_escrituras_peligrosas_tambien_piden_clave(sin_clave):
    # Lo que de verdad importaba: disparar envíos a una tienda real.
    assert sin_clave.post("/api/shopify/push", json={
        "shopify_connection_id": 1, "source_sheet_name": "x", "sku_column": "sku"}).status_code == 401
    assert sin_clave.post("/api/debug/reset-db").status_code == 401
    assert sin_clave.put("/api/schedule", json={"enabled": True, "interval_hours": 6}).status_code == 401


def test_si_falta_configurar_la_clave_falla_cerrada(sin_clave, monkeypatch):
    monkeypatch.delenv(auth.ENV_VAR, raising=False)
    r = sin_clave.get("/api/connections/")
    assert r.status_code == 503
    assert "TABLASK_PASSWORD" in r.json()["detail"]
    # Y tampoco se abre si alguien manda cualquier cosa como clave.
    assert sin_clave.get("/api/connections/", headers={"X-TablasK-Key": "lo-que-sea"}).status_code == 503


def test_una_clave_vacia_no_abre_la_app(sin_clave, monkeypatch):
    monkeypatch.setenv(auth.ENV_VAR, "   ")
    assert sin_clave.get("/api/connections/").status_code == 503


def test_los_links_con_candado_propio_siguen_abiertos():
    # Tienen su propio token/api-key; un sistema externo los usa sin la clave.
    assert auth.esta_abierta("GET", "/api/exports/12/download")
    assert auth.esta_abierta("POST", "/api/intake/push")


def test_pero_no_se_abre_de_rebote_el_resto_de_exports():
    # El riesgo de abrir por prefijo: rotar el token de un canal sin la clave.
    assert not auth.esta_abierta("POST", "/api/exports/12/regenerate-token")
    assert not auth.esta_abierta("GET", "/api/exports/")
    assert not auth.esta_abierta("GET", "/api/exports/12")
    assert not auth.esta_abierta("POST", "/api/exports/12/download")
    assert not auth.esta_abierta("GET", "/api/intake/push")


def test_el_frontend_se_sirve_sin_clave(sin_clave):
    # Si el middleware tapara esto, no habría pantalla donde escribir la clave.
    assert sin_clave.get("/").status_code != 401
