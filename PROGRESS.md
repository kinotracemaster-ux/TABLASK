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
> Última actualización: 2026-09-03

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
- Probar "Actualizar Maestra" (abajo) con credenciales reales de Google Sheets —
  en esta sesión solo se pudo verificar contra un sandbox sin
  `GOOGLE_CREDENTIALS_JSON`, así que la parte de mapeo/preview contra la
  Maestra real (incluida la UI de mapeo ambiguo) quedó verificada por tests
  y por lectura de código, no por click-through real con una Maestra viva.

## Decisiones tomadas
- **Consolidar "Actualizar Maestra" en una sola pantalla (sep 2026):** el
  usuario pidió simplificar el flujo de actualizar la Master — hoy requería
  pasar por "+ Nueva Fuente" (wizard de 3 pasos: origen → mapeo → destinos,
  obligando a configurar destinos aunque no hiciera falta) o por "Archivo →
  Maestra → Shopify" (más directo pero atado a Shopify como único destino).
  Se reemplazan ambas por `UpdateMaster.jsx` (ruta `/nueva-fuente`, mismo
  URL): dos caminos sin navegar entre páginas — (1) fuentes ya conectadas
  arriba, con "Correr ahora" (ofrece reemplazar archivo antes, igual que "Mis
  Flujos") para el caso más común de actualización recurrente; (2) conectar
  un origen nuevo (archivo/API al frente, Google Sheet detrás de "más
  opciones" — decisión explícita del usuario) con mapeo inline que abre la
  vista previa (`RunFlowModal`) apenas se guarda, y un destino nuevo
  opcional/colapsado después (reusa el paso "Destinos" de la wizard vieja,
  sin cambios de lógica). "Mis Flujos" y el módulo "Shopify → Maestra"
  (bajada) quedan intactos a propósito. De paso se cerró un hueco real: el
  auto-mapeo de columnas (`intelligent_engine.auto_map_columns`) elegía en
  silencio cuando dos columnas de la Maestra eran sinónimos del mismo campo
  (ej. "Precio" y "Costo") — ahora avisa "mapeo ambiguo" y pide elegir a
  mano. Detalle técnico en MEMORIA_PROYECTO.md §3.
- **Fix push Shopify Nombre/Categoría (sep 2026):** cuando varias variantes (SKU)
  del mismo producto en Shopify (ej. distintos colores del mismo modelo) pedían
  nombres distintos, el push aplicaba "gana el último" en silencio y pisaba el
  nombre de las otras — reportado por el usuario como "se rompen los colores".
  Primero se cambió a "bloquear y reportar conflicto"; el usuario aclaró la
  convención real: el SKU con sufijo **"-1"** (ej. "3076-1" entre
  "3076-1".."3076-6") es la variante **principal** de la referencia — su
  nombre es el que manda. Ahora, ante nombres distintos, se aplica el de la
  "-1" y las demás propuestas se ignoran (no bloquean el envío, quedan
  expuestas para transparencia); solo sigue siendo conflicto sin resolver si
  ninguna de las que difieren es la "-1". El usuario mandó el archivo real de
  nombres (BASE-SYS) y de ahí salieron dos ajustes más: los sufijos con letra
  ("-C1" = cuero, "-D1" = deportivo) son su PROPIA referencia y también tienen
  principal; y si el nombre difiere en algo más que el código de SKU pegado
  adelante (ej. una variante agrega "TIPO PATEK PHILIPPE" que las demás no
  tienen), ya no se resuelve solo — se trata como conflicto sin resolver, para
  no perder esa info real. Detalle en MEMORIA_PROYECTO.md §3.
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
