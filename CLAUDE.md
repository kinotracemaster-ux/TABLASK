# CLAUDE.md — TablasK

Guía corta para trabajar en este repo sin re-explorar cada sesión.
Se carga en **cada turno**: mantenerla ≤ ~100 líneas. Todo lo demás (estado,
pendientes, historial de chats y arquitectura profunda) vive en **un solo MD:
`PROYECTO.md`**. No crear otros MD de proyecto.

## Qué es
Sincronizador de catálogos. Cruza fuentes (Google Sheets / CSV-Excel / API HTTP /
Shopify) hacia una **Tabla Maestra** que vive en Google Sheets, usando el **SKU**
como llave universal. Postgres solo guarda configuración (conexiones, procesos,
destinos), nunca los datos duros.

**Prioridad #1:** que sea muy sencillo de ejecutar y entender para el usuario
final. Si una feature complica el uso, no va.

## Estructura
> Mapa para ubicarte sin abrir nada. Abrí solo el archivo que vas a tocar.
- `backend/` — FastAPI (Python 3.11)
  - `main.py` — app + arranque (monta routers, `start_scheduler()`)
  - `routers/` — endpoints por dominio (connections, intake, pipeline, schedule, shopify_*, staging…)
  - `services.py` — motor de sync (`_compute_master_sync`, `normalize_sku_for_match`, `get_sheet_data`)
  - `models.py` / `schemas.py` — SQLAlchemy / Pydantic
  - `connectors/` — `google_sheets.py`, `local_file.py`, `google_drive.py`, `http_api.py`, `shopify.py` (base común en `base.py`)
  - `auth.py` — clave de acceso de la API (`TABLASK_PASSWORD`, header `X-TablasK-Key`)
  - `pricing.py` — multiplicador de precio por canal (precio base × margen del canal)
  - `lavadero.py` — limpieza/validación por campo en el intake
  - `propagation.py` — distribución a hojas hijas + push a Shopify y canales API (background)
  - `api_push.py` — payload Maestra → API genérica (plantilla del canal, diff por SKU)
  - `scheduler.py` — piloto automático (thread daemon, estado en DB; modo "auto" escribe, modo "review" no)
  - `review.py` — Revisión diaria: calcula Fuentes→Maestra→Shopify sin escribir; al aprobar aplica solo lo revisado que siga vigente
  - `export_engine.py` / `export_presets.py` — plantillas CSV con transformaciones
  - `intelligent_engine.py` — auto-detección de SKU y mapeo semántico
  - `sheets_retry.py` — backoff ante 429/5xx de Google Sheets
- `frontend/` — React + Vite + Tailwind (`src/components/`, `src/utils/`)
- `tests/` — pytest (usan DB temporal vía `conftest.py`, no tocan red)
- `herramientas/subir_excel/` — script del PC (solo stdlib) que sube los Excel a sus Fuentes antes de la revisión

## Comandos
Backend (desde `backend/`):
```bash
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r ../requirements.txt
uvicorn main:app --reload            # http://127.0.0.1:8000/docs
```
Frontend (desde `frontend/`):
```bash
npm install
npm run dev     # http://localhost:5173
npm run build
npm run lint    # eslint, 0 warnings permitidos
```
Tests (desde la **raíz** del repo, importan `backend.*`):
```bash
pip install -r requirements-dev.txt   # incluye pytest
pytest -q
```

## Convenciones y reglas duras (no romper)
- **La Maestra vive en Google Sheets**, no en Postgres. El motor escribe celda por
  celda (`write_sheet_data_surgical`), nunca reescribe la matriz completa.
- **El SKU es la llave.** El cruce usa SKU *normalizado* (`normalize_sku_for_match`);
  la normalización es solo para comparar — el SKU guardado no se altera.
