"""Pruebas de que una tienda Shopify tiene UN SOLO destino guardado.

Bug real: FileToShopify.jsx y SourceWizard.jsx siempre hacían POST a
/api/shopify-subscriptions/ sin revisar si esa tienda ya tenía un destino
guardado. Cada archivo nuevo terminaba creando OTRO destino para la misma
tienda (visto en "Mis Flujos" como varias tarjetas "Shopify · SHOPOE"), y
como propagation.py corre TODOS los destinos activos en cada sync, un
destino viejo con un mapeo peligroso (ej. Stock = PRICE) seguía escribiendo
datos corruptos aunque ya hubiera uno nuevo y bien configurado.

Ahora: crear un destino para una tienda que ya tiene uno lo ACTUALIZA en vez
de duplicarlo (mismo id, se sigue viendo una sola tarjeta en Flujos). Editar
un destino para que apunte a la tienda de OTRO destino existente se rechaza
(nunca deja dos filas con el mismo connection_id).
"""
import pytest


@pytest.fixture
def client():
    import backend.main
    from fastapi.testclient import TestClient
    return TestClient(backend.main.app)


def _shopify_conn(client, domain="test.myshopify.com"):
    res = client.post("/api/connections/", json={
        "name": f"Tienda {domain}", "connection_type": "shopify",
        "shopify_domain": domain, "shopify_access_token": "shpat_x",
    })
    assert res.status_code == 200, res.text
    return res.json()["id"]


def test_crear_dos_veces_para_la_misma_tienda_actualiza_en_vez_de_duplicar(client):
    conn_id = _shopify_conn(client)
    primero = client.post("/api/shopify-subscriptions/", json={
        "name": "Shopi archivo viejo", "connection_id": conn_id,
        "price_column_master": "PRICE", "stock_column_master": "SKU",  # mapeo viejo y sin sentido
    })
    assert primero.status_code == 200, primero.text
    primero = primero.json()

    segundo = client.post("/api/shopify-subscriptions/", json={
        "name": "Shopi archivo nuevo", "connection_id": conn_id,
        "price_column_master": "PRICE", "stock_column_master": "STOCK",  # mapeo corregido
    })
    assert segundo.status_code == 200, segundo.text
    segundo = segundo.json()

    assert segundo["id"] == primero["id"]  # mismo registro, no uno nuevo
    assert segundo["name"] == "Shopi archivo nuevo"
    assert segundo["stock_column_master"] == "STOCK"  # el mapeo peligroso quedó reemplazado

    todos = client.get("/api/shopify-subscriptions/").json()
    assert len([s for s in todos if s["connection_id"] == conn_id]) == 1


def test_crear_para_conexion_distinta_no_se_mezcla(client):
    conn_a = _shopify_conn(client, "tienda-a.myshopify.com")
    conn_b = _shopify_conn(client, "tienda-b.myshopify.com")
    client.post("/api/shopify-subscriptions/", json={
        "name": "Destino A", "connection_id": conn_a, "price_column_master": "PRICE",
    })
    client.post("/api/shopify-subscriptions/", json={
        "name": "Destino B", "connection_id": conn_b, "price_column_master": "PRICE",
    })
    todos = client.get("/api/shopify-subscriptions/").json()
    assert len([s for s in todos if s["connection_id"] in (conn_a, conn_b)]) == 2


def test_editar_no_puede_pisar_la_conexion_de_otro_destino(client):
    conn_a = _shopify_conn(client, "tienda-a2.myshopify.com")
    conn_b = _shopify_conn(client, "tienda-b2.myshopify.com")
    client.post("/api/shopify-subscriptions/", json={
        "name": "Destino A", "connection_id": conn_a, "price_column_master": "PRICE",
    })
    destino_b = client.post("/api/shopify-subscriptions/", json={
        "name": "Destino B", "connection_id": conn_b, "price_column_master": "PRICE",
    }).json()

    res = client.put(f"/api/shopify-subscriptions/{destino_b['id']}", json={
        "name": "Destino B", "connection_id": conn_a, "price_column_master": "PRICE",
    })
    assert res.status_code == 400


def test_editar_el_propio_destino_sin_cambiar_tienda_funciona(client):
    conn_id = _shopify_conn(client, "tienda-c.myshopify.com")
    destino = client.post("/api/shopify-subscriptions/", json={
        "name": "Destino C", "connection_id": conn_id, "price_column_master": "PRICE",
    }).json()
    res = client.put(f"/api/shopify-subscriptions/{destino['id']}", json={
        "name": "Destino C renombrado", "connection_id": conn_id, "price_column_master": "PRICE",
    })
    assert res.status_code == 200, res.text
    assert res.json()["name"] == "Destino C renombrado"
