# PROYECTO — TablasK · Maestra + inventario Shopify Poedagar

> **Documento único del proyecto.** Reemplaza a `PROGRESS.md` y
> `MEMORIA_PROYECTO.md` (y a los resúmenes sueltos de cada chat). Todo lo que se
> hizo con Claude sobre la Tabla Maestra, la subida/inventario a Shopify y la
> actualización de la web de Poedagar vive acá.
>
> - **Parte 1 (§0–§3):** estado, qué se hizo, qué falta, índice de chats. Corta:
>   leerla al inicio de cada sesión.
> - **Parte 2 (§4–§9):** arquitectura e historial técnico del motor. Leerla solo
>   cuando la tarea toque el motor.
>
> Cierre de sesión: actualizar §0–§2 (corto) y, si hubo feature nueva, su detalle
> en §6. No crear MD nuevos: todo va en este archivo.
>
> Última actualización: 2026-10-21

---

# PARTE 1 — Estado del proyecto

## §0. Qué es y para qué
TablasK cruza las fuentes de inventario (archivo del SYS / BASE, Excel, carpeta de
Drive, Google Sheets, API, Shopify) hacia una **Tabla Maestra en Google Sheets**,
usando el **SKU** como llave, y desde ahí actualiza los canales: **Shopi-Poe** (web
Poedagar), **Shopi-Kino**, Kyte, Effi y CSV. Objetivo concreto de hoy: **que el
inventario y los precios de los productos POEDAGAR en Shopify se actualicen solos
desde el archivo del SYS**, con revisión diaria antes de tocar la web.

App en Railway (backend FastAPI + frontend React). Repo: `kinotracemaster-ux/TABLASK`.

