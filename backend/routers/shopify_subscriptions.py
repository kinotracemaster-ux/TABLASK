"""Suscripciones Maestra → Shopify (fase B).

Un destino permanente: cada vez que un sync escribe la Tabla Maestra, la
propagación en background (propagation.py) empuja precio/stock de los SKUs
afectados a la tienda. Este router maneja el CRUD y el envío completo bajo
demanda ("push-now", con dry_run para previsualizar el cruce).

Regla dura (MODO NORMAL, sección 2 de MEJORAS_TABLASK): hacia afuera la
Maestra siempre gana y NUNCA se crean productos en Shopify — solo se
actualizan variantes que cruzan por SKU normalizado.
"""
import json
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/shopify-subscriptions", tags=["shopify-subscriptions"])


def _reject_duplicate_connection(sub: schemas.ShopifySubscriptionCreate, db: Session, exclude_id: int):
    """Al EDITAR un destino, no dejar que quede apuntando a una tienda que ya
    tiene otro destino guardado — se pisarían entre sí en cada sync. Al CREAR
    no hace falta: create_shopify_subscription reusa el existente en vez de
    rechazar (ver ahí)."""
    otra = db.query(models.ShopifySubscription).filter(
        models.ShopifySubscription.connection_id == sub.connection_id,
        models.ShopifySubscription.id != exclude_id,
    ).first()
    if otra:
        raise HTTPException(
            status_code=400,
            detail=f"Esa tienda ya tiene otro destino guardado ('{otra.name}'). Dos destinos para la misma "
                   f"tienda terminan pisándose entre sí en cada sync — usá uno solo por tienda.",
        )


def _validate_payload(sub: schemas.ShopifySubscriptionCreate, db: Session):
    conn = db.query(models.Connection).filter(models.Connection.id == sub.connection_id).first()
    if not conn or conn.connection_type != "shopify":
        raise HTTPException(status_code=400, detail="La conexión indicada no es una tienda Shopify.")
    campos = {
        "precio": sub.price_column_master,
        "stock": sub.stock_column_master,
        "precio comparativo": sub.compare_price_column_master,
        "código de barras": sub.barcode_column_master,
    }
    if not any(campos.values()):
        raise HTTPException(status_code=400, detail="Mapeá al menos un campo de la Maestra (precio, stock, precio comparativo o código de barras).")
    # Guardián: la misma columna de la Maestra no puede alimentar dos campos
    # distintos de Shopify (ej. mandar la columna de precio también como stock
    # escribiría el precio como cantidad de inventario en la tienda).
    usadas: dict = {}
    for campo, columna in campos.items():
        if not columna:
            continue
        if columna in usadas:
            raise HTTPException(
                status_code=400,
                detail=f"La columna '{columna}' está mapeada a '{usadas[columna]}' y a '{campo}' a la vez. "
                       f"Elegí una columna distinta para cada campo (mandar la misma columna como precio y como "
                       f"stock, por ejemplo, escribiría el precio como cantidad de inventario en Shopify).",
            )
        usadas[columna] = campo
    return conn


def _apply_payload(db_sub: models.ShopifySubscription, sub: schemas.ShopifySubscriptionCreate):
    db_sub.name = sub.name
    db_sub.connection_id = sub.connection_id
    db_sub.price_column_master = sub.price_column_master
    db_sub.stock_column_master = sub.stock_column_master
    db_sub.compare_price_column_master = sub.compare_price_column_master
    db_sub.barcode_column_master = sub.barcode_column_master
    db_sub.location_id = sub.location_id
    db_sub.is_active = sub.is_active


@router.post("/", response_model=schemas.ShopifySubscriptionOut)
def create_shopify_subscription(sub: schemas.ShopifySubscriptionCreate, db: Session = Depends(get_db)):
    """Guarda un destino Shopify. Una tienda tiene UN SOLO destino: si ya existe
    una suscripción para esa misma conexión (activa o pausada), se actualiza
    en vez de crear otra — así "Guardar destino" nunca duplica un destino para
    la misma tienda con distintos mapeos, algunos potencialmente peligrosos."""
    _validate_payload(sub, db)
    db_sub = db.query(models.ShopifySubscription).filter(
        models.ShopifySubscription.connection_id == sub.connection_id
    ).first()
    if db_sub:
        _apply_payload(db_sub, sub)
    else:
        db_sub = models.ShopifySubscription(connection_id=sub.connection_id)
        _apply_payload(db_sub, sub)
        db.add(db_sub)
    db.commit()
    db.refresh(db_sub)
    return db_sub


@router.get("/", response_model=List[schemas.ShopifySubscriptionOut])
def list_shopify_subscriptions(db: Session = Depends(get_db)):
    return db.query(models.ShopifySubscription).all()


@router.put("/{sub_id}", response_model=schemas.ShopifySubscriptionOut)
def update_shopify_subscription(sub_id: int, sub: schemas.ShopifySubscriptionCreate, db: Session = Depends(get_db)):
    db_sub = db.query(models.ShopifySubscription).filter(models.ShopifySubscription.id == sub_id).first()
    if not db_sub:
        raise HTTPException(status_code=404, detail="Suscripción Shopify no encontrada")
    _validate_payload(sub, db)
    _reject_duplicate_connection(sub, db, exclude_id=sub_id)
    _apply_payload(db_sub, sub)
    db.commit()
    db.refresh(db_sub)
    return db_sub


@router.delete("/{sub_id}")
def delete_shopify_subscription(sub_id: int, db: Session = Depends(get_db)):
    db_sub = db.query(models.ShopifySubscription).filter(models.ShopifySubscription.id == sub_id).first()
    if not db_sub:
        raise HTTPException(status_code=404, detail="Suscripción Shopify no encontrada")
    db.delete(db_sub)
    db.commit()
    return {"message": "Destino Shopify eliminado"}


