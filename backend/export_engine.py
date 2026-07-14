"""Motor de transformaciones de export (MEJORAS_TABLASK §11).

Un export ya no solo renombra columnas: cada columna de SALIDA se define con
una transformación sobre las columnas de la Maestra. Las 4 transformaciones
que pide el MD, más const y template:

  field    → valor directo de una columna         {"type":"field","source":"name"}
  concat   → unir columnas con separador           {"type":"concat","sources":["sku","name"],"sep":" "}
  slug     → slug web desde columna(s)             {"type":"slug","sources":["name"]}
  price    → precio base × multiplicador           {"type":"price","source":"price","multiplier":2}
  const    → valor fijo                            {"type":"const","value":"TRUE"}
  template → plantilla con {columna}               {"type":"template","template":"<p>{name}</p>"}

Un transform_spec es una lista ORDENADA de columnas de salida:
  [{"output":"Handle","type":"slug","sources":["name"]}, ...]

Módulo puro (sin DB ni red) para fijarlo con tests.
"""
import re
import unicodedata
from typing import List, Dict, Any


def slugify(text: str) -> str:
    """"Reloj KARDOO Café" -> "reloj-kardoo-cafe". Sin acentos, minúsculas,
    guiones; colapsa separadores y recorta guiones de los bordes."""
    text = str(text or "")
    # Quitar acentos (café -> cafe)
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def _to_number(raw) -> float:
    """Extrae un número de un valor sucio ('$ 45.000' -> 45000.0). Reusa la
    lógica del lavadero para respetar los formatos reales de Kino; si no hay
    número interpretable, devuelve None."""
    from .lavadero import clean_price
    value, status, _ = clean_price(raw)
    if status in ("empty", "rejected"):
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def _fmt_number(num: float) -> str:
    """45000.0 -> '45000'; 45.5 -> '45.5'."""
    if num == int(num):
        return str(int(num))
    return f"{num}".rstrip("0").rstrip(".")


def apply_price(raw, multiplier: float) -> str:
    """Precio base × multiplicador (base ×2 global de Kino, o el del canal).
    Si el valor base no es interpretable, devuelve '' (no inventa precios)."""
    num = _to_number(raw)
    if num is None:
        return ""
    return _fmt_number(num * float(multiplier))


def _apply_column(row: Dict[str, str], col: Dict[str, Any]) -> str:
    ctype = col.get("type", "field")

    if ctype == "const":
        return str(col.get("value", ""))

    if ctype == "field":
        return str(row.get(col.get("source", ""), "") or "")

    if ctype == "concat":
        sep = col.get("sep", " ")
        parts = [str(row.get(s, "") or "").strip() for s in col.get("sources", [])]
        return sep.join(p for p in parts if p)

    if ctype == "slug":
        sep = col.get("sep", " ")
        parts = [str(row.get(s, "") or "").strip() for s in col.get("sources", [])]
        return slugify(sep.join(p for p in parts if p))

    if ctype == "price":
        return apply_price(row.get(col.get("source", ""), ""), col.get("multiplier", 1))

    if ctype == "template":
        tmpl = col.get("template", "")
        # Reemplazo simple de {columna} por su valor (vacío si no existe).
        def _sub(m):
            return str(row.get(m.group(1), "") or "")
        return re.sub(r"\{([^{}]+)\}", _sub, tmpl)

    # Tipo desconocido: no romper, columna vacía.
    return ""


def transform_headers(spec: List[Dict[str, Any]]) -> List[str]:
    return [col.get("output", "") for col in spec]


def transform_row(row: Dict[str, str], spec: List[Dict[str, Any]]) -> List[str]:
    """Aplica el spec a una fila de la Maestra (dict columna->valor) y devuelve
    la fila de salida como lista, en el orden del spec."""
    return [_apply_column(row, col) for col in spec]


def source_columns(spec: List[Dict[str, Any]]) -> List[str]:
    """Columnas de la Maestra que el spec necesita (para validar/remapear en UI)."""
    cols = set()
    for col in spec:
        if col.get("source"):
            cols.add(col["source"])
        for s in col.get("sources", []) or []:
            cols.add(s)
        # columnas referenciadas dentro de un template: {columna}
        if col.get("type") == "template":
            for m in re.findall(r"\{([^{}]+)\}", col.get("template", "")):
                cols.add(m)
    return sorted(cols)
