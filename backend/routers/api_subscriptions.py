"""Suscripciones Maestra → API genérica (canal API).

El equivalente de las suscripciones Shopify pero contra cualquier endpoint
HTTP del cliente (Effi u otros): un destino permanente que recibe las filas
de la Maestra transformadas con la plantilla del canal. Dos caminos de envío,
mismos que Shopify:

  1. Automático (diff quirúrgico): tras cada sync que escribe la Maestra,
     propagation.py empuja SOLO los SKUs afectados en esa corrida.
  2. Manual ("Enviar ahora"): POST /{id}/push-now manda la Maestra completa,
     con dry_run para previsualizar el payload antes de enviar.

El auth_token es write-only (nunca se devuelve; el response expone has_token).
"""
import json
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/api-subscriptions", tags=["api-subscriptions"])


def _to_out(sub: models.ApiSubscription) -> dict:
    """Serializa el modelo al schema de salida (deserializando los JSON Text
    y sin exponer jamás el token)."""
    return {
        "id": sub.id,
        "name": sub.name,
        "url": sub.url,
        "http_method": sub.http_method or "POST",
        "auth_header_name": sub.auth_header_name or "Authorization",
        "extra_headers": json.loads(sub.extra_headers) if sub.extra_headers else None,
        "transform_spec": json.loads(sub.transform_spec) if sub.transform_spec else None,
        "is_active": sub.is_active,
        "has_token": bool(sub.auth_token),
        "last_pushed_at": sub.last_pushed_at,
        "last_push_summary": sub.last_push_summary,
        "created_at": sub.created_at,
    }


def _validate_payload(sub: schemas.ApiSubscriptionCreate):
    if not (sub.url or "").strip().lower().startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="La URL del destino API debe empezar con http:// o https://")


@router.post("/", response_model=schemas.ApiSubscriptionOut)
def create_api_subscription(sub: schemas.ApiSubscriptionCreate, db: Session = Depends(get_db)):
    _validate_payload(sub)
    db_sub = models.ApiSubscription(
        name=sub.name,
        url=sub.url.strip(),
        http_method=sub.http_method,
        auth_header_name=sub.auth_header_name,
        auth_token=sub.auth_token or None,
        extra_headers=json.dumps(sub.extra_headers, ensure_ascii=False) if sub.extra_headers else None,
        transform_spec=json.dumps(sub.transform_spec, ensure_ascii=False) if sub.transform_spec else None,
        is_active=sub.is_active,
    )
    db.add(db_sub)
    db.commit()
    db.refresh(db_sub)
    return _to_out(db_sub)


@router.get("/", response_model=List[schemas.ApiSubscriptionOut])
def list_api_subscriptions(db: Session = Depends(get_db)):
    return [_to_out(s) for s in db.query(models.ApiSubscription).all()]


@router.put("/{sub_id}", response_model=schemas.ApiSubscriptionOut)
def update_api_subscription(sub_id: int, sub: schemas.ApiSubscriptionCreate, db: Session = Depends(get_db)):
    db_sub = db.query(models.ApiSubscription).filter(models.ApiSubscription.id == sub_id).first()
    if not db_sub:
        raise HTTPException(status_code=404, detail="Destino API no encontrado")
    _validate_payload(sub)
    db_sub.name = sub.name
    db_sub.url = sub.url.strip()
    db_sub.http_method = sub.http_method
    db_sub.auth_header_name = sub.auth_header_name
    # El token solo se pisa si viene no vacío (así se puede editar el resto
    # sin tener que reingresarlo; mismo criterio que los secretos Shopify).
    if sub.auth_token:
        db_sub.auth_token = sub.auth_token
    db_sub.extra_headers = json.dumps(sub.extra_headers, ensure_ascii=False) if sub.extra_headers else None
    db_sub.transform_spec = json.dumps(sub.transform_spec, ensure_ascii=False) if sub.transform_spec else None
    db_sub.is_active = sub.is_active
    db.commit()
    db.refresh(db_sub)
    return _to_out(db_sub)


@router.delete("/{sub_id}")
def delete_api_subscription(sub_id: int, db: Session = Depends(get_db)):
    db_sub = db.query(models.ApiSubscription).filter(models.ApiSubscription.id == sub_id).first()
    if not db_sub:
        raise HTTPException(status_code=404, detail="Destino API no encontrado")
    db.delete(db_sub)
    db.commit()
    return {"message": "Destino API eliminado"}


@router.post("/{sub_id}/push-now")
def push_now(sub_id: int, dry_run: bool = True, db: Session = Depends(get_db)):
    """Envío COMPLETO de la Maestra al endpoint de este canal (no solo el
    último diff). Con dry_run=True devuelve una muestra del payload sin
    llamar a la API externa."""
    db_sub = db.query(models.ApiSubscription).filter(models.ApiSubscription.id == sub_id).first()
    if not db_sub:
        raise HTTPException(status_code=404, detail="Destino API no encontrado")

    # Contexto de la Maestra global (mismo criterio que el push-now Shopify).
    from .shopify_subscriptions import _get_master_context
    _, master_conn, master_sheet, _sku = _get_master_context(db)

    from ..services import get_sheet_data
    raw = get_sheet_data(master_conn, f"{master_sheet}!A1:Z")
    if not raw or len(raw) < 2:
        raise HTTPException(status_code=400, detail=f"La hoja Maestra '{master_sheet}' está vacía o no se pudo leer.")

    from ..api_push import rows_from_master, send_rows
    spec = json.loads(db_sub.transform_spec) if db_sub.transform_spec else None
    rows = rows_from_master(raw, transform_spec=spec)

    if dry_run:
        return {
            "dry_run": True,
            "channel": db_sub.name,
            "url": db_sub.url,
            "rows_total": len(rows),
            "columns": list(rows[0].keys()) if rows else [],
            "sample": rows[:5],
        }

    summary = send_rows(db_sub, rows)
    db_sub.last_pushed_at = datetime.utcnow()
    db_sub.last_push_summary = json.dumps(summary, ensure_ascii=False)
    db.commit()

    from .logs import log_event
    log_event(
        db=db,
        event_type="API_SUB_PUSH",
        status="success" if summary.get("ok") else "error",
        message=(f"Envío completo al canal API '{db_sub.name}': {summary.get('sent', 0)} filas "
                 f"(HTTP {summary.get('status_code')})." if summary.get("ok")
                 else f"Canal API '{db_sub.name}' falló: {summary.get('error') or summary.get('response_excerpt', '')}"),
        rows_affected=summary.get("sent", 0),
    )

    summary["channel"] = db_sub.name
    return summary
