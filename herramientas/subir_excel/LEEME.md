# Subir Excel del PC a TablasK

Sube solo, cada mañana, los Excel/CSV de tu computador a sus Fuentes en
TablasK, para que la **Revisión diaria** compare contra el archivo de hoy.
No escribe nada en la Maestra ni en las tiendas: eso pasa solo cuando
aprobás la revisión en **Mis Flujos**.

## Configurar (una vez)

1. Necesitás Python 3 en el PC (python.org → marcar "Add to PATH").
2. Copiá `config.ejemplo.json` como `config.json` y completá:
   - `servidor`: la URL de tu TablasK (la misma que abrís en el navegador).
   - `archivos`: por cada archivo, la `ruta` en tu PC y la Fuente a la que va:
     - `"fuente": "BASE-SYS"` → el **nombre de la conexión de archivo** (como
       aparece en Mis Flujos → Conexiones), o
     - `"conexion_id": 12` si hay dos con el mismo nombre.
   - La ruta acepta comodines: `BASE-SYS*.xlsx` toma el más reciente.
3. Probalo: doble clic en `subir_excel.bat` (o `python subir_excel.py`).
   Deja todo anotado en `subir_excel.log`.

## Que corra solo

Programador de tareas de Windows → *Crear tarea básica* → Diariamente,
**30 min antes** de la hora de la Revisión diaria (ej. 6:30 a. m. si revisa
a las 7:00) → *Iniciar un programa* → `subir_excel.bat`.

Si querés que además genere la revisión apenas termina de subir, poné
`"revisar_al_terminar": true` (o corré `subir_excel.bat --revisar`).

## Detalles

- Solo sube un archivo si cambió desde la última vez o si ya pasó casi un
  día (así la app sabe que es el de hoy). `--forzar` sube siempre.
- Reemplaza el archivo de la Fuente **sin crear otra**: los flujos y destinos
  siguen como están.
- Si el PC está apagado a esa hora, la revisión corre igual con el último
  archivo subido y te avisa que está desactualizado.
