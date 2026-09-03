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

    calls = {"price": [], "stock": [], "product": []}
    monkeypatch.setattr(c, "_price_bulk_update",
                        lambda pid, variants: calls["price"].append((pid, variants)))
    monkeypatch.setattr(c, "_inventory_set",
                        lambda quantities: calls["stock"].append(quantities))
    monkeypatch.setattr(c, "_product_update",
                        lambda pid, fields: calls["product"].append((pid, fields)))
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


def test_dry_run_changes_shows_before_after(conn):
    # El índice mockeado no trae valores actuales -> "before" queda "(vacío)".
    updates = [{"sku": "1203", "price": "10", "stock": "5"}]
    summary = conn.push_updates(updates, do_price=True, do_stock=True, dry_run=True)
    assert summary["changes"] == [
        {"sku": "1203", "field": "Precio", "before": "(vacío)", "after": "10"},
        {"sku": "1203", "field": "Stock", "before": "(vacío)", "after": "5"},
    ]
    assert summary["changes_total"] == 2


def test_dry_run_changes_ignores_same_value_different_format(conn, monkeypatch):
    # "182000" (Maestra) vs "182000.00" (Shopify) es el MISMO precio -> no es
    # un cambio real, no debe aparecer en el preview (evita ruido/falsos positivos).
    index = {
        "1203": {
            "variant_id": "gid://shopify/ProductVariant/1",
            "product_id": "gid://shopify/Product/10",
            "inventory_item_id": "gid://shopify/InventoryItem/100",
            "sku": "1203",
            "current_price": "182000.00",
            "current_stock": 5,
        },
    }
    monkeypatch.setattr(conn, "index_variants_by_sku", lambda: index)
    summary = conn.push_updates([{"sku": "1203", "price": "182000", "stock": "5,0"}],
                                do_price=True, do_stock=True, dry_run=True)
    assert summary["changes"] == []
    assert summary["changes_total"] == 0


def test_dry_run_changes_only_for_active_fields(conn):
    # barcode viene en el update pero do_barcode=False -> no genera "changes".
    updates = [{"sku": "1203", "price": "10", "barcode": "999"}]
    summary = conn.push_updates(updates, do_price=True, do_stock=False, dry_run=True)
    assert [c["field"] for c in summary["changes"]] == ["Precio"]


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


def test_compare_price_and_barcode_go_in_one_variant_call(conn):
    # Precio comparativo (oferta) y barcode son de VARIANTE: viajan en la misma
    # llamada bulk que el precio, con las claves que Shopify espera.
    updates = [{"sku": "1203", "price": "10", "compare_at_price": "15,5", "barcode": "779000"}]
    summary = conn.push_updates(updates, do_price=True, do_stock=False, dry_run=False,
                                do_compare_price=True, do_barcode=True)
    assert summary["price_updated"] == 1
    assert summary["compare_price_updated"] == 1
    assert summary["barcode_updated"] == 1
    assert len(conn._calls["price"]) == 1  # una sola llamada de variante
    _, variants = conn._calls["price"][0]
    assert variants[0]["price"] == "10"
    assert variants[0]["compareAtPrice"] == "15.5"   # coma normalizada
    assert variants[0]["barcode"] == "779000"


def test_only_barcode_without_price(conn):
    # Se puede elegir un solo campo (barcode) sin tocar precio ni stock.
    summary = conn.push_updates([{"sku": "1203", "barcode": "abc123"}],
                                do_price=False, do_stock=False, dry_run=False,
                                do_barcode=True)
    assert summary["barcode_updated"] == 1
    assert summary["price_updated"] == 0
    _, variants = conn._calls["price"][0]
    assert variants[0] == {"id": "gid://shopify/ProductVariant/1", "barcode": "abc123"}


def test_extra_fields_off_by_default(conn):
    # Si no se activan, compare/barcode NO se escriben aunque vengan en el update.
    conn.push_updates([{"sku": "1203", "price": "10", "compare_at_price": "20", "barcode": "x"}],
                      do_price=True, do_stock=False, dry_run=False)
    _, variants = conn._calls["price"][0]
    assert "compareAtPrice" not in variants[0]
    assert "barcode" not in variants[0]


