"""El "Lavadero" (MEJORAS_TABLASK §3): normalización y validación por campo
en el INTAKE, antes del staging.

Principio: lo que no se puede limpiar NO se escribe sucio — se retiene y se
reporta con motivo visible en la vista previa. Los valores que sí se pueden
limpiar entran ya normalizados (ej. "$ 45.000" → "45000").

Cada limpieza devuelve una tupla (valor, status, motivo):
  - "ok"       → el valor ya estaba limpio, se usa tal cual.
  - "cleaned"  → se limpió automáticamente; se usa el valor limpio.
  - "empty"    → viene vacío: en updates NO se pisa el valor existente de la
                 Maestra (nunca borrar núcleo con vacíos); en filas nuevas
                 queda vacío sin más.
  - "rejected" → no se pudo interpretar ("5 unid", texto en precio…):
                 NO se escribe; se reporta {sku, campo, valor, motivo}.
  - "review"   → interpretable pero sospechoso (precio 0, stock negativo):
                 NO se escribe solo; se reporta para revisar.

Este módulo es puro (sin DB ni red) para poder fijar las reglas con tests.
"""
import re
from typing import Dict, Optional, Tuple

from .intelligent_engine import get_semantic_group

Washed = Tuple[str, str, Optional[str]]  # (valor, status, motivo)


# ─────────────────────────────────────────────────────────────── clasificación
def classify_columns(field_mappings: Dict[str, str]) -> Dict[str, Optional[str]]:
    """{columna_maestra: tipo} para las columnas del núcleo mapeadas.
    El tipo sale del diccionario semántico (intelligent_engine), probando el
    nombre de la columna en la Maestra y, si no, el del origen.
    Tipos: 'precio' | 'stock' | 'nombre' | None (sin limpieza especial)."""
    kinds: Dict[str, Optional[str]] = {}
    for src_col, dst_col in field_mappings.items():
        kind = get_semantic_group(dst_col) or get_semantic_group(src_col)
        if kind not in ("precio", "stock", "nombre"):
            kind = None
        kinds[dst_col] = kind
    return kinds


# ─────────────────────────────────────────────────────────────────── limpiezas
def _format_number(num: float) -> str:
    """45000.0 → '45000'; 45.5 → '45.5' (decimal con punto, sin ceros colgantes)."""
    if num == int(num):
        return str(int(num))
    return f"{num}".rstrip("0").rstrip(".")


def clean_price(raw) -> Washed:
    """Precio: quitar símbolos de moneda, espacios y separadores de miles.
    Maneja los formatos reales de las fuentes de Kino:
      "$ 45.000" → 45000 (punto de miles)  ·  "38000,00" → 38000 (coma decimal)
      "45,000.50" → 45000.5  ·  "45.000,50" → 45000.5
    Regla de desambiguación con UN solo separador: 3 dígitos después = miles;
    1-2 dígitos después = decimal.
    Sanidad: precio 0 o negativo → 'review' (no pasa solo)."""
    s = str(raw if raw is not None else "").strip()
    if s == "":
        return "", "empty", None
    original = s

    # Quitar todo lo que no sea dígito, separador o signo ("$", "COP", espacios…)
    cleaned = re.sub(r"[^\d.,\-]", "", s)
    if not re.search(r"\d", cleaned):
        return original, "rejected", "no contiene un número"

    negative = cleaned.startswith("-")
    if negative:
        cleaned = cleaned[1:]
    if "-" in cleaned:
        return original, "rejected", "formato de precio no interpretable (varios signos)"

    if "." in cleaned and "," in cleaned:
        # El separador de más a la derecha es el decimal; el otro, miles.
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif "," in cleaned:
        parts = cleaned.split(",")
        if len(parts) == 2 and len(parts[1]) != 3:
            cleaned = cleaned.replace(",", ".")   # decimal: "38000,00", "45,5"
        else:
            cleaned = cleaned.replace(",", "")    # miles: "45,000", "1,234,567"
    elif "." in cleaned:
        parts = cleaned.split(".")
        if len(parts) == 2 and len(parts[1]) != 3:
            pass                                   # decimal real: "45.5", "45.50"
        else:
            cleaned = cleaned.replace(".", "")    # miles: "45.000", "1.234.567"

    try:
        num = float(cleaned)
    except ValueError:
        return original, "rejected", "no se pudo interpretar como precio"

    if negative:
        return original, "review", "precio negativo"

    value = _format_number(num)
    if num == 0:
        return value, "review", "precio en 0"

    status = "ok" if value == original else "cleaned"
    return value, status, None


