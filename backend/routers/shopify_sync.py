from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from .. import models
from ..database import get_db

router = APIRouter(prefix="/api/shopify", tags=["shopify"])


class PushRequest(BaseModel):
    shopify_connection_id: int
    source_connection_id: Optional[int] = None   # default: la Maestra global
    source_sheet_name: str                        # tab origen (ej. "Shopi-poe")
    sku_column: str
    price_column: Optional[str] = None
    stock_column: Optional[str] = None
    location_id: Optional[str] = None             # ubicación destino para el stock
    dry_run: bool = True


@router.get("/locations")
def list_locations(connection_id: int, db: Session = Depends(get_db)):
    """Ubicaciones de la tienda Shopify (para elegir dónde escribir el stock)."""
    conn = db.query(models.Connection).filter(models.Connection.id == connection_id).first()
    if not conn or conn.connection_type != "shopify":
        raise HTTPException(status_code=400, detail="La conexión indicada no es de tipo Shopify.")
    from ..services import _create_connector
    try:
        return {"locations": _create_connector(conn).get_locations()}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)[:300])


def _resolve_master_connection_id(db: Session) -> Optional[int]:
    project = db.query(models.Project).filter(
        models.Project.master_connection_id.isnot(None)
    ).first()
    return project.master_connection_id if project else None


@router.post("/push")
def push_to_shopify(req: PushRequest, db: Session = Depends(get_db)):
    """
    Envía precio/stock de una hoja (tab) hacia una tienda Shopify, cruzando por SKU.
    Con dry_run=True solo reporta el cruce (cuántos SKU coinciden / no se encuentran).
    """
    shop_conn = db.query(models.Connection).filter(
        models.Connection.id == req.shopify_connection_id
    ).first()
    if not shop_conn or shop_conn.connection_type != "shopify":
        raise HTTPException(status_code=400, detail="La conexión indicada no es de tipo Shopify.")

    if not req.price_column and not req.stock_column:
        raise HTTPException(status_code=400, detail="Debes mapear al menos Precio o Stock.")

    src_conn_id = req.source_connection_id or _resolve_master_connection_id(db)
    src_conn = db.query(models.Connection).filter(
        models.Connection.id == src_conn_id
    ).first()
    if not src_conn:
        raise HTTPException(status_code=400, detail="No se encontró la conexión origen (Maestra).")

    from ..services import _create_connector, get_sheet_data

    raw = get_sheet_data(src_conn, f"{req.source_sheet_name}!A1:Z")
    if not raw or len(raw) < 2:
        raise HTTPException(status_code=400, detail=f"La hoja '{req.source_sheet_name}' está vacía o no se pudo leer.")

    headers = raw[0]

    def col_idx(name: Optional[str]) -> int:
        return headers.index(name) if name and name in headers else -1

    si = col_idx(req.sku_column)
    pi = col_idx(req.price_column)
    ti = col_idx(req.stock_column)
    if si < 0:
        raise HTTPException(status_code=400, detail=f"La columna SKU '{req.sku_column}' no existe en la hoja.")

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
        updates.append(u)

    connector = _create_connector(shop_conn)
    try:
        summary = connector.push_updates(
            updates, do_price=pi >= 0, do_stock=ti >= 0,
            dry_run=req.dry_run, location_id=req.location_id
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error contra Shopify: {str(e)[:300]}")

    # Log de la ejecución real (no del preview).
    if not req.dry_run:
        from .logs import log_event
        log_event(
            db=db,
            event_type="SHOPIFY_PUSH",
            status="success" if not summary.get("errors") else "warning",
            message=(f"Envío a Shopify '{shop_conn.name}': "
                     f"{summary['price_updated']} precios, {summary['stock_updated']} stock, "
                     f"{summary['not_found_count']} sin cruzar."),
            rows_affected=summary["price_updated"] + summary["stock_updated"],
        )

    summary["store"] = shop_conn.name
    return summary
