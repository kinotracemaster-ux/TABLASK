"""Config del piloto automático (sync programada, §5).

Dos modos (ScheduleConfig.mode):
- "auto": corre las fuentes y ESCRIBE solo (comportamiento original).
- "review": Revisión diaria — calcula qué cambiaría y deja un reporte
  pendiente de aprobación; no escribe nada (ver backend/review.py).
"""
import json
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..scheduler import get_or_create_config, compute_next_run, run_for_mode, TZ_NAME

router = APIRouter(prefix="/api/schedule", tags=["schedule"])

MODES = ("auto", "review")


class ScheduleUpdate(BaseModel):
    enabled: bool
    interval_hours: int = 6
    # Opcionales: si no vienen, se conserva lo guardado (la UI vieja solo
    # manda enabled/interval_hours y no debe resetear el modo).
    mode: Optional[str] = None
    daily_hour: Optional[int] = None
    use_daily_hour: Optional[bool] = None     # False = volver a "cada X horas"
    review_shopify_ids: Optional[List[int]] = None
    review_all_shopify: Optional[bool] = None  # True = revisar todas las tiendas activas


def _out(cfg):
    ids = None
    if cfg.review_shopify_ids:
        try:
            ids = json.loads(cfg.review_shopify_ids)
        except (ValueError, TypeError):
            ids = None
    return {
        "enabled": cfg.enabled,
        "interval_hours": cfg.interval_hours,
        "mode": cfg.mode or "auto",
        "daily_hour": cfg.daily_hour,
        "timezone": TZ_NAME,
        "review_shopify_ids": ids,
        "report_token": cfg.report_token,
        "last_run_at": cfg.last_run_at.isoformat() if cfg.last_run_at else None,
        "next_run_at": cfg.next_run_at.isoformat() if cfg.next_run_at else None,
        "last_summary": cfg.last_summary,
    }


@router.get("")
def get_schedule(db: Session = Depends(get_db)):
    return _out(get_or_create_config(db))


@router.put("")
def update_schedule(req: ScheduleUpdate, db: Session = Depends(get_db)):
    cfg = get_or_create_config(db)
    cfg.enabled = req.enabled
    cfg.interval_hours = max(req.interval_hours, 1)
    if req.mode is not None:
        if req.mode not in MODES:
            raise HTTPException(status_code=400, detail=f"Modo inválido: usá uno de {', '.join(MODES)}.")
        cfg.mode = req.mode
    if req.use_daily_hour is False:
        cfg.daily_hour = None
    elif req.daily_hour is not None:
        if not 0 <= req.daily_hour <= 23:
            raise HTTPException(status_code=400, detail="La hora debe estar entre 0 y 23.")
        cfg.daily_hour = req.daily_hour
    if req.review_all_shopify:
        cfg.review_shopify_ids = None
    elif req.review_shopify_ids is not None:
        cfg.review_shopify_ids = json.dumps(sorted(set(int(i) for i in req.review_shopify_ids)))
    # Al activar (o cambiar el horario), programa el próximo corrido.
    cfg.next_run_at = compute_next_run(cfg, datetime.utcnow()) if cfg.enabled else None
    db.commit()
    db.refresh(cfg)
    return _out(cfg)


@router.post("/run-now")
def run_now(db: Session = Depends(get_db)):
    """Dispara el piloto de inmediato, respetando el modo: en "review" arma la
    revisión (no escribe nada); en "auto" sincroniza y escribe."""
    cfg = get_or_create_config(db)
    summary = run_for_mode(db, cfg, trigger="manual")
    now = datetime.utcnow()
    cfg.last_run_at = now
    if cfg.enabled:
        cfg.next_run_at = compute_next_run(cfg, now)
    cfg.last_summary = json.dumps(summary, ensure_ascii=False, default=str)
    db.commit()
    return summary
