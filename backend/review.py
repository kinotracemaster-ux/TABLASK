"""Revisión diaria — el "revisor-actualizador" del piloto automático.

Modo "review" del scheduler (ScheduleConfig.mode = "review"): en vez de
escribir solo, una vez al día calcula QUÉ CAMBIARÍA, sin escribir nada:

  1. Fuentes activas → Maestra: el mismo túnel de siempre (_compute_master_sync:
     Lavadero, Guardián, cruce por SKU normalizado), pero solo como vista previa.
  2. Maestra "proyectada" (la actual + esos cambios, en memoria) → cada tienda
     Shopify revisada: dry_run del push (antes → después por SKU/campo).
  3. Alertas de lo que no cuadra (agotados en masa, saltos de precio, Guardián,
     archivos del PC sin actualizar, destinos duplicados...).

Todo queda en un DailyReview "pendiente". Nada sale hacia la web sin el OK.

Al aprobar (apply_review) se recalcula todo FRESCO y se aplica solo la
INTERSECCIÓN entre lo revisado y lo vigente: lo que cambió desde la revisión
(ej. una venta movió el stock, llegó un archivo nuevo) no se aplica a ciegas,
queda para la próxima revisión. Mismo espíritu que la expiración del
StagingBatch: nunca escribir datos que el humano no vio.
"""
import json
import os
import re
import threading
import traceback
from datetime import datetime

from . import models
from .sku_utils import normalize_sku_for_match

# Tope de líneas guardadas por fuente/tienda (lo que se puede aprobar). Muy por
# encima de un día normal; si se supera, se avisa con una alerta.
MAX_LINES = int(os.getenv("REVIEW_MAX_LINES", "20000"))
# Una revisión más vieja que esto ya no se puede aplicar (hay que generar otra).
REVIEW_MAX_AGE_HOURS = float(os.getenv("REVIEW_MAX_AGE_HOURS", "36"))
# Alertas
PRICE_JUMP_RATIO = float(os.getenv("REVIEW_PRICE_JUMP_RATIO", "0.5"))   # ±50% = salto sospechoso
MASS_ZERO_MIN = int(os.getenv("REVIEW_MASS_ZERO_MIN", "20"))            # N+ productos a stock 0 = alerta roja
STALE_FILE_HOURS = float(os.getenv("REVIEW_STALE_FILE_HOURS", "26"))    # archivo del PC sin actualizar

# Etiquetas del dry_run de Shopify → clave de update (para el filtro `only`).
LABEL_TO_KEY = {
    "Precio": "price",
    "Stock": "stock",
    "Precio comparativo": "compare_at_price",
    "Código de barras": "barcode",
    "Nombre": "title",
    "Categoría": "product_type",
}

# Una sola revisión/aplicación a la vez (el thread del scheduler y un request
# podrían cruzarse).
_LOCK = threading.Lock()


# ─────────────────────────────────────────────────────────── helpers puros
def _norm(sku) -> str:
    return normalize_sku_for_match(str(sku or ""))


def master_change_key(c: dict) -> tuple:
    """Identidad de un cambio Fuente→Maestra: SKU normalizado + columna + valor nuevo."""
    return (_norm(c.get("sku")), str(c.get("field")), str(c.get("new", "")).strip())


def store_change_key(c: dict) -> tuple:
    """Identidad de un cambio Maestra→Shopify: SKU normalizado + campo + valor después."""
    return (_norm(c.get("sku")), str(c.get("field")), str(c.get("after", "")).strip())


def project_master(projected: list, headers_after: list, sku_col: str,
                   changes: list, new_rows: list) -> None:
    """Aplica EN MEMORIA los cambios/altas de una fuente sobre la Maestra
    proyectada (lista de listas, se muta). Sirve para previsualizar qué le
    llegaría a cada tienda si se aprueban los cambios de la Maestra."""
    if not projected:
        projected.append(list(headers_after or []))
    headers = projected[0]
    for h in headers_after or []:
        if h not in headers:
            headers.append(h)
    if sku_col not in headers:
        return
    si = headers.index(sku_col)
    idx = {}
    for i, row in enumerate(projected[1:], start=1):
        n = _norm(row[si] if si < len(row) else "")
        if n and n not in idx:
            idx[n] = i
    for ch in changes or []:
        i = idx.get(_norm(ch.get("sku")))
        field = ch.get("field")
        if i is None or field not in headers:
            continue
        row = projected[i]
        ci = headers.index(field)
        if len(row) <= ci:
            row.extend([""] * (ci + 1 - len(row)))
        row[ci] = ch.get("new", "")
    for nr in new_rows or []:
        n = _norm(nr.get("sku"))
        if not n or n in idx:
            continue
        fields = nr.get("fields") or {}
        projected.append([fields.get(h, "") for h in headers])
        idx[n] = len(projected) - 1


