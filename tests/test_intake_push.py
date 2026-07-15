"""Pruebas de la entrada por API EMPUJADA (intake → túnel real).

Fijan la regla nueva: cuando una app conectada está vinculada a una Fuente
(target_process_id), los datos empujados entran por el MISMO túnel del sync
manual — Lavadero → Guardián → escritura quirúrgica — y el Guardián en modo
automático salta el lote si cruza <10% con filas nuevas (no contamina la
Maestra sin un humano que confirme).

Sin red: la Maestra es un CSV local y la escritura quirúrgica se captura
con monkeypatch (fijándose QUÉ se habría escrito).
"""
import pytest


@pytest.fixture
def client():
    import backend.main
    from fastapi.testclient import TestClient
    return TestClient(backend.main.app)


def _upload_csv(client, name, content):
    return client.post("/api/connections/upload", data={"name": name},
                       files={"file": (f"{name}.csv", content, "text/csv")}).json()["id"]


def _make_app_linked_to_process(client, master_content, app_name="AppExterna"):
    """Crea Maestra CSV + Fuente + app conectada vinculada. Devuelve (api_key, process_id, cleanup)."""
    master = _upload_csv(client, f"master_{app_name}", master_content)
    proc = client.post("/api/processes/", json={
        "name": f"Fuente-{app_name}", "source_connection_id": master, "source_sheet_name": "CSV Data",
        "target_connection_id": master, "target_sheet_name": "CSV Data",
        "sku_column_source": "Codigo", "sku_column_master": "sku",
        "field_mappings": {"PRECIO": "price"}, "add_new_rows": True, "is_active": True,
    }).json()
    app = client.post("/api/intake/apps", json={"name": app_name}).json()
    client.put(f"/api/intake/apps/{app['id']}", json={
        "name": app_name, "target_process_id": proc["id"], "is_active": True,
    })

    def cleanup():
        client.delete(f"/api/intake/apps/{app['id']}")
        client.delete(f"/api/processes/{proc['id']}")

    return app["api_key"], proc["id"], cleanup


def test_push_sin_api_key_rechazado(client):
    resp = client.post("/api/intake/push", json=[{"Codigo": "1", "PRECIO": "2"}])
    assert resp.status_code == 401


def test_push_sin_fuente_vinculada_va_a_staging(client):
    app = client.post("/api/intake/apps", json={"name": "AppSinFuente"}).json()
    try:
        resp = client.post("/api/intake/push", json=[{"Codigo": "1", "PRECIO": "2"}],
                           headers={"api-key": app["api_key"]}).json()
        assert "batch_id" in resp  # comportamiento anterior conservado
        assert resp["rows_received"] == 1
    finally:
        client.delete(f"/api/intake/apps/{app['id']}")


def test_push_vinculado_escribe_por_el_tunel(client, monkeypatch):
    # Maestra: AAA a precio 100. El push manda AAA a 45000 → 1 cambio.
    api_key, _, cleanup = _make_app_linked_to_process(
        client, "sku,name,price\nAAA,Producto,100\n", app_name="Tunel")

    written = {}

    def fake_write(**kw):
        written.update(kw)
        return {"total_updates": len(kw.get("changes", []))}

    import backend.services as services
    monkeypatch.setattr(services, "write_sheet_data_surgical",
                        lambda **kw: fake_write(**kw))
    try:
        resp = client.post("/api/intake/push",
                           json=[{"Codigo": "AAA", "PRECIO": "45000"}],
                           headers={"api-key": api_key}).json()
        assert resp["written"] is True
        assert resp["rows_updated"] == 1
        assert resp["rows_added"] == 0
        assert resp["lavadero"] is not None
        # Se escribió exactamente el cambio de precio de AAA.
        assert len(written["changes"]) == 1
        assert written["changes"][0]["sku"] == "AAA"
        assert written["changes"][0]["new"] == "45000"
    finally:
        cleanup()


def test_guardian_salta_push_con_baja_coincidencia(client, monkeypatch):
    # Maestra con AAA; el push trae DOS SKUs que no cruzan (0%) → NO escribir.
    api_key, _, cleanup = _make_app_linked_to_process(
        client, "sku,name,price\nAAA,Producto,100\n", app_name="Guardian")

    def no_debe_escribir(**kw):
        raise AssertionError("el Guardián debía saltar este push sin escribir")

    import backend.services as services
    monkeypatch.setattr(services, "write_sheet_data_surgical",
                        lambda **kw: no_debe_escribir(**kw))
    try:
        resp = client.post("/api/intake/push",
                           json=[{"Codigo": "ZZZ1", "PRECIO": "10"},
                                 {"Codigo": "ZZZ2", "PRECIO": "20"}],
                           headers={"api-key": api_key}).json()
        assert resp["written"] is False
        assert resp["coherence_index"] < 10
        assert resp["rows_would_add"] == 2
    finally:
        cleanup()


def test_push_sin_columna_llave_da_error_claro(client):
    api_key, _, cleanup = _make_app_linked_to_process(
        client, "sku,name,price\nAAA,Producto,100\n", app_name="SinLlave")
    try:
        resp = client.post("/api/intake/push",
                           json=[{"OtraCosa": "AAA"}],
                           headers={"api-key": api_key})
        assert resp.status_code == 400
        assert "Codigo" in resp.json()["detail"]  # dice qué columna espera
    finally:
        cleanup()


def test_lavadero_retiene_precio_sucio_en_push(client, monkeypatch):
    # 'gratis' no es un precio: se retiene (rejected) y NO se escribe.
    api_key, _, cleanup = _make_app_linked_to_process(
        client, "sku,name,price\nAAA,Producto,100\n", app_name="Lavadero")

    import backend.services as services
    monkeypatch.setattr(services, "write_sheet_data_surgical",
                        lambda **kw: (_ for _ in ()).throw(AssertionError("no había nada limpio que escribir")))
    try:
        resp = client.post("/api/intake/push",
                           json=[{"Codigo": "AAA", "PRECIO": "gratis"}],
                           headers={"api-key": api_key}).json()
        assert resp["written"] is False
        assert resp["lavadero"]["rejected"], "el rechazo del lavadero debe reportarse"
    finally:
        cleanup()
