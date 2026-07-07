# Tests — Actualizar Tablas K

Primer set de pruebas del motor. Se enfoca en la lógica **más peligrosa y más
autocontenida**: la normalización de SKU (regla central del cruce) y el
`push_updates` de Shopify (única acción que escribe a una tienda en vivo).

Estas pruebas **no tocan la red ni Google Sheets**: los métodos que llaman a
Shopify se reemplazan con `monkeypatch`, así que corren en milisegundos y sin
credenciales.

## Cómo correrlas

`pytest` aún no está en `requirements.txt`. Instálalo (idealmente en un
`requirements-dev.txt` aparte para no cargar prod):

```bash
pip install pytest
```

Desde la **raíz del repo**:

```bash
pytest -q
```

(Se ejecuta desde la raíz porque los tests importan `backend.*`, igual que arranca la app.)

## Qué cubren

**`test_sku_normalization.py`**
- Reglas de `normalize_sku_for_match`: espacios, mayúsculas, decimales de Sheets
  (`1203.0`→`1203`), ceros a la izquierda (`01203`→`1203`), casos límite (`000`→`0`,
  `1203.5` que NO se colapsa, `None`/vacío).
- **Paridad** entre `services.normalize_sku_for_match` y
  `ShopifyConnector._normalize_sku`: la segunda promete "mismas reglas"; el test
  evita que se separen sin que nadie lo note.

**`test_shopify_push.py`**
- `dry_run` reporta el cruce **sin escribir nada**.
- Cruce por SKU normalizado (`01203` cruza con la variante `1203`).
- Agrupación de precio por producto (una llamada bulk por producto).
- Normalización de decimales (`19,99`→`19.99`; stock `12,5`→`12`).
- **Reglas de negocio de riesgo**, fijadas a propósito:
  - vacío (`""`/ausente) en precio o stock → **se salta**.
  - `0` en stock → **SÍ escribe** (pone el stock en 0). Este test documenta el
    riesgo que motiva agregar un *preview con diff de valores* antes de enviar.

## Qué falta (deuda de testing pendiente)

- `_compute_master_sync` (BASE→Master): es el core, pero necesita mockear
  `get_sheet_data` + la sesión de DB. Siguiente objetivo natural.
- El Guardián: expiración de lote (30 min) y bloqueo por <10% de match.
- Los conectores CSV/HTTP y el auto-mapeo (`intelligent_engine`).