def _to_number(v):
    try:
        s = str(v).replace("$", "").replace(" ", "").strip()
        if not s:
            return None
        # "45.000" (miles) vs "45.5" (decimal): el formato ya viene normalizado
        # por _fmt_price del conector, así que basta con float.
        return float(s.replace(",", "."))
    except (TypeError, ValueError):
        return None


def price_jumps(changes: list, ratio: float = PRICE_JUMP_RATIO) -> list:
    """Cambios de precio cuyo valor nuevo se aleja ±ratio del actual."""
    out = []
    for c in changes or []:
        if c.get("field") not in ("Precio", "Precio comparativo"):
            continue
        before, after = _to_number(c.get("before")), _to_number(c.get("after"))
        if not before or after is None:
            continue
        if abs(after / before - 1) >= ratio:
            out.append(c)
    return out


def stock_to_zero(changes: list) -> list:
    return [c for c in changes or []
            if c.get("field") == "Stock" and _to_number(c.get("after")) == 0
            and (_to_number(c.get("before")) or 0) > 0]


def stock_negative(changes: list) -> list:
    """Cambios de stock que dejan la tienda en negativo (el SYS manda: se
    respetan, pero se avisan)."""
    out = []
    for c in changes or []:
        if c.get("field") != "Stock":
            continue
        n = _to_number(c.get("after"))
        if n is not None and n < 0:
            out.append(c)
    return out


_DOBLE_NUMERO = re.compile(r"-[A-Z]?\d{2,}$", re.IGNORECASE)


def es_doble_numero(sku) -> bool:
    """Código con número doble al final (503B-11, 810-11, 1401-20, 836-C11):
    para Kino es un PRODUCTO NUEVO, no un error de tipeo del de un número."""
    return bool(_DOBLE_NUMERO.search(str(sku or "").strip()))


def _alert(level: str, text: str, where: str = None, samples: list = None) -> dict:
    a = {"level": level, "text": text}
    if where:
        a["where"] = where
    if samples:
        a["samples"] = samples[:10]
    return a


def _err_text(e: Exception) -> str:
    detail = getattr(e, "detail", None)
    return str(detail or e)[:300]


# ─────────────────────────────────────────────────────── contexto de la Maestra
def _master_context(db):
    project = db.query(models.Project).filter(models.Project.master_connection_id.isnot(None)).first()
    if not project:
        return None
    master_conn = db.query(models.Connection).filter(models.Connection.id == project.master_connection_id).first()
    if not master_conn:
        return None
    sku_column = project.master_sku_column
    if not sku_column:
        counts = {}
        for p in db.query(models.Process).filter(models.Process.is_active == True).all():  # noqa: E712
            if p.sku_column_master:
                counts[p.sku_column_master] = counts.get(p.sku_column_master, 0) + 1
        sku_column = max(counts, key=counts.get) if counts else None
    return project, master_conn, project.master_sheet_name, sku_column


def _targets_global_master(proc, project, master_sheet) -> bool:
    if not proc.target_connection_id:
        return True
    return (proc.target_connection_id == project.master_connection_id
            and (proc.target_sheet_name or master_sheet) == master_sheet)


def _shopify_flags(sub) -> dict:
    return dict(
        do_price=bool(sub.price_column_master),
        do_stock=bool(sub.stock_column_master),
        do_compare_price=bool(sub.compare_price_column_master),
        do_barcode=bool(sub.barcode_column_master),
        do_title=bool(sub.title_column_master),
        do_product_type=bool(sub.product_type_column_master),
    )


