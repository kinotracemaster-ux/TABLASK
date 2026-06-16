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

## 3. Hitos Logrados y Estado Actual
* **Refactorización Global:** Se eliminó el concepto de "múltiples proyectos aislados". Ahora toda la app gira en torno a **una única Tabla Maestra global**.
* **Flexibilidad de Columnas:** Si la Tabla Maestra está en blanco, el usuario puede teclear libremente los nombres de las columnas (ej. "SKU") en los menús desplegables (comboboxes) usando la interfaz de Procesos. El motor creará esas columnas automáticamente en Google Sheets en la primera ejecución.
* **Soporte CSV Local:** Integrado de forma nativa en la sección de Conexiones.
* **Manejo de Errores Visuales:** El "Preview" (Vista Previa) de los procesos muestra explícitamente cuántas filas **Se Sobreescribirán**, cuántas **Se Añadirán (Nuevos)** y cuántas quedarán **Iguales (Sin Cambio)**.

## 4. Reglas Estrictas de Desarrollo
* **NUNCA** proponer migrar la data de la Tabla Maestra a PostgreSQL. Se acordó explícitamente mantener Google Sheets como la única fuente de la verdad para mantener la flexibilidad de edición manual.
* **Cuidado con las dependencias circulares:** El backend está en FastAPI (`main.py` y `services.py`). Evitar imports circulares al modificar endpoints.
* **Frontend:** React + Tailwind CSS. Mantener el diseño limpio, profesional y enfocado en la usabilidad.

---
*Última actualización: Junio 2026*
