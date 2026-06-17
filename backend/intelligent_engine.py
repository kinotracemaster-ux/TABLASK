import math
from typing import List, Dict, Any, Tuple

# ═══════════════════════════════════════════════════════════════════
# PILAR 1: DETECCIÓN INTELIGENTE DE LLAVES (SKU)
# ═══════════════════════════════════════════════════════════════════

# Patrones conocidos para detectar llaves
KEY_PATTERNS = [
    "sku", "id", "codigo", "code", "ref", "referencia", "item",
    "product_id", "productid", "barcode", "upc", "ean"
]

def analyze_column_for_key(header: str, values: List[str]) -> Dict[str, Any]:
    """
    Analiza una columna para determinar qué tan probable es que sea una llave principal (SKU).
    Retorna un diccionario con el score de confianza y razones.
    """
    total_rows = len(values)
    if total_rows == 0:
        return {"columna": header, "confianza": 0, "razon": "Columna vacía"}

    # Limpiar valores vacíos
    non_empty_values = [v for v in values if v and str(v).strip()]
    empty_count = total_rows - len(non_empty_values)
    
    if len(non_empty_values) == 0:
         return {"columna": header, "confianza": 0, "razon": "Columna vacía"}

    # Unicidad
    unique_values = set(non_empty_values)
    uniqueness_ratio = len(unique_values) / len(non_empty_values)
    
    # Vacíos
    empty_ratio = empty_count / total_rows

    score = 0
    reasons = []

    # 1. Porcentaje de unicidad (Puntaje base pesado)
    if uniqueness_ratio > 0.99:
        score += 50
        reasons.append("100% únicos")
    elif uniqueness_ratio > 0.95:
        score += 30
        reasons.append(">95% únicos")
    else:
        # Una llave no debería tener muchos duplicados
        score -= 50
        reasons.append(f"Solo {int(uniqueness_ratio*100)}% únicos")

    # 2. Porcentaje de vacíos
    if empty_ratio == 0:
        score += 20
        reasons.append("0% vacíos")
    elif empty_ratio < 0.05:
        score += 10
        reasons.append("Pocos vacíos")
    else:
        score -= 30
        reasons.append("Demasiados vacíos")

    # 3. Coincidencia de nombre (Patrones semánticos)
    header_lower = header.lower().strip()
    is_pattern_match = False
    for pat in KEY_PATTERNS:
        if pat in header_lower:
            is_pattern_match = True
            break
            
    if is_pattern_match:
        score += 30
        reasons.append("Nombre reconocido")

    # Limitar score entre 0 y 100
    confianza = max(0, min(100, score))

    return {
        "columna": header,
        "confianza": confianza,
        "razon": " + ".join(reasons) if reasons else "Sin indicios claros"
    }

def detect_potential_keys(headers: List[str], data_rows: List[List[str]]) -> List[Dict[str, Any]]:
    """
    Analiza todas las columnas de un dataset y devuelve una lista ordenada por probabilidad de ser llave.
    """
    if not headers or not data_rows:
        return []

    results = []
    for col_idx, header in enumerate(headers):
        # Extraer valores de esta columna
        col_values = []
        for row in data_rows:
            if col_idx < len(row):
                col_values.append(row[col_idx])
            else:
                col_values.append("")
                
        analysis = analyze_column_for_key(header, col_values)
        results.append(analysis)

    # Ordenar por confianza descendente
    results.sort(key=lambda x: x["confianza"], reverse=True)
    return results


# ═══════════════════════════════════════════════════════════════════
# PILAR 2: MAPEO SEMÁNTICO DE COLUMNAS
# ═══════════════════════════════════════════════════════════════════

SEMANTIC_GROUPS = {
    "descripcion": ["descripcion", "descripción", "description", "body", "body_html", "desc", "detalle", "detail", "texto", "text", "contenido", "content"],
    "precio": ["precio", "price", "costo", "cost", "valor", "value", "precio_venta", "sale_price", "pvp", "price_retail"],
    "stock": ["stock", "inventory", "inventario", "cantidad", "quantity", "qty", "disponible", "available", "existencias", "units"],
    "nombre": ["nombre", "name", "titulo", "título", "title", "producto", "product", "descripcion_corta", "short_description"],
    "imagen": ["imagen", "image", "foto", "photo", "img", "picture", "image_url", "imagen_url", "src"],
    "categoria": ["categoria", "categoría", "category", "tipo", "type", "departamento", "department", "familia", "family"]
}

def get_semantic_group(column_name: str) -> str:
    """Retorna el nombre del grupo semántico al que pertenece una columna, o None si no hay coincidencia."""
    name_lower = column_name.lower().strip()
    for group_name, synonyms in SEMANTIC_GROUPS.items():
        if name_lower in synonyms:
            return group_name
    return None

def auto_map_columns(source_headers: List[str], target_headers: List[str]) -> List[Dict[str, Any]]:
    """
    Intenta mapear columnas de origen a destino usando matching exacto y semántico.
    Devuelve una lista de sugerencias.
    """
    mappings = []
    
    # Crear un índice de los grupos semánticos de las columnas destino
    target_semantic_map = {}
    for tgt_head in target_headers:
        group = get_semantic_group(tgt_head)
        if group:
            if group not in target_semantic_map:
                target_semantic_map[group] = []
            target_semantic_map[group].append(tgt_head)

    for src_head in source_headers:
        # 1. Matching Exacto (Case Insensitive)
        exact_match = next((t for t in target_headers if t.lower() == src_head.lower()), None)
        if exact_match:
            mappings.append({
                "source_field": src_head,
                "target_field": exact_match,
                "confidence": "exact",
                "reason": "Nombre exacto"
            })
            continue
            
        # 2. Matching Semántico
        group = get_semantic_group(src_head)
        if group and group in target_semantic_map:
            # Sugerimos el primer target de este grupo semántico
            suggested_tgt = target_semantic_map[group][0]
            mappings.append({
                "source_field": src_head,
                "target_field": suggested_tgt,
                "confidence": "semantic",
                "reason": f"Sugerencia semántica ({group})"
            })
            continue

        # 3. Sin match claro
        mappings.append({
            "source_field": src_head,
            "target_field": "",
            "confidence": "none",
            "reason": "Sin coincidencias"
        })

    return mappings