- **Nunca se crean productos en Shopify.** Los SKUs que no cruzan se reportan como
  `not_found`. El push solo actualiza productos/variantes existentes, cruzando por
  SKU — configurables uno o varios por destino: precio, stock, precio comparativo y
  código de barras (VARIANTE); nombre y categoría (PRODUCTO — si el SKU comparte
  producto con otras variantes, el cambio afecta al producto entero). Sigue sin
  tocar descripción ni imágenes.
- **Modelo simétrico de canales:** entra por archivo o API (pull o push con `api-key`
  por el túnel real) → Maestra → cada canal sale por API (`ApiSubscription`, diff
  quirúrgico) o archivo (CSV con link fijo `?token=`). El túnel (Lavadero → Guardián →
  escritura quirúrgica) es el mismo venga de donde venga.
- **Carpeta de Drive como origen** (`connectors/google_drive.py`): la conexión guarda
  `drive_folder_id` y en cada corrida se toma el archivo **más reciente** de adentro
  (.xlsx/.xls/.csv). Ignora los `.md` y los temporales `~$` de Excel abierto. El
  parseo lo delega en `LocalFileConnector` — no duplicar ese lector.
- **El Guardián** decide por PARECIDO, no por % de coherencia a secas: un SKU nuevo
  casi-idéntico a uno ya existente (`NEAR_DUP_RATIO`, `services.py`) es "formato
  roto" y bloquea (manual) o salta (automático, log `AUTO_SYNC_SKIP`); un SKU nuevo
  que no se parece a nada es alta legítima y pasa, aunque la coherencia sea baja.
  Altas de la MISMA referencia (ej. "…-3" cuando ya existe "…-2") no cuentan como
  parecido sospechoso — mismo `sku_reference_base` con distinto número de variante.
- **El Lavadero** limpia precio/stock/nombre antes de escribir; lo que no se puede
  limpiar se retiene y se reporta (`rejected`/`review`), no se escribe sucio.
- **La API pide clave** (`auth.py`): variable `TABLASK_PASSWORD` + header `X-TablasK-Key`.
  Si la variable falta, la API responde 503 — **falla cerrada**, nunca abierta. Quedan
  sin clave solo las rutas con candado propio: `GET /api/exports/{id}/download?token=`
  y `POST /api/intake/push` (header `api-key`).
- **Multiplicador por canal** (`pricing.py`): cada destino Shopify tiene
  `price_multiplier` (default 1.0 = la columna va tal cual). Aplica SOLO al precio,
  no al stock ni al precio comparativo. La web de Poedagar usa 2,8.
- **Cuota de Sheets (429):** respetar el retry con backoff y la caché de lecturas;
  invalidarla al escribir (`invalidate_read_cache`).
- Código y comentarios en **español**, igual que el resto del repo.
- Al cambiar lógica del motor, correr `pytest -q`; los tests fijan reglas de negocio
  de riesgo (normalización SKU, push Shopify, lavadero, scheduler, export engine).

## Canales y reglas de negocio
- **BASE-SYS:** fuente del precio base.
- **Precio sugerido = precio base × 2** (solo lo muestra Kyte, que es catálogo).
- **Shopi-Kino:** lleva TODOS los relojes de Base, excluyendo algunos.
- **Shopi-Poe:** solo productos POEDAGAR.
- **Effi:** debe quedar sincronizado con Shopify por inventario.
- **Módulos Shopify (son dos, a propósito):**
  - Bajada (Shopify → Maestra): plan de emergencia cuando no está el archivo BASE.
  - Subida (Maestra → Shopify): flujo normal.

## Despliegue
Railway con Nixpacks (`nixpacks.toml` / `railway.toml`). Un solo worker uvicorn
sirve el backend; el frontend se compila en el build. Ver `README.md`.

## Estado del proyecto
Al inicio de cada sesión leer la **Parte 1 de `PROYECTO.md`** (§0–§3: qué se hizo,
qué falta, índice de chats). La Parte 2 (§4–§9, arquitectura e historial del
motor) solo cuando la tarea toque el motor. Al cierre: actualizar §1–§2 y, si hubo
feature nueva, su detalle en §6.
