"""Pruebas de los helpers de 'referencia/variante' en sku_utils.py: agrupar
SKU por referencia (sufijo "-N" o "-<letra>N") e identificar la variante
PRINCIPAL de esa referencia/línea. Los usa el push de Nombre/Categoría a
Shopify (ShopifyConnector.push_updates) para resolver conflictos entre
variantes del mismo producto sin pisarse el nombre entre sí.
"""
import pytest

from backend.sku_utils import sku_reference_base, is_primary_variant_sku, strip_sku_label


@pytest.mark.parametrize("sku,expected", [
    ("3076-1", True),
    ("3076-6", False),
    ("968B-1", True),
    ("968B-4", False),
    ("1203", False),          # sin sufijo "-N": no hay variante principal que identificar
    # Sub-líneas con letra (confirmado por el usuario: "C" = cuero, "D" = deportivo)
    # son su PROPIA referencia — la "-1" de esa línea es la principal.
    ("827-C1", True),
    ("827-C2", False),
    ("892B-D1", True),
    ("892B-D2", False),
    ("1401-C1", True),
    ("1401-C11", False),      # "-C11" NO es "-C1" (no confundir por prefijo)
    (" 3076–1 ", True),       # guion unicode / espacios (normalize_sku_for_match)
])
def test_is_primary_variant_sku(sku, expected):
    assert is_primary_variant_sku(sku) is expected


@pytest.mark.parametrize("sku,expected_base", [
    ("968B-1", "968b"),
    ("968B-2", "968b"),
    ("1203", "1203"),
    # sku_reference_base solo saca el sufijo NUMÉRICO puro ("-\\d+$"): un
    # sufijo con letra ("-C1") no es su caso de uso (piensa en variantes de
    # color/talle simples) y queda tal cual — is_primary_variant_sku sí lo
    # reconoce como su propia referencia/línea (ver test de arriba).
    ("827-C1", "827-c1"),
])
def test_sku_reference_base(sku, expected_base):
    assert sku_reference_base(sku) == expected_base


def test_strip_sku_label_removes_own_prefix():
    assert strip_sku_label("3076-3", "3076-3 POEDAGAR METAL CALENDARIO DAMA") == "POEDAGAR METAL CALENDARIO DAMA"


def test_strip_sku_label_leaves_text_without_prefix_untouched():
    # El SKU no está al inicio del texto -> se devuelve tal cual (no hay nada que sacar).
    assert strip_sku_label("3076-3", "POEDAGAR METAL CALENDARIO DAMA") == "POEDAGAR METAL CALENDARIO DAMA"


def test_strip_sku_label_case_insensitive_prefix():
    assert strip_sku_label("3076-3", "3076-3  poedagar metal") == "poedagar metal"
