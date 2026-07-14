"""Pruebas del piloto automático (sync programada §5).

Lo crítico a fijar: en modo automático NO hay humano que confirme, así que el
Guardián debe SALTAR un proceso cuando cruza muy pocos SKUs y quiere crear
muchas filas nuevas (probable formato de SKU roto) — en vez de contaminar la
Maestra. Se prueba con TestClient + archivos locales (sin red).
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


def test_guardian_salta_proceso_con_baja_coincidencia(client):
    _clear_processes(client)  # aislar de otros tests
    # Maestra con un SKU; BASE trae OTROS dos que no cruzan (coherencia 0%).
    master = _upload_csv(client, "master_g", "sku,name,price\nAAA,Existente,100\n")
    base = _upload_csv(client, "base_g", "Codigo,PRECIO\n1203,45000\n45,38000\n")

    client.post("/api/processes/", json={
        "name": "Guardian-BASE->Master", "source_connection_id": base, "source_sheet_name": "CSV Data",
        "target_connection_id": master, "target_sheet_name": "CSV Data",
        "sku_column_source": "Codigo", "sku_column_master": "sku",
        "field_mappings": {"PRECIO": "price"}, "add_new_rows": True, "is_active": True,
    })

    summary = client.post("/api/schedule/run-now").json()
    assert summary["ran"] is True
    proc_result = next(r for r in summary["results"] if r["process"] == "Guardian-BASE->Master")
    # Se saltó por el Guardián: NO intentó escribir (habría dado error de credenciales).
    assert proc_result.get("skipped") is True
    assert "error" not in proc_result


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
