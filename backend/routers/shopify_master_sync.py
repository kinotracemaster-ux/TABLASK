from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
import json
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/shopify-master-sync", tags=["shopify-master-sync"])


def _get_or_create_config(db: Session) -> models.ShopifyMasterSyncConfig:
    config = db.query(models.ShopifyMasterSyncConfig).first()
    if not config:
        config = models.ShopifyMasterSyncConfig()
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


@router.get("/config", response_model=schemas.ShopifyMasterSyncConfigOut)
def get_config(db: Session = Depends(get_db)):
    return _get_or_create_config(db)


@router.put("/config", response_model=schemas.ShopifyMasterSyncConfigOut)
def update_config(payload: schemas.ShopifyMasterSyncConfigUpdate, db: Session = Depends(get_db)):
    conn = db.query(models.Connection).filter(models.Connection.id == payload.connection_id).first()
    if not conn or conn.connection_type != "shopify":
        raise HTTPException(status_code=400, detail="La conexión indicada no es de tipo Shopify.")
    if not payload.price_column_master and not payload.stock_column_master:
        raise HTTPException(status_code=400, detail="Mapeá al menos Precio o Stock.")

    config = _get_or_create_config(db)
    config.connection_id = payload.connection_id
    config.sku_column_master = payload.sku_column_master
    config.price_column_master = payload.price_column_master
    config.stock_column_master = payload.stock_column_master
    db.commit()
    db.refresh(config)
    return config


def _run_diff(db: Session):
    """Compara precio/stock de Shopify contra la Maestra por SKU. Solo ACTUALIZA
    filas que ya existen en la Maestra (no crea productos nuevos: para eso ya
    está el flujo de 'Nueva Fuente')."""
    from ..services import _create_connector, get_sheet_data, normalize_sku_for_match, _get_master_info

    config = _get_or_create_config(db)
    if not config.connection_id or not config.sku_column_master:
        raise HTTPException(status_code=400, detail="Configurá primero la tienda Shopify y la columna SKU de la Maestra.")
    if not config.price_column_master and not config.stock_column_master:
        raise HTTPException(status_code=400, detail="Configurá al menos la columna de Precio o Stock de la Maestra.")

    shop_conn = db.query(models.Connection).filter(models.Connection.id == config.connection_id).first()
    if not shop_conn:
        raise HTTPException(status_code=400, detail="La conexión Shopify configurada ya no existe.")

    project, master_conn, master_sheet = _get_master_info(db)
    if not master_conn:
        raise HTTPException(status_code=400, detail="No hay una Tabla Maestra enlazada todavía.")

    connector = _create_connector(shop_conn)
    try:
        shopify_rows = connector.fetch_data("Products")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error leyendo Shopify: {str(e)[:300]}")

    shop_by_norm = {}
    for r in shopify_rows:
        norm = normalize_sku_for_match(r.get("sku", ""))
        if norm and norm not in shop_by_norm:
            shop_by_norm[norm] = r

    master_raw = get_sheet_data(master_conn, f"{master_sheet}!A1:Z")
    if not master_raw or len(master_raw) < 2:
        raise HTTPException(status_code=400, detail="La Tabla Maestra está vacía.")

    headers = master_raw[0]
    if config.sku_column_master not in headers:
        raise HTTPException(status_code=400, detail=f"Columna SKU '{config.sku_column_master}' no encontrada en la Maestra.")
    sku_idx = headers.index(config.sku_column_master)
    price_idx = headers.index(config.price_column_master) if config.price_column_master and config.price_column_master in headers else None
    stock_idx = headers.index(config.stock_column_master) if config.stock_column_master and config.stock_column_master in headers else None

    changes = []
    updated_skus = set()
    unchanged = 0
    not_found = []

    for i, row in enumerate(master_raw[1:]):
        sku_val = (row[sku_idx] if sku_idx < len(row) else "").strip()
        if not sku_val:
            continue
        shop_row = shop_by_norm.get(normalize_sku_for_match(sku_val))
        if not shop_row:
            not_found.append(sku_val)
            continue

        if price_idx is not None:
            new_price = str(shop_row.get("price") or "").strip()
            old_price = (row[price_idx] if price_idx < len(row) else "").strip()
            if new_price and new_price != old_price:
                changes.append({"field": config.price_column_master, "new": new_price, "row_index": i + 1,
                                 "sku": sku_val, "old": old_price})
                updated_skus.add(sku_val)

        if stock_idx is not None:
            raw_stock = shop_row.get("inventory_quantity")
            new_stock = "" if raw_stock is None else str(raw_stock)
            old_stock = (row[stock_idx] if stock_idx < len(row) else "").strip()
            if new_stock != "" and new_stock != old_stock:
                changes.append({"field": config.stock_column_master, "new": new_stock, "row_index": i + 1,
                                 "sku": sku_val, "old": old_stock})
                updated_skus.add(sku_val)

        if sku_val not in updated_skus:
            unchanged += 1

    return {
        "config": config,
        "master_conn": master_conn,
        "master_sheet": master_sheet,
        "headers": headers,
        "changes": changes,
        "total_master": len(master_raw) - 1,
        "updated": len(updated_skus),
        "unchanged": unchanged,
        "not_found_count": len(not_found),
        "not_found": not_found[:50],
        "store": shop_conn.name,
    }


@router.post("/preview")
def preview(db: Session = Depends(get_db)):
    """Solo calcula el diff, no escribe nada en la Maestra."""
    result = _run_diff(db)
    return {
        "updated": result["updated"],
        "unchanged": result["unchanged"],
        "not_found_count": result["not_found_count"],
        "not_found": result["not_found"],
        "total_master": result["total_master"],
        "store": result["store"],
        "sample_changes": result["changes"][:30],
    }


@router.post("/apply")
def apply(db: Session = Depends(get_db)):
    """Recalcula el diff y escribe quirúrgicamente los cambios en la Maestra."""
    from ..services import write_sheet_data_surgical

    result = _run_diff(db)
    if result["changes"]:
        write_sheet_data_surgical(
            result["master_conn"].spreadsheet_id, result["master_sheet"],
            result["headers"], result["changes"], [], result["total_master"]
        )

    summary = {
        "updated": result["updated"],
        "unchanged": result["unchanged"],
        "not_found_count": result["not_found_count"],
        "store": result["store"],
    }
    config = result["config"]
    config.last_synced_at = datetime.utcnow()
    config.last_sync_summary = json.dumps(summary, ensure_ascii=False)
    db.commit()

    from .logs import log_event
    log_event(
        db=db,
        event_type="SHOPIFY_MASTER_SYNC",
        status="success" if result["not_found_count"] == 0 else "warning",
        message=(f"Sync Shopify → Maestra ({result['store']}): "
                  f"{result['updated']} SKU actualizados, {result['not_found_count']} sin cruzar."),
        rows_affected=result["updated"],
    )
    return summary