def _updates_for(sub, raw, sku_column):
    """Los mismos updates que mandaría el envío real — multiplicador del canal
    incluido. Si acá no se aplicara, la revisión mostraría un precio y después
    se escribiría otro, y lo aprobado no coincidiría con lo que se envía."""
    from .routers.shopify_subscriptions import build_updates_from_sheet
    return build_updates_from_sheet(
        raw, sku_column, sub.price_column_master, sub.stock_column_master,
        sub.compare_price_column_master, sub.barcode_column_master,
        sub.title_column_master, sub.product_type_column_master,
        price_multiplier=sub.price_multiplier or 1.0,
    )


def _selected_subs(db, shopify_ids):
    subs = db.query(models.ShopifySubscription).filter(models.ShopifySubscription.is_active == True).all()  # noqa: E712
    if shopify_ids is None:
        return subs, []
    wanted = set(int(i) for i in shopify_ids)
    return [s for s in subs if s.id in wanted], [s for s in subs if s.id not in wanted]


# ─────────────────────────────────────────────────────────── armar la revisión
def build_review(db, shopify_ids=None) -> dict:
    """Calcula la revisión SIN escribir nada. Devuelve el reporte (dict)."""
    from .services import _compute_master_sync, get_sheet_data, invalidate_read_cache, _create_connector
    from .scheduler import build_sync_request

    invalidate_read_cache()  # leer fresco
    ctx = _master_context(db)
    if not ctx:
        return {"ok": False, "reason": "No hay Maestra enlazada."}
    project, master_conn, master_sheet, sku_column = ctx

    report = {
        "ok": True,
        "version": 1,
        "generated_at": datetime.utcnow().isoformat(),
        "master": {"sheet": master_sheet, "sku_column": sku_column},
        "processes": [],
        "stores": [],
        "alerts": [],
        "downstream": {},
    }
    alerts = report["alerts"]

    master_base = get_sheet_data(master_conn, f"{master_sheet}!A1:Z") or []
    projected = [list(r) for r in master_base]

    # 1) Fuentes activas → Maestra (vista previa)
    now = datetime.utcnow()
    for proc in db.query(models.Process).filter(models.Process.is_active == True).all():  # noqa: E712
        entry = {"process_id": proc.id, "name": proc.name, "status": "ok",
                 "changes": [], "new_rows": []}
        report["processes"].append(entry)

        # Archivo del PC sin actualizar: la revisión compararía datos viejos.
        src = db.query(models.Connection).filter(models.Connection.id == proc.source_connection_id).first()
        if src and src.connection_type == "local_file":
            entry["file_updated_at"] = src.file_updated_at.isoformat() if src.file_updated_at else None
            if not src.file_updated_at or (now - src.file_updated_at).total_seconds() / 3600 > STALE_FILE_HOURS:
                cuando = (f"desde hace {int((now - src.file_updated_at).total_seconds() // 86400)} día(s)"
                          if src.file_updated_at else "nunca se reemplazó")
                alerts.append(_alert("warning",
                                     f"El archivo de '{proc.name}' no se actualiza {cuando}: la revisión compara datos "
                                     f"viejos. ¿Subiste el Excel nuevo?", proc.name))

        try:
            req = build_sync_request(proc)
            result = _compute_master_sync(project, req, db)
        except Exception as e:
            entry["status"] = "error"
            entry["error"] = _err_text(e)
            alerts.append(_alert("danger", f"No se pudo revisar '{proc.name}': {entry['error']}", proc.name))
            continue

        changes = result.get("changes", [])
        new_rows = result.get("new_rows", [])
        entry.update({
            "coherence": result.get("coherence_index"),
            "rows_orphan": result.get("rows_orphan", 0),
            "rows_zeroed": result.get("rows_zeroed", 0),
            "rows_skipped": result.get("rows_skipped", 0),
            "lavadero": result.get("lavadero"),
        })

        if new_rows and result.get("new_rows_look_broken"):
            entry["status"] = "guardian"
            entry["suspect_ratio"] = result.get("new_rows_suspect_ratio")
            alerts.append(_alert(
                "danger",
                f"El Guardián frenó '{proc.name}': {len(new_rows)} SKU nuevos y la mayoría se parecen a SKU que ya "
                f"existen (probable formato de SKU roto). No se aplica nada de esta fuente; revisá el archivo.",
                proc.name, [nr.get("sku") for nr in new_rows]))
            continue

        entry["changes"] = [
            {k: c.get(k) for k in ("sku", "field", "old", "new", "orphan_zero") if c.get(k) is not None}
            for c in changes[:MAX_LINES]
        ]
        entry["new_rows"] = [{"sku": nr.get("sku"), "fields": nr.get("fields") or {}} for nr in new_rows[:MAX_LINES]]
        entry["changes_total"] = len(changes)
        entry["new_total"] = len(new_rows)
        if len(changes) > MAX_LINES or len(new_rows) > MAX_LINES:
            entry["truncated"] = True
            alerts.append(_alert("warning", f"'{proc.name}' trae más de {MAX_LINES} líneas: se guardaron las primeras; "
                                            f"el resto queda para la próxima revisión.", proc.name))

        if entry["rows_zeroed"]:
            alerts.append(_alert(
                "danger" if entry["rows_zeroed"] >= MASS_ZERO_MIN else "warning",
                f"{entry['rows_zeroed']} producto(s) se agotarían (stock 0) en la Maestra porque NO vienen en "
                f"'{proc.name}'.", proc.name,
                [c.get("sku") for c in changes if c.get("orphan_zero")]))
        if new_rows:
            alerts.append(_alert("info", f"{len(new_rows)} SKU nuevo(s) se crearían en la Maestra desde '{proc.name}' "
                                         f"(quedan marcados NUEVO para enriquecer).", proc.name,
                                 [nr.get("sku") for nr in new_rows]))
        lav = result.get("lavadero") or {}
        retenidos = (lav.get("rejected_count") or len(lav.get("rejected") or [])) + \
                    (lav.get("review_count") or len(lav.get("review") or []))
        if retenidos:
            alerts.append(_alert("warning", f"El Lavadero retuvo {retenidos} valor(es) sucios de '{proc.name}' "
                                            f"(no se escriben).", proc.name))

        dups = result.get("duplicate_skus") or []
        if dups:
            alerts.append(_alert("warning", f"{len(dups)} SKU vienen repetidos en el archivo de '{proc.name}': "
                                            f"se usa la última fila de cada uno. Revisá el SYS.", proc.name, dups))

        if _targets_global_master(proc, project, master_sheet):
            project_master(projected, (result.get("master_raw") or [[]])[0], proc.sku_column_master,
                           changes, new_rows)

    # 2) Maestra proyectada → tiendas Shopify (dry_run)
    subs, excluded = _selected_subs(db, shopify_ids)
    report["stores_not_reviewed"] = [s.name for s in excluded]
    for sub in subs:
        shop_conn = db.query(models.Connection).filter(models.Connection.id == sub.connection_id).first()
        entry = {"subscription_id": sub.id, "name": sub.name,
                 "store": shop_conn.name if shop_conn else None, "status": "ok", "changes": []}
        report["stores"].append(entry)
        if not shop_conn or shop_conn.connection_type != "shopify":
            entry["status"] = "error"
            entry["error"] = "La conexión de este destino no es una tienda Shopify."
            continue
        if not sku_column or len(projected) < 2:
            entry["status"] = "error"
            entry["error"] = "No se pudo leer la Maestra o su columna SKU."
            continue
        try:
            updates = _updates_for(sub, projected, sku_column)
            connector = _create_connector(shop_conn)
            summary = connector.push_updates(updates, dry_run=True, location_id=sub.location_id or None,
                                             preview_limit=MAX_LINES, **_shopify_flags(sub))
        except Exception as e:
            entry["status"] = "error"
            entry["error"] = _err_text(e)
            alerts.append(_alert("danger", f"No se pudo revisar la tienda '{sub.name}': {entry['error']}", sub.name))
            continue

        changes = summary.get("changes", [])
        entry.update({
            "changes": changes,
            "changes_total": summary.get("changes_total", len(changes)),
            "matched": summary.get("matched", 0),
            "not_found_count": summary.get("not_found_count", 0),
            "not_found": summary.get("not_found") or [],
            "conflicts_total": summary.get("conflicts_total", 0),
            "conflicts": (summary.get("conflicts") or [])[:100],
            "ignored_secondary_total": summary.get("ignored_secondary_total", 0),
            "by_field": {},
        })
        for c in changes:
            entry["by_field"][c["field"]] = entry["by_field"].get(c["field"], 0) + 1

        zeros = stock_to_zero(changes)
        if zeros:
            alerts.append(_alert("danger" if len(zeros) >= MASS_ZERO_MIN else "warning",
                                 f"{len(zeros)} producto(s) quedarían en stock 0 en '{sub.name}'.",
                                 sub.name, [c["sku"] for c in zeros]))
        jumps = price_jumps(changes)
        if jumps:
            alerts.append(_alert("warning",
                                 f"{len(jumps)} precio(s) cambian más de ±{int(PRICE_JUMP_RATIO * 100)}% en '{sub.name}'.",
                                 sub.name, [f"{c['sku']}: {c['before']} → {c['after']}" for c in jumps]))
        negs = stock_negative(changes)
        if negs:
            alerts.append(_alert("warning", f"{len(negs)} producto(s) quedarían con stock NEGATIVO en '{sub.name}' "
                                            f"(se respeta lo que dice el SYS).",
                                 sub.name, [f"{c['sku']}: {c['after']}" for c in negs]))
        faltan = entry["not_found"]
        if faltan:
            dobles = [x for x in faltan if es_doble_numero(x)]
            extra = (f" {len(dobles)} son de número doble (ej. {dobles[0]}): productos nuevos." if dobles else "")
            alerts.append(_alert("info", f"{entry['not_found_count']} SKU no existen en '{sub.name}': no se crean "
                                         f"solos, hay que crearlos aparte.{extra}", sub.name, faltan))
        if entry["conflicts_total"]:
            alerts.append(_alert("warning", f"{entry['conflicts_total']} conflicto(s) de nombre/categoría entre "
                                            f"variantes en '{sub.name}' (no se envían).", sub.name))
        if summary.get("errors"):
            alerts.append(_alert("danger", f"Errores leyendo '{sub.name}': {'; '.join(summary['errors'][:3])}", sub.name))

    # 3) Problemas de configuración que corrompen datos
    by_conn = {}
    for s in db.query(models.ShopifySubscription).filter(models.ShopifySubscription.is_active == True).all():  # noqa: E712
        by_conn.setdefault(s.connection_id, []).append(s.name)
    for names in by_conn.values():
        if len(names) > 1:
            alerts.append(_alert("danger", f"La misma tienda tiene {len(names)} destinos activos ({', '.join(names)}): "
                                           f"se pisan entre sí. Dejá uno solo en Mis Flujos."))

    # Qué más se actualiza al aprobar (como en un correr normal), para que no
    # haya sorpresas: hojas hijas y canales API suscritos a la Maestra.
    report["downstream"] = {
        "sheets": [s.name for s in db.query(models.FieldSubscription).filter(
            models.FieldSubscription.is_active == True).all()],  # noqa: E712
        "api": [s.name for s in db.query(models.ApiSubscription).filter(
            models.ApiSubscription.is_active == True).all()],  # noqa: E712
    }

    ok_procs = [p for p in report["processes"] if p["status"] == "ok"]
    ok_stores = [s for s in report["stores"] if s["status"] == "ok"]
    report["totals"] = {
        "master_changes": sum(p.get("changes_total", 0) for p in ok_procs),
        "master_new": sum(p.get("new_total", 0) for p in ok_procs),
        "master_zeroed": sum(p.get("rows_zeroed", 0) for p in ok_procs),
        "store_changes": sum(s.get("changes_total", 0) for s in ok_stores),
        # SKU distintos que quedarían en stock 0 en alguna tienda (cualquier motivo).
        "store_zeroed": len({_norm(c["sku"]) for s in ok_stores for c in stock_to_zero(s.get("changes"))}),
        "processes": len(report["processes"]),
        "stores": len(report["stores"]),
        "alerts_danger": sum(1 for a in alerts if a["level"] == "danger"),
        "alerts_warning": sum(1 for a in alerts if a["level"] == "warning"),
    }
    t = report["totals"]
    t["has_changes"] = bool(t["master_changes"] or t["master_new"] or t["store_changes"])
    return report


