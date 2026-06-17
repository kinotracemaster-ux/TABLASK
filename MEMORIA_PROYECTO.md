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
*Última actualización: 17 de Junio de 2026*
