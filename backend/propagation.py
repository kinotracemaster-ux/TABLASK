import json
from datetime import datetime
from typing import List, Dict, Any
from .models import FieldSubscription, Connection, ShopifySubscription
from .services import get_sheet_data, write_sheet_data_surgical
from .database import SessionLocal

def propagate_changes(project_id: int, changes: List[Dict[str, Any]], new_rows: List[Dict[str, Any]]):
    """
    Función para ejecutarse en background (BackgroundTasks).
    Revisa si algún campo cambiado o nueva fila afecta a alguna suscripción activa,
    y propaga los cambios a las hojas hijas. Después empuja precio/stock de los
    SKUs afectados a las suscripciones Shopify activas (fase B).

    IMPORTANTE: abre su propia sesión de DB. La sesión del request que originó
    la tarea ya está cerrada cuando esto corre, por lo que no debe reutilizarse.
    """
    if not changes and not new_rows:
        return

    db = SessionLocal()
    try:
        _propagate_changes(db, project_id, changes, new_rows)
        _push_shopify_subscriptions(db, changes, new_rows)
    finally:
        db.close()


def _propagate_changes(db, project_id: int, changes: List[Dict[str, Any]], new_rows: List[Dict[str, Any]]):

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


# ═══════════════════════════════════════════════════════════════════
# ██ Maestra → Shopify (fase B): empujar el diff a las tiendas suscritas
# ═══════════════════════════════════════════════════════════════════

def build_shopify_updates(changes: List[Dict[str, Any]], new_rows: List[Dict[str, Any]],
                          price_col: str, stock_col: str) -> List[Dict[str, Any]]:
    """
    Convierte el diff de la Maestra en updates por SKU para Shopify:
    [{"sku": ..., "price"?: ..., "stock"?: ...}].

    Solo entran los SKUs cuyo precio/stock cambió en ESTA corrida (escritura
    quirúrgica también hacia afuera: no se re-empujan los 3.000 productos).
    Las filas nuevas de la Maestra se incluyen por si ya existen en la tienda;
    si no cruzan, push_updates las reporta como not_found y NUNCA las crea.
    """
    by_sku: Dict[str, Dict[str, Any]] = {}

    def entry(sku):
        return by_sku.setdefault(sku, {"sku": sku})

    for ch in changes:
        if price_col and ch.get("field") == price_col:
            entry(ch["sku"])["price"] = ch.get("new")
        if stock_col and ch.get("field") == stock_col:
            entry(ch["sku"])["stock"] = ch.get("new")

    for nr in new_rows:
        fields = nr.get("fields", {}) or {}
        if price_col and str(fields.get(price_col, "") or "").strip() != "":
            entry(nr["sku"])["price"] = fields[price_col]
        if stock_col and str(fields.get(stock_col, "") or "").strip() != "":
            entry(nr["sku"])["stock"] = fields[stock_col]

    return list(by_sku.values())


def _push_shopify_subscriptions(db, changes: List[Dict[str, Any]], new_rows: List[Dict[str, Any]]):
    """Empuja el diff a cada suscripción Shopify activa. Cada tienda va en su
    propio try/except: un fallo contra Shopify se loggea pero no aborta ni la
    propagación a hojas hijas ni a las demás tiendas."""
    subs = db.query(ShopifySubscription).filter(ShopifySubscription.is_active == True).all()
    if not subs:
        return

    from .routers.logs import log_event

    for sub in subs:
        try:
            updates = build_shopify_updates(changes, new_rows, sub.price_column_master, sub.stock_column_master)
            if not updates:
                continue  # El diff no tocó precio/stock: nada que enviar a esta tienda

            shop_conn = db.query(Connection).filter(Connection.id == sub.connection_id).first()
            if not shop_conn or shop_conn.connection_type != "shopify":
                continue

            from .services import _create_connector
            connector = _create_connector(shop_conn)
            summary = connector.push_updates(
                updates,
                do_price=bool(sub.price_column_master) and any("price" in u for u in updates),
                do_stock=bool(sub.stock_column_master) and any("stock" in u for u in updates),
                dry_run=False,
                location_id=sub.location_id or None,
            )

            sub.last_pushed_at = datetime.utcnow()
            sub.last_push_summary = json.dumps(summary)
            db.commit()

            log_event(
                db=db,
                event_type="SHOPIFY_SUB_PUSH",
                status="success" if not summary.get("errors") else "warning",
                message=(f"Destino Shopify '{sub.name}': {summary['price_updated']} precios, "
                         f"{summary['stock_updated']} stock, {summary['not_found_count']} sin cruzar (no se crean)."),
                rows_affected=summary["price_updated"] + summary["stock_updated"],
            )
        except Exception as e:
            import traceback
            try:
                log_event(
                    db=db,
                    event_type="SHOPIFY_SUB_PUSH",
                    status="error",
                    message=f"Destino Shopify '{sub.name}' falló: {str(e)[:200]}",
                    technical_detail=traceback.format_exc(),
                )
            except Exception:
                print(f"Error empujando a Shopify '{sub.name}': {e}")