## §1. Mini resumen — lo que ya está hecho
Todo fusionado en `main` y desplegado (PR #1 … #69):

- **Motor Fuente → Maestra** (jun–jul): cruce por SKU normalizado, escritura
  celda por celda, Lavadero (limpia precio/stock/nombre), Guardián (frena SKUs
  con formato roto), staging con vista previa antes de escribir.
- **Subida Maestra → Shopify** (jul–sep): actualiza precio, stock, precio
  comparativo, código de barras, nombre y categoría de productos **existentes**
  (nunca crea productos). Vista previa con detalle SKU por SKU. Conflictos entre
  variantes de color resueltos por la variante principal ("-1").
- **Bajada Shopify → Maestra**: plan de emergencia cuando falta el archivo BASE.
- **Una tienda = un destino** (dedup, #46): fin de los destinos duplicados que
  corrompían el stock. Verificado 20-oct: hoy no queda ningún duplicado.
- **"Actualizar Maestra" en una sola pantalla** (#60–#63): subir archivo →
  Maestra → Shopify, sin obligar a guardar un flujo.
- **Fixes Shopify** (#64–#66): aviso falso de ubicación, token cacheado por
  secret, Guardián que bloqueaba altas legítimas, `add_new_rows` sin efecto.
- **Octubre** (#67–#69):
  - **Revisión diaria**: el piloto calcula Fuentes → Maestra → Shopify sin
    escribir, avisa, y al aprobar aplica solo lo revisado.
  - **Clave de acceso** (`TABLASK_PASSWORD`): **ya activa en Railway**
    (verificado 20-oct: 401 sin clave, 200 con clave).
  - **Multiplicador de precio por canal** (web Poedagar = base × 2,8).
  - **Carpeta de Drive como origen**: toma siempre el archivo más reciente.
- **Pantalla "Actualizar"** (26-oct, rama `actualizar-con-un-archivo`): la app abre en
  una sola pantalla: subir el archivo del SYS → "Esto va a cambiar en Shopify" →
  Aprobar. También vigila una carpeta de Drive buzón cada 5 min y avisa por
  Telegram. Alertas nuevas: SKU repetidos, stock negativo, SKU que no existen en
  Shopify y códigos de número doble. Todo lo demás pasó a `/admin`.
- **Script del PC** `herramientas/subir_excel/` (instrucciones en su `LEEME.md`) para subir el Excel
  del día antes de la revisión.

Fuera de TablasK pero del mismo objetivo:
- `INVENTARIO-RAPIDO-K`: arreglado el lector de precios del archivo SYS
  (9.993 ítems, 3.133 con stock). Revisar en Kyte/Shopify si quedó algo
  subido con precio $0 antes del fix.
- `Auto-Catalogo-K`: links de fotos de Drive en el catálogo PDF/web (#6, #8).
- `PLANTILLA-WEB-POEDAGAR` (tema de la web): limpieza de "warehouse" hecha en
  rama, **sin PR**.

## §2. Lo que falta (en orden)
**Bloqueante — sin esto nada se actualiza en la web de Poedagar:**
1. **Token de la app de Shopify de la tienda Poedagar** (Dev Dashboard,
   client id + secret) con permisos `read_products`, `write_products`,
   `read_inventory`, `write_inventory`, `read_locations`. Lo pega el usuario en
   la app, **nunca por chat**. La conexión Shopify `ii1apd-ws.myshopify.com` **sí es** la tienda de
   Poedagar (verificado 26-oct): solo falta agregarle el scope `read_locations`.

**Configuración en producción (no requiere código):**
2. Destino **Shopi-Poe** con multiplicador **2,8 sobre el precio del SYS** (1401-1:
   130.000 → 364.000; el × 1,4 es sobre el precio de Kyte = SYS × 2) y Shopi-Kino.
3. Crear el proceso Fuente → Maestra con el archivo del SYS
   (`INVENTARIO_POEDAGAR`, ~621 filas): `Artículo`→SKU, `Descripción`→nombre,
   `Exist. unidades`→stock, `Precio`→precio base. Precio y stock llegan como
   texto (`"45,000.00"`, `"2.00"`): los limpia el Lavadero.
4. Borrar las Fuentes repetidas `EXISTENCIAS POEDAGAR (2).xlsx` (ids 57/58/59,
   dejar una).
5. Carpeta de Drive: compartirla con la cuenta de servicio de Google, habilitar
   la API de Drive y conectarla como origen.
6. Activar la **Revisión diaria** (Revisar y avisar · 7:00 a. m. · Shopi-Kino +
   Shopi-Poe), programar `herramientas/subir_excel/` en el PC y pasar el link
   del auditor a la tarea de Claude.

**Seguridad:**
7. Rotar credenciales de Shopify y de Google (estuvieron expuestas mientras la
   app estuvo abierta sin clave).

**Mejoras pendientes (código):**
- UI: aviso "posible formato de SKU roto" cuando el preview trae
  `new_rows_look_broken=True` (backend listo, frontend sin usar).
- UI: filtrar/resaltar en la Maestra los productos con `estado = NUEVO`.
- Anti-sobreventa (descontar por venta confirmada) y precio manual vs.
  automático por canal: ideas de `MEJORAS_TABLASK.md` (ese archivo nunca llegó
  al repo; las referencias a él en la Parte 2 quedan como históricas).
- Llenar los campos de enriquecimiento de la Maestra (color, descripción,
  categoría…).
- Proyecto "Actualización web Poedagar": cola de pendientes para que el agente
  resuelva solo las excepciones.

**Verificaciones en producción pendientes:**
- Correr una sync real con altas de una referencia existente (ej. color nuevo)
  y confirmar que el Guardián ya no saltea el lote.
- Probar "Actualizar Maestra" con credenciales reales de Google Sheets.

**Ramas viejas sin fusionar** (decidir si se rescatan o se borran; todo lo
importante ya está en `main`): `subir-repo-descomprimido` (plantilla BASE-SYS →
stock de un clic), `destination-sheet-config` (destino configurable por flujo),
`productos-actualizados-archivo` (rechazar dominio propio en vez del admin de
Shopify), `new-session-rppfx6` (reemplazar archivo de una fuente — ya cubierto
por "cambiar archivo"). PR #70 (`estado-oct20`) queda absorbido por este
documento y se puede cerrar.

### Decisiones tomadas (no re-discutir)
- La Maestra vive en Google Sheets, nunca en Postgres.
- Nunca se crean productos en Shopify; los SKUs que no cruzan se reportan.
- Dos módulos Shopify a propósito: bajada = emergencia, subida = flujo normal.
- Carpeta de Drive: se toma el archivo **más reciente**, no uno con nombre fijo.
- Revisión diaria elegida por el usuario: revisar y reportar, 1 vez al día,
  Shopi-Kino + Shopi-Poe + Maestra.
- Limpiar duplicados viejos a mano, no por código: elegir "el bueno" es
  decisión humana.

## §3. Índice de chats (sesiones de Claude) unificados aquí
Todos los chats sobre la Maestra / Shopify / Poedagar quedan resumidos en este
documento; no hace falta volver a abrirlos. Lo más reciente primero.

| Fecha | Chat | Resultado |
|---|---|---|
| 2026-10-21 | Unificar proyecto Claude y Shopify | Este documento |
| 2026-10-19/20 | Conversación de claude.ai (proyecto) | Clave verificada; nada configurado para Poedagar; falta token Shopify; PR #70 |
| 2026-10 | Revisión diaria / clave + multiplicador / Drive | PR #67, #68, #69 fusionados |
| 2026-09-25 | Generador de links del Drive (Auto-Catalogo-K) | PR #8 fusionado |
| 2026-09-22 | Generar Drive / Configurar DRIVE_FOLDER_ID (Auto-Catalogo-K) | PR #6; falta `GOOGLE_SERVICE_ACCOUNT_JSON` en ese servicio |
| 2026-09-21 | Optimizar tokens (INVENTARIO-RAPIDO-K) | Fix precios del archivo SYS |
| 2026-09-15 | Error GraphQL Shopify 401 | Fix Guardián + add_new_rows (#66) |
| 2026-09-12 | Nombre producto no aparece en descripción | Quedó la duda: ¿renombrar `ii1apd-ws` o multi-tienda? → resuelto: falta la tienda Poedagar (§2.1) |
| 2026-09-04 | Conexión tabla maestra Shopify | "Actualizar Maestra" sin guardar flujo (#63) |
| 2026-09-03 | Colores al cambiar nombre de variante | Detalle completo en preview (#62), variante principal (#58–#59) |
| 2026-09-02 | Campos actualizables en Shopify | Mapeo de campos dinámico (#57) |
| 2026-09-01 | (sin título) | Duda: SKUs con guion sobrante — ¿tolerarlo en la normalización? (abierta) |
| 2026-08-31 | Productos actualizados no en archivo | Rama sin fusionar (dominio propio) |
| 2026-08-27 | Actualización de inventario con precio | Dedup de destinos Shopify (#46) |
| 2026-08-24/25 | Contexto completo / Volvemos al proyecto | Fix SKU case-insensitive en push |
| 2026-08-14 | Proceso de subida de archivo Poe-Shopi | Campos configurables; faltaba scope `read_locations` |
| 2026-07-31 | Configuración de hoja de destino | Rama sin fusionar |
| 2026-07-27 | Subir repo descomprimido | Plantilla BASE-SYS → stock (rama sin fusionar) |
| 2026-07-24/27 | Warehouse tema / Eliminar warehouse (PLANTILLA-WEB-POEDAGAR) | Rama sin PR |
| 2026-07-22/24 | Flujo Maestra→Shopify / Flujo centralizado / Seleccionar hoja | Elegir hoja de la Maestra en ambos extremos |
| 2026-07-10 | SYS file upload / Shopify admin config / TEMA_POEDAGAR | UX de subida (#20); acceso a la org POEDAGARCOLOMBIA |
| 2026-07-06/08 | Imágenes por color / New session | Primeros tests (#16), reemplazar archivo de fuente |
| 2026-06-18/30 | App review / Project revision / Integración Shopify | Arranque: deploy Railway, conector Shopify, maestra por defecto |

---

# PARTE 2 — Arquitectura e historial técnico

## §4. Filosofía y Arquitectura Core
* **Google Sheets como Base de Datos Maestra:** La "Tabla Maestra" vive EXCLUSIVAMENTE en la nube (Google Sheets). Los datos duros (celdas, filas) NO se guardan en la base de datos PostgreSQL de la aplicación. Esto permite al usuario editar la información manualmente en Google Sheets en cualquier momento sin desincronizar la aplicación.
* **PostgreSQL (Railway) como Configuración:** La base de datos de la app solo guarda metadatos y configuraciones: Conexiones (URLs de Google Sheets), Procesos de importación (Mapeo de columnas) y Formatos de Salida (Exportaciones).
* **El SKU es la Llave Universal:** Todo el sistema cruza información utilizando una columna "llave" única (generalmente el SKU). El nombre de esta columna puede variar en los orígenes, pero su contenido dicta cómo se fusiona la información.

## §5. Flujo de Trabajo (El "Motor")
El motor de datos son 4 pilares (Conexiones, Procesos, Tabla Maestra, Distribución/Suscripciones), pero **la interfaz (React) ya NO expone esas 4 pantallas por separado** (ver §6.1: simplificación de julio 2026). De cara al usuario todo pasa por:
1. **"+ Nueva Fuente"** (`SourceWizard.jsx`, 3 pasos: Traer datos → Confirmar campos → Elegir destinos) para dar de alta una fuente y sus destinos.
2. **"Mis Flujos"** (`Flujos.jsx`) es el centro de operación: pausar/borrar/editar Y **correr cada flujo** (ver §6, "Correr por flujo"). Cada Fuente tiene su botón "Correr flujo"; arriba hay un "Correr todo" para los activos.
3. **"Tabla Maestra"** (home): muestra los datos y enlaza un botón "Correr flujos" que lleva a Mis Flujos. Ya NO tiene el botón global "⚡ Correr Procesos" (retirado jul 2026).

Por dentro, sigue siendo: una Conexión (Google Sheet / archivo subido / API HTTP / Shopify) → un Proceso que mapea su núcleo (sku/name/price/stock) hacia la Maestra → Suscripciones (Sheets) o Exportaciones CSV o un push puntual a Shopify como destinos.
   - *Lógica de Sincronización:* Si el SKU ya existe en la Maestra, **sólo se sobreescriben** las columnas mapeadas cuyos valores hayan cambiado. Si el SKU no existe, se **añade** como una fila nueva al final.

## §6. Hitos Logrados y Arquitectura Actual
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
* **Limpieza de modelos muertos (Jul 2026, tercera pasada):** se retiraron los modelos y schemas de la arquitectura vieja per-proyecto que ya no tenían ningún uso en el flujo real: `SourceTable`, `TargetTable`, `FieldMapping`, `SyncRule`, `SyncLog` (y sus relaciones en `Project`). Los 4 conceptos vivos quedan claros: **Conexión, Fuente (`Process`), Destino (`FieldSubscription` / `ShopifySubscription` / `ExportFormat`), Log (`ExecutionLog`)**. Nota: a diferencia del plan original del MD §9, `Project` se conserva (guarda la config de la Maestra global: `master_connection_id`/`master_sheet_name`/`master_sku_column`) y `ExportFormat` dejó de estar deprecado (es el Destino CSV con plantillas §11). Las tablas huérfanas en Postgres no estorban; en una DB nueva simplemente no se crean.
* **Simplificación de UI (Jul 2026, segunda pasada) — un solo asistente en vez de 4 pantallas:** se borraron `Connections.jsx`, `Processes.jsx`, `Exports.jsx`, `ShopifyPush.jsx` y los endpoints de "procesos preestablecidos" (`/api/processes/presets*`, dependían de una hoja `BASE` hardcodeada en el mismo Sheet que la Maestra). Reemplazados por:
  - **`SourceWizard.jsx`** ("+ Nueva Fuente"): 3 pasos — (1) Traer datos: conecta Google Sheet / sube CSV-Excel / conecta API HTTP / conecta Shopify (crea la `Connection` correspondiente); (2) Confirmar campos: auto-detecta hojas/columnas y sugiere SKU + mapeo contra la Maestra (reusa `intelligent_engine`), crea el `Process` ya activo; (3) Elegir destinos: agrega una Suscripción (Sheets), una Exportación CSV, o hace un push puntual a Shopify (no queda "guardado" como los otros dos: se previsualiza y se envía ahí mismo, reusa `/api/shopify/push`).
  - **`Flujos.jsx`** ("Mis Flujos"): única pantalla de gestión — lista Fuentes (Procesos), Destinos (Suscripciones + Exportaciones CSV) y Conexiones, cada una con pausar/borrar. Reemplaza la necesidad de editar desde 3 pantallas distintas.
  - Se sacaron del `main.py` los endpoints ahora huérfanos: `/api/processes/presets`, `/api/processes/{id}/preview`, `/api/processes/{id}/run` (y `services._run_single_process`, sin más llamadores).

* **Conector Shopify (multi-tienda, LECTURA):** `backend/connectors/shopify.py` (`connection_type="shopify"`). Cada tienda es una **conexión** con `shopify_domain` + `shopify_client_id` + `shopify_client_secret` (+ `shopify_api_version`, default `2026-04`). 
  - **Auth:** `client_credentials grant` (`POST /admin/oauth/access_token`) → token de **24h cacheado en memoria** (`_TOKEN_CACHE`). Sirve para tiendas propias (app y tienda en la misma organización); **no** requiere OAuth con redirects. Los custom apps del admin (token `shpat_`) quedaron deprecados (1-ene-2026); por eso se usa el Dev Dashboard + client credentials.
  - **Lectura:** GraphQL Admin API (REST quedó legacy). `fetch_data` pagina `products`+`variants` y devuelve **una fila por variante** (`sku`, `product_title`, `price`, `inventory_quantity`, `inventory_item_id`, `variant_id`, ...). Se mapea como cualquier otra fuente al núcleo de la Maestra.
  - **Seguridad:** el `client_secret` es **write-only** (entra por `ConnectionCreate`, nunca se devuelve; el response expone solo `has_shopify_secret`). Endpoint `POST /api/connections/{id}/test` valida credenciales. UI: opción "Shopify" en `SourceWizard.jsx` (Paso 1 como origen de lectura, Paso 3 como destino de escritura).
  - **Escritura (fase B, HECHA - jul 2026): Maestra → Shopify vía suscripciones.** Nuevo modelo `ShopifySubscription` (destino permanente, tabla `shopify_subscriptions`): tienda + columnas de la Maestra para precio/stock + bodega (`location_id`). Dos caminos de envío:
    1. **Automático (diff quirúrgico):** al ejecutar un sync que escribe la Maestra, `propagation.py::_push_shopify_subscriptions` empuja SOLO los SKUs cuyo precio/stock cambió en esa corrida (usa `build_shopify_updates`, fijada por tests). Corre en el mismo background task que la propagación a hojas hijas; un fallo contra Shopify se loggea (`SHOPIFY_SUB_PUSH`) pero no aborta nada.
    2. **Manual ("Enviar ahora"):** `POST /api/shopify-subscriptions/{id}/push-now` manda la Maestra completa, con `dry_run` para previsualizar el cruce antes de escribir.
    Regla dura en ambos: NUNCA se crean productos en la tienda (los que no cruzan se reportan como `not_found`). Escritura vía `push_updates` del conector (`productVariantsBulkUpdate` para precio, `inventorySetQuantities` + `@idempotent` para stock). UI: guardar destino permanente en Paso 3 del Wizard; tarjetas en "Mis Flujos" (pausar/borrar/enviar ahora + último envío). Protección relacional: la conexión no se borra si una suscripción Shopify la usa.

* **Piloto automático / sync programada (jul 2026).** Correr todas las fuentes activas cada X horas sin tener la app abierta (MEJORAS_TABLASK §5).
  - **`scheduler.py`**: thread daemon (`start_scheduler()` en `main.py`, idempotente). Hace "tick" cada 5 min y compara `next_run_at` (en la DB) contra el reloj; cuando vence, corre y reprograma. Como el estado vive en la DB, sobrevive reinicios de Railway (un solo worker uvicorn → sin duplicación). `run_scheduled_sync` reutiliza `_compute_master_sync` + escritura quirúrgica + `propagate_changes` (empuja también a Shopify), SIN pasar por StagingBatch.
  - **Guardián en automático:** como no hay humano que confirme, si un proceso cruza <10% de SKUs y quiere crear filas nuevas (formato de SKU probablemente roto), se SALTA y se registra `AUTO_SYNC_SKIP` en vez de contaminar la Maestra. Éxitos/errores quedan como `AUTO_SYNC_OK`/`AUTO_SYNC_ERROR` en Logs.
  - **Modelo `ScheduleConfig`** (registro único) + router `/api/schedule` (GET/PUT/run-now). UI: **`AutoSyncPanel.jsx`** en Mis Flujos — toggle on/off, selector de intervalo, "Correr ahora", y "próxima/última corrida". Fijado por `tests/test_scheduler.py` (incluye el skip del Guardián). Se agregó `tests/conftest.py` para que los tests usen una DB temporal.

* **Plantillas de export predefinidas con transformaciones (jul 2026).** Un export ya no solo renombra columnas: cada columna de salida se calcula con una fórmula (MEJORAS_TABLASK §11). Un clic aplica una plantilla por canal en vez del mapeo columna-a-columna.
  - **`export_engine.py`** (motor puro, con tests): transformaciones `field` / `concat` (sku+name para Effi/Kyte) / `slug` (handle Shopify) / `price` (base × multiplicador, ×2 global) / `const` / `template` ({columna} en texto, ej. Body HTML). Reusa `lavadero.clean_price` para respetar formatos sucios.
  - **`export_presets.py`** + `GET /api/exports/presets`: 4 canales listos — **Shopify CSV** (Handle slug, Variant Price ×2), **Kyte** (Nombre=sku+name, Código=sku, Precio ×2, flags S/N), **Effi** (Descripción=sku+name), **Catálogo** (espejo con precio sugerido ×2). Los `source` usan nombres del núcleo; la UI los remapea a las columnas reales de la Maestra.
  - **Modelo:** `ExportFormat.transform_spec` (Text JSON, nullable) + migración. Si está, el download (`/api/exports/{id}/download`) usa el motor; si no, cae al renombrado directo de `columns_mapping` (retrocompat intacta).
  - **UI (`SourceWizard.jsx` paso 3, destino CSV):** botones de plantilla + "Mapeo manual". Al elegir una, muestra las columnas de salida que se generan solas y un remapeo "campo del preset → columna real de la Maestra" (auto-detectado, editable). Fijado por `tests/test_export_engine.py`.

* **Home tipo pipeline con semáforos (jul 2026).** Arriba del Home (Tabla Maestra) va una banda visual `[Fuentes] → [MAESTRA] → [Destinos]` para entender el sistema de un vistazo (MEJORAS_TABLASK §5).
  - **`GET /api/pipeline`** (`routers/pipeline.py`): arma el estado sin disparar ninguna sync. Semáforos derivados de datos ya registrados: fuentes desde el último `ExecutionLog` (`WRITE_SUCCESS`→verde, `WRITE_ERROR`/`STAGE_ERROR`→rojo, sin logs→amber, pausado→gris); destinos Shopify desde `last_pushed_at` + errores del `last_push_summary`; suscripciones Sheets verde/gris (se propagan solas); exportaciones CSV verde. `total_rows` de la Maestra se lee con tolerancia a fallo (si Sheets no responde, el home no se rompe).
  - **`PipelineBar.jsx`**: banda con nodos (punto de color + ícono + "última corrida hace X"), leyenda de colores y enlace "Operar flujos →". Se oculta si no hay Maestra enlazada. Botón de refrescar. NO reemplaza la tabla de datos: va encima.

* **Correr por flujo (jul 2026): se retira el botón "correr todos" a favor de control individual.** Antes, la Tabla Maestra tenía un único botón "⚡ Correr Procesos" que stageaba y ejecutaba TODOS los procesos activos juntos. Ahora cada flujo se corre por separado desde **Mis Flujos** (`Flujos.jsx`): cada Fuente tiene su botón "Correr flujo" y hay un "Correr todo" para los activos.
  - **`RunFlowModal.jsx`** (componente compartido): recibe uno o varios procesos, los pone en staging (`/api/processes/{id}/stage`), muestra la vista previa humana (nuevas / actualizaciones / lavadero / advertencia de baja coincidencia) y recién al confirmar ejecuta (`/api/staging/execute-bulk`). Es el mismo Guardián/staging de antes, expuesto por flujo.
  - Los destinos Shopify (`ShopifySubscription`) ya tenían su propio "Enviar ahora" en Mis Flujos; ahora entradas y salidas se operan desde el mismo lugar.
  - Backend intacto: no cambió ni `stage` ni `execute-bulk`; el rediseño es de UI (dónde se dispara). Se quitó de `MasterTable.jsx` toda la maquinaria de preview global (código muerto).

* **El Lavadero (jul 2026): normalización + validación por campo en el intake.** `backend/lavadero.py`, invocado dentro de `_compute_master_sync` ANTES de comparar/escribir cada valor del núcleo. Principio: lo que no se puede limpiar NO se escribe sucio — se retiene y se reporta con motivo visible.
  - **Clasificación semántica** de las columnas mapeadas (reusa `intelligent_engine.get_semantic_group`): precio / stock / nombre. El SKU y el enriquecimiento NO se lavan.
  - **Limpiezas:** precio (quita `$`, separa miles/decimal según formato real de Kino: `$ 45.000`→`45000`, `38000,00`→`38000`); stock (fuerza entero, acepta `5.0`/`5,00`, rechaza `5 unid` y fracciones reales); nombre (colapsa espacios, respeta mayúsculas de marca).
  - **Estados por valor:** `ok`/`cleaned` se escriben; `empty` nunca pisa un valor existente de la Maestra; `rejected` (texto en precio, `gratis`) y `review` (precio 0, stock negativo) NO se escriben y van al reporte. En filas nuevas, un valor retenido deja la celda vacía (no escribe basura).
  - **Reporte (`WashReport`)** viaja en el diff del staging → la vista previa muestra "🧼 Lavadero: N limpiados · M rechazados · K a revisar" con tabla expandible (SKU / campo / valor recibido / motivo). Fijado por `tests/test_lavadero.py`.

* **Canales de salida y entrada por API o archivo (jul 2026).** Cierra el modelo simétrico *"entra por archivo o API → Maestra → cada canal sale por archivo o API"*. Tres piezas:
  1. **Destino API genérica (`ApiSubscription`, router `/api/api-subscriptions`):** el equivalente de las suscripciones Shopify pero contra cualquier endpoint HTTP del cliente (Effi u otros). Mismos dos caminos: **automático** (tras cada sync, `propagation.py::_push_api_subscriptions` empuja SOLO las filas de los SKUs afectados — diff quirúrgico, filtrado por SKU normalizado) y **manual** ("Enviar ahora" con `dry_run` que muestra el payload sin llamar la API). El payload por fila se arma con la **plantilla del canal** (`transform_spec`, mismas transformaciones del export engine §11) o, sin plantilla, con todas las columnas de la Maestra. `auth_token` write-only (el response expone solo `has_token`). Parte pura en `backend/api_push.py` (fijada por `tests/test_api_channels.py`). UI: opción "API externa" en el Paso 3 del Wizard (reusa el selector de plantillas) y tarjetas en Mis Flujos.
  2. **Link fijo de descarga por canal CSV:** `ExportFormat.public_token` (auto-generado al crear + backfill al arrancar). `GET /api/exports/{id}/download?token=...` lo exige (comparación en tiempo constante) y `POST /api/exports/{id}/regenerate-token` lo rota. Así un sistema externo (o un `IMPORTDATA`) baja el CSV del canal sin abrir la app. UI: botón "copiar link fijo" en la tarjeta CSV de Mis Flujos.
  3. **Entrada por API empujada por el túnel real:** si una app conectada (`ConnectedApp`) está vinculada a una Fuente (`target_process_id`), lo que empuje a `POST /api/intake/push` (header `api-key`) entra por el MISMO túnel del sync manual: `_compute_master_sync` con `src_raw_override` (los datos llegan en el request) → Lavadero → **Guardián en modo automático** (salta si cruza <10% con filas nuevas, log `INTAKE_PUSH_SKIP`) → escritura quirúrgica → propagación (hijas + Shopify + canales API). Sin Fuente vinculada se conserva el comportamiento viejo (encolar en Staging para revisión). Fijado por `tests/test_intake_push.py`. UI: selector "Fuente vinculada" en Conexiones de Apps.

* **Guardián inteligente por PARECIDO (jul-ago 2026): ya no bloquea altas nuevas por baja coherencia a secas.** Antes, si un sync cruzaba <10% de SKUs Y traía filas nuevas, se bloqueaba/saltaba directo — pero eso también frenaba altas legítimas de catálogo (SKUs genuinamente nuevos, coherencia baja porque es la primera carga). Ahora el criterio es si las filas "nuevas" **se parecen** a SKUs que ya existen en la Maestra:
  - `backend/services.py`: `NEAR_DUP_RATIO` (env `GUARDIAN_NEAR_DUP_RATIO`, default 0.85) — similitud desde la cual un SKU "nuevo" se considera casi-idéntico a uno existente (`difflib.get_close_matches` sobre SKU normalizado). `BROKEN_FORMAT_MIN` (env `GUARDIAN_BROKEN_FORMAT_MIN`, default 0.5) — fracción de "nuevos" casi-idénticos a partir de la cual se declara `new_rows_look_broken=True` (probable formato de SKU roto: mismo producto, SKU mal escrito/con sufijo).
  - Señal expuesta en el resultado de `_compute_master_sync`: `new_rows_look_broken` / `new_rows_suspect_ratio`. Solo bloquea/salta cuando `look_broken=True`; SKUs nuevos que no se parecen a nada (altas reales) se crean aunque la coherencia general sea baja. Usado en `scheduler.py` (auto) e `routers/intake.py` (push); expuesto en el preview manual (`routers/processes.py`) para que el humano vea el aviso — **pendiente**: el frontend todavía no muestra ese aviso (ver PROYECTO.md (Parte 1) → Próximos pasos).
  - No cubre el caso "columna equivocada" (valores que no se parecen a nada de la Maestra): ese sigue dependiendo del preview manual (confirmación humana).
* **Marca de altas nuevas (`estado = NUEVO`, jul-ago 2026):** al CREAR una fila nueva en la Maestra, se escribe además una columna de control (`ESTADO_COL`, env `MASTER_ESTADO_COL`, default `"estado"`) con el valor `ESTADO_NUEVO` (env `MASTER_ESTADO_NUEVO`, default `"NUEVO"`). Si la columna no existe en la hoja, se agrega al final sin tocar el resto. Así los productos recién creados por el motor no quedan "perdidos" mezclados con el resto — quedan resaltados para que el usuario los enriquezca (color/descripción/categoría) y luego les cambie el estado a mano. Efecto secundario útil: la escritura quirúrgica ahora reescribe la fila de encabezados al necesitar apendizar una columna nueva (antes quedaban columnas sin título). **Pendiente en UI:** filtrar/resaltar en `MasterTable.jsx` las filas con `estado=NUEVO` (ver Próximos pasos).
* **Agotar faltantes / anti-stock fantasma (jul-ago 2026), flag `zero_missing_stock` por Proceso (default OFF, opt-in a propósito):** cuando está ON, los SKU que están en la Maestra pero NO llegaron en esa corrida de la fuente pasan a `stock = 0` (solo toca la columna de stock, solo si tenía valor > 0; nunca toca otras columnas ni borra la fila). Pensado para que **solo la fuente de verdad del inventario** (BASE-SYS) pueda "agotar" — si cualquier fuente parcial tuviera esto ON, vaciaría stock de productos que simplemente no vienen en ESA fuente. Resultado expuesto como `rows_zeroed`/`detail_zeroed` en `_compute_master_sync`; visible en el preview y en `scheduler.py`/`routers/intake.py`. UI: checkbox + aviso al editar un Proceso en `Flujos.jsx`.
* **Módulo "Shopify → Maestra" (Bajada, plan de emergencia — separado a propósito de la Subida):** `ShopifyMasterSyncConfig` (registro único, `routers/shopify_master_sync.py`, UI `ShopifyMasterSync.jsx`) trae precio/stock desde una tienda Shopify y **actualiza** (nunca crea filas) los SKU que YA están en la Maestra, mapeando por columnas configuradas (`sku_column_master`/`price_column_master`/`stock_column_master`). Pensado para cuando el archivo BASE-SYS no está disponible y hay que mantener la Maestra al día igual. Es el espejo inverso del flujo normal (Maestra → Shopify vía `ShopifySubscription`), y CLAUDE.md remarca que son dos módulos separados **a propósito** (no hay que fusionarlos).
* **`MasterSnapshot`:** última "foto" conocida de la Maestra (JSON `{sku: {columna: valor}}` por `project_id`), pensada para detectar ediciones manuales hechas directo en Google Sheets y reflejarlas a las hojas hijas suscritas. Modelo vivo en `models.py`; confirmar alcance real de uso en el código de propagación antes de asumir que está activo en todos los flujos.
* **Página dedicada "Archivo → Maestra → Shopify" (`FileToShopify.jsx`, ruta `/subir-shopify`, ago 2026):** simétrica a la de Bajada, agrupa en una sola pantalla con 3 tarjetas numeradas lo que antes requería pasar por el Wizard + Mis Flujos por separado: (1) Archivo → crea la Fuente (auto-detecta SKU y mapeo contra la Maestra); (2) botón "Actualizar Maestra ahora" (abre `RunFlowModal` del proceso); (3) Shopify → guarda `ShopifySubscription` + Previsualizar/Enviar. No agrega lógica de backend nueva, solo reusa endpoints existentes en un layout más directo para el caso de uso más común.
* **Cierre "Correr ahora" en el Wizard (`SourceWizard.jsx`, ago 2026):** el Paso 3 (Elegir destinos) antes dejaba la fuente creada pero SIN correr — la Maestra no se actualizaba hasta un "Correr Procesos" manual poco visible. Ahora termina con una tarjeta "Actualizar ahora" (mini-diagrama Archivo → Maestra → Shopify + botón) que abre `RunFlowModal` sobre el proceso recién creado, cerrando el círculo completo (alta + primera corrida) en un solo lugar.
* **`PipelineBar.jsx` interactivo (home, ago 2026):** dejó de ser solo decorativo — cada nodo (Fuente/Maestra/Destino) tiene botones que arman un deep-link `/flujos?action=&node=` y disparan la acción real ya existente en `Flujos.jsx` (Correr, Editar, Ver Maestra, Enviar). Genérico para cualquier fuente/destino, no hardcodea ningún canal particular.
* **Push a Shopify con campos configurables (ago 2026), extiende §6 "Escritura Maestra → Shopify":** antes `ShopifySubscription` solo mandaba precio + stock. Ahora, a nivel VARIANTE, también puede mandar **precio comparativo/oferta** (`compare_price_column_master`) y **código de barras** (`barcode_column_master`) — cualquier combinación, opcionales. `push_updates` arma una sola llamada bulk con los campos activos (flags `do_compare_price`/`do_barcode`, contadores propios en el summary). Sigue sin crear productos ni tocar título/descripción/imágenes — la regla dura de §6 no cambia, solo se amplía qué campos de VARIANTE se pueden sincronizar. Auto-migración de las 2 columnas nuevas en `main.py` al arrancar. UI en 3 lugares: `FileToShopify.jsx`, el Wizard, y el modal de edición de destino en `Flujos.jsx` (antes no existía edición, solo pausar/borrar/enviar).
* **Guardián contra mapear la misma columna a dos campos de un destino Shopify (ago 2026):** `_validate_payload` en `shopify_subscriptions.py` rechaza (400) crear/editar una suscripción si dos de los cuatro campos de variante (precio/stock/precio comparativo/barcode) apuntan a la misma columna de la Maestra. Nace de un caso real: PRICE mapeado a la vez a "Precio" y "Stock" → Shopify mostró el precio como cantidad en existencias. Aplica a los 3 puntos de entrada (Wizard, `FileToShopify.jsx`, modal de Flujos) porque los tres pegan al mismo endpoint. El inventario que ya quedó corrupto en Shopify con una suscripción mal mapeada NO se recupera solo — hay que corregirlo a mano en Shopify o resincronizar desde una fuente con stock real. Tests: `tests/test_shopify_subscriptions_validation.py`.
* **Una tienda Shopify = un solo destino guardado (dedup, ago 2026):** `saveShopSub`/`saveShopifySubscription` (los 3 puntos de entrada de arriba) hacían siempre `POST /api/shopify-subscriptions/` sin chequear si esa tienda ya tenía un destino — cada archivo nuevo dejaba OTRO `ShopifySubscription` para la misma tienda, y como `propagation.py` corre TODOS los destinos activos en cada sync, un destino viejo con mapeo peligroso seguía escribiendo aunque ya hubiera uno nuevo bien configurado. Ahora `create_shopify_subscription` (POST) busca por `connection_id` y, si ya existe, ACTUALIZA en vez de crear otra (mismo id, una sola tarjeta en Flujos); `update_shopify_subscription` (PUT) rechaza (400) si el `connection_id` recibido ya pertenece a OTRO destino. **Los duplicados creados ANTES de este fix siguen activos en la base** (no hay limpieza automática — cuál de varios es "el bueno" lo decide un humano) y hay que pausarlos/borrarlos a mano desde Flujos; ver PROYECTO.md (Parte 1). Tests: `tests/test_shopify_subscriptions_dedup.py`.
* **"Reemplazar archivo" en una Fuente antes de correrla (ago 2026):** cada archivo nuevo creaba una `Connection` separada — no había forma de actualizar el contenido de una ya subida, así que archivos más nuevos del mismo origen se acumulaban como Fuentes duplicadas. `POST /api/connections/{id}/replace-file` (`connections.py`) reemplaza `file_path`/`file_content`/`file_updated_at` SIN cambiar el id — el `Process` que la usa como origen sigue intacto y pasa a leer el archivo nuevo. Columna `Connection.file_updated_at` con auto-migración en `main.py`. En `Flujos.jsx`, al correr una Fuente cuyo origen es archivo local aparece un aviso no bloqueante sugiriendo reemplazarlo antes de sincronizar (con opción de continuar igual). Tests: `tests/test_connection_replace_file.py`.
* **Separar en la vista previa los "agotados" de las actualizaciones reales del archivo (ago 2026):** con "Agotar faltantes" (§6, `zero_missing_stock`) ON, el motor mezclaba en la misma lista `changes` los cambios que sí traía el archivo con los SKU que se agotaban (`stock=0`) por NO llegar en esa fuente — el modal "Correr flujo" los mostraba juntos dentro de "Ver las N actualizaciones" sin distinción, dando la impresión de que el archivo traía productos que en realidad no traía. Cada cambio de agotado ahora se marca con `orphan_zero` (`services.py`; la escritura y propagación siguen usando la misma lista `changes`, sin cambio de comportamiento) y `RunFlowModal.jsx` los separa en su propia sección "Agotados (NO están en este archivo)".
* **SKU corrompidos cuando Excel los interpreta como fecha (ago 2026):** códigos tipo `9051-3` (patrón número-guion-número corto) Excel los autodetecta como fecha "año-mes" y los guarda como datetime aunque la celda se vea igual en la planilla; `LocalFileConnector` leía xlsx/xls con pandas, que traía la celda ya convertida (`"9051-03-01 00:00:00"`) — un SKU irreconocible que no cruzaba con nada y se creaba como producto fantasma. Ahora `LocalFileConnector` lee xlsx/xls con `openpyxl` para acceder al `number_format` real de cada celda: si es fecha, reconstruye el texto que el usuario ve en Excel (`"yyyy-m"` → `"9051-3"`) en vez del datetime completo. De paso los enteros (stock/precio) ya no salen con `.0` pegado. Tests: `tests/test_local_file_excel_dates.py`.
* **Push a Shopify de nombre y categoría, a nivel PRODUCTO (sep 2026), extiende §6 y el punto anterior "Push a Shopify con campos configurables":** hasta ahora `ShopifySubscription` solo podía mandar campos de VARIANTE (precio/stock/comparativo/barcode). El usuario pidió también actualizar nombre y categoría — campos que en Shopify viven a nivel PRODUCTO, no de variante. Se decidió (confirmado con el usuario, ver PROYECTO.md (Parte 1)) ampliar la regla dura de §6 explícitamente para estos dos campos, dejando afuera el color (es una opción de variante — cambiarla por API puede reestructurar/duplicar variantes, mucho más riesgoso que un `productUpdate`). Nuevas columnas `title_column_master`/`product_type_column_master` en `ShopifySubscription` (auto-migración en `main.py`). `ShopifyConnector.push_updates` gana `do_title`/`do_product_type`: arma un `productUpdate` (GraphQL, `product: ProductUpdateInput!` — la API 2026-04 ya no acepta el `input: ProductInput!` viejo) por PRODUCTO (no por variante), agrupando por `product_id`. Sigue sin crear productos y sin tocar descripción/imágenes. Aplica a los 3 puntos de entrada Shopify (`SourceWizard.jsx`, `FileToShopify.jsx`, modal de edición en `Flujos.jsx`) y al push directo `/api/shopify/push` (`shopify_sync.py`, el "correr ahora" del Wizard sin guardar destino). Tests: `tests/test_shopify_push.py` (conector), `tests/test_shopify_subscription_diff.py` (diff), `tests/test_shopify_subscriptions_validation.py` (guardián de columna duplicada, ahora también entre nombre/categoría y el resto).
* **Fix: conflicto de Nombre/Categoría entre variantes del mismo producto (sep 2026), corrige el punto anterior:** el diseño original decía "si dos SKU/variantes del mismo producto traen valores distintos, gana el último procesado" — en la práctica esto rompía el catálogo: cuando varias variantes (SKU) de un mismo producto Shopify son en realidad distintos colores/talles del mismo modelo, y la Maestra trae un nombre distinto por SKU, el push pisaba en silencio el nombre de unas variantes con el de la última procesada (reportado por el usuario como "se rompen los colores" al cambiar el nombre). Ahora `push_updates` detecta por producto, por campo (`title`/`product_type`), si los SKU matcheados piden valores DISTINTOS: si hay conflicto, NO se aplica ninguno (ni en la corrida real ni en el dry_run) — se reporta en `conflicts`/`conflicts_total` del summary. Solo se escribe cuando todas las variantes del producto piden el mismo valor. `ShopifyPushModal.jsx` muestra el aviso (rojo) y la lista expandible de SKU/campo/valor no enviado, tanto en el preview como en el resultado del envío real. Tests nuevos en `tests/test_shopify_push.py`: `test_title_conflict_between_variants_is_skipped_not_overwritten`, `test_dry_run_flags_title_conflict_between_variants`.
* **Resolución de conflicto Nombre/Categoría por variante PRINCIPAL "-1" (sep 2026), refina el punto anterior:** bloquear TODO conflicto era más estricto de lo necesario — el usuario aclaró la convención real del catálogo: las variantes de una misma referencia comparten el código antes del último "-N" (ya usado por `sku_reference_base` para sugerencias de enriquecimiento) y la variante "-1" (ej. "3076-1" entre "3076-1".."3076-6") es la PRINCIPAL — su nombre es el que debe representar al producto. Nuevo helper `sku_utils.is_primary_variant_sku(sku)` (regex `-1$` sobre el SKU normalizado). `ShopifyConnector.push_updates` ahora, ante valores distintos para el mismo campo/producto: si puede identificar una única variante principal entre las que difieren, aplica SU valor (las demás se ignoran, expuestas en `ignored_secondary`/`ignored_secondary_total` para transparencia, no bloquean el envío); solo si ninguna es "-1" (o ambigüedad) sigue cayendo en conflicto sin resolver (`conflicts`/`conflicts_total`, sin cambios respecto al punto anterior). El caso sin conflicto (un solo valor, o un solo SKU) no requiere sufijo "-1" — sigue aplicándose directo, así productos de una sola variante (SKU sin guion) no se ven afectados. `ShopifyPushModal.jsx` suma un aviso informativo (azul, no bloqueante) para `ignored_secondary`, distinto del aviso rojo de `conflicts`. Tests nuevos: `test_title_conflict_resolved_by_primary_variant`, `test_dry_run_title_conflict_resolved_by_primary_variant`.
* **Sub-líneas con letra ("-C1" cuero, "-D1" deportivo) + red de seguridad contra perder contenido real (sep 2026), refina el punto anterior:** el usuario mandó un archivo real de nombres (BASE-SYS, 558 filas) para revisar los conflictos que seguían quedando. Dos hallazgos: (1) confirmó que sufijos con letra son su PROPIA referencia/línea — "C" = cuero, "D" = deportivo (ej. "827-C1"/"827-C2" son las variantes de cuero de la referencia "827", no del "827" a secas) — y la "-1" de ESA línea (ej. "827-C1") es la principal, igual que la "-1" numérica simple. `is_primary_variant_sku` pasa de regex `-1$` a `-[a-z]*1$` para reconocerlas. (2) Al analizar el archivo se vio que en 23 de 110 referencias con más de una variante, el nombre no difiere SOLO por el código de SKU pegado adelante — difiere en contenido real (ej. "789B-1..5" dicen "POEDAGAR METAL CALENDARIO DAMA" pero "789B-6/7/8" agregan "TIPO PATEK PHILIPPE..."). Aplicar "gana la principal" a ciegas ahí borraría información real del catálogo, no sería limpiar ruido de formato. Nuevo helper `sku_utils.strip_sku_label(sku, text)`: saca el prefijo de SKU de un texto si está pegado adelante. `push_updates` ahora, antes de resolver por la variante principal, chequea que el "resto" (`strip_sku_label`) sea IGUAL entre todas las variantes en conflicto — si el contenido real difiere, NO se resuelve solo aunque haya una "-1"/"-C1" única: queda como conflicto sin resolver, mismo criterio que "no contaminar la Maestra" del Guardián. Tests nuevos: `test_title_conflict_resolved_by_primary_variant_with_letter_suffix`, `test_title_conflict_not_resolved_when_content_differs_beyond_sku_label`, y `tests/test_sku_reference_helpers.py` (cobertura directa de `is_primary_variant_sku`/`sku_reference_base`/`strip_sku_label`).
* **Pantalla única "Actualizar Maestra" (sep 2026), reemplaza `SourceWizard.jsx` y `FileToShopify.jsx`:** el usuario pidió simplificar de raíz el flujo de actualizar la Master ("pocos pasos, sin importar el origen, con vista previa y aviso de conflicto de mapeo, sin partir de cero"). Investigación previa (plan en `/root/.claude/plans/velvet-foraging-dongarra.md` de esta sesión) confirmó que el motor (`_compute_master_sync`, Guardián, Lavadero, `write_sheet_data_surgical`, `propagate_changes`) ya cumplía todo lo pedido salvo un hueco puntual: `auto_map_columns` (`intelligent_engine.py`) elegía en silencio cuando dos columnas de la Maestra eran sinónimos del mismo grupo semántico (ej. "Precio" y "Costo") — nunca avisaba de la ambigüedad, y además el matching exigía coincidencia exacta de header sin tolerar ruido tipográfico real (ej. "Precio*" con asterisco de "obligatorio" no matcheaba con "Precio").
  - **Backend** (`backend/intelligent_engine.py`): nuevo `_normalize_header()` (trim, minúsculas, saca `*`/`:` final, colapsa espacios) usado tanto en el match exacto como en `get_semantic_group`. `auto_map_columns` ahora, cuando `target_semantic_map[group]` tiene 2+ candidatos, devuelve `confidence: "ambiguous"`, `target_field: ""` y `candidates: [...]` en vez de tomar `[0]` en silencio. `backend/routers/intelligence.py` (`POST /api/intelligence/auto-map`) suma `mappings` (la lista completa con confidence/reason/candidates) a la respuesta, manteniendo `mapping` (aplanado) por compatibilidad. Tests: `tests/test_intelligent_engine.py`.
  - **Frontend**: `UpdateMaster.jsx` (ruta `/nueva-fuente`, mismo URL que antes — no rompe los links existentes de `Flujos.jsx`/`PipelineBar.jsx`) junta en una sola pantalla, sin navegar entre pasos: (1) lista de Fuentes (`Process`) ya conectadas con "Correr ahora" — reusa el mismo patrón de `Flujos.jsx` (`maybeRunProc`/`handleReplaceAndRun`/modal de "reemplazar archivo antes de correr" para orígenes `local_file`, duplicado acá porque `Flujos.jsx` no se tocó a propósito); (2) conectar un origen nuevo (Archivo/API primarios, Google Sheet detrás de un toggle "más opciones" — decisión explícita del usuario) con lectura de columnas y mapeo inline en la misma tarjeta (patrón de la vieja `FileToShopify.jsx`); el mapeo usa la nueva respuesta `mappings` de auto-map: los campos `ambiguous` se muestran con borde ámbar y una nota "podría ir a X o Y — elegí cuál" en vez de autocompletarse; (3) al guardar el `Process` se abre `RunFlowModal` en el acto (sin paso intermedio) y se revela, colapsada, una sección opcional "¿este origen también alimenta un destino nuevo?" que reusa tal cual el JSX/handlers del viejo paso "Destinos" de `SourceWizard.jsx` (Sheet/CSV/API externa/Shopify, presets de export, `ShopifyFieldMapper`). `Flujos.jsx` (gestión fina: editar, pausar, borrar) y el módulo "Shopify → Maestra" (bajada, `ShopifyMasterSync.jsx`) quedan sin tocar a propósito — dos módulos separados según CLAUDE.md. `App.jsx`: nav renombrado "+ Nueva Fuente" → "Actualizar Maestra", ruta `/subir-shopify` eliminada (sin otros enlaces en el código, verificado por grep).
  - Verificado con datos reales en un sandbox local (SQLite, sin `GOOGLE_CREDENTIALS_JSON`): subida de archivo + lectura de columnas + auto-detección de SKU funcionan; el flujo completo "Correr ahora" → modal de reemplazar archivo → `RunFlowModal` se probó de punta a punta con Playwright (screenshots), incluyendo el error esperado por falta de credenciales de Google (no es un bug: el mismo error que ya daría cualquier flujo viejo sin Maestra real conectada). La detección de mapeo ambiguo se verificó por HTTP real (`curl`) y tests unitarios, no por click-through visual (necesitaría una Maestra real con columnas sinónimas duplicadas).
  - **Fix (mismo día):** la sección 5 (destinos) había quedado mal acoplada — solo se mostraba tras crear una Fuente NUEVA en esa misma sesión (`{createdProc && (...)}`), calcada sin pensarlo del comportamiento de la wizard vieja. El usuario notó la regresión recordando que la vieja `FileToShopify.jsx` mostraba la tarjeta de Shopify SIEMPRE, sin depender de haber subido un archivo nuevo. Es un acoplamiento real e innecesario: un `ShopifySubscription`/`FieldSubscription`/`ExportFormat`/`ApiSubscription` se conecta a la Maestra en general (por `connection_id`, sin `process_id`), nunca a una Fuente puntual — así que no hay motivo para esconder la sección de destinos detrás de "recién creaste un origen". Se sacó esa condición (la sección ahora es siempre visible, colapsada por default) y `loadAll()` carga `destinations` de una con `loadDestinations(projectId)`, no solo tras guardar un proceso. Verificado con Playwright: la sección aparece y funciona sin haber creado ninguna Fuente en la sesión.
  - **Fix (mismo día, 2):** en la tarjeta Shopify de la sección de destinos, "Previsualizar" solo mostraba un resumen de una línea ("Cruzan: X de Y · sin cruzar: Z") — el usuario notó que no mostraba el detalle SKU/campo/antes→después como el resto de la app. El backend (`/api/shopify/push` dry_run) ya devuelve `changes`/`conflicts`/`ignored_secondary`/`not_found` completos (mismo shape que usa `ShopifyPushModal.jsx`); el problema era que esta tarjeta (heredada del paso "Destinos" de `SourceWizard.jsx`) nunca los renderizaba. En vez de duplicar de nuevo las ~150 líneas de tablas expandibles que ya existían en `ShopifyPushModal.jsx`, se extrajeron a un componente compartido nuevo, `frontend/src/components/ShopifyPushDetails.jsx`: `ShopifyPushPreviewDetails({ preview })` (stat tiles + avisos de conflicto/variantes secundarias + botones "Ver los N..." + las 4 tablas expandibles) y `ShopifyPushResultSummary({ result })` (contadores por campo + avisos + errores tras el envío real). `ShopifyPushModal.jsx` pasó a usarlos (bajó de ~330 a ~100 líneas, mismo comportamiento) y la tarjeta Shopify de `UpdateMaster.jsx` los usa igual — así ambos lugares muestran el mismo detalle completo y quedan sincronizados a futuro (un solo lugar para arreglar/extender esta UI). Verificado con `npm run build` + `pytest -q` (sin cambios de backend en este fix); no se pudo re-verificar visualmente el detalle expandido en el navegador por no haber una tienda Shopify real conectada en el sandbox — la extracción es texto movido tal cual (no reescrito), así que el riesgo de regresión es bajo, pero conviene que el usuario lo confirme con una tienda real.

* **"Actualizar Maestra" deja de obligar a guardar un flujo (sep 2026):** el usuario aclaró que en su uso real cada actualización es puntual (archivo de origen distinto cada vez, no se repite) — obligar a "guardar" una Fuente para poder correrla juntaba flujos de un solo uso en "Mis Flujos" sin necesidad. `UpdateMaster.jsx` suma un checkbox "Guardar este flujo para repetirlo más adelante", **destildado por defecto**: al cerrar la vista previa sin tildarlo, se borra el `Process` de soporte (`DELETE /api/processes/{id}`, desvincula el `ExecutionLog` en vez de borrarlo — el registro de que corrió queda) y se limpia el formulario. Tildado, el comportamiento es el de antes (queda en "Mis Flujos"). Sin cambios de backend. De paso, el cartel de la Maestra suma un link "Abrir en Google Sheets" (directo a `spreadsheet_id`) al lado de "Ver Maestra →".
* **Fix: aviso de ubicación Shopify prometía stock que no se podía escribir (sep 2026):** en "Enviar a Shopify" (`UpdateMaster.jsx`), cuando fallaba `GET /api/shopify/locations` se mostraba SIEMPRE "...si la tienda tiene una sola ubicación, igual se puede escribir el stock" — caso real reportado por el usuario donde la promesa era falsa: credenciales Shopify inválidas/vencidas (401), así que nada se podía escribir. Esa reassurance solo es cierta cuando el error es específicamente el scope `read_locations` faltante (ahí `get_primary_location_id()` funciona igual, porque solo pide `id`, no `name`). El frontend ahora distingue por el texto del error: caso de scope → aviso de siempre; cualquier otro error → rojo, sin promesa. `shopify.py::_graphql` traduce el 401 crudo de Shopify a mensaje claro en español. De paso se encontró y corrigió un bug relacionado: `_TOKEN_CACHE` (client_credentials) usaba `(domain, client_id)` como clave, sin el secret — si se rotaba el secret en Shopify, el proceso podía seguir devolviendo hasta 24h un token pedido con el secret viejo (que Shopify invalida al rotar). Ahora el secret entra en la clave del caché.
* **Fix: Guardián bloqueaba altas legítimas de una referencia ya existente + `add_new_rows` no hacía nada (sep 2026):** dos fallos lógicos encontrados en auditoría del motor, a raíz de un reporte de "productos nuevos que no se mapean a la Maestra".
  1. El near-dup del Guardián (`NEAR_DUP_RATIO=0.85`) comparaba el SKU nuevo contra el más parecido de la Maestra SIN distinguir "mismo producto mal escrito" de "variante nueva legítima de una referencia ya existente" — para códigos largos con sufijo `-<número>` (ej. `300834723-3` nuevo cuando ya existe `300834723-2`, el formato más común del catálogo), la similitud textual con su hermano supera el umbral aunque sea un alta 100% legítima, bloqueando TODO el lote (no solo esa fila) en automático/push. Fix en `_compute_master_sync`: si el SKU nuevo comparte `sku_reference_base` con el más parecido pero el número de variante (`sku_variant_suffix`, nuevo helper en `sku_utils.py`) es DISTINTO, no cuenta como sospechoso — sigue contando si el número de variante es el MISMO (ese caso es el typo real, ej. `726B-04` vs `726B-4`, que el Guardián debe seguir bloqueando). Tests: `test_guardian_deja_pasar_variante_nueva_de_referencia_existente`.
  2. `Process.add_new_rows` (checkbox "Agregar filas nuevas que no existan en la Maestra" en `Flujos.jsx`) se guardaba en la DB y viajaba hasta `_compute_master_sync` pero la función nunca lo leía — un SKU nuevo SIEMPRE se creaba, tuviera el flag el valor que tuviera. Fix: la rama "no está en la Maestra" ahora respeta `req.add_new_rows` (default `True`, sin cambio de comportamiento para quien nunca tocó el checkbox); si está en `False`, el SKU se ignora (`rows_new_ignored`, nuevo contador expuesto en el resultado). Tests: `test_add_new_rows_false_no_crea_skus_nuevos`.
  Ambos fijados en `tests/test_scheduler.py` (mismo patrón que los tests del Guardián existentes: se verificó que fallan contra el código pre-fix antes de darlos por buenos).

* **Clave de acceso de la app (oct 2026).** La app estaba desplegada en Railway **sin ninguna autenticación**: con el link, cualquiera leía la Maestra completa (`GET /api/master`) y podía disparar un envío a una tienda Shopify real (`POST /api/shopify/push`) o borrar la base (`/api/debug/reset-db`). Se cierra con una clave compartida.
  - **`backend/auth.py`**: middleware sobre todo `/api/`, clave en la variable `TABLASK_PASSWORD` y header `X-TablasK-Key`, comparada con `hmac.compare_digest` (tiempo constante). **Falla cerrada**: si la variable no está configurada la API responde 503 con el texto de qué hacer, en vez de quedar abierta en silencio — por eso hay que crear la variable en Railway ANTES de fusionar. Pequeño router `GET /api/auth/check` para que la pantalla de ingreso valide.
  - **Lista de rutas abiertas explícita por método + ruta exacta** (`_ABIERTAS`), no por prefijo: `GET /api/exports/{id}/download` (link fijo del canal CSV, ya tiene su `?token=`) y `POST /api/intake/push` (app conectada, ya tiene su header `api-key`). Abrir por prefijo `/api/exports/` habría dejado `regenerate-token` accesible sin clave — hay un test que lo fija.
  - **Orden del middleware:** se registra ANTES del CORS porque en Starlette el último agregado queda por fuera; así el CORS envuelve a la clave y los 401/503 salen con cabeceras CORS (si no, en desarrollo el navegador no muestra el error real).
  - **Frontend:** `utils/auth.js` parcha `window.fetch` UNA vez y le agrega la clave a toda llamada que contenga `/api/` — así no hubo que tocar los ~100 `fetch` repartidos por los componentes; un 401 borra la clave guardada y vuelve a pedirla. `components/LoginGate.jsx` envuelve la app entera en `App.jsx`: hasta que la clave no es correcta no se monta ninguna pantalla. Estado `sin-config` propio para el 503.
  - **Tests sin tocar los existentes:** `tests/conftest.py` fija `TABLASK_PASSWORD` y parcha `TestClient.__init__` para que todo cliente mande el header solo; los tests de la clave lo borran a mano. Así los 208 tests previos siguieron pasando sin editarlos. Nuevo `tests/test_auth.py`.
  - Es una clave compartida para el equipo, no usuarios con permisos distintos: alcanza para cerrar la puerta y el middleware es el único lugar a cambiar si algún día hace falta separar por persona.

* **Multiplicador de precio por canal (oct 2026).** La Maestra guarda el precio base del proveedor y cada canal vende con su propio margen. Kyte ya lo hacía con el ×2 de sus plantillas de export (§11), pero los destinos Shopify mandaban la columna mapeada **tal cual** — y la web de Poedagar vende a `base × 2,8`, así que no había forma de alimentarla desde la Maestra sin una columna calculada aparte.
  - **`backend/pricing.py`**: `aplicar_multiplicador(raw, mult)` reusa `lavadero.clean_price` para leer precios sucios (`"$ 45.000"`, `"38000,00"`) y redondea a entero (el peso no usa centavos). Un precio ilegible se manda **tal cual**, no se inventa un número. `es_multiplicador_valido` acota a `0 < m <= 100`: un 0 pondría toda la tienda gratis.
  - **`ShopifySubscription.price_multiplier`** (Float, default 1.0, auto-migración en `main.py`). Se aplica en los dos lugares donde se arman los updates: `propagation.build_shopify_updates` (diff automático tras cada sync) y `routers/shopify_subscriptions.build_updates_from_sheet` ("Enviar ahora", Maestra completa). También en el push directo `POST /api/shopify/push` (`price_multiplier` en el request).
  - **Solo afecta al precio**, no al stock ni al precio comparativo (este último suele venir ya como valor final). Default 1.0 = comportamiento idéntico al anterior, así que ningún destino ya configurado cambia de conducta.
  - **UI:** campo en `ShopifyFieldMapper.jsx` (componente compartido), visible solo cuando el destino está enviando el precio; cableado en los dos puntos de entrada que quedan (`Flujos.jsx` modal de edición y `UpdateMaster.jsx`). Tests: `tests/test_price_multiplier.py`.
* **Carpeta de Google Drive como origen (oct 2026).** Cierra el pedido de Kino: "subo el archivo a la carpeta y el sistema actualiza". Antes había que entrar a la app y subir el archivo a mano en cada corrida.
  - **`backend/connectors/google_drive.py`** (`connection_type="google_drive"`): la conexión guarda `drive_folder_id` y en cada lectura se toma el archivo **MÁS RECIENTE** de la carpeta. Se eligió "el más reciente" en vez de "el que se llame X" para que Kino pueda subir `BASE-SYS 20-oct.xlsx` y al otro día `BASE-SYS 21-oct.xlsx` sin tocar la configuración.
  - **Filtro `es_archivo_fuente`:** solo .xlsx/.xls/.csv. Deja afuera los `.md` del proyecto (que viven en esa misma carpeta: AVANCES, el proceso y el informe) y los temporales `~$...` que Excel crea mientras el archivo está abierto — los dos casos son MÁS NUEVOS que el archivo de verdad y se llevarían el puesto de "el más reciente". Hay tests para los dos.
  - **El parseo se delega en `LocalFileConnector`** (se le pasan los bytes bajados): así el archivo que llega por Drive y el que se sube a mano se comportan idéntico, incluido el arreglo de los SKU que Excel guarda como fecha (`9051-3`). Duplicar ese lector era garantía de que se desincronizaran.
  - **Credenciales:** la misma cuenta de servicio que ya lee la Maestra, con scope `drive.readonly` propio del conector (no se tocó el `SCOPES` de `services.py`). Requiere que la carpeta esté compartida con el correo de la cuenta y la API de Drive habilitada.
  - **Red aislada en dos métodos** (`listar_archivos`, `descargar`) para poder probar todo sin red; el archivo bajado se cachea por instancia, así leer las hojas y después los datos no lo baja dos veces (hay test).
  - `_solo_id_de_carpeta` en `routers/connections.py` acepta el link tal cual se copia del navegador (`.../folders/<id>?usp=sharing`) o el id pelado.
  - Rama propia en `services.get_sheet_metadata` y opción "Carpeta de Drive" en el selector de origen de `UpdateMaster.jsx` (detrás de "más opciones", al lado de Google Sheet). Tests: `tests/test_google_drive_connector.py`.
* **Revisión diaria — el "revisor-actualizador" (oct 2026), modo `review` del piloto automático.** El usuario pidió un agente que revise todos los días las páginas contra los Excel/Sheets y le reporte antes de tocar nada (elección explícita: "revisa y reporta", 1 vez al día, Shopi-Kino + Shopi-Poe + Maestra; además un auditor externo — tarea programada de Claude — que lee el reporte y avisa lo que no cuadra).
  - **`ScheduleConfig`** suma `mode` (`auto` = comportamiento de siempre, escribe solo; `review` = no escribe), `daily_hour` (hora local, `TABLASK_TZ` default `America/Bogota`, fallback UTC-5 fijo si falta tzdata; nulo = `interval_hours`), `review_shopify_ids` (JSON; nulo = todas las activas) y `report_token` (link de solo lectura). Auto-migración en `main.py`. `scheduler.run_for_mode` decide qué correr; `/api/schedule/run-now` también respeta el modo (en `review` jamás sincroniza). `scheduler.build_sync_request(proc)` es ahora el único lugar que arma el `MasterSyncRequest` de un Proceso (lo usan piloto y revisión).
  - **`backend/review.py`**: `build_review` corre `_compute_master_sync` por fuente activa (mismo túnel: Lavadero/Guardián; si el Guardián marca formato roto, la fuente queda `guardian` sin líneas), arma la **Maestra proyectada** en memoria (`project_master`, actual + cambios + altas, por SKU normalizado) y contra ELLA hace `push_updates(dry_run=True, preview_limit=MAX_LINES)` por tienda revisada — así se ve qué le llegaría a cada tienda si se aprueba la Maestra. Alertas: Guardián, errores, agotados por "agotar faltantes", altas nuevas, Lavadero retuvo, stock→0 en tiendas (rojo desde `REVIEW_MASS_ZERO_MIN`=20), saltos de precio ±`REVIEW_PRICE_JUMP_RATIO` (50%), conflictos nombre/categoría, archivo local sin reemplazar en >`REVIEW_STALE_FILE_HOURS` (26h), y la misma tienda con 2+ destinos activos (el pendiente urgente de PROGRESS). Se guarda un **`DailyReview`** (`pendiente` / `sin_cambios` / `error`); uno nuevo deja la pendiente anterior como `reemplazada`.
  - **Aplicar (`apply_review`)** recalcula TODO fresco y aplica solo la **intersección** revisado∩vigente: en la Maestra por clave (SKU normalizado, columna, valor nuevo) y altas por SKU; después de escribir, propaga a hojas hijas y canales API como un correr normal (NO al push automático de Shopify); luego, por tienda revisada, dry_run fresco sobre la Maestra ya escrita y envío real solo de las líneas cuya clave (SKU, campo, valor después) estaba en lo revisado. Lo que apareció después de revisar queda `not_approved` (para la próxima); lo revisado que ya no aplica, `no_longer_valid`. Tiendas fuera de la revisión no se tocan. Vence a las `REVIEW_MAX_AGE_HOURS` (36h, estado `vencida`); solo se aprueba la más nueva; con errores queda `con_errores`. Un lock evita revisar y aplicar a la vez.
  - **`ShopifyConnector.push_updates(only=...)`**: filtro de escritura `{sku_normalizado: {"price","stock",...}}`. El cruce y la resolución de conflictos de nombre/categoría (variante principal "-1") siguen usando la lista COMPLETA de updates; solo se filtra el envío (un producto recibe nombre/categoría si alguna de sus variantes lo tiene aprobado, con el valor ya resuelto). `preview_limit` (default 300) controla cuántas líneas devuelve el dry_run. Sin `only` el comportamiento es idéntico al de antes.
  - **Router `/api/reviews`**: `GET ""`, `GET /latest`, `GET /latest/public?token=` (resumen compacto para el auditor, `hmac.compare_digest`), `POST /token/regenerate`, `POST /run-now`, `GET /{id}`, `POST /{id}/apply`, `POST /{id}/discard`.
  - **UI**: `AutoSyncPanel.jsx` suma el selector de modo ("Revisar y avisar" / "Aplicar solo"), "Todos los días a las…" + hora, y las tiendas a revisar; de paso corrige que las fechas UTC sin "Z" se leían como hora local ("próxima en X h" corrido 5 h). `DailyReviewPanel.jsx` (en Mis Flujos): totales, alertas, detalle SKU/campo/antes→después por fuente y por tienda, "Aprobar y aplicar" / "Descartar", resultado de la aplicación y "copiar link" del auditor.
  - **`herramientas/subir_excel/`** (solo stdlib, para el PC Windows): sube cada Excel a su Fuente con `replace-file` (sin crear otra), resuelve la conexión por nombre o id, acepta comodines (toma el más reciente), solo sube si cambió o si pasaron ~20 h (para que la app no lo marque desactualizado), y opcionalmente pide la revisión al terminar.
  - Tests: `tests/test_daily_review.py` (revisar no escribe; aprobar aplica Maestra + tienda; lo que cambió después no se aplica; Guardián; reemplazo; token; piloto en modo revisión; hora diaria; Maestra que falla → `con_errores` sin empujar lo que dependía; filtro `only`). Verificado además de punta a punta con el backend real + tienda simulada: revisar → aprobar desde la UI → nueva revisión `sin_cambios`.

### Pantalla "Actualizar" (oct 2026)
- `/` es `Actualizar.jsx`: subir archivo → revisión (`POST /api/actualizar/archivo`)
  → Aprobar/Descartar (`/api/reviews/{id}/apply|discard`, los de siempre).
- El archivo REEMPLAZA el de la conexión de archivo de la Fuente del SYS (misma
  conexión, `ScheduleConfig.upload_connection_id` o la única Fuente activa de tipo
  archivo). La carpeta de Drive buzón (`ScheduleConfig.drive_folder_id`) es solo
  otra forma de entregar ese archivo: `scheduler._tick_buzon` la mira cada 5 min y
  procesa cada archivo una sola vez (`drive_last_file`).
- Aviso por Telegram (`avisos.py`) al llegar un archivo por Drive y en la revisión
  programada pendiente. Nunca aprueba solo.
- Alertas nuevas en `review.py`: SKU repetidos en el origen (`duplicate_skus` de
  `_compute_master_sync`), stock negativo, SKU que no existen en la tienda
  (`not_found`) y códigos de número doble (`es_doble_numero`).
- Lavadero: el stock negativo ya no va a "revisar": pasa tal cual.
- Configuración en `/admin/actualizar`.
- Por defecto (sin configurar nada): la Fuente del SYS se elige sola (la de
  nombre POEDAGAR/SYS, si no la más reciente) y, si no hay ninguna, la PRIMERA
  subida la crea (`preparar_fuente`: Artículo → SKU, Precio y Exist. unidades →
  columnas de precio/stock de la Maestra; no toca el nombre). Si no hay destino
  Shopify activo y hay una sola tienda conectada, crea "Shopi-Poe" con precio ×
  2,8 (`asegurar_tienda`, `TABLASK_MULT_POEDAGAR`). En Administración se marcan
  las tiendas a actualizar (`review_shopify_ids`) y hay botón "Actualizar otra tienda".
- Corrección (26-oct): la tienda Poedagar ES `ii1apd-ws.myshopify.com`.
- Solo Poedagar (26-oct): el SYS trae todas las marcas. `filtrar_marca` deja las
  filas cuyo código está en la web o cuya descripción dice POEDAGAR
  (`TABLASK_MARCA`), guarda eso como CSV y limita la revisión a esos SKU
  (`solo_skus`). Avisa los productos de la web que no vienen en el archivo.
- Columnas SKU sin distinguir mayúsculas en el motor (`find_header_index`).
- Excel "lo que no se sube" (27-oct): `GET /api/reviews/{id}/no-subidos.xlsx`
  (`review.excel_no_subidos`), botón en la pantalla Actualizar. Hojas: no se
  subieron (precio/stock que llevaría + razón), en la web sin archivo, retenidos
  del Lavadero y errores al aprobar. `parecidos_en_web` avisa códigos escritos
  distinto (NO:610-1 / NO610-1, 810-1 / 810-1-, P9051-1 / 9051-1): solo pista, no cruza.

## §7. Fuera de Scope (Versión Actual)
Se discutieron y se marcaron explícitamente como "fuera de scope" (no implementados):
- Suscripciones a hijas con la regla de negocio "Sobreescribir SOLO si la celda hija está vacía". Actualmente, la distribución siempre sobreescribe con el valor de la Maestra.
- El diccionario semántico (AI/Mappings) no "aprende" automáticamente ni hace blacklist de los rechazos del usuario.
- Escritura individual a nivel microscópico por cada celda: aunque se hace `batchUpdate` específico, se agrupa la fila completa si se añade una nueva.

## §8. Reglas Estrictas de Desarrollo
* **NUNCA** proponer migrar la data de la Tabla Maestra a PostgreSQL. Se acordó explícitamente mantener Google Sheets como la única fuente de la verdad.
* **Protección Relacional:** Las conexiones (orígenes y destinos) no pueden borrarse si están atadas a `FieldSubscription`s o `Process`es activos.
* **Backend FastAPI:** Manejar BackgroundTasks para propagación.
* **Frontend React:** Manejo de estados de carga explícitos para no congelar la UI.

---

## §9. Flujo de Trabajo de Git (vigente desde que se usa Claude Code on the web)

> Nota histórica: este proyecto usó una única rama `pruebas` (nunca `main` directo,
> nunca ramas nuevas). Quedó obsoleto solo: el entorno web asigna una rama `claude/*`
> propia por sesión y no se puede evitar. Lo que se mantiene intacto del espíritu
> original: `main` nunca se toca sin permiso explícito del usuario.

* Cada sesión trabaja en la rama `claude/*` que el entorno le asigna (o la crea si
  no existe). No hay que migrarla a `pruebas` ni renombrarla.
* `main` → rama estable, Railway publica desde acá. Se llega por **Pull Request**,
  nunca por push directo ni commit directo.
* Fusionar a `main` **solo cuando el usuario lo pide explícitamente** (por PR, revisando
  que no haya conflictos ni checks rotos) — nunca por iniciativa propia de la IA.
* Si la rama de la sesión ya se fusionó y hay trabajo nuevo: reiniciarla desde el
  `main` actual (mismo nombre) en vez de apilar sobre historia ya fusionada.
* No guardar tokens/credenciales dentro del repo ni en la URL del remoto.

---
*Última actualización: 20 de Octubre de 2026 (sección 3: revisión diaria, clave de acceso de la app, multiplicador de precio por canal y carpeta de Drive como origen). Anterior: 15 de Septiembre de 2026 (sección 3 ampliada: fix de aviso de
ubicación Shopify + cache de token por secret, fix de Guardián bloqueando altas
legítimas de una referencia existente + `add_new_rows` que no hacía nada; sección 6
(Git) corregida para reflejar el flujo real con Claude Code on the web (rama `claude/*`
por sesión + PR a `main`) en vez de la regla vieja de una sola rama `pruebas`. Nota:
varias entradas de §6 referencian "MEJORAS_TABLASK.md" (§5, §7, §9, §11…) — ese
archivo no existe en el repo (no está en el historial de git); o se restaura o esas
referencias quedan sin destino. No se tocó en esta pasada para no reescribir
historia ya asentada.)*