# ------------------------------------------------------------------ push-now
def _get_master_context(db: Session):
    """(project, master_conn, master_sheet, sku_column) de la Maestra global."""
    project = db.query(models.Project).filter(models.Project.master_connection_id.isnot(None)).first()
    if not project:
        raise HTTPException(status_code=400, detail="No hay tabla maestra enlazada.")
    master_conn = db.query(models.Connection).filter(
        models.Connection.id == project.master_connection_id
    ).first()
    if not master_conn:
        raise HTTPException(status_code=400, detail="No se encontró la conexión de la Maestra.")

    sku_column = project.master_sku_column
    if not sku_column:
        # Fallback: inferir desde los procesos activos (misma regla que main._resolve_master_sku_column)
        counts = {}
        for p in db.query(models.Process).filter(models.Process.is_active == True).all():
            if p.sku_column_master:
                counts[p.sku_column_master] = counts.get(p.sku_column_master, 0) + 1
        sku_column = max(counts, key=counts.get) if counts else None
    if not sku_column:
        raise HTTPException(status_code=400, detail="No se pudo determinar la columna llave (SKU) de la Maestra.")
    return project, master_conn, project.master_sheet_name, sku_column


def _header_index(headers: list, name: Optional[str]) -> int:
    """Busca una columna por nombre exacto y, si no hay match, case-insensitive
    (la columna SKU guardada puede no coincidir en mayúsculas con el
    encabezado real, ej. 'sku' guardado vs 'SKU' en la hoja)."""
    if not name:
        return -1
    if name in headers:
        return headers.index(name)
    name_lower = name.strip().lower()
    for i, h in enumerate(headers):
        if str(h).strip().lower() == name_lower:
            return i
    return -1


def build_updates_from_sheet(raw: list, sku_col: str, price_col: Optional[str], stock_col: Optional[str],
                             compare_col: Optional[str] = None, barcode_col: Optional[str] = None) -> list:
    """Convierte la matriz de la Maestra en updates [{sku, price?, stock?, ...}] para Shopify."""
    headers = raw[0]
    si = _header_index(headers, sku_col)
    if si < 0:
        raise HTTPException(status_code=400, detail=f"La columna SKU '{sku_col}' no existe en la Maestra.")
    pi = _header_index(headers, price_col)
    ti = _header_index(headers, stock_col)
    ci = _header_index(headers, compare_col)
    bi = _header_index(headers, barcode_col)
    updates = []
    for row in raw[1:]:
        sku = row[si] if si < len(row) else ""
        if not str(sku).strip():
            continue
        u = {"sku": sku}
        if pi >= 0:
            u["price"] = row[pi] if pi < len(row) else ""
        if ti >= 0:
            u["stock"] = row[ti] if ti < len(row) else ""
        if ci >= 0:
            u["compare_at_price"] = row[ci] if ci < len(row) else ""
        if bi >= 0:
            u["barcode"] = row[bi] if bi < len(row) else ""
        updates.append(u)
    return updates


@router.post("/{sub_id}/push-now")
def push_now(sub_id: int, dry_run: bool = True, db: Session = Depends(get_db)):
    """Envío COMPLETO de la Maestra a la tienda de esta suscripción (no solo el
    último diff). Con dry_run=True solo reporta el cruce, sin escribir nada."""
    db_sub = db.query(models.ShopifySubscription).filter(models.ShopifySubscription.id == sub_id).first()
    if not db_sub:
        raise HTTPException(status_code=404, detail="Suscripción Shopify no encontrada")
    shop_conn = db.query(models.Connection).filter(models.Connection.id == db_sub.connection_id).first()
    if not shop_conn or shop_conn.connection_type != "shopify":
        raise HTTPException(status_code=400, detail="La conexión de esta suscripción no es una tienda Shopify.")

    _, master_conn, master_sheet, sku_column = _get_master_context(db)

    from ..services import _create_connector, get_sheet_data

    raw = get_sheet_data(master_conn, f"{master_sheet}!A1:Z")
    if not raw or len(raw) < 2:
        raise HTTPException(status_code=400, detail=f"La hoja Maestra '{master_sheet}' está vacía o no se pudo leer.")

    updates = build_updates_from_sheet(
        raw, sku_column, db_sub.price_column_master, db_sub.stock_column_master,
        db_sub.compare_price_column_master, db_sub.barcode_column_master,
    )

    connector = _create_connector(shop_conn)
    try:
        summary = connector.push_updates(
            updates,
            do_price=bool(db_sub.price_column_master),
            do_stock=bool(db_sub.stock_column_master),
            do_compare_price=bool(db_sub.compare_price_column_master),
            do_barcode=bool(db_sub.barcode_column_master),
            dry_run=dry_run,
            location_id=db_sub.location_id or None,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error contra Shopify: {str(e)[:300]}")

    if not dry_run:
        db_sub.last_pushed_at = datetime.utcnow()
        db_sub.last_push_summary = json.dumps(summary)
        db.commit()
        from .logs import log_event
        log_event(
            db=db,
            event_type="SHOPIFY_SUB_PUSH",
            status="success" if not summary.get("errors") else "warning",
            message=(f"Envío completo a Shopify '{shop_conn.name}' (destino '{db_sub.name}'): "
                     f"{summary['price_updated']} precios, {summary['stock_updated']} stock, "
                     f"{summary['not_found_count']} sin cruzar (no se crean)."),
            rows_affected=summary["price_updated"] + summary["stock_updated"],
        )

    summary["store"] = shop_conn.name
    return summary
