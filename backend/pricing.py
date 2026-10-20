"""Multiplicador de precio por canal.

Cada canal vende al mismo catálogo con su propio margen: la Maestra guarda el
precio base (el del proveedor) y cada destino decide por cuánto multiplicarlo.
Kyte ya lo hacía con el ×2 de sus plantillas de export; esto trae la misma idea
a los destinos Shopify, donde hasta ahora la columna mapeada se enviaba tal cual.

Caso real: la web de Poedagar vende a `precio base × 2,8`.

Regla: multiplicador 1.0 (el default) = comportamiento de siempre, la columna
va sin tocar. Un precio que no se puede leer como número se manda tal cual y
el Lavadero lo reporta — acá no se inventan números.
"""
from .lavadero import clean_price

MULTIPLICADOR_MAX = 100.0  # tope de sanidad: un dedo de más no multiplica por mil


def es_multiplicador_valido(mult) -> bool:
    try:
        m = float(mult)
    except (TypeError, ValueError):
        return False
    return 0 < m <= MULTIPLICADOR_MAX


def a_numero(raw):
    """Precio sucio ('$ 45.000', '38000,00') → float, o None si no se puede."""
    valor, estado, _ = clean_price(raw)
    if estado not in ("ok", "cleaned"):
        return None
    try:
        return float(str(valor).replace(",", "."))
    except (TypeError, ValueError):
        return None


def aplicar_multiplicador(raw, mult):
    """Devuelve el precio ya multiplicado, redondeado a entero (el peso
    colombiano no usa centavos). Si no hay nada que hacer, devuelve `raw` tal
    cual para no alterar el valor original ni su formato."""
    if raw in (None, ""):
        return raw
    try:
        m = float(mult)
    except (TypeError, ValueError):
        return raw
    if m == 1.0:
        return raw
    numero = a_numero(raw)
    if numero is None:
        return raw          # no se pudo leer: que lo reporte el Lavadero
    return str(int(round(numero * m)))
