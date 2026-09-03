"""Pruebas de backend/intelligent_engine.py: auto-mapeo de columnas
origen->Maestra. Fija dos reglas de negocio:
- Headers con ruido tipográfico real (mayúsculas, espacios, "*"/":" de
  "obligatorio" pegado al final) deben matchear igual que su forma limpia.
- Si un campo del origen podría ir a MÁS de una columna de la Maestra (dos
  columnas destino son sinónimos del mismo grupo semántico), el sistema NO
  elige una a ciegas: reporta "ambiguous" con las candidatas, para que lo
  resuelva el usuario.
"""
from backend.intelligent_engine import auto_map_columns


def _by_source(mappings, source_field):
    return next(m for m in mappings if m["source_field"] == source_field)


def test_exact_match_case_insensitive():
    mappings = auto_map_columns(["SKU"], ["sku"])
    m = _by_source(mappings, "SKU")
    assert m["confidence"] == "exact"
    assert m["target_field"] == "sku"


def test_exact_match_ignores_trailing_asterisk_and_spaces():
    # Header real de un archivo BASE-SYS: "Precio*" marca el campo como
    # obligatorio -- antes de esto no matcheaba con "Precio" ni por exacto
    # ni por semántico.
    mappings = auto_map_columns(["Precio*"], ["Precio"])
    m = _by_source(mappings, "Precio*")
    assert m["confidence"] == "exact"
    assert m["target_field"] == "Precio"


def test_semantic_match_single_candidate():
    mappings = auto_map_columns(["price"], ["Precio Venta"])
    # "Precio Venta" no es un sinónimo exacto de ningún grupo -> no matchea
    # (caso esperado, no hay candidato semántico real acá).
    m = _by_source(mappings, "price")
    assert m["confidence"] == "none"


def test_semantic_match_when_target_uses_a_known_synonym():
    mappings = auto_map_columns(["price"], ["Costo"])
    m = _by_source(mappings, "price")
    assert m["confidence"] == "semantic"
    assert m["target_field"] == "Costo"


def test_ambiguous_when_two_targets_share_semantic_group():
    # La Maestra tiene "Precio" y "Costo": ambos son sinónimos del grupo
    # "precio" -- antes se elegía "Precio" (el primero) en silencio.
    mappings = auto_map_columns(["price"], ["Precio", "Costo"])
    m = _by_source(mappings, "price")
    assert m["confidence"] == "ambiguous"
    assert m["target_field"] == ""
    assert set(m["candidates"]) == {"Precio", "Costo"}


def test_ambiguous_field_is_excluded_from_flattened_mapping_dict():
    from backend.routers.intelligence import api_auto_map_columns
    result = api_auto_map_columns(["price", "sku"], ["Precio", "Costo", "SKU"])
    assert "price" not in result["mapping"]
    assert result["mapping"]["sku"] == "SKU"
    ambiguous = _by_source(result["mappings"], "price")
    assert ambiguous["confidence"] == "ambiguous"
