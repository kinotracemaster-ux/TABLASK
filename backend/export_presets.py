"""Plantillas de export predefinidas por canal (MEJORAS_TABLASK §11).

Cada preset es una lista ordenada de columnas de salida con su transformación
(ver export_engine). Los `source`/`sources` usan los nombres del NÚCLEO de la
Maestra propuesta (sku, name, price, stock, brand, category, status, parent…);
si la Maestra del usuario usa otros nombres, la UI permite reasignarlos antes
de guardar. El precio de venta se calcula al exportar con multiplicador por
canal (base ×2 global de Kino).

Un clic aplica todo esto en vez del mapeo columna-a-columna tedioso.
"""

# Multiplicador de precio por defecto (regla global de Kino confirmada).
PRICE_X = 2

PRESETS = [
    {
        "key": "shopify",
        "name": "Shopify CSV",
        "description": "Importador oficial de Shopify. Variantes agrupadas por Handle (slug). Precio de venta = base ×2.",
        "spec": [
            {"output": "Handle", "type": "slug", "sources": ["parent", "name"]},
            {"output": "Title", "type": "field", "source": "name"},
            {"output": "Body (HTML)", "type": "template", "template": "<p>{name} — {brand}</p>"},
            {"output": "Vendor", "type": "field", "source": "brand"},
            {"output": "Product Category", "type": "field", "source": "category"},
            {"output": "Type", "type": "field", "source": "category"},
            {"output": "Tags", "type": "field", "source": "line"},
            {"output": "Published", "type": "const", "value": "TRUE"},
            {"output": "Option1 Name", "type": "const", "value": "Color"},
            {"output": "Option1 Value", "type": "field", "source": "color"},
            {"output": "Variant SKU", "type": "field", "source": "sku"},
            {"output": "Variant Inventory Qty", "type": "field", "source": "stock"},
            {"output": "Variant Price", "type": "price", "source": "price", "multiplier": PRICE_X},
        ],
    },
    {
        "key": "kyte",
        "name": "Kyte",
        "description": "POS/catálogo Kyte. El SKU va embebido en el Nombre; Código = SKU limpio. Precio de venta = base ×2.",
        "spec": [
            {"output": "Nombre", "type": "concat", "sources": ["sku", "name"], "sep": " "},
            {"output": "Categoría", "type": "field", "source": "category"},
            {"output": "Código", "type": "field", "source": "sku"},
            {"output": "Descripción", "type": "field", "source": "description"},
            {"output": "Costo unitario", "type": "field", "source": "price"},
            {"output": "Precio", "type": "price", "source": "price", "multiplier": PRICE_X},
            {"output": "Mostrar en catálogo (S/N)", "type": "const", "value": "S"},
            {"output": "Controlar stock (S/N)", "type": "const", "value": "S"},
            {"output": "Stock actual", "type": "field", "source": "stock"},
        ],
    },
    {
        "key": "effi",
        "name": "Effi",
        "description": "Gestor de inventario Effi. El SKU va embebido en la Descripción (sku + nombre).",
        "spec": [
            {"output": "Descripción", "type": "concat", "sources": ["sku", "name"], "sep": " "},
            {"output": "Costo", "type": "field", "source": "price"},
            {"output": "Cantidad", "type": "field", "source": "stock"},
            {"output": "Tipo de ajuste", "type": "const", "value": "Entrada"},
        ],
    },
    {
        "key": "catalogo",
        "name": "Catálogo / genérico",
        "description": "Espejo de la Maestra con precio sugerido (base ×2). Buen punto de partida para editar.",
        "spec": [
            {"output": "SKU", "type": "field", "source": "sku"},
            {"output": "Nombre", "type": "field", "source": "name"},
            {"output": "Marca", "type": "field", "source": "brand"},
            {"output": "Categoría", "type": "field", "source": "category"},
            {"output": "Color", "type": "field", "source": "color"},
            {"output": "Precio sugerido", "type": "price", "source": "price", "multiplier": PRICE_X},
            {"output": "Stock", "type": "field", "source": "stock"},
            {"output": "Descripción", "type": "field", "source": "description"},
        ],
    },
]


def get_presets():
    return PRESETS
