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

## 3.b Robustez añadida (Sesión 19 Jun 2026 — rama `claude/epic-volta-xp97zk`, PR #8)
* **Validación de mapeo al crear/editar Proceso:** `create_process` y `update_process` (`backend/routers/processes.py`) ahora llaman a `_validate_process_mapping` (`backend/services.py`). Verifican **concordancia EXACTA de nombres** de la llave de origen, la llave de destino y las columnas de origen mapeadas contra los encabezados reales. Si algo no concuerda, **NO se crea/actualiza** y se devuelve un error claro.
* **Sugerencia de columnas parecidas:** cuando una llave/columna no coincide exacto, `_find_similar_columns` sugiere candidatos (ignorando mayúsculas/acentos/símbolos, por subcadena, grupo semántico de `intelligent_engine` y cercanía difusa con `difflib`): *"¿Quisiste decir...?"*.
* **Detección de llaves duplicadas DENTRO de la misma hoja:** `_find_duplicate_keys` detecta SKU repetidos en origen y maestra (con números de fila) y los expone como `warnings` en preview y staging.
  - Importante (caso POEDAGAR): los duplicados en la **maestra** son **variantes legítimas** (el sufijo de variante `-1 -2 -3` vive en KYTE incrustado en `Nombre*`, NO en la maestra). Por eso el aviso de duplicados de maestra es **informativo/suave** (no bloquea); el de origen es advertencia seria.
  - El cruce de valores SKU sigue siendo **igualdad exacta**: `1203`, `1203-1`, `1203-3` son productos DISTINTOS. NUNCA aplicar matching difuso/subcadena/prefijo sobre los VALORES de SKU (fusionaría productos).
* **Optimización de cuota Google Sheets (fix HttpError 429 — 60 lecturas/min):**
  - `get_sheet_metadata` pasó de 1 lectura por hoja (bucle) a **un solo `batchGet`** (`_fetch_sheet_metadata`).
  - `_execute_with_retry`: reintenta 429/503 con backoff exponencial (2/4/8/16s); otros errores se propagan de inmediato. Aplicado a metadata, clear, update, batchUpdate y al `fetch_data` del conector de Google Sheets.
  - **Cache en memoria de metadata** con TTL (`METADATA_CACHE_TTL`, default 120s), invalidada automáticamente tras escribir (`invalidate_metadata_cache*`). Sólo cachea ESTRUCTURA; los datos de filas SIEMPRE se leen frescos.

## 3.c Flujo de ramas / despliegue acordado
* **Rama única de pruebas:** `claude/epic-volta-xp97zk`. Todo el trabajo se acumula ahí; cada push actualiza el **PR #8** y Railway levanta un preview (`TABLASK-pr-8`).
* **Producción:** `main` → Railway `production` (`web-production-b9b2.up.railway.app`). Se fusiona desde la rama de pruebas **sólo con aprobación del usuario**.
* **Spreadsheet maestro de referencia (POEDAGAR):** `1fjpAJUk_wfAR5lcxRza7Zqn18yLqh_w_Q-FmSfgtXTM`. Hojas: `Hoja 8`/`SYS`/`REAL` (idénticas, llave `sku`/`SKU`/`Código`), `Catalogo`, `Shopify` (export; ojo: 5 SKU corrompidos a fecha tipo `3076-01-01`), `KYTE` (código incrustado al inicio de `Nombre*`, columna `Código` vacía), `EFFI` (vacía).

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
*Última actualización: 19 de Junio de 2026*
