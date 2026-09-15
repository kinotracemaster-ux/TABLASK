# PROGRESS — TablasK

> Estado vivo del proyecto, **corto a propósito**: se carga completo en CADA turno
> vía el `@import` de CLAUDE.md, así que cada línea de más acá es tokens gastados
> en toda sesión futura. El detalle técnico y el historial completo de cada
> feature (qué se rompió, cómo se resolvió, qué archivos tocó, qué tests la
> fijan) vive en `MEMORIA_PROYECTO.md` §3 — se lee bajo demanda, no en cada turno.
> Estas entradas son punteros de una línea a propósito: si necesitás el porqué,
> está en MEMORIA §3, no acá.
>
> Instrucción típica de cierre: "actualizá el estado — PROGRESS.md corto acá,
> detalle de la feature en MEMORIA_PROYECTO.md §3".
>
> Última actualización: 2026-09-15

## Estado actual
- Motor y flujos principales (Fuente → Maestra → Destinos) estables. Mapa
  completo en MEMORIA_PROYECTO.md §2-3.
- La Master todavía tiene campos de enriquecimiento por llenar.
- **Pendiente urgente (dato ya escrito, no lo arregla código nuevo):** los
  destinos Shopify duplicados creados ANTES del fix de deduplicación (varias
  tarjetas para la misma tienda, algunos con `Stock = PRICE` o `Stock = SKU`)
  siguen activos y corrompen inventario en cada sync — hay que
  pausarlos/borrarlos a mano desde Flujos (ver "Próximos pasos").

## En progreso
- Nada activo ahora mismo.

## Próximos pasos
- Limpiar a mano los duplicados Shopify viejos ya en la base (arriba). No
  automatizar sin confirmación humana: decidir cuál de varios es "el bueno"
  no es una decisión para el código.
- UI: mostrar el aviso "posible formato de SKU roto" cuando el preview trae
  `new_rows_look_broken=True` (el backend ya lo expone, frontend sin usar).
- UI: filtrar/resaltar en la Master los productos con `estado = NUEVO`.
- `MEJORAS_TABLASK.md` no existe en el repo (git lo confirma) pero varias
  entradas de MEMORIA_PROYECTO.md §3 lo referencian (§5, §7, §9, §11...) — o se
  restaura el archivo o se limpian esas referencias. No implementado en el
  código (por eso no se puede verificar contra el archivo): §7 anti-sobreventa
  (descontar por venta confirmada) y §9 precio manual vs. automático por canal.
- Verificar en producción el fix del Guardián (ver Decisiones): correr una
  sync real con altas legítimas de una referencia ya existente (ej. un color
  nuevo de un producto que ya tiene 2+ variantes en la Maestra) y confirmar
  que ya no se saltea el lote entero.
- Probar "Actualizar Maestra" con credenciales reales de Google Sheets — en la
  sesión de sep 2026 solo se pudo verificar contra un sandbox sin
  `GOOGLE_CREDENTIALS_JSON` (mapeo/preview y UI de mapeo ambiguo verificados
  por tests y lectura de código, no por click-through con una Maestra viva).

## Decisiones tomadas
> Una línea por decisión + de qué se trata. El porqué y el detalle técnico
> (archivos, tests) viven en MEMORIA_PROYECTO.md §3.
- **Fix Guardián + `add_new_rows` (sep 2026):** el Guardián bloqueaba altas
  legítimas de una referencia ya existente (ej. "...-3" nuevo cuando ya está
  "...-2") por parecerse demasiado a su hermano; y el checkbox "Agregar filas
  nuevas" no tenía ningún efecto (siempre agregaba). Los dos, corregidos.
- **Fix aviso de ubicación Shopify + cache de token por secret (sep 2026):**
  el aviso "igual se puede escribir el stock" se mostraba aunque el error real
  fuera credenciales inválidas (falso). De paso, un secret rotado podía dejar
  cacheado un token viejo hasta 24h.
- **"Actualizar Maestra" ya no obliga a guardar un flujo (sep 2026):** correr
  sin guardar es ahora el default (checkbox para guardarlo, destildado).
- **Consolidar "Actualizar Maestra" en una sola pantalla (sep 2026):**
  reemplaza "+ Nueva Fuente" y "Archivo → Maestra → Shopify". De paso, avisa
  cuando el auto-mapeo de columnas es ambiguo en vez de elegir en silencio.
- **Push a Shopify: nombre y categoría, con conflicto resuelto por variante
  principal (sep 2026):** amplía la regla de "solo VARIANTE" para estos dos
  campos (a nivel PRODUCTO); cuando variantes del mismo producto piden
  valores distintos, gana la "-1" (o "-C1"/"-D1") salvo que el contenido real
  difiera, en cuyo caso queda como conflicto sin resolver.
- Dos módulos Shopify a propósito (bajada = emergencia, subida = flujo
  normal): no fusionar — regla ya en CLAUDE.md.

## Pendientes / dudas abiertas
- (ninguna abierta ahora)

## Notas de lógica
- (nada pendiente de anotar acá — ver MEMORIA_PROYECTO.md §2-3 para el
  detalle técnico del motor)