def clean_stock(raw) -> Washed:
    """Stock: forzar entero. Se aceptan los decimales-cero de Sheets ("5.0",
    "5,00" → 5). Texto ("5 unid"), fracciones reales ("5.5") → rechazado.
    Sanidad: stock negativo → 'review' (no pasa solo). Stock 0 es válido (agotado)."""
    s = str(raw if raw is not None else "").strip()
    if s == "":
        return "", "empty", None
    original = s

    if re.search(r"[^\d.,\-\s]", s):
        return original, "rejected", "el stock contiene texto"
    compact = s.replace(" ", "")

    negative = compact.startswith("-")
    if negative:
        compact = compact[1:]
    if "-" in compact or not re.search(r"\d", compact):
        return original, "rejected", "no es un número entero"

    # Separador decimal solo si lo que sigue son puros ceros ("5.0", "5,00").
    m = re.fullmatch(r"(\d+)(?:[.,](0+))?", compact)
    if not m:
        # ¿Es fracción real ("5.5") o formato raro ("1.2.3")?
        if re.fullmatch(r"\d+[.,]\d+", compact):
            return original, "rejected", "el stock tiene decimales (debe ser entero)"
        return original, "rejected", "no es un número entero"

    num = int(m.group(1))
    if negative:
        return f"-{num}", "review", "stock negativo"

    value = str(num)
    status = "ok" if value == original else "cleaned"
    return value, status, None


def clean_name(raw) -> Washed:
    """Nombre: colapsar espacios múltiples y recortar bordes. No se fuerza
    capitalización (las marcas como KARDOO van en mayúsculas a propósito)."""
    s = str(raw if raw is not None else "")
    if s.strip() == "":
        return "", "empty", None
    value = re.sub(r"\s+", " ", s).strip()
    status = "ok" if value == s else "cleaned"
    return value, status, None


_CLEANERS = {"precio": clean_price, "stock": clean_stock, "nombre": clean_name}


def wash_value(kind: Optional[str], raw) -> Washed:
    """Aplica la limpieza según el tipo de columna. Sin tipo conocido → pasa tal cual
    (el enriquecimiento y columnas no clasificadas no se tocan)."""
    cleaner = _CLEANERS.get(kind)
    if cleaner is None:
        s = str(raw if raw is not None else "")
        return s, ("empty" if s.strip() == "" else "ok"), None
    return cleaner(raw)


# ───────────────────────────────────────────────────────────────── reporte
class WashReport:
    """Acumula lo que hizo el lavadero en una corrida, con topes para que el
    JSON del staging no explote con miles de ítems."""
    MAX_ITEMS = 200

    def __init__(self):
        self.cleaned_count = 0
        self.rejected = []
        self.review = []
        self.empties_skipped = 0  # vacíos que NO pisaron valores existentes

    def add_cleaned(self):
        self.cleaned_count += 1

    def add_rejected(self, sku, field, value, reason):
        if len(self.rejected) < self.MAX_ITEMS:
            self.rejected.append({"sku": sku, "field": field, "value": str(value), "reason": reason})
        self._rejected_total = getattr(self, "_rejected_total", 0) + 1

    def add_review(self, sku, field, value, reason):
        if len(self.review) < self.MAX_ITEMS:
            self.review.append({"sku": sku, "field": field, "value": str(value), "reason": reason})
        self._review_total = getattr(self, "_review_total", 0) + 1

    def add_empty_skipped(self):
        self.empties_skipped += 1

    def to_dict(self) -> dict:
        return {
            "cleaned_count": self.cleaned_count,
            "rejected_count": getattr(self, "_rejected_total", 0),
            "review_count": getattr(self, "_review_total", 0),
            "empties_skipped": self.empties_skipped,
            "rejected": self.rejected,
            "review": self.review,
        }
