"""Pruebas de la Bandeja de Nuevos (cuarentena de altas).

Fijan la regla nueva: con add_new_rows=False, un SKU que NO cruza con la Maestra
no se escribe — se retiene en PendingNewRecord. Desde la bandeja se aprueba (se
crea por escritura quirúrgica) o se rechaza. Sin red: la Maestra es un CSV local
y la escritura quirúrgica se captura con monkeypatch.
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


def _make_app_no_new(client, master_content, app_name="AppTray"):
    """Fuente con add_new_rows=False + app vinculada. Devuelve (api_key, process_id, master_id, cleanup)."""
    master = _upload_csv(client, f"master_{app_name}", master_content)
    proc = client.post("/api/processes/", json={
        "name": f"Fuente-{app_name}", "source_connection_id": master, "source_sheet_name": "CSV Data",
        "target_connection_id": master, "target_sheet_name": "CSV Data",
        "sku_column_source": "Codigo", "sku_column_master": "sku",
        "field_mappings": {"PRECIO": "price"}, "add_new_rows": False, "is_active": True,
    }).json()
    app = client.post("/api/intake/apps", json={"name": app_name}).json()
    client.put(f"/api/intake/apps/{app['id']}", json={
        "name": app_name, "target_process_id": proc["id"], "is_active": True,
    })

    def cleanup():
        client.delete(f"/api/intake/apps/{app['id']}")
        client.delete(f"/api/processes/{proc['id']}")

    return app["api_key"], proc["id"], master, cleanup


def test_nuevo_no_se_escribe_va_a_la_bandeja(client, monkeypatch):
    # Maestra con AAA. El push trae un SKU nuevo (NUEVO1) que no cruza. Con
    # add_new_rows=False no debe escribirse: queda retenido en la Bandeja.
    api_key, _, _, cleanup = _make_app_no_new(
        client, "sku,name,price\nAAA,Producto,100\nBBB,Otro,200\n", app_name="Park")

    import backend.services as services
    monkeypatch.setattr(services, "write_sheet_data_surgical",
                        lambda **kw: (_ for _ in ()).throw(AssertionError("no debía escribir un nuevo")))
    try:
        resp = client.post("/api/intake/push",
                           json=[{"Codigo": "NUEVO1", "PRECIO": "500"}],
                           headers={"api-key": api_key}).json()
        assert resp["written"] is False or resp.get("rows_added", 0) == 0
        assert resp["rows_held"] == 1

        tray = client.get("/api/tray").json()
        skus = [r["sku"] for r in tray["records"]]
        assert "NUEVO1" in skus
        assert tray["pending_count"] >= 1
    finally:
        cleanup()


def test_aprobar_crea_en_la_maestra(client, monkeypatch):
    api_key, _, _, cleanup = _make_app_no_new(
        client, "sku,name,price\nAAA,Producto,100\n", app_name="Approve")

    import backend.services as services
    monkeypatch.setattr(services, "write_sheet_data_surgical", lambda **kw: {"ok": True})

    written = {}
    import backend.routers.tray as tray_mod
    monkeypatch.setattr(tray_mod, "write_sheet_data_surgical",
                        lambda **kw: written.update(kw) or {"ok": True})
    try:
        client.post("/api/intake/push",
                    json=[{"Codigo": "NUEVO2", "PRECIO": "999"}],
                    headers={"api-key": api_key})

        tray = client.get("/api/tray").json()
        rec = next(r for r in tray["records"] if r["sku"] == "NUEVO2")

        resp = client.post("/api/tray/approve", json={"ids": [rec["id"]]}).json()
        assert resp["rows_added"] == 1
        # Se escribió exactamente el nuevo, con su SKU en los fields.
        assert len(written["new_rows"]) == 1
        assert written["new_rows"][0]["fields"]["sku"] == "NUEVO2"

        # Ya no está pendiente.
        after = client.get("/api/tray").json()
        assert all(r["sku"] != "NUEVO2" for r in after["records"])
    finally:
        cleanup()


def test_rechazar_no_crea_nada(client, monkeypatch):
    api_key, _, _, cleanup = _make_app_no_new(
        client, "sku,name,price\nAAA,Producto,100\n", app_name="Reject")

    import backend.services as services
    monkeypatch.setattr(services, "write_sheet_data_surgical", lambda **kw: {"ok": True})
    import backend.routers.tray as tray_mod
    monkeypatch.setattr(tray_mod, "write_sheet_data_surgical",
                        lambda **kw: (_ for _ in ()).throw(AssertionError("rechazar no debe escribir")))
    try:
        client.post("/api/intake/push",
                    json=[{"Codigo": "NUEVO3", "PRECIO": "10"}],
                    headers={"api-key": api_key})
        tray = client.get("/api/tray").json()
        rec = next(r for r in tray["records"] if r["sku"] == "NUEVO3")

        resp = client.post("/api/tray/reject", json={"ids": [rec["id"]]}).json()
        assert resp["rejected"] == 1

        pend = client.get("/api/tray").json()
        assert all(r["sku"] != "NUEVO3" for r in pend["records"])
    finally:
        cleanup()


def test_dedup_no_inunda_la_bandeja(client, monkeypatch):
    # Empujar dos veces el mismo SKU nuevo → un solo registro pendiente.
    api_key, _, _, cleanup = _make_app_no_new(
        client, "sku,name,price\nAAA,Producto,100\n", app_name="Dedup")

    import backend.services as services
    monkeypatch.setattr(services, "write_sheet_data_surgical", lambda **kw: {"ok": True})
    try:
        for _ in range(2):
            client.post("/api/intake/push",
                        json=[{"Codigo": "DUP1", "PRECIO": "77"}],
                        headers={"api-key": api_key})
        tray = client.get("/api/tray").json()
        dup = [r for r in tray["records"] if r["sku"] == "DUP1"]
        assert len(dup) == 1
    finally:
        cleanup()
