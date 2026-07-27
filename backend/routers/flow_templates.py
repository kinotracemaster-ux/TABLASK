"""Plantillas de flujo preestablecido.

Un solo lugar que ARMA, con las convenciones ya puestas, un flujo completo de
stock: el Process BASE-SYS → Maestra (con "agotar faltantes" ON porque BASE-SYS
es la fuente de verdad del inventario) y todos sus destinos (hojas hijas por
FieldSubscription + canales Shopify/API).

No es un motor nuevo: crea EXACTAMENTE las mismas filas de config que el usuario
armaría a mano una por una, solo que de una sola vez y pre-estructuradas. Por eso
todo lo que crea queda editable/borrable desde sus CRUD normales
(`/api/processes`, `/api/subscriptions`, `/api/shopify-subscriptions`,
`/api/api-subscriptions`). Cumple el pedido: "que esté ya estructurado, pero que
se pueda editar y borrar dado el caso".
"""
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/flow-templates", tags=["flow-templates"])

# Nombre canónico del proceso de la plantilla; sirve para detectarlo y no
# duplicarlo. Si el usuario lo renombra, deja de considerarse "la plantilla"
# (queda como un proceso normal más), que es justo lo que se quiere.
TEMPLATE_PROCESS_NAME = "BASE-SYS → Maestra (stock)"


def _get_master_project(db: Session) -> models.Project:
    """La Maestra global: primer proyecto con Maestra enlazada."""
    project = db.query(models.Project).filter(
        models.Project.master_connection_id.isnot(None)
    ).first()
    if not project:
        raise HTTPException(
            status_code=400,
            detail="Primero enlazá la Tabla Maestra; sin Maestra no hay a dónde llevar el stock.",
        )
    return project


@router.get("/base-sys-stock", response_model=schemas.FlowTemplateStatus)
def base_sys_stock_status(db: Session = Depends(get_db)):
    """¿Ya existe el flujo preestablecido? (para que la UI muestre el botón bien)."""
    proc = db.query(models.Process).filter(
        models.Process.name == TEMPLATE_PROCESS_NAME
    ).first()
    return schemas.FlowTemplateStatus(exists=bool(proc), process_id=proc.id if proc else None)


@router.post("/base-sys-stock", response_model=schemas.BaseSysStockTemplateResult)
def create_base_sys_stock_flow(payload: schemas.BaseSysStockTemplate, db: Session = Depends(get_db)):
    project = _get_master_project(db)
    warnings: list[str] = []

    # La fuente BASE-SYS debe existir.
    source = db.query(models.Connection).filter(
        models.Connection.id == payload.source_connection_id
    ).first()
    if not source:
        raise HTTPException(status_code=404, detail="La conexión BASE-SYS indicada no existe.")

    # No duplicar el proceso de la plantilla: si ya está, se edita/borra, no se re-arma.
    existing = db.query(models.Process).filter(
        models.Process.name == TEMPLATE_PROCESS_NAME
    ).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Ya existe el flujo de stock preestablecido (proceso #{existing.id}). "
                "Editalo o borralo antes de volver a armarlo."
            ),
        )

    # 1) Process BASE-SYS → Maestra (trae stock; opcional precio base).
    field_mappings = {payload.stock_column_source: payload.master_stock_column}
    if payload.price_column_source and payload.master_price_column:
        field_mappings[payload.price_column_source] = payload.master_price_column

    proc = models.Process(
        name=TEMPLATE_PROCESS_NAME,
        description=(
            "Flujo preestablecido: trae el stock del BASE-SYS a la Maestra y agota "
            "los SKU faltantes (BASE-SYS es la fuente de verdad del inventario)."
        ),
        source_connection_id=payload.source_connection_id,
        source_sheet_name=payload.source_sheet_name,
        target_connection_id=None,   # Maestra global
        target_sheet_name=None,
        sku_column_source=payload.sku_column_source,
        sku_column_master=payload.master_sku_column,
        field_mappings=json.dumps(field_mappings, ensure_ascii=False),
        add_new_rows=True,
        zero_missing_stock=True,     # clave: solo la fuente de verdad agota faltantes
        is_active=payload.activate,
    )
    db.add(proc)
    db.flush()  # obtener proc.id sin cerrar la transacción

    # 2) Hojas hijas (FieldSubscription): Maestra → hoja, columna de stock.
    field_sub_ids: list[int] = []
    for tgt in payload.sheet_targets:
        conn = db.query(models.Connection).filter(models.Connection.id == tgt.connection_id).first()
        if not conn:
            warnings.append(f"Hoja destino omitida: la conexión #{tgt.connection_id} no existe.")
            continue
        mapping = {payload.master_stock_column: tgt.stock_column}
        for sheet in tgt.sheets:
            sub = models.FieldSubscription(
                project_id=project.id,
                target_connection_id=tgt.connection_id,
                target_sheet_name=sheet,
                sku_column_target=tgt.sku_column,
                field_mappings=json.dumps(mapping, ensure_ascii=False),
                is_active=payload.activate,
                name=f"BASE-SYS stock · {sheet}",
            )
            db.add(sub)
            db.flush()
            field_sub_ids.append(sub.id)

    # 3) Canales Shopify: Maestra → tienda (solo stock; NUNCA crea productos).
    shopify_ids: list[int] = []
    for tgt in payload.shopify_targets:
        conn = db.query(models.Connection).filter(models.Connection.id == tgt.connection_id).first()
        if not conn or conn.connection_type != "shopify":
            warnings.append(
                f"Canal Shopify omitido: la conexión #{tgt.connection_id} no es una tienda Shopify."
            )
            continue
        sub = models.ShopifySubscription(
            name=tgt.name or f"BASE-SYS stock · {conn.name}",
            connection_id=tgt.connection_id,
            price_column_master=None,
            stock_column_master=payload.master_stock_column,
            location_id=tgt.location_id,
            is_active=payload.activate,
        )
        db.add(sub)
        db.flush()
        shopify_ids.append(sub.id)

    # 4) Canales API genéricos (ej. Effi): Maestra → endpoint HTTP.
    api_ids: list[int] = []
    for tgt in payload.api_targets:
        if not (tgt.url or "").strip().lower().startswith(("http://", "https://")):
            warnings.append(
                f"Canal API '{tgt.name}' omitido: la URL debe empezar con http:// o https://"
            )
            continue
        sub = models.ApiSubscription(
            name=tgt.name,
            url=tgt.url.strip(),
            http_method=tgt.http_method,
            auth_header_name=tgt.auth_header_name,
            auth_token=tgt.auth_token or None,
            extra_headers=json.dumps(tgt.extra_headers, ensure_ascii=False) if tgt.extra_headers else None,
            transform_spec=None,
            is_active=payload.activate,
        )
        db.add(sub)
        db.flush()
        api_ids.append(sub.id)

    db.commit()
    return schemas.BaseSysStockTemplateResult(
        process_id=proc.id,
        field_subscription_ids=field_sub_ids,
        shopify_subscription_ids=shopify_ids,
        api_subscription_ids=api_ids,
        warnings=warnings,
    )
