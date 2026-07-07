"""Pruebas de ShopifyConnector.push_updates (el camino más peligroso: escribe a
una tienda en vivo).

Se monkeypatchean los métodos de red (index de variantes y las mutaciones), así
que estas pruebas NO tocan Shopify: verifican la LÓGICA de orquestación —cruce,
dry_run, agrupación por producto, y las reglas de negocio sobre vacíos y ceros.
"""
import pytest

from backend.connectors.shopify import ShopifyConnector


def _make_connector():
    # access_token evita que __init__ intente credenciales/red.
    return ShopifyConnector({"shopify_domain": "demo", "shopify_access_token": "shpat_test"})


@pytest.fixture
def conn(monkeypatch):
    c = _make_connector()

    # Catálogo simulado: dos variantes del MISMO producto (product_id 10).
    index = {
        "1203": {
            "variant_id": "gid://shopify/ProductVariant/1",
            "product_id": "gid://shopify/Product/10",
            "inventory_item_id": "gid://shopify/InventoryItem/100",
            "sku": "1203",
        },
        "45": {
            "variant_id": "gid://shopify/ProductVariant/2",
            "product_id": "gid://shopify/Product/10",
            "inventory_item_id": "gid://shopify/InventoryItem/101",
            "sku": "45",
        },
    }
    monkeypatch.setattr(c, "index_variants_by_sku", lambda: index)

    calls = {"price": [], "stock": []}
    monkeypatch.setattr(c, "_price_bulk_update",
                        lambda pid, variants: calls["price"].append((pid, variants)))
    monkeypatch.setattr(c, "_inventory_set",
                        lambda quantities: calls["stock"].append(quantities))
    monkeypatch.setattr(c, "get_primary_location_id",
                        lambda: "gid://shopify/Location/1")
    c._calls = calls
    return c


def test_dry_run_reports_cross_without_writing(conn):
    updates = [{"sku": "1203", "price": "10", "stock": "5"}, {"sku": "9999", "price": "1"}]
    summary = conn.push_updates(updates, do_price=True, do_stock=True, dry_run=True)

    assert summary["total"] == 2
    assert summary["matched"] == 1
    assert summary["not_found_count"] == 1
    assert summary["not_found"] == ["9999"]
    assert summary["price_updated"] == 0
    assert summary["stock_updated"] == 0
    # Lo esencial del dry_run: NO escribe nada.
    assert conn._calls["price"] == []
    assert conn._calls["stock"] == []


def test_matches_by_normalized_sku(conn):
    # "01203" debe cruzar con la variante indexada como "1203".
    summary = conn.push_updates([{"sku": "01203", "price": "9,99"}],
                                do_price=True, do_stock=False, dry_run=True)
    assert summary["matched"] == 1
    assert summary["not_found_count"] == 0


def test_blank_price_and_stock_are_skipped(conn):
    summary = conn.push_updates([{"sku": "1203", "price": "", "stock": ""}],
                                do_price=True, do_stock=True, dry_run=False)
    assert summary["price_updated"] == 0
    assert summary["stock_updated"] == 0
    assert conn._calls["price"] == []
    assert conn._calls["stock"] == []


def test_stock_zero_IS_written(conn):
    # COMPORTAMIENTO DE RIESGO, fijado a propósito: un 0 (que no es vacío) SÍ
    # pone el stock en 0 en la tienda. Este test documenta el riesgo que motiva
    # el preview con diff de valores antes de enviar.
    summary = conn.push_updates([{"sku": "1203", "stock": "0"}],
                                do_price=False, do_stock=True, dry_run=False)
    assert summary["stock_updated"] == 1
    assert len(conn._calls["stock"]) == 1
    payload = conn._calls["stock"][0]
    assert payload[0]["quantity"] == 0
    assert payload[0]["locationId"] == "gid://shopify/Location/1"


def test_price_written_and_grouped_by_product(conn):
    updates = [{"sku": "1203", "price": "10"}, {"sku": "45", "price": "20"}]
    summary = conn.push_updates(updates, do_price=True, do_stock=False, dry_run=False)
    # Ambas variantes son del mismo product_id -> UNA sola llamada bulk con 2 variantes.
    assert summary["price_updated"] == 2
    assert len(conn._calls["price"]) == 1
    pid, variants = conn._calls["price"][0]
    assert pid == "gid://shopify/Product/10"
    assert {v["price"] for v in variants} == {"10", "20"}


def test_price_decimal_comma_is_normalized(conn):
    conn.push_updates([{"sku": "1203", "price": "19,99"}],
                      do_price=True, do_stock=False, dry_run=False)
    _, variants = conn._calls["price"][0]
    assert variants[0]["price"] == "19.99"


def test_stock_decimal_comma_truncated_to_int(conn):
    conn.push_updates([{"sku": "1203", "stock": "12,5"}],
                      do_price=False, do_stock=True, dry_run=False)
    payload = conn._calls["stock"][0]
    assert payload[0]["quantity"] == 12


def test_non_numeric_stock_is_skipped(conn):
    summary = conn.push_updates([{"sku": "1203", "stock": "abc"}],
                                do_price=False, do_stock=True, dry_run=False)
    assert summary["stock_updated"] == 0
    assert conn._calls["stock"] == []


def test_unmatched_sku_goes_to_not_found(conn):
    summary = conn.push_updates([{"sku": "does-not-exist", "price": "5"}],
                                do_price=True, do_stock=False, dry_run=False)
    assert summary["matched"] == 0
    assert summary["not_found"] == ["does-not-exist"]
    assert conn._calls["price"] == []
