"""Aviso al celular cuando hay una revisión lista (Telegram).

Opcional: si faltan TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID no se manda nada y
todo sigue igual (la revisión se ve en la app). Telegram porque es gratis y no
pide cuenta Business como WhatsApp. El link lleva a la pantalla "Actualizar"
(TABLASK_PUBLIC_URL), donde se aprueba: el mensaje nunca aprueba solo.
"""
import json
import os
import urllib.request


def configurado() -> bool:
    return bool(os.getenv("TELEGRAM_BOT_TOKEN") and os.getenv("TELEGRAM_CHAT_ID"))


def texto_revision(report: dict, status: str, origen: str = "") -> str:
    """Resumen corto, en palabras simples, de una revisión."""
    t = (report or {}).get("totals", {}) or {}
    cab = f"TablasK: llegó un archivo nuevo{f' ({origen})' if origen else ''}."
    if status == "error":
        return f"{cab}\nNo se pudo revisar: {(report or {}).get('reason', 'error desconocido')}"
    if status == "sin_cambios":
        return f"{cab}\nTodo cuadra: no hay nada que actualizar en Shopify."
    lineas = [cab, f"Cambios para la tienda: {t.get('store_changes', 0)}"]
    if t.get("master_new"):
        lineas.append(f"Productos nuevos en el archivo: {t['master_new']}")
    rojas = t.get("alerts_danger", 0)
    amarillas = t.get("alerts_warning", 0)
    if rojas or amarillas:
        lineas.append(f"Alertas: {rojas} importantes, {amarillas} para revisar")
    url = os.getenv("TABLASK_PUBLIC_URL", "").rstrip("/")
    lineas.append(f"Revisá y aprobá aquí: {url}/" if url else "Entrá a TablasK para revisar y aprobar.")
    return "\n".join(lineas)


def enviar(texto: str) -> bool:
    """Manda el texto por Telegram. Nunca lanza: un aviso caído no frena nada."""
    if not configurado():
        return False
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    cuerpo = json.dumps({"chat_id": os.getenv("TELEGRAM_CHAT_ID"), "text": texto,
                         "disable_web_page_preview": True}).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=cuerpo,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return 200 <= r.status < 300
    except Exception as e:
        print("No se pudo mandar el aviso de Telegram:", str(e)[:200])
        return False
