# CLAUDE.md — TablasK

Guía corta para trabajar en este repo sin re-explorar cada sesión.
Se carga en **cada turno**: mantenerla ≤ ~100 líneas. La arquitectura profunda
vive en `MEMORIA_PROYECTO.md` (leerla solo cuando la tarea toque el motor).

## Qué es
Sincronizador de catálogos. Cruza fuentes (Google Sheets / CSV-Excel / API HTTP /
Shopify) hacia una **Tabla Maestra** que vive en Google Sheets, usando el **SKU**
como llave universal. Postgres solo guarda configuración (conexiones, procesos,
destinos), nunca los datos duros.

## Estructura
- `backend/` — FastAPI (Python 3.11)
  - `main.py` — app + arranque (monta routers, `start_scheduler()`)
  - `routers/` — endpoints por dominio (connections, intake, pipeline, schedule, shopify_*, staging…)
  - `services.py` — motor de sync (`_compute_master_sync`, `normalize_sku_for_match`, `get_sheet_data`)
  - `models.py` / `schemas.py` — SQLAlchemy / Pydantic
  - `connectors/` — `google_sheets.py`, `local_file.py`, `http_api.py`, `shopify.py` (base común en `base.py`)
  - `lavadero.py` — limpieza/validación por campo en el intake
  - `propagation.py` — distribución a hojas hijas + push a Shopify y canales API (background)
  - `api_push.py` — payload Maestra → API genérica (plantilla del canal, diff por SKU)
  - `scheduler.py` — piloto automático (thread daemon, estado en DB)
  - `export_engine.py` / `export_presets.py` — plantillas CSV con transformaciones
  - `intelligent_engine.py` — auto-detección de SKU y mapeo semántico
  - `sheets_retry.py` — backoff ante 429/5xx de Google Sheets
- `frontend/` — React + Vite + Tailwind (`src/components/`, `src/utils/`)
- `tests/` — pytest (usan DB temporal vía `conftest.py`, no tocan red)

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
  `not_found`. El push solo actualiza precio/stock de variantes existentes.
- **Modelo simétrico de canales:** entra por archivo o API (pull o push con `api-key`
  por el túnel real) → Maestra → cada canal sale por API (`ApiSubscription`, diff
  quirúrgico) o archivo (CSV con link fijo `?token=`). El túnel (Lavadero → Guardián →
  escritura quirúrgica) es el mismo venga de donde venga.
- **El Guardián:** si un sync cruza <10% de SKUs, se bloquea (manual) o se salta
  (automático, log `AUTO_SYNC_SKIP`). No contaminar la Maestra.
- **El Lavadero** limpia precio/stock/nombre antes de escribir; lo que no se puede
  limpiar se retiene y se reporta (`rejected`/`review`), no se escribe sucio.
- **Cuota de Sheets (429):** respetar el retry con backoff y la caché de lecturas;
  invalidarla al escribir (`invalidate_read_cache`).
- Código y comentarios en **español**, igual que el resto del repo.
- Al cambiar lógica del motor, correr `pytest -q`; los tests fijan reglas de negocio
  de riesgo (normalización SKU, push Shopify, lavadero, scheduler, export engine).

## Despliegue
Railway con Nixpacks (`nixpacks.toml` / `railway.toml`). Un solo worker uvicorn
sirve el backend; el frontend se compila en el build. Ver `README.md`.
