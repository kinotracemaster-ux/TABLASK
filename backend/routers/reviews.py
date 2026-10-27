"""Revisión diaria (modo "review" del piloto automático): ver, generar,
aprobar y descartar. La lógica vive en backend/review.py."""
import hmac
import json
import secrets

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..review import run_review, apply_review, discard_review, public_summary, excel_no_subidos, ReviewError
from ..scheduler import get_or_create_config

router = APIRouter(prefix="/api/reviews", tags=["reviews"])


def _row(r: models.DailyReview) -> dict:
    report = json.loads(r.report) if r.report else {}
    return {
        "id": r.id,
        "status": r.status,
        "trigger": r.trigger,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
        "totals": report.get("totals", {}),
        "reason": report.get("reason"),
    }


def _full(r: models.DailyReview) -> dict:
    out = _row(r)
    out["report"] = json.loads(r.report) if r.report else {}
    out["apply_summary"] = json.loads(r.apply_summary) if r.apply_summary else None
    return out


def _get(db, review_id: int) -> models.DailyReview:
    r = db.query(models.DailyReview).filter(models.DailyReview.id == review_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Revisión no encontrada")
    return r


@router.get("")
def list_reviews(limit: int = 15, db: Session = Depends(get_db)):
    rows = db.query(models.DailyReview).order_by(models.DailyReview.id.desc()).limit(max(1, min(limit, 60))).all()
    return [_row(r) for r in rows]


@router.get("/latest")
def latest_review(db: Session = Depends(get_db)):
    r = db.query(models.DailyReview).order_by(models.DailyReview.id.desc()).first()
    return _full(r) if r else None


@router.get("/latest/public")
def latest_review_public(token: str = None, db: Session = Depends(get_db)):
    """Resumen de solo lectura de la última revisión, con link fijo
    (?token=...): pensado para un auditor externo que no abre la app."""
    cfg = get_or_create_config(db)
    if not token or not hmac.compare_digest(str(token), str(cfg.report_token or "")):
        raise HTTPException(status_code=403, detail="Token inválido.")
    r = db.query(models.DailyReview).order_by(models.DailyReview.id.desc()).first()
    if not r:
        return {"review_id": None, "status": "sin_revisiones"}
    return public_summary(r)


@router.post("/token/regenerate")
def regenerate_token(db: Session = Depends(get_db)):
    """Rota el token del link del auditor (el link anterior deja de servir)."""
    cfg = get_or_create_config(db)
    cfg.report_token = secrets.token_urlsafe(24)
    db.commit()
    return {"report_token": cfg.report_token}


@router.post("/run-now")
def run_now(db: Session = Depends(get_db)):
    """Genera una revisión ya mismo (no escribe nada)."""
    r = run_review(db, trigger="manual")
    return _full(r)


@router.get("/{review_id}")
def get_review(review_id: int, db: Session = Depends(get_db)):
    return _full(_get(db, review_id))


@router.get("/{review_id}/no-subidos.xlsx")
def descargar_no_subidos(review_id: int, db: Session = Depends(get_db)):
    """Excel con lo que no se sube a la web en esta revisión y por qué."""
    r = _get(db, review_id)
    fecha = r.created_at.strftime("%Y-%m-%d") if r.created_at else str(r.id)
    return Response(
        content=excel_no_subidos(r),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="no-subidos-{fecha}.xlsx"'},
    )


@router.post("/{review_id}/apply")
def apply(review_id: int, db: Session = Depends(get_db)):
    """Aplica lo aprobado: solo lo revisado que siga vigente."""
    r = _get(db, review_id)
    try:
        apply_review(db, r)
    except ReviewError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.refresh(r)
    return _full(r)


@router.post("/{review_id}/discard")
def discard(review_id: int, db: Session = Depends(get_db)):
    r = _get(db, review_id)
    try:
        discard_review(db, r)
    except ReviewError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.refresh(r)
    return _row(r)
