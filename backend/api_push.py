"""Envío Maestra → API genérica (destino "canal API").

Módulo con la parte pura (armar el payload) separada del envío HTTP, para
fijarla con tests sin tocar la red. El payload por fila se arma con la
plantilla del canal (transform_spec, mismas transformaciones del export
engine §11: field/concat/slug/price/const/template); si el canal no tiene
plantilla, la fila sale con TODAS las columnas de la Maestra tal cual.

Regla dura compartida con Shopify: hacia afuera la Maestra siempre gana y el
push NUNCA borra ni crea nada localmente — solo informa al endpoint del canal.
"""
import json
from typing import Any, Dict, List, Optional

from .export_engine import transform_headers, transform_row


def rows_from_master(master_raw: List[List[str]],
                     transform_spec: Optional[List[Dict[str, Any]]] = None,
                     only_skus: Optional[set] = None,
                     sku_column: Optional[str] = None) -> List[Dict[str, str]]:
    """Convierte la matriz de la Maestra en filas dict listas para el payload.

    - transform_spec: plantilla del canal; si es None, cada fila sale con todas
      las columnas de la Maestra (dict columna → valor).
    - only_skus: set de SKUs *normalizados* a incluir (diff quirúrgico tras un
      sync); None = Maestra completa. Requiere sku_column para filtrar.
    """
    if not master_raw or len(master_raw) < 2:
        return []

    headers = master_raw[0]

    sku_idx = -1
    if only_skus is not None:
        if not sku_column or sku_column not in headers:
            return []
        sku_idx = headers.index(sku_column)

    from .services import normalize_sku_for_match

    rows = []
    for row in master_raw[1:]:
        if only_skus is not None:
            sku_val = row[sku_idx] if sku_idx < len(row) else ""
            if normalize_sku_for_match(str(sku_val)) not in only_skus:
                continue

        row_dict = {headers[i]: (row[i] if i < len(row) else "") for i in range(len(headers))}
        if transform_spec:
            out_headers = transform_headers(transform_spec)
            out_values = transform_row(row_dict, transform_spec)
            rows.append(dict(zip(out_headers, out_values)))
        else:
            rows.append(row_dict)
    return rows


def affected_skus_from_diff(changes: List[Dict[str, Any]], new_rows: List[Dict[str, Any]]) -> set:
    """SKUs (normalizados) tocados por un sync: los que cambiaron + los creados.
    Es el mismo principio quirúrgico del push Shopify: no se re-empujan los
    3.000 productos, solo lo que cambió en ESTA corrida."""
    from .services import normalize_sku_for_match
    skus = set()
    for ch in changes or []:
        norm = normalize_sku_for_match(str(ch.get("sku", "")))
        if norm:
            skus.add(norm)
    for nr in new_rows or []:
        norm = normalize_sku_for_match(str(nr.get("sku", "")))
        if norm:
            skus.add(norm)
    return skus


def build_request(sub, rows: List[Dict[str, str]]) -> Dict[str, Any]:
    """Arma (url, method, headers, body_json) desde una ApiSubscription.
    Separado de send_rows para poder previsualizarlo/testearlo sin red."""
    headers = {"Content-Type": "application/json"}
    try:
        extra = json.loads(sub.extra_headers) if sub.extra_headers else {}
        if isinstance(extra, dict):
            headers.update({str(k): str(v) for k, v in extra.items()})
    except (json.JSONDecodeError, TypeError):
        pass
    if sub.auth_token:
        headers[sub.auth_header_name or "Authorization"] = sub.auth_token

    body = {
        "source": "TablasK",
        "channel": sub.name,
        "count": len(rows),
        "rows": rows,
    }
    method = (sub.http_method or "POST").upper()
    if method not in ("POST", "PUT", "PATCH"):
        method = "POST"
    return {"url": sub.url, "method": method, "headers": headers, "json": body}


def send_rows(sub, rows: List[Dict[str, str]], timeout: int = 30) -> Dict[str, Any]:
    """Envía las filas al endpoint del canal. Devuelve un resumen serializable
    (para last_push_summary y para los logs). No lanza: el error queda en el
    resumen y el llamador decide cómo loggearlo."""
    import requests

    req = build_request(sub, rows)
    try:
        resp = requests.request(
            method=req["method"],
            url=req["url"],
            headers=req["headers"],
            json=req["json"],
            timeout=timeout,
        )
        return {
            "sent": len(rows),
            "status_code": resp.status_code,
            "ok": 200 <= resp.status_code < 300,
            "response_excerpt": (resp.text or "")[:300],
        }
    except Exception as e:
        return {"sent": 0, "status_code": None, "ok": False, "error": str(e)[:300]}
