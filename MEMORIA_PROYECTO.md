# Contexto y Memoria del Proyecto: TablasK

Este documento sirve como **memoria central** del proyecto. Contiene la arquitectura, la filosofía de diseño y el estado actual del desarrollo. 

## 🤖 PROTOCOLO DE INICIO (Para la IA)
**Cuando inicies una nueva sesión de chat o un nuevo agente para este proyecto, el usuario te indicará que leas este archivo. DEBES LEER este documento (`MEMORIA_PROYECTO.md`) en su totalidad antes de proponer cambios arquitectónicos o escribir código nuevo.**

---

## 1. Filosofía y Arquitectura Core
* **Google Sheets como Base de Datos Maestra:** La "Tabla Maestra" vive EXCLUSIVAMENTE en la nube (Google Sheets). Los datos duros (celdas, filas) NO se guardan en la base de datos PostgreSQL de la aplicación. Esto permite al usuario editar la información manualmente en Google Sheets en cualquier momento sin desincronizar la aplicación.
* **PostgreSQL (Railway) como Configuración:** La base de datos de la app solo guarda metadatos y configuraciones: Conexiones (URLs de Google Sheets), Procesos de importación (Mapeo de columnas) y Formatos de Salida (Exportaciones).
* **El SKU es la Llave Universal:** Todo el sistema cruza información utilizando una columna "llave" única (generalmente el SKU). El nombre de esta columna puede variar en los orígenes, pero su contenido dicta cómo se fusiona la información.

## 2. Flujo de Trabajo (El "Motor")
El motor de datos son 4 pilares (Conexiones, Procesos, Tabla Maestra, Distribución/Suscripciones), pero **la interfaz (React) ya NO expone esas 4 pantallas por separado** (ver §3.1: simplificación de julio 2026). De cara al usuario todo pasa por:
1. **"+ Nueva Fuente"** (`SourceWizard.jsx`, 3 pasos: Traer datos → Confirmar campos → Elegir destinos) para dar de alta una fuente y sus destinos.
2. **"Mis Flujos"** (`Flujos.jsx`) para pausar/borrar lo ya creado.
3. **"Tabla Maestra"** (home) con el botón **"⚡ Correr Procesos"**.

Por dentro, sigue siendo: una Conexión (Google Sheet / archivo subido / API HTTP / Shopify) → un Proceso que mapea su núcleo (sku/name/price/stock) hacia la Maestra → Suscripciones (Sheets) o Exportaciones CSV o un push puntual a Shopify como destinos.
   - *Lógica de Sincronización:* Si el SKU ya existe en la Maestra, **sólo se sobreescriben** las columnas mapeadas cuyos valores hayan cambiado. Si el SKU no existe, se **añade** como una fila nueva al final.

## 3. Hitos Logrados y Arquitectura Actual
* **Motor "Acumulador Inteligente":** Cada origen externo aporta solo la información de sus columnas mapeadas a una Maestra centralizada. Los valores no mapeados se conservan intactos.
* **El Guardián y StagingBatch (Paso Intermedio Seguros):** Ningún cambio se escribe automáticamente en la base de datos de Google Sheets sin pasar por una cuarentena temporal (`StagingBatch`). 
   - Los batches expiran a los 30 minutos para evitar escrituras basadas en datos obsoletos de origen.
   - Si el Guardián detecta <10% de coincidencias de SKU, bloquea preventivamente la ejecución (requiere override manual).
