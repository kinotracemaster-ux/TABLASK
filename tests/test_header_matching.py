"""Pruebas de find_header_index (backend/sku_utils.py).

Busca una columna configurada (SKU, precio, stock...) en los encabezados
reales de una hoja. Antes cada router hacía `headers.index(name)` a secas:
si la columna guardada tenía otra casing que el encabezado real ("sku"
guardado vs "SKU" en la hoja), el cruce fallaba con un error confuso —o,
en api_push.py, en silencio, sin escribir nada. Visto en producción con la
Maestra real de POEDAGAR.
"""
from backend.sku_utils import find_header_index

HEADERS = ["SKU", "Nombre", "PRICE", "Stock "]


def test_match_exacto():
    assert find_header_index(HEADERS, "SKU") == 0


def test_match_case_insensitive():
    assert find_header_index(HEADERS, "sku") == 0
    assert find_header_index(HEADERS, "price") == 2


def test_match_con_espacios_alrededor():
    assert find_header_index(HEADERS, " Stock ") == 3
    assert find_header_index(HEADERS, "stock") == 3


def test_no_encontrada_devuelve_menos_uno():
    assert find_header_index(HEADERS, "no_existe") == -1


def test_nombre_vacio_o_none_devuelve_menos_uno():
    assert find_header_index(HEADERS, "") == -1
    assert find_header_index(HEADERS, None) == -1
