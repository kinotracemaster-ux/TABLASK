"""Pruebas del motor de transformaciones de export (MEJORAS_TABLASK §11).

Fija cómo se genera cada columna de salida: un cambio silencioso acá produce
CSV corruptos para Shopify/Kyte/Effi (SKU mal embebido, precios sin ×2, handles
rotos). Se prueban las transformaciones y los presets reales.
"""
import pytest

from backend.export_engine import (
    slugify, apply_price, transform_row, transform_headers, source_columns,
)
from backend.export_presets import get_presets

# Fila típica de la Maestra de Kino (estructura destino del §10).
ROW = {
    "sku": "K-001", "parent": "K-001", "name": "Reloj POEDAGAR Café",
    "brand": "POEDAGAR", "category": "reloj", "line": "ECONOMICO",
    "color": "café", "price": "$ 45.000", "stock": "5",
    "description": "Reloj elegante", "status": "activo",
}


# ─────────────────────────────────────────────────────────────────── slug
@pytest.mark.parametrize("raw,expected", [
    ("Reloj KARDOO Café", "reloj-kardoo-cafe"),
    ("  Espacios   raros ", "espacios-raros"),
    ("K-001", "k-001"),
    ("Ñandú & Co.", "nandu-co"),
])
def test_slugify(raw, expected):
    assert slugify(raw) == expected


# ─────────────────────────────────────────────────────────────────── precio
def test_apply_price_multiplica_y_limpia():
    assert apply_price("$ 45.000", 2) == "90000"   # base sucio ×2
    assert apply_price("38000,00", 2) == "76000"
    assert apply_price("1000", 1.8) == "1800"


def test_apply_price_valor_no_interpretable_queda_vacio():
    assert apply_price("gratis", 2) == ""
    assert apply_price("", 2) == ""


# ─────────────────────────────────────────────────── transformaciones
def test_field_concat_const_template():
    spec = [
        {"output": "Código", "type": "field", "source": "sku"},
        {"output": "Nombre", "type": "concat", "sources": ["sku", "name"], "sep": " "},
        {"output": "Publicado", "type": "const", "value": "TRUE"},
        {"output": "Body", "type": "template", "template": "<p>{name} — {brand}</p>"},
    ]
    assert transform_headers(spec) == ["Código", "Nombre", "Publicado", "Body"]
    assert transform_row(ROW, spec) == [
        "K-001",
        "K-001 Reloj POEDAGAR Café",
        "TRUE",
        "<p>Reloj POEDAGAR Café — POEDAGAR</p>",
    ]


def test_concat_ignora_vacios():
    spec = [{"output": "N", "type": "concat", "sources": ["sku", "color"], "sep": " "}]
    row = {"sku": "K-9", "color": ""}
    assert transform_row(row, spec) == ["K-9"]  # sin espacio colgante


def test_source_columns_incluye_template_refs():
    spec = [
        {"output": "A", "type": "field", "source": "sku"},
        {"output": "B", "type": "concat", "sources": ["sku", "name"]},
        {"output": "C", "type": "template", "template": "{name}-{brand}"},
        {"output": "D", "type": "const", "value": "x"},
    ]
    assert source_columns(spec) == ["brand", "name", "sku"]


# ─────────────────────────────────────────────────────────────────── presets
def test_preset_shopify_genera_handle_y_precio_x2():
    shopify = next(p for p in get_presets() if p["key"] == "shopify")
    headers = transform_headers(shopify["spec"])
    out = dict(zip(headers, transform_row(ROW, shopify["spec"])))
    assert out["Handle"] == "k-001-reloj-poedagar-cafe"   # slug de parent+name
    assert out["Variant SKU"] == "K-001"
    assert out["Variant Price"] == "90000"                # 45000 ×2
    assert out["Published"] == "TRUE"


def test_preset_kyte_embebe_sku_en_nombre():
    kyte = next(p for p in get_presets() if p["key"] == "kyte")
    headers = transform_headers(kyte["spec"])
    out = dict(zip(headers, transform_row(ROW, kyte["spec"])))
    assert out["Nombre"] == "K-001 Reloj POEDAGAR Café"   # sku + name
    assert out["Código"] == "K-001"                        # sku limpio
    assert out["Precio"] == "90000"                        # ×2
    assert out["Costo unitario"] == "$ 45.000"             # costo base tal cual


def test_preset_effi_embebe_sku_en_descripcion():
    effi = next(p for p in get_presets() if p["key"] == "effi")
    headers = transform_headers(effi["spec"])
    out = dict(zip(headers, transform_row(ROW, effi["spec"])))
    assert out["Descripción"] == "K-001 Reloj POEDAGAR Café"
    assert out["Cantidad"] == "5"


def test_todos_los_presets_tienen_estructura_valida():
    for p in get_presets():
        assert p["key"] and p["name"] and isinstance(p["spec"], list) and p["spec"]
        for col in p["spec"]:
            assert col.get("output")
            assert col.get("type") in ("field", "concat", "slug", "price", "const", "template")
