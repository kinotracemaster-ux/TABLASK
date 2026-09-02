"""Pruebas del guardián de configuración de un destino Shopify (`/api/shopify-subscriptions/`).

Bug real: un usuario mapeó la misma columna de la Maestra (PRICE) tanto a
"Precio" como a "Stock" del destino Shopify. El push escribió el precio como
cantidad de inventario, dejando el catálogo con "480.000 en existencias" (el
precio en pesos, no un stock real). Esta validación bloquea guardar una
configuración así — la misma columna no puede alimentar dos campos distintos.
"""
import pytest


@pytest.fixture
def client():
    import backend.main
    from fastapi.testclient import TestClient
    return TestClient(backend.main.app)


def _shopify_conn(client):
    res = client.post("/api/connections/", json={
        "name": "Tienda Test", "connection_type": "shopify",
        "shopify_domain": "test.myshopify.com",
        "shopify_access_token": "shpat_x",
    })
    assert res.status_code == 200, res.text
    return res.json()["id"]


def test_rechaza_misma_columna_para_precio_y_stock(client):
    conn_id = _shopify_conn(client)
    res = client.post("/api/shopify-subscriptions/", json={
        "name": "Destino test", "connection_id": conn_id,
        "price_column_master": "PRICE", "stock_column_master": "PRICE",
    })
    assert res.status_code == 400
    assert "PRICE" in res.json()["detail"]


def test_rechaza_misma_columna_para_stock_y_comparativo(client):
    conn_id = _shopify_conn(client)
    res = client.post("/api/shopify-subscriptions/", json={
        "name": "Destino test", "connection_id": conn_id,
        "stock_column_master": "PRICE", "compare_price_column_master": "PRICE",
    })
    assert res.status_code == 400


def test_acepta_columnas_distintas_por_campo(client):
    conn_id = _shopify_conn(client)
    res = client.post("/api/shopify-subscriptions/", json={
        "name": "Destino test", "connection_id": conn_id,
        "price_column_master": "PRICE", "stock_column_master": "STOCK",
    })
    assert res.status_code == 200, res.text


def test_rechaza_misma_columna_para_precio_y_nombre(client):
    conn_id = _shopify_conn(client)
    res = client.post("/api/shopify-subscriptions/", json={
        "name": "Destino test", "connection_id": conn_id,
        "price_column_master": "COL", "title_column_master": "COL",
    })
    assert res.status_code == 400
    assert "COL" in res.json()["detail"]


def test_acepta_solo_nombre_y_categoria(client):
    conn_id = _shopify_conn(client)
    res = client.post("/api/shopify-subscriptions/", json={
        "name": "Destino test", "connection_id": conn_id,
        "title_column_master": "NOMBRE", "product_type_column_master": "CATEGORIA",
    })
    assert res.status_code == 200, res.text


def test_update_tambien_valida(client):
    conn_id = _shopify_conn(client)
    created = client.post("/api/shopify-subscriptions/", json={
        "name": "Destino test", "connection_id": conn_id,
        "price_column_master": "PRICE", "stock_column_master": "STOCK",
    }).json()
    res = client.put(f"/api/shopify-subscriptions/{created['id']}", json={
        "name": "Destino test", "connection_id": conn_id,
        "price_column_master": "PRICE", "stock_column_master": "PRICE",
    })
    assert res.status_code == 400