* **Distribución Quirúrgica (Suscripciones):** Las hojas hijas reciben automáticamente *sólo los campos a los que están suscritas*, propagados mediante `BackgroundTasks` en la API (FastAPI) únicamente si la escritura original a la Maestra fue exitosa. Las escrituras a hijas fallidas se loggean pero no abortan el pipeline.
* **Escritura Celda por Celda (BatchUpdate):** En vez de descargar y reescribir la matriz gigante de Google Sheets, el motor actualiza la nube mediante el API granular enviando únicamente los rangos "A2, B4..." que cambiaron (`write_sheet_data_surgical`).
* **Cuota de Google Sheets (429):** Sheets limita ~60 lecturas/min por usuario. Para no reventar: (1) **retry con backoff** exponencial ante 429/5xx en todas las llamadas, respetando `Retry-After` (`backend/sheets_retry.py::execute_with_retry`, usado en `services.py` y el conector); (2) **caché corta de lecturas** en `services.get_sheet_data` por `(spreadsheet_id, sheet_name)` con TTL `SHEETS_READ_CACHE_TTL` (45s por defecto), que colapsa relecturas de la misma hoja (ej. la Maestra al sincronizar varios procesos). La caché se **invalida** al escribir esa hoja (`invalidate_read_cache`). Solo aplica a Google Sheets (local/HTTP no tienen cuota).
* **Clasificación del sync (REGLA central): coherencia BASE → Master por SKU normalizado.** En `_compute_master_sync` (`services.py`). Principio: *BASE es el flujo inicial y todo lo que está en BASE debe existir en Master (que enriquece y distribuye).*
  - **Cruce por SKU NORMALIZADO** (`normalize_sku_for_match`): `1203.0`/`01203`/mayúsculas/espacios cruzan con `1203`. La normalización es SOLO para comparar; el SKU guardado no se altera (se conserva el de la Maestra al actualizar).
  - **Cruza** → se **rellena el núcleo** (solo las columnas de `field_mappings`: name/price/stock). El **enriquecimiento** (color/description/category…, que no está en mappings) **nunca se toca**.
  - **No está en Master** → se **CREA** la fila con el núcleo (SKU + name/price/stock); el enriquecimiento queda vacío para llenarse luego. Como el cruce es normalizado, no se duplican los que ya estaban con otro formato. Dedup interno de BASE (si trae el SKU 2 veces).
  - **Huérfanos** (`rows_orphan`/`detail_orphan`): SKUs en Master que NO llegaron desde BASE → solo se reportan (no se borran).
  - **`coherence_index`**: % de BASE que ya estaba en Master antes de crear. Termómetro de integración.
  El guard anti-basura (fila-encabezado del proveedor) sigue. El SKU se mete en `fields` de `new_rows` para que la escritura quirúrgica escriba el código.
* **Limpieza de código muerto (Jul 2026, primera pasada):** se eliminó lo que no formaba parte del flujo real Base→Master→Distribución:
  - Microsistema de resolución manual "Se parecen"/"No aparecen" (`StagingQueue.jsx`, endpoints `/api/staging/{id}/{pending,approve,reject,resolve}`) — dormido desde que el motor dejó de generar `suspects`/`new_candidates`.
  - Detección fuzzy `find_similar_sku` (sin llamadores).
  - API vieja per-proyecto de Tabla Maestra (`/api/projects/{id}/master*`, `/api/sync/*`, `/api/run-all`, `sync_engine.py`) — duplicaba la API global (`/api/master`, `/api/master-columns`, `/api/master/sync-reflection`) que sí usa el frontend.
  - `POST /api/exports/{id}/push` y la pestaña "Salidas" de `MasterTable.jsx` — el `output_type` que hubiera activado el push (`google_sheets`) nunca era creable desde la UI; quedó como código inalcanzable.
  - El flujo vigente de un solo botón es: `MasterTable.jsx` → `POST /api/processes/{id}/stage` (preview) → `POST /api/staging/execute-bulk` (escribe + dispara propagación en background).
* **Simplificación de UI (Jul 2026, segunda pasada) — un solo asistente en vez de 4 pantallas:** se borraron `Connections.jsx`, `Processes.jsx`, `Exports.jsx`, `ShopifyPush.jsx` y los endpoints de "procesos preestablecidos" (`/api/processes/presets*`, dependían de una hoja `BASE` hardcodeada en el mismo Sheet que la Maestra). Reemplazados por:
  - **`SourceWizard.jsx`** ("+ Nueva Fuente"): 3 pasos — (1) Traer datos: conecta Google Sheet / sube CSV-Excel / conecta API HTTP / conecta Shopify (crea la `Connection` correspondiente); (2) Confirmar campos: auto-detecta hojas/columnas y sugiere SKU + mapeo contra la Maestra (reusa `intelligent_engine`), crea el `Process` ya activo; (3) Elegir destinos: agrega una Suscripción (Sheets), una Exportación CSV, o hace un push puntual a Shopify (no queda "guardado" como los otros dos: se previsualiza y se envía ahí mismo, reusa `/api/shopify/push`).
  - **`Flujos.jsx`** ("Mis Flujos"): única pantalla de gestión — lista Fuentes (Procesos), Destinos (Suscripciones + Exportaciones CSV) y Conexiones, cada una con pausar/borrar. Reemplaza la necesidad de editar desde 3 pantallas distintas.
  - Se sacaron del `main.py` los endpoints ahora huérfanos: `/api/processes/presets`, `/api/processes/{id}/preview`, `/api/processes/{id}/run` (y `services._run_single_process`, sin más llamadores).