def run_review(db, trigger: str = "programada") -> models.DailyReview:
    """Arma la revisión, la guarda y reemplaza a la pendiente anterior."""
    from .routers.logs import log_event
    from .scheduler import get_or_create_config

    with _LOCK:
        cfg = get_or_create_config(db)
        ids = None
        if cfg.review_shopify_ids:
            try:
                ids = json.loads(cfg.review_shopify_ids)
            except (ValueError, TypeError):
                ids = None
        try:
            report = build_review(db, ids)
            if not report.get("ok"):
                status = "error"
            elif report["totals"]["has_changes"]:
                status = "pendiente"
            else:
                status = "sin_cambios"
        except Exception as e:
            report = {"ok": False, "reason": _err_text(e), "traceback": traceback.format_exc()[-2000:]}
            status = "error"

        now = datetime.utcnow()
        db.query(models.DailyReview).filter(models.DailyReview.status == "pendiente").update(
            {"status": "reemplazada", "resolved_at": now}, synchronize_session=False)
        rev = models.DailyReview(status=status, trigger=trigger,
                                 report=json.dumps(report, ensure_ascii=False, default=str))
        db.add(rev)
        db.commit()
        db.refresh(rev)

    t = report.get("totals", {})
    if status == "error":
        log_event(db, "REVIEW_ERROR", "error", f"Revisión diaria #{rev.id} falló: {report.get('reason', '')}")
    else:
        log_event(db, "REVIEW_READY", "warning" if t.get("alerts_danger") else "info",
                  f"Revisión diaria #{rev.id} lista: {t.get('master_changes', 0)} cambios y "
                  f"{t.get('master_new', 0)} altas en la Maestra, {t.get('store_changes', 0)} cambios en tiendas, "
                  f"{t.get('alerts_danger', 0)} alertas rojas. "
                  + ("Esperando aprobación." if status == "pendiente" else "Todo cuadra, nada que aplicar."))
    return rev


