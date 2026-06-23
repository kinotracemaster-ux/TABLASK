"""Utilidades para sobrevivir a los límites de cuota de Google Sheets.

Google limita las lecturas a 60/min por usuario (y escrituras parecido). Cuando
se sincronizan varios procesos o se propaga a muchas hijas, es fácil pegar el
límite y recibir un HttpError 429. Este helper reintenta con backoff exponencial
(respetando Retry-After si viene) para que el pico se absorba en vez de reventar.
"""
import time
import random

try:
    from googleapiclient.errors import HttpError
except Exception:  # pragma: no cover - googleapiclient siempre está en runtime
    HttpError = None

# Estados transitorios que vale la pena reintentar.
_RETRYABLE_STATUS = {429, 500, 502, 503, 504}


def execute_with_retry(request, max_attempts: int = 6, base_delay: float = 1.0):
    """Ejecuta un HttpRequest de googleapiclient reintentando ante 429/5xx.

    El objeto `request` se puede reejecutar de forma segura (vuelve a enviar la
    petición), así que en cada intento llamamos a `request.execute()`.
    """
    delay = base_delay
    last_exc = None
    for attempt in range(max_attempts):
        try:
            return request.execute()
        except Exception as e:  # noqa: BLE001 - queremos inspeccionar el status
            status = None
            resp = getattr(e, "resp", None)
            if resp is not None:
                try:
                    status = int(resp.status)
                except (TypeError, ValueError):
                    status = None

            is_retryable = (HttpError is not None and isinstance(e, HttpError)
                            and status in _RETRYABLE_STATUS)
            if not is_retryable or attempt == max_attempts - 1:
                raise

            # Respetar Retry-After si el servidor lo manda; si no, backoff exp.
            wait = None
            if resp is not None:
                ra = resp.get("retry-after") if hasattr(resp, "get") else None
                if ra:
                    try:
                        wait = float(ra)
                    except (TypeError, ValueError):
                        wait = None
            if wait is None:
                wait = delay + random.uniform(0, 0.5)

            time.sleep(wait)
            delay = min(delay * 2, 60.0)
            last_exc = e

    if last_exc:
        raise last_exc