* **Conector Shopify (multi-tienda, LECTURA):** `backend/connectors/shopify.py` (`connection_type="shopify"`). Cada tienda es una **conexión** con `shopify_domain` + `shopify_client_id` + `shopify_client_secret` (+ `shopify_api_version`, default `2026-04`). 
  - **Auth:** `client_credentials grant` (`POST /admin/oauth/access_token`) → token de **24h cacheado en memoria** (`_TOKEN_CACHE`). Sirve para tiendas propias (app y tienda en la misma organización); **no** requiere OAuth con redirects. Los custom apps del admin (token `shpat_`) quedaron deprecados (1-ene-2026); por eso se usa el Dev Dashboard + client credentials.
  - **Lectura:** GraphQL Admin API (REST quedó legacy). `fetch_data` pagina `products`+`variants` y devuelve **una fila por variante** (`sku`, `product_title`, `price`, `inventory_quantity`, `inventory_item_id`, `variant_id`, ...). Se mapea como cualquier otra fuente al núcleo de la Maestra.
  - **Seguridad:** el `client_secret` es **write-only** (entra por `ConnectionCreate`, nunca se devuelve; el response expone solo `has_shopify_secret`). Endpoint `POST /api/connections/{id}/test` valida credenciales. UI: opción "Shopify" en `SourceWizard.jsx` (Paso 1 como origen de lectura, Paso 3 como destino de escritura).
  - **Pendiente (fase B):** ESCRITURA a Shopify (`inventorySetQuantities` con `changeFromQuantity` + `@idempotent`, requeridos desde 2026-04) vía suscripciones.

## 4. Fuera de Scope (Versión Actual)
Se discutieron y se marcaron explícitamente como "fuera de scope" (no implementados):
- Suscripciones a hijas con la regla de negocio "Sobreescribir SOLO si la celda hija está vacía". Actualmente, la distribución siempre sobreescribe con el valor de la Maestra.
- El diccionario semántico (AI/Mappings) no "aprende" automáticamente ni hace blacklist de los rechazos del usuario.
- Escritura individual a nivel microscópico por cada celda: aunque se hace `batchUpdate` específico, se agrupa la fila completa si se añade una nueva.

## 5. Reglas Estrictas de Desarrollo
* **NUNCA** proponer migrar la data de la Tabla Maestra a PostgreSQL. Se acordó explícitamente mantener Google Sheets como la única fuente de la verdad.
* **Protección Relacional:** Las conexiones (orígenes y destinos) no pueden borrarse si están atadas a `FieldSubscription`s o `Process`es activos.
* **Backend FastAPI:** Manejar BackgroundTasks para propagación.
* **Frontend React:** Manejo de estados de carga explícitos para no congelar la UI.

---

## 6. Flujo de Trabajo de Git (PREMISA NO NEGOCIABLE)

> ⛔ **PREMISA NO NEGOCIABLE:** En este proyecto **SIEMPRE y SOLO se maneja UNA rama de trabajo: `pruebas`**.
> **NO se crean otras ramas. NUNCA. Por ninguna razón.** Ni ramas de "feature", ni ramas
> automáticas tipo `claude/*` generadas por el entorno web. Si una sesión arranca en otra
> rama, lo PRIMERO que se hace es moverse a `pruebas` y trabajar ahí.

Este proyecto se maneja con **solo dos ramas en total** (una de trabajo + una estable). Cualquier sesión de IA o desarrollo manual DEBE respetar esto:

* **`pruebas`** → **ÚNICA** rama de trabajo. TODO el desarrollo, los commits y los `push` van aquí. **Es la única rama que se edita.**
* **`main`** → Rama estable y desplegable. Railway publica desde aquí. **NUNCA se edita ni se commitea directo en `main`.** Solo recibe fusiones (merge) ya probadas, y solo cuando el usuario lo pida.

### Obligación al iniciar CUALQUIER sesión (IA o manual)
1. `git fetch origin`
2. `git checkout pruebas` (si no existe local: `git checkout -b pruebas origin/pruebas`).
3. `git pull origin pruebas` → empezar siempre desde lo último.
4. Si el entorno te puso en una rama `claude/*` u otra cualquiera: **cámbiate a `pruebas` antes de tocar nada.** No commitees en la rama autogenerada.

### Ciclo de trabajo
1. Se edita en la carpeta local (o en la sesión web), **siempre sobre `pruebas`**.
2. `git push origin pruebas` → sube los cambios a `pruebas` (jamás a `main`, jamás a otra rama).
3. El usuario **prueba** la app (local y/o deploy de pruebas).
4. **Solo cuando el USUARIO lo pida explícitamente**, se fusiona `pruebas` → `main` (vía Pull Request o merge). La IA NO debe fusionar a `main` por iniciativa propia.

### Reglas de oro
* **PROHIBIDO crear ramas nuevas** (feature, fix, experimentales, `claude/*`, etc.). Todo vive en `pruebas`.
* Antes de empezar a trabajar: `git checkout pruebas && git pull origin pruebas`.
* No guardar tokens/credenciales dentro del repo ni en la URL del remoto (usar `gh auth login` o SSH).

---
*Última actualización: 23 de Junio de 2026*
