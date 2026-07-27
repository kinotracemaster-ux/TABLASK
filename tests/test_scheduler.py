"""Pruebas del piloto automático (sync programada §5).

Lo crítico a fijar: en modo automático NO hay humano que confirme, así que el
Guardián inteligente debe SALTAR un proceso cuando las filas nuevas parecen un
FORMATO DE SKU ROTO (casi-idénticas a SKUs que ya están en la Maestra) — en vez
de contaminar la Maestra. Pero los productos GENUINAMENTE nuevos (que no se
parecen a nada existente) SÍ se crean, aunque la coherencia sea baja: BASE da de
alta productos nuevos. Se prueba con TestClient + archivos locales (sin red).
"""
import pytest


@pytest.fixture
def client():
    # conftest.py ya apuntó DATABASE_URL a una DB temporal antes de importar.
    import backend.main
    from fastapi.testclient import TestClient
    return TestClient(backend.main.app)


def _upload_csv(client, name, content):
    return client.post("/api/connections/upload", data={"name": name},
                       files={"file": (f"{name}.csv", content, "text/csv")}).json()["id"]


def _clear_processes(client):
    for p in client.get("/api/processes/").json():
        client.delete(f"/api/processes/{p['id']}")


def test_guardian_salta_formato_de_sku_roto(client):
    _clear_processes(client)  # aislar de otros tests
    # Maestra con 726B-4; BASE trae dos CASI-IDÉNTICOS (guion perdido / dígito de
    # más) que no cruzan exacto. El Guardián inteligente los detecta como formato
    # de SKU roto y SALTA, en vez de crear duplicados del mismo producto.
    master = _upload_csv(client, "master_g", "sku,name,price\n726B-4,Reloj,100\n")
    base = _upload_csv(client, "base_g", "Codigo,PRECIO\n726B4,45000\n726B-04,38000\n")

    client.post("/api/processes/", json={
        "name": "Guardian-Roto", "source_connection_id": base, "source_sheet_name": "CSV Data",
        "target_connection_id": master, "target_sheet_name": "CSV Data",
        "sku_column_source": "Codigo", "sku_column_master": "sku",
        "field_mappings": {"PRECIO": "price"}, "add_new_rows": True, "is_active": True,
    })

    summary = client.post("/api/schedule/run-now").json()
    assert summary["ran"] is True
    proc_result = next(r for r in summary["results"] if r["process"] == "Guardian-Roto")
    # Se saltó por el Guardián: NO intentó escribir (habría dado error de credenciales).
    assert proc_result.get("skipped") is True
    assert "error" not in proc_result


def test_guardian_deja_pasar_altas_legitimas(client, monkeypatch):
    _clear_processes(client)  # aislar de otros tests
    # Maestra con AAA; BASE trae dos productos GENUINAMENTE nuevos (no se parecen
    # a nada existente). Coherencia 0%, pero NO es formato roto → se CREAN.
    # (Antes el Guardián los bloqueaba por baja coherencia; ahora pasan.)
    master = _upload_csv(client, "master_ok", "sku,name,price\nAAA,Existente,100\n")
    base = _upload_csv(client, "base_ok", "Codigo,PRECIO\n1203,45000\n45,38000\n")

    written = {}
    import backend.services as services
    import backend.propagation as propagation
    monkeypatch.setattr(services, "write_sheet_data_surgical",
                        lambda **kw: written.update(kw) or {"total_updates": 0})
    monkeypatch.setattr(propagation, "propagate_changes", lambda *a, **k: None)

    client.post("/api/processes/", json={
        "name": "Guardian-Altas", "source_connection_id": base, "source_sheet_name": "CSV Data",
        "target_connection_id": master, "target_sheet_name": "CSV Data",
        "sku_column_source": "Codigo", "sku_column_master": "sku",
        "field_mappings": {"PRECIO": "price"}, "add_new_rows": True, "is_active": True,
    })

    summary = client.post("/api/schedule/run-now").json()
    assert summary["ran"] is True
    proc_result = next(r for r in summary["results"] if r["process"] == "Guardian-Altas")
    # NO se saltó: se crearon las dos filas nuevas legítimas.
    assert proc_result.get("skipped") is not True
    assert proc_result.get("rows_added") == 2
    assert len(written.get("new_rows", [])) == 2
    # Cada alta nueva queda MARCADA con estado=NUEVO (para enriquecer/revisar).
    assert all(nr["fields"].get("estado") == "NUEVO" for nr in written["new_rows"])


def test_config_por_defecto_y_activacion(client):
    cfg = client.get("/api/schedule").json()
    assert cfg["enabled"] is False and cfg["next_run_at"] is None

    updated = client.put("/api/schedule", json={"enabled": True, "interval_hours": 3}).json()
    assert updated["enabled"] is True
    assert updated["interval_hours"] == 3
    assert updated["next_run_at"] is not None  # se programó el próximo corrido

    off = client.put("/api/schedule", json={"enabled": False, "interval_hours": 3}).json()
    assert off["next_run_at"] is None  # al apagar se limpia


def test_interval_minimo_una_hora(client):
    updated = client.put("/api/schedule", json={"enabled": True, "interval_hours": 0}).json()
    assert updated["interval_hours"] == 1  # se fuerza mínimo de 1h
