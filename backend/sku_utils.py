"""Normalización de SKU para el cruce (única fuente de verdad).

`normalize_sku_for_match` decide qué SKUs se consideran "el mismo" al cruzar
BASE→Master y hoja→Shopify. Vive en un módulo propio para que services.py y el
conector de Shopify usen EXACTAMENTE la misma regla (un cambio silencioso aquí
duplica productos o pisa datos). La normalización es SOLO para comparar; el SKU
que se guarda en Sheets nunca se altera.
"""
import re

# Caracteres invisibles que se ELIMINAN (no aportan al SKU y rompen el cruce):
# ancho cero, joiners, BOM y guion suave. Se pegan a los SKU al copiar de Excel
# o de software de diseño.
_ZERO_WIDTH = dict.fromkeys([0x200B, 0x200C, 0x200D, 0xFEFF, 0x00AD], None)

# Variantes unicode de GUION → guion ASCII '-'. Excel "autocorrige" el guion
# normal a guion largo (–, —), así que '726B-4' y '726B–4' deben cruzar.
_DASHES = {c: 0x2D for c in (
    0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015,  # ‐ ‑ ‒ – — ―
    0x2212,                                          # − (signo menos)
    0xFE58, 0xFE63, 0xFF0D,                          # ﹘ ﹣ － (compat/ancho completo)
)}

# Variantes unicode de ESPACIO → espacio normal (luego .strip() saca los de los
# extremos). Incluye el espacio duro (\xa0), muy común pegado a los SKU.
_SPACES = {c: 0x20 for c in (
    0x00A0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
    0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x202F, 0x205F, 0x3000,
)}

_TRANSLATE = {**_ZERO_WIDTH, **_DASHES, **_SPACES}


def normalize_sku_for_match(s: str) -> str:
    """Forma normalizada de un SKU/código SOLO para comparar (no para escribir).
    Unifica las diferencias más comunes que rompen el cruce exacto:
    - caracteres invisibles (ancho cero, BOM, guion suave): se eliminan
    - guiones unicode (–, —, −, …): se unifican a '-'
    - espacios unicode (duro, etc.): se unifican y se recortan de los extremos
    - mayúsculas/minúsculas y espacios
    - decimales de Sheets: '1203.0' -> '1203'
    - ceros a la izquierda en numéricos: '01203' -> '1203'
    El valor real que se escribe en Sheets NUNCA se altera; esto es solo para
    detectar el mismo producto pese a diferencias de formato/typos.
    """
    s = (s or "").translate(_TRANSLATE).strip().lower()
    if not s:
        return ""
    # '1203.0' / '1203.00' -> '1203'
    if re.fullmatch(r"\d+\.0+", s):
        s = s.split(".")[0]
    # ceros a la izquierda en numéricos puros: '01203' -> '1203'
    if s.isdigit():
        s = s.lstrip("0") or "0"
    return s
