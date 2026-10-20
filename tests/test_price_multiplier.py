"""Pruebas del multiplicador de precio por canal (backend/pricing.py).

Caso real: la Maestra guarda el precio base del proveedor y la web de Poedagar
vende a base × 2,8. Antes la columna se enviaba tal cual a Shopify.

Lo crítico a fijar: el multiplicador aplica SOLO al precio (no al stock ni al
precio comparativo), el default 1.0 no cambia nada de lo que ya funcionaba, y
un precio ilegible se manda tal cual en vez de inventar un número.
"""
import pytest

from backend.pricing import MULTIPLICADOR_MAX, aplicar_multiplicador, es_multiplicador_valido
from backend.propagation import build_shopify_updates
from backend.routers.shopify_subscriptions import build_updates_from_sheet


# ───────────────────────────────────────────────── el cálculo en sí
@pytest.mark.parametrize("base,mult,esperado", [
    ("65000", 2.8, "182000"),        # el caso de Poedagar
    ("45000", 2.8, "126000"),
    ("$ 45.000", 2.8, "126000"),     # formato sucio del SYS (punto de miles)
    ("38000,00", 2.8, "106400"),     # coma decimal
    ("45,000.00", 2.8, "126000"),    # coma de miles
    ("40000", 2.0, "80000"),         # el ×2 de Kyte
    ("37000", 2.8, "103600"),
    ("55000", 2.8, "154000"),
])
def test_precio_base_por_multiplicador(base, mult, esperado):
    assert aplicar_multiplicador(base, mult) == esperado


def test_redondea_a_entero_porque_el_peso_no_tiene_centavos():
    assert aplicar_multiplicador("35000", 2.85) == "99750"
    assert aplicar_multiplicador("1001", 1.5) == "1502"   # 1501.5 → 1502


def test_multiplicador_1_no_toca_nada():
    # Es el default: todo lo que ya estaba configurado sigue igual.
    for raw in ("45000", "$ 45.000", "", None, "gratis"):
        assert aplicar_multiplicador(raw, 1.0) == raw


def test_un_precio_ilegible_se_manda_tal_cual_sin_inventar():
    assert aplicar_multiplicador("consultar", 2.8) == "consultar"
    assert aplicar_multiplicador("", 2.8) == ""
    assert aplicar_multiplicador(None, 2.8) is None


def test_multiplicadores_validos_e_invalidos():
    assert es_multiplicador_valido(2.8) and es_multiplicador_valido(1) and es_multiplicador_valido(MULTIPLICADOR_MAX)
    # 0 pondría toda la tienda gratis; negativo y enorme son dedazos.
    assert not es_multiplicador_valido(0)
    assert not es_multiplicador_valido(-2)
    assert not es_multiplicador_valido(MULTIPLICADOR_MAX + 1)
    assert not es_multiplicador_valido("dos")
    assert not es_multiplicador_valido(None)


# ──────────────────────────────────────── al armar los updates del diff
def test_diff_a_shopify_aplica_el_multiplicador_solo_al_precio():
    changes = [
        {"sku": "A1", "field": "PRECIO", "new": "65000"},
        {"sku": "A1", "field": "STOCK", "new": "7"},
        {"sku": "A2", "field": "COMPARA", "new": "50000"},
    ]
    out = {u["sku"]: u for u in build_shopify_updates(
        changes, [], "PRECIO", "STOCK", compare_col="COMPARA", price_multiplier=2.8)}
    assert out["A1"]["price"] == "182000"
    assert out["A1"]["stock"] == "7"            # el stock nunca se multiplica
    assert out["A2"]["compare_at_price"] == "50000"  # el comparativo tampoco


def test_diff_a_shopify_multiplica_tambien_las_filas_nuevas():
    new_rows = [{"sku": "N1", "fields": {"PRECIO": "40000", "STOCK": "3"}}]
    out = build_shopify_updates([], new_rows, "PRECIO", "STOCK", price_multiplier=2.8)[0]
    assert out["price"] == "112000" and out["stock"] == "3"


def test_diff_a_shopify_sin_multiplicador_es_el_comportamiento_de_antes():
    changes = [{"sku": "A1", "field": "PRECIO", "new": "65000"}]
    assert build_shopify_updates(changes, [], "PRECIO", "STOCK")[0]["price"] == "65000"


# ──────────────────────────────────── al armar los updates de la Maestra
def test_envio_completo_desde_la_maestra_aplica_el_multiplicador():
    raw = [["sku", "PRECIO", "STOCK"],
           ["685B-1", "65000", "67"],
           ["3076-1", "45000", "8"]]
    out = build_updates_from_sheet(raw, "sku", "PRECIO", "STOCK", price_multiplier=2.8)
    assert [(u["sku"], u["price"], u["stock"]) for u in out] == [
        ("685B-1", "182000", "67"),
        ("3076-1", "126000", "8"),
    ]


def test_envio_completo_sin_multiplicador_manda_la_columna_tal_cual():
    raw = [["sku", "PRECIO"], ["685B-1", "65000"]]
    assert build_updates_from_sheet(raw, "sku", "PRECIO", None)[0]["price"] == "65000"


# ─────────────────────────────────────────────────── validación en la API
@pytest.fixture
def client():
    import backend.main
    from fastapi.testclient import TestClient
    return TestClient(backend.main.app)


def _tienda(client, nombre):
    return client.post("/api/connections/", json={
        "name": nombre, "connection_type": "shopify",
        "shopify_domain": nombre, "shopify_access_token": "shpat_test"}).json()["id"]


def test_la_api_guarda_y_devuelve_el_multiplicador(client):
    conn = _tienda(client, "tienda-mult")
    sub = client.post("/api/shopify-subscriptions/", json={
        "name": "Shopi-Poe", "connection_id": conn,
        "price_column_master": "PRICE", "price_multiplier": 2.8}).json()
    assert sub["price_multiplier"] == 2.8
    assert any(s["id"] == sub["id"] and s["price_multiplier"] == 2.8
               for s in client.get("/api/shopify-subscriptions/").json())
    client.delete(f"/api/shopify-subscriptions/{sub['id']}")


def test_la_api_rechaza_multiplicadores_peligrosos(client):
    conn = _tienda(client, "tienda-mult-malo")
    for malo in (0, -1, MULTIPLICADOR_MAX + 1):
        r = client.post("/api/shopify-subscriptions/", json={
            "name": "Malo", "connection_id": conn,
            "price_column_master": "PRICE", "price_multiplier": malo})
        assert r.status_code == 400, malo
        assert "multiplicador" in r.json()["detail"].lower()


def test_un_destino_viejo_sin_multiplicador_queda_en_1(client):
    conn = _tienda(client, "tienda-sin-mult")
    sub = client.post("/api/shopify-subscriptions/", json={
        "name": "Sin mult", "connection_id": conn, "price_column_master": "PRICE"}).json()
    assert sub["price_multiplier"] == 1.0
    client.delete(f"/api/shopify-subscriptions/{sub['id']}")
