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

## En progreso
- [Lo que estás tocando ahora, con el archivo/módulo]

## Próximos pasos
- El preview manual ya trae `new_rows_look_broken`: mostrar en la UI un aviso
  "posible formato de SKU roto" cuando venga en True (frontend, aún sin usar).

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
