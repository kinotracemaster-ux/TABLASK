"""Pruebas del Lavadero (MEJORAS_TABLASK §3): normalización por campo en el intake.

Estas reglas deciden qué entra a la Maestra y cómo. Un cambio silencioso aquí
escribe precios/stock corruptos en la fuente de verdad, así que quedan fijadas:
  - precio: formatos reales de Kino ("$ 10.000" miles, "38000,00" decimal)
  - stock: entero forzado; texto y fracciones se rechazan; negativo a revisar
  - nombre: colapsar espacios, sin forzar capitalización (marcas en mayúsculas)
  - vacíos: nunca pisan datos existentes
"""
import pytest

from backend.lavadero import (
    clean_price, clean_stock, clean_name, classify_columns, wash_value,
)


# ─────────────────────────────────────────────────────────────────── precio
PRICE_CASES = [
    # (entrada, valor esperado, status esperado)
    ("$ 45.000", "45000", "cleaned"),      # ejemplo literal del MD §3
    ("$ 10.000", "10000", "cleaned"),      # formato BASE-SYS (MD §11)
    ("38000,00", "38000", "cleaned"),      # formato Kyte con coma decimal (MD §11)
    ("45000", "45000", "ok"),              # ya limpio
    ("45.000", "45000", "cleaned"),        # punto de miles
    ("1.234.567", "1234567", "cleaned"),   # varios puntos = miles
    ("45,000.50", "45000.5", "cleaned"),   # anglo: coma miles + punto decimal
    ("45.000,50", "45000.5", "cleaned"),   # latino: punto miles + coma decimal
    ("45.5", "45.5", "ok"),                # decimal real (1-2 dígitos) se respeta
    ("45,5", "45.5", "cleaned"),           # coma decimal
    ("  45000  ", "45000", "ok"),          # espacios alrededor: se recortan sin marcar
    ("COP 45.000", "45000", "cleaned"),    # prefijo de moneda con letras
]

@pytest.mark.parametrize("raw,expected,status", PRICE_CASES)
def test_clean_price(raw, expected, status):
    value, st, reason = clean_price(raw)
    assert (value, st) == (expected, status), f"{raw!r} → {value!r}/{st} (motivo: {reason})"


def test_precio_vacio_es_empty():
    assert clean_price("") == ("", "empty", None)
    assert clean_price(None) == ("", "empty", None)
    assert clean_price("   ") == ("", "empty", None)


def test_precio_sin_numero_se_rechaza():
    for raw in ("gratis", "$", "N/A", "consultar"):
        value, st, reason = clean_price(raw)
        assert st == "rejected", raw
        assert reason


def test_precio_cero_va_a_revisar():
    value, st, reason = clean_price("0")
    assert st == "review" and "0" in reason


def test_precio_negativo_va_a_revisar():
    value, st, reason = clean_price("-500")
    assert st == "review" and "negativo" in reason


# ─────────────────────────────────────────────────────────────────── stock
def test_stock_entero_limpio():
    assert clean_stock("5") == ("5", "ok", None)
    assert clean_stock("0") == ("0", "ok", None)      # 0 es válido: agotado


def test_stock_decimal_cero_de_sheets_se_limpia():
    assert clean_stock("5.0") == ("5", "cleaned", None)
    assert clean_stock("5,00") == ("5", "cleaned", None)


def test_stock_con_texto_se_rechaza():
    value, st, reason = clean_stock("5 unid")          # ejemplo literal del MD §3
    assert st == "rejected" and "texto" in reason


def test_stock_fraccion_real_se_rechaza():
    value, st, reason = clean_stock("5.5")
    assert st == "rejected" and "decimales" in reason


def test_stock_negativo_va_a_revisar():
    value, st, reason = clean_stock("-3")
    assert (value, st) == ("-3", "review") and "negativo" in reason


def test_stock_vacio_es_empty():
    assert clean_stock("") == ("", "empty", None)


# ─────────────────────────────────────────────────────────────────── nombre
def test_nombre_colapsa_espacios():
    assert clean_name("Reloj   POEDAGAR  dama ") == ("Reloj POEDAGAR dama", "cleaned", None)


def test_nombre_no_fuerza_capitalizacion():
    # Las marcas van en mayúsculas a propósito: no se tocan.
    assert clean_name("KARDOO Digital") == ("KARDOO Digital", "ok", None)


# ───────────────────────────────────────────────── clasificación y despacho
def test_classify_columns_nucleo_kino():
    # Mapeo real BASE-SYS → Master (MD §11): Cantidad/Código/Nombre/PRECIO
    mappings = {"PRECIO": "price", "Cantidad": "stock", "Nombre": "name", "Código": "sku"}
    kinds = classify_columns(mappings)
    assert kinds["price"] == "precio"
    assert kinds["stock"] == "stock"
    assert kinds["name"] == "nombre"
    assert kinds["sku"] is None  # el SKU no se lava (solo se normaliza al cruzar)


def test_classify_por_nombre_de_origen_si_maestra_no_dice_nada():
    # La columna maestra "valor_base" no está en el diccionario, pero "PRECIO" sí.
    kinds = classify_columns({"PRECIO": "valor_base"})
    assert kinds["valor_base"] == "precio"


def test_wash_value_sin_tipo_pasa_tal_cual():
    # Columnas sin clasificar (enriquecimiento u otras) no se tocan.
    assert wash_value(None, "  lo que sea $ ") == ("  lo que sea $ ", "ok", None)
