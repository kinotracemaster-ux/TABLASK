# PROGRESS — TablasK

> Estado vivo del proyecto, **corto a propósito**: se carga completo en CADA turno
> vía el `@import` de CLAUDE.md, así que cada línea de más acá es tokens gastados
> en toda sesión futura. El detalle técnico y el historial completo de cada
> feature (qué se rompió, cómo se resolvió, qué archivos tocó, qué tests la
> fijan) vive en `MEMORIA_PROYECTO.md` §3 — se lee bajo demanda, no en cada turno.
>
> Instrucción típica de cierre: "actualizá el estado — PROGRESS.md corto acá,
> detalle de la feature en MEMORIA_PROYECTO.md §3".
>
> Última actualización: 2026-09-02

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
- Sin implementar del flujo de stock: §7 anti-sobreventa (descontar por venta
  confirmada) y §9 precio manual vs. automático por canal (ver MEJORAS_TABLASK.md).

## Decisiones tomadas
- Push a Shopify ahora también puede mandar **nombre** y **categoría** (a nivel
  PRODUCTO, no variante) — pedido explícito del usuario, amplía la regla dura
  de "solo VARIANTE" de CLAUDE.md/MEMORIA_PROYECTO.md §3. **Color queda afuera
  a propósito:** es una opción de variante, cambiarla por API es mucho más
  riesgoso (puede reestructurar/duplicar variantes) que actualizar un campo de
  producto. Detalle técnico en MEMORIA_PROYECTO.md §3 ("Push a Shopify de
  nombre y categoría").
- Dos módulos Shopify a propósito: bajada = emergencia (sin archivo BASE),
  subida = flujo normal. No fusionar.
- Precio sugerido = base × 2, se muestra solo en Kyte.
- El Guardián decide por PARECIDO (near-dup del SKU), no por % de coherencia
  a secas: nuevos que no se parecen a nada = altas legítimas (pasan); nuevos
  casi-idénticos a existentes = formato roto (se bloquea/salta).

## Pendientes / dudas abiertas
- (ninguna abierta ahora)

## Notas de lógica
- (nada pendiente de anotar acá — ver MEMORIA_PROYECTO.md §2-3 para el
  detalle técnico del motor)
