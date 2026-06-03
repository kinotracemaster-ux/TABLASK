from typing import List, Dict, Any

def process_sync(
    target_data: List[List[str]], 
    source_datasets: Dict[str, List[List[str]]],
    mappings: List[Dict[str, Any]],
    target_key: str
) -> Dict[str, Any]:
    """
    Procesa el cruce de datos en memoria para la Vista Previa.
    
    target_data: Lista de listas, ej: [["ID_Producto", "Nombre"], ["P001", "Laptop"]]
    source_datasets: Dict con datos de origen, ej: {"Productos": [["Código", "Precio"], ["P001", "1000"]]}
    mappings: Lista de diccionarios con el mapeo:
        [
            {"source_table": "Productos", "source_field": "Código", "target_field": "ID_Producto", "is_key": True},
            {"source_table": "Productos", "source_field": "Precio", "target_field": "Costo", "is_key": False}
        ]
    target_key: El nombre de la columna clave en el destino.
    """
    if not target_data:
        return {"preview_data": [], "rows_changed": 0, "rows_added": 0, "errors": 0}
        
    target_headers = target_data[0]
    try:
        target_key_idx = target_headers.index(target_key)
    except ValueError:
        return {"error": f"Columna clave '{target_key}' no encontrada en el destino."}

    # Convertir target_data en lista de diccionarios para manipulación más fácil
    target_records = []
    for row in target_data[1:]:
        # Asegurar que la fila tenga la misma longitud que los headers
        row_dict = {target_headers[i]: (row[i] if i < len(row) else "") for i in range(len(target_headers))}
        target_records.append(row_dict)

    rows_changed_count = 0
    rows_added_count = 0
    
    # Índices de las tablas origen
    source_indices = {}
    for source_name, data in source_datasets.items():
        if not data: continue
        headers = data[0]
        records = []
        for row in data[1:]:
            r_dict = {headers[i]: (row[i] if i < len(row) else "") for i in range(len(headers))}
            records.append(r_dict)
        source_indices[source_name] = records

    # Cruce de datos
    for record in target_records:
        key_val = record.get(target_key)
        if not key_val: continue
        
        changed = False
        # Buscar en cada tabla de origen
        for mapping in mappings:
            if mapping['is_key']: continue # Ya sabemos cuál es la clave
            src_table = mapping['source_table']
            src_field = mapping['source_field']
            tgt_field = mapping['target_field']
            
            # Encontrar el source key para esta tabla
            src_key_mapping = next((m for m in mappings if m['source_table'] == src_table and m['is_key']), None)
            if not src_key_mapping: continue
            
            src_key_field = src_key_mapping['source_field']
            
            # Buscar el registro en src_table que coincida con key_val
            src_records = source_indices.get(src_table, [])
            match = next((r for r in src_records if r.get(src_key_field) == key_val), None)
            
            if match and src_field in match:
                new_val = match[src_field]
                if record.get(tgt_field) != new_val:
                    record[tgt_field] = new_val
                    changed = True
                    
        if changed:
            rows_changed_count += 1
            
    # Volver a formato de lista de listas
    preview_data = [target_headers]
    for record in target_records:
        row = [record.get(h, "") for h in target_headers]
        preview_data.append(row)
        
    return {
        "preview_data": preview_data,
        "rows_changed": rows_changed_count,
        "rows_added": rows_added_count, # Simplified for MVP
        "errors": 0
    }
