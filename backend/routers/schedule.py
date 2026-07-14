"""Config del piloto automático (sync programada, §5)."""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..scheduler import get_or_create_config, run_scheduled_sync

router = APIRouter(prefix="/api/schedule", tags=["schedule"])


class ScheduleUpdate(BaseModel):
    enabled: bool
    interval_hours: int = 6


def _out(cfg):
    return {
        "enabled": cfg.enabled,
        "interval_hours": cfg.interval_hours,
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
    # Al activar (o cambiar el intervalo), programa el próximo corrido.
    if cfg.enabled:
        cfg.next_run_at = datetime.utcnow() + timedelta(hours=cfg.interval_hours)
    else:
        cfg.next_run_at = None
    db.commit()
    db.refresh(cfg)
    return _out(cfg)


@router.post("/run-now")
def run_now(db: Session = Depends(get_db)):
    """Dispara la sync completa de inmediato (para probar el piloto automático)."""
    import json
    cfg = get_or_create_config(db)
    summary = run_scheduled_sync(db)
    cfg.last_run_at = datetime.utcnow()
    if cfg.enabled:
        cfg.next_run_at = datetime.utcnow() + timedelta(hours=max(cfg.interval_hours, 1))
    cfg.last_summary = json.dumps(summary, ensure_ascii=False)
    db.commit()
    return summary
