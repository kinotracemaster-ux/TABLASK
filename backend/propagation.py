import json
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from .models import FieldSubscription, Connection
from .services import get_sheet_data, write_sheet_data_surgical

def propagate_changes(db: Session, project_id: int, changes: List[Dict[str, Any]], new_rows: List[Dict[str, Any]]):
    """
    Función para ejecutarse en background (BackgroundTasks).
    Revisa si algún campo cambiado o nueva fila afecta a alguna suscripción activa,
    y propaga los cambios a las hojas hijas.
    """
    if not changes and not new_rows:
        return

    # Extraer qué campos (columnas de la maestra) fueron modificados
    modified_fields = set()
    for ch in changes:
        modified_fields.add(ch["field"])
    for nr in new_rows:
        modified_fields.update(nr["fields"].keys())

    # Buscar suscripciones activas
    subscriptions = db.query(FieldSubscription).filter(
        FieldSubscription.project_id == project_id,
        FieldSubscription.is_active == True
    ).all()

    for sub in subscriptions:
        try:
            mappings = json.loads(sub.field_mappings) if isinstance(sub.field_mappings, str) else sub.field_mappings
            # mappings es {"columna_maestra": "columna_hija"}
            
            # 1. ¿Le afecta este diff a esta hija?
            intersecting_fields = modified_fields.intersection(mappings.keys())
            if not intersecting_fields:
                continue # A esta hija no le importa ningún campo que cambió
                
            # 2. Leer hoja hija
            target_conn = db.query(Connection).filter(Connection.id == sub.target_connection_id).first()
            if not target_conn:
                continue
                
            target_raw = get_sheet_data(target_conn, f"{sub.target_sheet_name}!A1:Z")
            if not target_raw:
                # Si la hoja está vacía, iniciamos con cabeceras
                target_headers = [sub.sku_column_target] + list(set(mappings.values()))
                target_raw = [target_headers]
            else:
                target_headers = target_raw[0]

            # Asegurar que todas las columnas mapeadas existan en destino
            for tgt_col in mappings.values():
                if tgt_col not in target_headers:
                    target_headers.append(tgt_col)
            target_raw[0] = target_headers
            
            if sub.sku_column_target not in target_headers:
                # Si no tiene la llave principal, no podemos propagar
                continue
                
            target_sku_idx = target_headers.index(sub.sku_column_target)
            
            # Indexar hija
            target_by_sku = {}
            for i, row in enumerate(target_raw[1:]):
                sku_val = row[target_sku_idx] if target_sku_idx < len(row) else ""
                if sku_val:
                    padded_row = row + [""] * (len(target_headers) - len(row))
                    target_by_sku[sku_val] = {"index": i + 1, "data": padded_row}

            # 3. Filtrar diffs para esta hija
            sub_changes = []
            sub_new_rows = []
            
            # Aplicar cambios a SKUs existentes en la hija
            for change in changes:
                master_field = change["field"]
                if master_field in mappings:
                    sku = change["sku"]
                    if sku in target_by_sku:
                        tgt_field = mappings[master_field]
                        old_tgt_val = target_by_sku[sku]["data"][target_headers.index(tgt_field)]
                        new_val = change["new"]
                        
                        if old_tgt_val != new_val:
                            sub_changes.append({
                                "sku": sku,
                                "field": tgt_field,
                                "old": old_tgt_val,
                                "new": new_val,
                                "row_index": target_by_sku[sku]["index"]
                            })
                            
            # Propagar nuevas filas si la hija acepta adiciones (por defecto sí)
            for new_row in new_rows:
                # Solo extraemos los campos que la hija está suscrita
                sub_row_fields = {}
                for master_field, val in new_row["fields"].items():
                    if master_field in mappings:
                        sub_row_fields[mappings[master_field]] = val
                
                if sub_row_fields: # Si tiene algún campo relevante
                    sub_new_rows.append({
                        "sku": new_row["sku"],
                        "fields": sub_row_fields
                    })

            # 4. Escribir cambios quirúrgicamente en la hija
            if sub_changes or sub_new_rows:
                total_rows_before = len(target_raw) - 1 # Original data rows before adding
                write_sheet_data_surgical(
                    target_conn.spreadsheet_id, 
                    sub.target_sheet_name, 
                    target_headers, 
                    sub_changes, 
                    sub_new_rows, 
                    total_rows_before
                )
                
                # Opcional: Registrar en un log el éxito
                print(f"Propagado exitosamente a suscripción {sub.name}: {len(sub_changes)} cambios, {len(sub_new_rows)} nuevas filas")

        except Exception as e:
            print(f"Error propagando a suscripción {sub.name}: {str(e)}")
            # Log_event podría llamarse aquí también
