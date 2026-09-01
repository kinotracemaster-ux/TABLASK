"""Sugerencia de enriquecimiento (categoría/marca...) para altas nuevas.

Pedido del usuario: SKUs con el mismo código de referencia y distinto sufijo
de variante (968B-1, 968B-2, 968B-3) son "la misma referencia" — si dos ya
existen en la Maestra con la MISMA categoría, un 968B-3 recién creado debería
poder copiarla en vez de quedar vacía. Regla dura pedida explícitamente:
NUNCA se aplica sola, siempre hay que confirmar (apply_suggestions=True en
/api/staging/execute-bulk); por default queda como sugerencia sin escribir.
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


def _make_process(client, master_content, base_content, name="Proc-Enrich"):
    master = _upload_csv(client, f"master_{name}", master_content)
    base = _upload_csv(client, f"base_{name}", base_content)
    proc = client.post("/api/processes/", json={
        "name": name, "source_connection_id": base, "source_sheet_name": "CSV Data",
        "target_connection_id": master, "target_sheet_name": "CSV Data",
        "sku_column_source": "Codigo", "sku_column_master": "sku",
        "field_mappings": {"PRECIO": "price"}, "add_new_rows": True, "is_active": True,
    }).json()
    return proc["id"]


def test_sugiere_categoria_cuando_los_hermanos_coinciden(client):
    # 968B-1 y 968B-2 ya existen con la MISMA categoría; 968B-3 es nuevo.
    master = "sku,name,price,category\n968B-1,Reloj Negro,100,RELOJES 3D\n968B-2,Reloj Plata,100,RELOJES 3D\n"
    base = "Codigo,PRECIO\n968B-3,45000\n"
    proc_id = _make_process(client, master, base)

    diff = client.post(f"/api/processes/{proc_id}/stage").json()["diff"]
    assert diff["rows_to_add"] == 1
    new_row = diff["new_rows"][0]
    assert new_row["sku"] == "968B-3"
    # El núcleo (price) se escribe normal; la categoría queda como SUGERENCIA,
    # no en "fields" (que es lo que se escribe si no se confirma).
    assert "category" not in new_row["fields"]
    assert new_row["suggested_fields"] == {"category": "RELOJES 3D"}


def test_no_sugiere_si_los_hermanos_no_coinciden(client):
    # 968B-1 y 968B-2 tienen categorías DISTINTAS -> nada inequívoco que sugerir.
    master = "sku,name,price,category\n968B-1,Reloj Negro,100,RELOJES 3D\n968B-2,Reloj Plata,100,OTRA\n"
    base = "Codigo,PRECIO\n968B-3,45000\n"
    proc_id = _make_process(client, master, base, name="Proc-Conflicto")

    diff = client.post(f"/api/processes/{proc_id}/stage").json()["diff"]
    assert diff["new_rows"][0]["suggested_fields"] == {}


def test_no_sugiere_sin_referencia_previa(client):
    # Ningún SKU existente comparte la referencia base "AAA" -> sin hermanos.
    master = "sku,name,price,category\nBBB-1,Otro,100,X\n"
    base = "Codigo,PRECIO\nAAA-1,45000\n"
    proc_id = _make_process(client, master, base, name="Proc-SinHermanos")

    diff = client.post(f"/api/processes/{proc_id}/stage").json()["diff"]
    assert diff["new_rows"][0]["suggested_fields"] == {}


def test_execute_bulk_no_aplica_sugerencia_por_defecto(client, monkeypatch):
    master = "sku,name,price,category\n968B-1,Reloj Negro,100,RELOJES 3D\n968B-2,Reloj Plata,100,RELOJES 3D\n"
    base = "Codigo,PRECIO\n968B-3,45000\n"
    proc_id = _make_process(client, master, base, name="Proc-Default")

    batch_id = client.post(f"/api/processes/{proc_id}/stage").json()["batch_id"]

    written = {}
    import backend.routers.staging as staging
    monkeypatch.setattr(staging, "write_sheet_data_surgical",
                        lambda **kw: written.update(kw) or {"total_updates": 0})

    resp = client.post("/api/staging/execute-bulk", json={"batch_ids": [batch_id]})
    assert resp.status_code == 200
    new_row = written["new_rows"][0]
    assert "category" not in new_row["fields"]


def test_execute_bulk_aplica_sugerencia_si_se_confirma(client, monkeypatch):
    master = "sku,name,price,category\n968B-1,Reloj Negro,100,RELOJES 3D\n968B-2,Reloj Plata,100,RELOJES 3D\n"
    base = "Codigo,PRECIO\n968B-3,45000\n"
    proc_id = _make_process(client, master, base, name="Proc-Aplicar")

    batch_id = client.post(f"/api/processes/{proc_id}/stage").json()["batch_id"]

    written = {}
    import backend.routers.staging as staging
    monkeypatch.setattr(staging, "write_sheet_data_surgical",
                        lambda **kw: written.update(kw) or {"total_updates": 0})

    resp = client.post("/api/staging/execute-bulk",
                       json={"batch_ids": [batch_id], "apply_suggestions": True})
    assert resp.status_code == 200
    new_row = written["new_rows"][0]
    assert new_row["fields"]["category"] == "RELOJES 3D"
    # El núcleo lavado sigue intacto.
    assert new_row["fields"]["price"] == "45000"
