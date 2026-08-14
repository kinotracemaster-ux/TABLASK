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
- **Push a Shopify con campos configurables (uno o varios):** antes el destino solo
  mandaba precio/stock. Ahora se pueden elegir campos a nivel VARIANTE que Shopify
  acepta cruzando por SKU: **precio, stock, precio comparativo (oferta) y código de
  barras** — uno o varios, opcionales. Sigue sin crear productos ni tocar datos de
  producto (título/descripción). Cambios: 2 columnas nuevas en `ShopifySubscription`
  (`compare_price_column_master`, `barcode_column_master`) con auto-migración en
  `main.py`; `push_updates` arma una sola llamada bulk de variante con los campos
  activos (`do_compare_price`/`do_barcode`, contadores nuevos en el summary);
  `build_updates_from_sheet`, `build_shopify_updates`, el push directo `/api/shopify/push`
  y el diff de propagación extendidos. UI en las 3 pantallas (FileToShopify, asistente,
  modal de Flujos). Tests nuevos en `test_shopify_push.py` y `test_shopify_subscription_diff.py`
  (136 pasan). Regla en CLAUDE.md actualizada.
- **Página dedicada "Archivo → Maestra → Shopify" (subida):** módulo propio en el
  menú, simétrico al de "Shopify → Maestra" (bajada), al estilo del screenshot del
  usuario. Tres tarjetas numeradas apiladas en una sola pantalla:
  1) **Archivo** — subir nuevo o elegir uno ya subido → lee columnas → auto-detecta
     SKU y auto-mapea contra la Maestra (editable) → "Guardar" crea la Fuente.
  2) **Maestra** — botón "Actualizar Maestra ahora" que abre el `RunFlowModal` del
     proceso (vista previa → escritura quirúrgica).
  3) **Shopify** — tienda + precio/stock (columnas Maestra) + bodega → "Guardar
     destino" (`ShopifySubscription`) → Previsualizar / Enviar (`push-now`).
  Reusa endpoints existentes; sin lógica nueva de backend. (`FileToShopify.jsx`,
  ruta `/subir-shopify`, link en `App.jsx`.)
- **Cierre "Correr ahora" en el asistente (Nueva Fuente):** el flujo
  Archivo → Maestra → Shopify ya existía entero en el wizard, pero al crear la
  fuente NO se corría → la Maestra no se actualizaba hasta un "Correr Procesos"
  manual y poco visible. Ahora el Paso 3 termina con una tarjeta **"Actualizar
  ahora"** (mini-diagrama Archivo → Maestra → Shopify + botón **Correr ahora**)
  que abre el `RunFlowModal` del proceso recién creado: vista previa → escribe la
  Maestra (quirúrgico) → la propagación empuja precio/stock al destino Shopify
  guardado. Cierra el círculo en un solo lugar. (`SourceWizard.jsx`: `createdProc`,
  `runProc`, reusa `RunFlowModal` y `staging/execute-bulk`.)
- **Diagrama de flujo interactivo (home):** el `PipelineBar` (Fuentes → Maestra →
  Destinos) dejó de ser solo visual. Cada nodo ahora tiene botones que llevan a la
  acción real vía deep-link `/flujos?action=&node=`:
  - Fuente → **Correr** (vista previa) y **Editar** el mapeo.
  - Maestra → **Ver Maestra**.
  - Destino Shopify/API → **Enviar** (push ahora) y **Editar**; hoja hija → **Editar**.
  Se agregó una línea que explica el camino ("Subís por una Fuente → Maestra →
  Destino"). Genérico para cualquier fuente/destino (el caso Poe→Shopify es un
  ejemplo). `Flujos.jsx` lee el deep-link y dispara el handler ya existente.
- **Editar destinos Shopify:** faltaba el modal de edición (antes solo se podía
  enviar/pausar/borrar). Ahora se puede cambiar nombre, tienda, columnas de
  precio/stock (desde `master-columns`) y location_id. (`Flujos.jsx`,
  `PUT /api/shopify-subscriptions/{id}` ya existía.)

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