def test_title_and_product_type_are_product_level(conn):
    # Nombre/categoría van por productUpdate (PRODUCTO), no por la mutación de
    # variante — nunca deben mezclarse con la llamada de precio/stock.
    updates = [{"sku": "1203", "title": "Reloj Deportivo", "product_type": "Relojes"}]
    summary = conn.push_updates(updates, do_price=False, do_stock=False, dry_run=False,
                                do_title=True, do_product_type=True)
    assert summary["title_updated"] == 1
    assert summary["product_type_updated"] == 1
    assert conn._calls["price"] == []  # no toca la mutación de variante
    assert len(conn._calls["product"]) == 1
    pid, fields = conn._calls["product"][0]
    assert pid == "gid://shopify/Product/10"
    assert fields == {"title": "Reloj Deportivo", "productType": "Relojes"}


def test_title_updates_grouped_one_call_per_product(conn):
    # Dos SKUs (variantes) del MISMO producto piden el MISMO nombre -> se
    # aplica en una sola llamada productUpdate.
    updates = [
        {"sku": "1203", "title": "Reloj A"},
        {"sku": "45", "title": "Reloj A"},
    ]
    conn.push_updates(updates, do_price=False, do_stock=False, dry_run=False, do_title=True)
    assert len(conn._calls["product"]) == 1
    pid, fields = conn._calls["product"][0]
    assert pid == "gid://shopify/Product/10"
    assert fields == {"title": "Reloj A"}


def test_title_conflict_between_variants_is_skipped_not_overwritten(conn):
    # Dos SKUs (variantes/colores) del MISMO producto piden nombres DISTINTOS:
    # aplicar "gana el último" a ciegas pisaría el nombre que debería quedar
    # para la otra variante/color -> no se aplica ninguno, se reporta conflicto.
    updates = [
        {"sku": "1203", "title": "Reloj Rojo"},
        {"sku": "45", "title": "Reloj Azul"},
    ]
    summary = conn.push_updates(updates, do_price=False, do_stock=False, dry_run=False, do_title=True)
    assert summary["title_updated"] == 0
    assert summary["conflicts_total"] == 1
    assert conn._calls["product"] == []


def test_blank_title_and_product_type_are_skipped(conn):
    summary = conn.push_updates([{"sku": "1203", "title": "", "product_type": ""}],
                                do_price=False, do_stock=False, dry_run=False,
                                do_title=True, do_product_type=True)
    assert summary["title_updated"] == 0
    assert summary["product_type_updated"] == 0
    assert conn._calls["product"] == []


def test_title_off_by_default(conn):
    conn.push_updates([{"sku": "1203", "price": "10", "title": "Reloj Nuevo"}],
                      do_price=True, do_stock=False, dry_run=False)
    assert conn._calls["product"] == []


def test_dry_run_shows_title_and_product_type_changes(conn, monkeypatch):
    index = {
        "1203": {
            "variant_id": "gid://shopify/ProductVariant/1",
            "product_id": "gid://shopify/Product/10",
            "inventory_item_id": "gid://shopify/InventoryItem/100",
            "sku": "1203",
            "current_title": "Reloj Viejo",
            "current_product_type": "",
        },
    }
    monkeypatch.setattr(conn, "index_variants_by_sku", lambda: index)
    summary = conn.push_updates(
        [{"sku": "1203", "title": "Reloj Nuevo", "product_type": "Relojes"}],
        do_price=False, do_stock=False, dry_run=True, do_title=True, do_product_type=True)
    assert summary["changes"] == [
        {"sku": "1203", "field": "Nombre", "before": "Reloj Viejo", "after": "Reloj Nuevo"},
        {"sku": "1203", "field": "Categoría", "before": "(vacío)", "after": "Relojes"},
    ]


def test_dry_run_flags_title_conflict_between_variants(conn):
    # Mismo escenario que el conflicto real, pero en dry_run: no se listan
    # como "cambio" (no se van a aplicar), quedan aparte en "conflicts".
    updates = [
        {"sku": "1203", "title": "Reloj Rojo"},
        {"sku": "45", "title": "Reloj Azul"},
    ]
    summary = conn.push_updates(updates, do_price=False, do_stock=False, dry_run=True, do_title=True)
    assert summary["changes"] == []
    assert summary["conflicts_total"] == 2
    assert {"sku": "1203", "field": "Nombre", "value": "Reloj Rojo"} in summary["conflicts"]
    assert {"sku": "45", "field": "Nombre", "value": "Reloj Azul"} in summary["conflicts"]
