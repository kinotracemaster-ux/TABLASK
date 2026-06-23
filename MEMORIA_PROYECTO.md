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
El sistema se divide en 4 pilares reflejados en la interfaz (React):
1. **Fuentes Externas (Conexiones):** Archivos CSV locales o URLs de Google Sheets de donde provienen los datos (proveedores, inventarios).
2. **Importar (Procesos):** Tareas configuradas que extraen datos de una Fuente Externa y los inyectan en la Tabla Maestra.
   - *Lógica de Sincronización:* Si el SKU ya existe en la Maestra, **sólo se sobreescriben** las columnas mapeadas cuyos valores hayan cambiado. Si el SKU no existe, se **añade** como una fila nueva al final.
3. **Tabla Maestra:** El panel central que visualiza los datos en tiempo real desde Google Sheets. Tiene el botón principal **"⚡ Correr Procesos"** que ejecuta todos los procesos de importación y luego todas las exportaciones en cadena.
4. **Distribuir (Formatos de Salida):** Configuración para enviar columnas específicas de la Tabla Maestra hacia otras hojas de cálculo destino (por ejemplo, catálogos para Shopify o listas de precios).

## 3. Hitos Logrados y Arquitectura Actual
* **Motor "Acumulador Inteligente":** Cada origen externo aporta solo la información de sus columnas mapeadas a una Maestra centralizada. Los valores no mapeados se conservan intactos.
* **El Guardián y StagingBatch (Paso Intermedio Seguros):** Ningún cambio se escribe automáticamente en la base de datos de Google Sheets sin pasar por una cuarentena temporal (`StagingBatch`). 
   - Los batches expiran a los 30 minutos para evitar escrituras basadas en datos obsoletos de origen.
   - Si el Guardián detecta <10% de coincidencias de SKU, bloquea preventivamente la ejecución (requiere override manual).
* **Distribución Quirúrgica (Suscripciones):** Las hojas hijas reciben automáticamente *sólo los campos a los que están suscritas*, propagados mediante `BackgroundTasks` en la API (FastAPI) únicamente si la escritura original a la Maestra fue exitosa. Las escrituras a hijas fallidas se loggean pero no abortan el pipeline.
* **Escritura Celda por Celda (BatchUpdate):** En vez de descargar y reescribir la matriz gigante de Google Sheets, el motor actualiza la nube mediante el API granular enviando únicamente los rangos "A2, B4..." que cambiaron (`write_sheet_data_surgical`).
* **Cuota de Google Sheets (429):** Sheets limita ~60 lecturas/min por usuario. Para no reventar: (1) **retry con backoff** exponencial ante 429/5xx en todas las llamadas, respetando `Retry-After` (`backend/sheets_retry.py::execute_with_retry`, usado en `services.py` y el conector); (2) **caché corta de lecturas** en `services.get_sheet_data` por `(spreadsheet_id, sheet_name)` con TTL `SHEETS_READ_CACHE_TTL` (45s por defecto), que colapsa relecturas de la misma hoja (ej. la Maestra al sincronizar varios procesos). La caché se **invalida** al escribir esa hoja (`invalidate_read_cache`). Solo aplica a Google Sheets (local/HTTP no tienen cuota).
* **Clasificación del sync (REGLA central): solo rellenar, marcar el resto.** En `_compute_master_sync` (`services.py`):
  - **Coincidencia exacta** → se **rellena** (actualiza) la fila de la Maestra. Único caso automático que escribe.
  - **No cruza exacto** → NUNCA se crea solo; se **marca** en uno de dos grupos para revisión manual en el microsistema:
    - **`suspects` ("se parecen")**: se parece a un SKU existente vía `find_similar_sku` — `formato` (`1203.0`/`01203`/mayúsculas), `variante` (`1203-1` con base `1203`) o `similar` (fuzzy ≥0.86 **solo de mismo largo**; no compara largos distintos porque en códigos cortos `7-59`/`7-159`, `708-1`/`1708-1` son otro producto y daban falsos positivos).
    - **`new_candidates` ("no aparecen")**: no se parece a nada.
  `rows_added` siempre 0 y `new_rows` vacío en el sync: las altas solo ocurren por el microsistema. El valor real del SKU nunca se altera.
* **Microsistema de resolución (Staging):** En la Cola de Aprobación, "Se parecen" y "No aparecen" son tablas interactivas (checkbox por fila + seleccionar todo). `POST /api/staging/{batch_id}/resolve` aplica sobre el lote persistido según `action`:
  - **`cross`** (solo "se parecen"): los datos del código pasan a **actualizar la fila del SKU sugerido** (genera `change`, nunca pisa el SKU destino).
  - **`create`** (ambos grupos): el código se **da de alta como producto nuevo** (fila nueva a `master_raw` y `new_rows`).
  El código sale de su grupo y se recalculan contadores. No escribe a Sheets aún; deja el lote listo para Aprobar/Ejecutar. **Nota infra:** `StagingQueue.jsx` usa la base `API` (`VITE_API_URL`) en todos sus `fetch`; con rutas relativas la pantalla fallaba cuando el backend está en otro host.

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
