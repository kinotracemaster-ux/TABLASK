# PROGRESS — TablasK

> Estado vivo del proyecto. Se LEE al inicio de cada sesión y se ACTUALIZA al final.
> Instrucción típica de cierre: "actualizá PROGRESS.md con lo que hicimos,
> decisiones y próximos pasos".
>
> Nota: si `MEJORAS_TABLASK.md` te sirve para lluvia de ideas de mejora, dejalo
> para eso. Este archivo es solo el estado/avance. Si preferís uno solo,
> renombrá MEJORAS → PROGRESS y borrá este.
>
> Última actualización: [poné la fecha]

## Estado actual
- [Describí en qué punto está el proyecto ahora mismo]
- El Master todavía tiene campos de enriquecimiento por llenar.

## Hecho
- **Guardián inteligente** para crear productos nuevos: ya no bloquea por baja
  coherencia a secas. Ahora solo salta (auto/push) si las filas nuevas parecen
  un FORMATO DE SKU ROTO (casi-idénticas a SKUs existentes). Los productos
  genuinamente nuevos se crean aunque la coherencia sea baja.
  (`services.py`: señal `new_rows_look_broken` / `new_rows_suspect_ratio`;
  usada en `scheduler.py` e `intake.py`; expuesta en el preview de `processes.py`.)
- **Marca de altas nuevas:** al crear un producto nuevo, la Master lo marca con
  `estado = NUEVO` (columna de control; si no existe se agrega al final sin tocar
  el resto). Así se crean pero quedan resaltados para enriquecer/revisar — no se
  crea basura silenciosa. Nombre/valor configurables por env (`MASTER_ESTADO_COL`,
  `MASTER_ESTADO_NUEVO`). De paso, la escritura quirúrgica ahora reescribe la fila
  de encabezados al apendizar (arregla columnas nuevas que quedaban sin título).

- **Agotar faltantes (§4 del flujo de stock):** flag por proceso
  `zero_missing_stock` (default OFF). Cuando está ON, los SKU que están en la
  Master pero NO llegan en esa fuente pasan a `stock = 0`. Solo toca la columna
  de stock y solo si tenía valor > 0. Es OPT-IN a propósito: solo la fuente de
  verdad del inventario (BASE-SYS) debe agotar; una fuente parcial vaciaría el
  catálogo. Expuesto en el motor (`rows_zeroed`/`detail_zeroed`), en el preview,
  en scheduler/intake, y con checkbox + aviso en `Flujos.jsx` (editar proceso).

## En progreso
- [Lo que estás tocando ahora, con el archivo/módulo]

## Próximos pasos
- El preview manual ya trae `new_rows_look_broken`: mostrar en la UI un aviso
  "posible formato de SKU roto" cuando venga en True (frontend, aún sin usar).
- UI: mostrar/filtrar en la Master los productos con `estado = NUEVO` para que el
  usuario los enriquezca y luego les cambie el estado.
- Del flujo de stock quedan sin implementar: §7 anti-sobreventa (descontar stock
  por venta confirmada) y §9 precio manual vs. automático por canal.

## Decisiones tomadas
- Dos módulos Shopify a propósito: bajada = emergencia (sin archivo BASE),
  subida = flujo normal.
- Precio sugerido = base × 2, se muestra solo en Kyte.
- Sincronización vía archivo/API con mapeo por SKU, no a mano en la Sheet.
- El Guardián decide por PARECIDO, no por % de coherencia: nuevos que no se
  parecen a nada = altas legítimas (pasan); nuevos casi-idénticos a existentes
  = formato roto (se bloquea). Umbrales configurables por env
  (`GUARDIAN_NEAR_DUP_RATIO`=0.85, `GUARDIAN_BROKEN_FORMAT_MIN`=0.5).
  Nota: esta regla NO frena el caso de "columna equivocada" cuyos valores no se
  parecen a la Maestra; eso se cubre con el preview manual (humano confirma).

## Pendientes / dudas abiertas
- [Preguntas o cosas por decidir]

## Notas de lógica
- [Detalles técnicos que no querés re-explicar la próxima sesión]
