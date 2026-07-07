"""Pruebas de la normalización de SKU (regla central del cruce).

`normalize_sku_for_match` decide qué SKUs se consideran "el mismo" al cruzar
BASE→Master y hoja→Shopify. Un cambio silencioso aquí duplica productos o pisa
datos, así que estas reglas quedan fijadas por tests.
"""
import pytest

from backend.services import normalize_sku_for_match
from backend.connectors.shopify import ShopifyConnector

# (entrada, salida esperada)
CASES = [
    ("  1203 ", "1203"),      # espacios alrededor
    ("1203", "1203"),         # ya normalizado
    ("1203.0", "1203"),       # decimal de Sheets
    ("1203.00", "1203"),      # decimal de Sheets (varios ceros)
    ("01203", "1203"),        # ceros a la izquierda (numérico)
    ("01203.0", "1203"),      # ceros + decimal
    ("0", "0"),               # cero solo se conserva
    ("000", "0"),             # solo ceros -> "0" (no cadena vacía)
    ("00.0", "0"),            # decimal que colapsa a cero
    ("", ""),                 # vacío
    (None, ""),               # None se trata como vacío
    ("ABC-01", "abc-01"),     # alfanumérico: minúsculas, NO se quitan ceros
    ("1203.5", "1203.5"),     # decimal real NO se colapsa (solo \d+\.0+)
    ("12O3", "12o3"),         # la 'O' es letra, no cero: no se toca salvo minúscula
    ("  MiXeD-Code_9 ", "mixed-code_9"),
]


@pytest.mark.parametrize("raw,expected", CASES)
def test_normalize_sku_for_match(raw, expected):
    assert normalize_sku_for_match(raw) == expected


@pytest.mark.parametrize("raw,_expected", CASES)
def test_services_and_shopify_normalizers_agree(raw, _expected):
    """La docstring de _normalize_sku promete 'mismas reglas' que services.
    Este test evita que las dos implementaciones se separen sin que nadie lo note.
    """
    assert normalize_sku_for_match(raw) == ShopifyConnector._normalize_sku(raw)
