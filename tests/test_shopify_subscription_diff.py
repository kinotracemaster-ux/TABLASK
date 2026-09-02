"""Pruebas de build_shopify_updates (fase B: Maestra → Shopify vía suscripciones).

Esta función decide QUÉ se envía a la tienda después de cada sync: convierte el
diff de la Maestra (changes + new_rows) en updates por SKU. Una regresión aquí
significa empujar precios/stock equivocados a una tienda en vivo, así que las
reglas quedan fijadas por tests:
  - solo entran los SKUs cuyo precio/stock cambió en la corrida (quirúrgico);
  - cambios de otras columnas (enriquecimiento) NUNCA generan envíos;
  - precio y stock del mismo SKU se fusionan en un solo update.
"""
from backend.propagation import build_shopify_updates


def test_solo_cambios_de_precio():
    changes = [
        {"sku": "1203", "field": "price", "old": "100", "new": "200"},
        {"sku": "45", "field": "name", "old": "Reloj", "new": "Reloj Deportivo"},
    ]
    updates = build_shopify_updates(changes, [], price_col="price", stock_col="stock")
    assert updates == [{"sku": "1203", "price": "200"}]


def test_precio_y_stock_del_mismo_sku_se_fusionan():
    changes = [
        {"sku": "1203", "field": "price", "old": "100", "new": "200"},
        {"sku": "1203", "field": "stock", "old": "5", "new": "8"},
    ]
    updates = build_shopify_updates(changes, [], price_col="price", stock_col="stock")
    assert updates == [{"sku": "1203", "price": "200", "stock": "8"}]


def test_cambios_de_enriquecimiento_no_generan_envios():
    changes = [
        {"sku": "1203", "field": "color", "old": "", "new": "negro"},
        {"sku": "45", "field": "description", "old": "", "new": "Reloj de lujo"},
    ]
    assert build_shopify_updates(changes, [], "price", "stock") == []


def test_filas_nuevas_incluyen_solo_campos_con_valor():
    new_rows = [
        {"sku": "K-001", "fields": {"name": "Reloj", "price": "45000", "stock": ""}},
        {"sku": "K-002", "fields": {"name": "Otro", "price": "", "stock": "3"}},
        {"sku": "K-003", "fields": {"name": "Sin nucleo"}},
    ]
    updates = build_shopify_updates([], new_rows, "price", "stock")
    assert {"sku": "K-001", "price": "45000"} in updates
    assert {"sku": "K-002", "stock": "3"} in updates
    assert len(updates) == 2  # K-003 no aporta precio ni stock


def test_columna_no_mapeada_se_ignora():
    changes = [
        {"sku": "1203", "field": "price", "old": "100", "new": "200"},
        {"sku": "1203", "field": "stock", "old": "5", "new": "8"},
    ]
    # Suscripción solo de stock (price_col=None): el cambio de precio no viaja.
    updates = build_shopify_updates(changes, [], price_col=None, stock_col="stock")
    assert updates == [{"sku": "1203", "stock": "8"}]


def test_diff_vacio_no_envia_nada():
    assert build_shopify_updates([], [], "price", "stock") == []


def test_campos_extra_compare_y_barcode_viajan():
    changes = [
        {"sku": "1203", "field": "precio_oferta", "old": "0", "new": "150"},
        {"sku": "1203", "field": "cod_barras", "old": "", "new": "779001"},
        {"sku": "1203", "field": "color", "old": "", "new": "negro"},  # no mapeado: se ignora
    ]
    updates = build_shopify_updates(changes, [], price_col="price", stock_col="stock",
                                    compare_col="precio_oferta", barcode_col="cod_barras")
    assert updates == [{"sku": "1203", "compare_at_price": "150", "barcode": "779001"}]


def test_campos_nombre_y_categoria_viajan():
    # Nombre/categoría son a nivel PRODUCTO, pero acá siguen siendo un update más
    # por SKU (push_updates es quien los agrupa por producto al escribir).
    changes = [
        {"sku": "1203", "field": "nombre_prod", "old": "Reloj", "new": "Reloj Deportivo"},
        {"sku": "1203", "field": "categoria", "old": "", "new": "Relojes"},
    ]
    updates = build_shopify_updates(changes, [], price_col="price", stock_col="stock",
                                    title_col="nombre_prod", product_type_col="categoria")
    assert updates == [{"sku": "1203", "title": "Reloj Deportivo", "product_type": "Relojes"}]
