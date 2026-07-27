"""Pruebas de la plantilla de flujo preestablecido BASE-SYS → stock.

Fijan que un solo POST arma el flujo completo con las convenciones ya puestas:
- El Process BASE-SYS → Maestra sale con "agotar faltantes" (zero_missing_stock)
  ON, add_new_rows ON y el mapeo de stock (+ precio base opcional).
- Se crean las FieldSubscriptions de las hojas hijas y el canal Shopify (solo
  stock), como filas normales editables/borrables por sus CRUD.
- No se puede duplicar (409) ni armar sin Maestra enlazada (400).
- Una conexión que no es Shopify se omite con warning, no rompe la corrida.
Se prueba con TestClient (sin red).
"""
import json

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


def _reset(client):
    """Aísla de otros tests: borra procesos y canales, y desvincula la Maestra."""
    for p in client.get("/api/processes/").json():
        client.delete(f"/api/processes/{p['id']}")
    for s in client.get("/api/shopify-subscriptions/").json():
        client.delete(f"/api/shopify-subscriptions/{s['id']}")
    for s in client.get("/api/api-subscriptions/").json():
        client.delete(f"/api/api-subscriptions/{s['id']}")
    client.post("/api/master/unlink")


def _link_master(client, master_id):
    client.post("/api/master/link", json={
        "master_connection_id": master_id, "master_sheet_name": "CSV Data",
        "master_sku_column": "SKU",
    })


def _master_project_id():
    """Id del proyecto de la Maestra global (para inspeccionar sus suscripciones)."""
    from backend.database import SessionLocal
    from backend import models
    db = SessionLocal()
    try:
        proj = db.query(models.Project).filter(
            models.Project.master_connection_id.isnot(None)
        ).first()
        return proj.id if proj else None
    finally:
        db.close()


def test_arma_flujo_completo_con_convenciones(client):
    _reset(client)
    master = _upload_csv(client, "master_tpl", "SKU,Stock,Precio base\nA1,5,100\n")
    base = _upload_csv(client, "base_tpl", "SKU,Stock,Precio\nA1,7,120\n")
    hija = _upload_csv(client, "hija_tpl", "SKU,Stock\nA1,5\n")
    _link_master(client, master)

    r = client.post("/api/flow-templates/base-sys-stock", json={
        "source_connection_id": base,
        "source_sheet_name": "CSV Data",
        "sku_column_source": "SKU",
        "stock_column_source": "Stock",
        "price_column_source": "Precio",
        "master_sku_column": "SKU",
        "master_stock_column": "Stock",
        "master_price_column": "Precio base",
        "sheet_targets": [
            {"connection_id": hija, "sheets": ["CSV Data"], "sku_column": "SKU", "stock_column": "Stock"}
        ],
    })
    assert r.status_code == 200, r.text
    out = r.json()
    assert not out["warnings"]
    assert len(out["field_subscription_ids"]) == 1

    # El Process salió con las convenciones de la fuente de verdad.
    proc = next(p for p in client.get("/api/processes/").json() if p["id"] == out["process_id"])
    assert proc["zero_missing_stock"] is True
    assert proc["add_new_rows"] is True
    assert proc["target_connection_id"] is None  # Maestra global
    assert proc["field_mappings"] == {"Stock": "Stock", "Precio": "Precio base"}

    # La hoja hija recibe SOLO el stock, por SKU.
    subs = client.get(f"/api/subscriptions/?project_id={_master_project_id()}").json()
    hija_sub = next(s for s in subs if s["id"] in out["field_subscription_ids"])
    assert hija_sub["target_sheet_name"] == "CSV Data"
    assert hija_sub["sku_column_target"] == "SKU"
    assert hija_sub["field_mappings"] == {"Stock": "Stock"}


def test_sin_precio_solo_mapea_stock(client):
    _reset(client)
    master = _upload_csv(client, "master_np", "SKU,Stock\nA1,5\n")
    base = _upload_csv(client, "base_np", "SKU,Stock\nA1,7\n")
    _link_master(client, master)

    r = client.post("/api/flow-templates/base-sys-stock", json={
        "source_connection_id": base, "source_sheet_name": "CSV Data",
    })
    assert r.status_code == 200, r.text
    proc = next(p for p in client.get("/api/processes/").json() if p["id"] == r.json()["process_id"])
    assert proc["field_mappings"] == {"Stock": "Stock"}  # sin precio


def test_no_se_puede_duplicar(client):
    _reset(client)
    master = _upload_csv(client, "master_dup", "SKU,Stock\nA1,5\n")
    base = _upload_csv(client, "base_dup", "SKU,Stock\nA1,7\n")
    _link_master(client, master)

    body = {"source_connection_id": base, "source_sheet_name": "CSV Data"}
    assert client.post("/api/flow-templates/base-sys-stock", json=body).status_code == 200
    # Segundo intento: ya existe → 409.
    r2 = client.post("/api/flow-templates/base-sys-stock", json=body)
    assert r2.status_code == 409

    # El status lo refleja.
    st = client.get("/api/flow-templates/base-sys-stock").json()
    assert st["exists"] is True and st["process_id"] is not None


def test_sin_maestra_enlazada_falla(client):
    _reset(client)
    base = _upload_csv(client, "base_nomaster", "SKU,Stock\nA1,7\n")
    r = client.post("/api/flow-templates/base-sys-stock", json={
        "source_connection_id": base, "source_sheet_name": "CSV Data",
    })
    assert r.status_code == 400


def test_canal_shopify_ok_y_no_shopify_se_omite(client):
    _reset(client)
    master = _upload_csv(client, "master_sh", "SKU,Stock\nA1,5\n")
    base = _upload_csv(client, "base_sh", "SKU,Stock\nA1,7\n")
    _link_master(client, master)
    # Conexión Shopify real (tipo shopify) y una que NO lo es (el propio base).
    shop = client.post("/api/connections/", json={
        "name": "Tienda X", "connection_type": "shopify",
        "shopify_domain": "x.myshopify.com", "shopify_access_token": "shpat_x",
    }).json()["id"]

    r = client.post("/api/flow-templates/base-sys-stock", json={
        "source_connection_id": base, "source_sheet_name": "CSV Data",
        "shopify_targets": [
            {"connection_id": shop},          # válido
            {"connection_id": base},          # no es shopify → warning
        ],
    })
    assert r.status_code == 200, r.text
    out = r.json()
    assert len(out["shopify_subscription_ids"]) == 1
    assert any("no es una tienda Shopify" in w for w in out["warnings"])

    # El destino Shopify quedó con solo stock mapeado.
    sub = next(s for s in client.get("/api/shopify-subscriptions/").json()
               if s["id"] in out["shopify_subscription_ids"])
    assert sub["stock_column_master"] == "Stock"
    assert sub["price_column_master"] is None