# ─────────────────────────────────────────────────────────── aplicar lo aprobado
class ReviewError(Exception):
    pass


def apply_review(db, review: models.DailyReview) -> dict:
    """Aplica SOLO lo revisado que siga vigente. Primero la Maestra (y lo que
    cuelga de ella: hojas hijas y canales API, como un correr normal), después
    cada tienda Shopify revisada. Las tiendas fuera de la revisión no se tocan."""
    from .services import (_compute_master_sync, write_sheet_data_surgical, invalidate_read_cache,
                           get_sheet_data, _create_connector)
    from .scheduler import build_sync_request
    from .routers.logs import log_event

    with _LOCK:
        db.refresh(review)
        if review.status != "pendiente":
            raise ReviewError(f"Esta revisión ya no está pendiente (estado: {review.status}).")
        latest = db.query(models.DailyReview).order_by(models.DailyReview.id.desc()).first()
        if latest and latest.id != review.id:
            raise ReviewError("Hay una revisión más nueva: aprobá esa.")
        age_h = (datetime.utcnow() - review.created_at).total_seconds() / 3600
        if age_h > REVIEW_MAX_AGE_HOURS:
            review.status = "vencida"
            review.resolved_at = datetime.utcnow()
            db.commit()
            raise ReviewError(f"La revisión tiene más de {int(REVIEW_MAX_AGE_HOURS)} h: generá una nueva antes de aplicar.")

        report = json.loads(review.report)
        ctx = _master_context(db)
        if not ctx:
            raise ReviewError("No hay Maestra enlazada.")
        project, master_conn, master_sheet, sku_column = ctx
        invalidate_read_cache()

        out = {"processes": [], "stores": [], "downstream": {}}
        all_changes, all_new = [], []
        procs = {p.id: p for p in db.query(models.Process).all()}

        # 1) Maestra
        for pe in report.get("processes", []):
            if pe.get("status") != "ok" or not (pe.get("changes") or pe.get("new_rows")):
                continue
            res = {"name": pe["name"], "applied_changes": 0, "applied_new": 0}
            out["processes"].append(res)
            proc = procs.get(pe["process_id"])
            if not proc or not proc.is_active:
                res["skipped"] = "La fuente se pausó o borró después de la revisión."
                continue
            approved_changes = {master_change_key(c) for c in pe.get("changes", [])}
            approved_new = {_norm(n.get("sku")) for n in pe.get("new_rows", [])}
            try:
                result = _compute_master_sync(project, build_sync_request(proc), db)
                fresh_changes = result.get("changes", [])
                fresh_new = result.get("new_rows", [])
                if fresh_new and result.get("new_rows_look_broken"):
                    res["skipped"] = "El Guardián la frenó al recalcular (formato de SKU roto)."
                    continue
                ch = [c for c in fresh_changes if master_change_key(c) in approved_changes]
                nr = [n for n in fresh_new if _norm(n.get("sku")) in approved_new]
                res["not_approved"] = (len(fresh_changes) - len(ch)) + (len(fresh_new) - len(nr))
                res["no_longer_valid"] = (len(approved_changes) - len(ch)) + (len(approved_new) - len(nr))
                if ch or nr:
                    master_raw = result["master_raw"]
                    target_conn = result["master_conn"]
                    write_sheet_data_surgical(
                        spreadsheet_id=target_conn.spreadsheet_id,
                        sheet_name=result["target_sheet_name"],
                        headers=master_raw[0],
                        changes=ch,
                        new_rows=nr,
                        total_rows_before=len(master_raw) - 1 - len(fresh_new),
                    )
                    all_changes.extend(ch)
                    all_new.extend(nr)
                res["applied_changes"] = len(ch)
                res["applied_new"] = len(nr)
                log_event(db, "REVIEW_APPLY", "success",
                          f"Revisión #{review.id} aprobada · '{proc.name}': {len(ch)} cambios y {len(nr)} altas "
                          f"en la Maestra.", proc.id, None, None, len(ch) + len(nr))
            except Exception as e:
                res["error"] = _err_text(e)
                log_event(db, "REVIEW_APPLY", "error",
                          f"Revisión #{review.id} · '{pe['name']}' falló al aplicar: {res['error']}",
                          proc.id, None, traceback.format_exc())

        # Lo que cuelga de la Maestra (como en un correr normal) — menos Shopify,
        # que va abajo y solo con lo revisado.
        if all_changes or all_new:
            from .propagation import _propagate_changes, _push_api_subscriptions
            for label, fn in (("sheets", lambda: _propagate_changes(db, project.id, all_changes, all_new)),
                              ("api", lambda: _push_api_subscriptions(db, all_changes, all_new))):
                try:
                    fn()
                    out["downstream"][label] = "ok"
                except Exception as e:
                    out["downstream"][label] = f"error: {_err_text(e)}"

        # 2) Tiendas Shopify revisadas
        master_failed = any(p.get("error") for p in out["processes"])
        stores = [s for s in report.get("stores", []) if s.get("status") == "ok" and s.get("changes")]
        master_raw = None
        if stores:
            invalidate_read_cache()
            try:
                master_raw = get_sheet_data(master_conn, f"{master_sheet}!A1:Z")
            except Exception as e:
                out["stores_error"] = f"No se pudo leer la Maestra: {_err_text(e)}"
        for se in stores:
            res = {"name": se["name"], "applied": 0}
            out["stores"].append(res)
            if not master_raw:
                res["skipped"] = "No se pudo leer la Maestra."
                continue
            sub = db.query(models.ShopifySubscription).filter(
                models.ShopifySubscription.id == se["subscription_id"]).first()
            if not sub or not sub.is_active:
                res["skipped"] = "El destino se pausó o borró después de la revisión."
                continue
            shop_conn = db.query(models.Connection).filter(models.Connection.id == sub.connection_id).first()
            if not shop_conn or shop_conn.connection_type != "shopify":
                res["skipped"] = "La conexión ya no es una tienda Shopify."
                continue
            approved = {store_change_key(c) for c in se.get("changes", [])}
            try:
                updates = _updates_for(sub, master_raw, sku_column)
                connector = _create_connector(shop_conn)
                flags = _shopify_flags(sub)
                fresh = connector.push_updates(updates, dry_run=True, location_id=sub.location_id or None,
                                               preview_limit=MAX_LINES, **flags)
                only = {}
                for c in fresh.get("changes", []):
                    if store_change_key(c) in approved and c.get("field") in LABEL_TO_KEY:
                        only.setdefault(_norm(c["sku"]), set()).add(LABEL_TO_KEY[c["field"]])
                applied_lines = sum(len(v) for v in only.values())
                res["no_longer_valid"] = len(approved) - applied_lines
                res["not_approved"] = fresh.get("changes_total", 0) - applied_lines
                if not only:
                    res["skipped"] = ("Lo revisado dependía de cambios de la Maestra que no se pudieron escribir."
                                      if master_failed else "Nada de lo revisado sigue pendiente en la tienda.")
                    continue
                summary = connector.push_updates(updates, dry_run=False, location_id=sub.location_id or None,
                                                 only=only, **flags)
                res["applied"] = applied_lines
                res["summary"] = {k: summary.get(k) for k in (
                    "price_updated", "stock_updated", "compare_price_updated", "barcode_updated",
                    "title_updated", "product_type_updated")}
                res["errors"] = summary.get("errors", [])[:20]
                sub.last_pushed_at = datetime.utcnow()
                sub.last_push_summary = json.dumps(summary, default=str)
                db.commit()
                log_event(db, "SHOPIFY_SUB_PUSH", "success" if not summary.get("errors") else "warning",
                          f"Revisión #{review.id} aprobada · '{sub.name}': {applied_lines} cambios enviados "
                          f"({summary.get('price_updated', 0)} precios, {summary.get('stock_updated', 0)} stock).",
                          None, None, None, applied_lines)
            except Exception as e:
                res["error"] = _err_text(e)
                log_event(db, "SHOPIFY_SUB_PUSH", "error",
                          f"Revisión #{review.id} · '{se['name']}' falló al aplicar: {res['error']}",
                          None, None, traceback.format_exc())

        had_errors = master_failed or any(s.get("error") or s.get("errors") for s in out["stores"]) \
            or bool(out.get("stores_error"))
        review.status = "con_errores" if had_errors else "aplicada"
        review.resolved_at = datetime.utcnow()
        review.apply_summary = json.dumps(out, ensure_ascii=False, default=str)
        db.commit()
        return out


