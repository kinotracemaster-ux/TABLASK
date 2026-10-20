"""Clave de acceso de la app.

Sin esto, cualquiera con el link de Railway podía ver la Maestra completa y,
peor, disparar envíos a Shopify. Ahora toda la API pide una clave compartida
(variable de entorno `TABLASK_PASSWORD`) en el header `X-TablasK-Key`.

Decisiones:
- **Falla cerrada.** Si la clave no está configurada, la API no responde nada
  (503 con un mensaje que dice qué hacer), en vez de quedar abierta en silencio.
- **Los links que ya traen su propio candado siguen abiertos**, porque los usa
  un sistema externo que no conoce la clave: la descarga de un CSV por canal
  (`?token=`) y el intake empujado por una app conectada (header `api-key`).
  La lista es explícita por método y ruta exacta, no por prefijo, para que
  `/api/exports/{id}/regenerate-token` NO quede abierto de rebote.
- Es una clave compartida para el equipo, no usuarios con permisos distintos.
  Alcanza para cerrar la puerta; si algún día hace falta separar por persona,
  el middleware es el único lugar a cambiar.
"""
import hmac
import os
import re

from fastapi import APIRouter
from fastapi.responses import JSONResponse

HEADER = "x-tablask-key"
ENV_VAR = "TABLASK_PASSWORD"

FALTA_CLAVE = (
    "La app no tiene clave configurada. En Railway, agregá la variable "
    "TABLASK_PASSWORD con la clave que quieras y volvé a desplegar."
)
CLAVE_MALA = "Clave incorrecta."

# Rutas de la API que NO piden la clave porque ya tienen la suya.
_ABIERTAS = (
    ("GET", re.compile(r"^/api/exports/\d+/download/?$")),   # link fijo del canal CSV (?token=)
    ("POST", re.compile(r"^/api/intake/push/?$")),           # app conectada (header api-key)
)


def esta_abierta(method: str, path: str) -> bool:
    return any(m == method and rx.match(path) for m, rx in _ABIERTAS)


def clave_configurada() -> str:
    return (os.getenv(ENV_VAR) or "").strip()


async def auth_middleware(request, call_next):
    """Exige la clave en todo /api/, menos las rutas con candado propio.

    Lo que no empieza con /api/ (el frontend, los assets) pasa derecho: si no,
    no habría de dónde escribir la clave.
    """
    path = request.url.path
    if not path.startswith("/api/") or request.method == "OPTIONS":
        return await call_next(request)
    if esta_abierta(request.method, path):
        return await call_next(request)

    clave = clave_configurada()
    if not clave:
        return JSONResponse(status_code=503, content={"detail": FALTA_CLAVE})

    enviada = request.headers.get(HEADER, "")
    # compare_digest: comparación de tiempo constante (no filtra la clave por
    # cuánto tarda en responder).
    if not enviada or not hmac.compare_digest(enviada, clave):
        return JSONResponse(status_code=401, content={"detail": CLAVE_MALA})

    return await call_next(request)


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/check")
def check():
    """La pantalla de ingreso llama acá. Si la clave está mal, el middleware
    responde 401 antes de llegar; si falta configurarla, 503."""
    return {"ok": True}