def discard_review(db, review: models.DailyReview) -> None:
    with _LOCK:
        db.refresh(review)
        if review.status != "pendiente":
            raise ReviewError(f"Esta revisión ya no está pendiente (estado: {review.status}).")
        review.status = "descartada"
        review.resolved_at = datetime.utcnow()
        db.commit()


# ─────────────────────────────────────────────────────────── vista compacta
def public_summary(review: models.DailyReview, sample: int = 15) -> dict:
    """Resumen corto de solo lectura (link fijo con token), pensado para un
    auditor externo: totales, alertas y una muestra de líneas por bloque."""
    report = json.loads(review.report) if review.report else {}
    return {
        "review_id": review.id,
        "status": review.status,
        "trigger": review.trigger,
        "created_at": review.created_at.isoformat() if review.created_at else None,
        "resolved_at": review.resolved_at.isoformat() if review.resolved_at else None,
        "reason": report.get("reason"),
        "totals": report.get("totals", {}),
        "alerts": report.get("alerts", []),
        "processes": [{
            "name": p.get("name"), "status": p.get("status"), "error": p.get("error"),
            "changes_total": p.get("changes_total", 0), "new_total": p.get("new_total", 0),
            "rows_zeroed": p.get("rows_zeroed", 0), "coherence": p.get("coherence"),
            "sample_changes": (p.get("changes") or [])[:sample],
            "sample_new": [n.get("sku") for n in (p.get("new_rows") or [])[:sample]],
        } for p in report.get("processes", [])],
        "stores": [{
            "name": s.get("name"), "store": s.get("store"), "status": s.get("status"), "error": s.get("error"),
            "changes_total": s.get("changes_total", 0), "by_field": s.get("by_field", {}),
            "not_found_count": s.get("not_found_count", 0), "conflicts_total": s.get("conflicts_total", 0),
            "sample_changes": (s.get("changes") or [])[:sample],
        } for s in report.get("stores", [])],
        "stores_not_reviewed": report.get("stores_not_reviewed", []),
        "downstream": report.get("downstream", {}),
        "apply_summary": json.loads(review.apply_summary) if review.apply_summary else None,
    }
