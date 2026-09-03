import time
import uuid
import certifi
import requests
from typing import List, Dict, Any, Tuple
from .base import BaseConnector
from ..sku_utils import normalize_sku_for_match, is_primary_variant_sku, strip_sku_label

# Se fuerza el bundle de CAs de certifi (en vez del default de requests, que
# puede quedar pisado por REQUESTS_CA_BUNDLE/SSL_CERT_FILE del contenedor de
# despliegue) — visto en producción: Railway/Nixpacks con esa variable
# apuntando a una ruta de Nix inexistente en runtime hacía fallar TODO
# llamado a Shopify con "unable to get local issuer certificate", aunque el
# certificado de *.myshopify.com sea válido.
_CA_BUNDLE = certifi.where()


def _chunks(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def _fmt_price(v) -> str:
    """Para comparar 'antes' (Shopify) vs 'después' (Maestra) sin ruido de
    formato: "182000" y "182000.00" deben verse como el mismo precio."""
    if v in (None, ""):
        return "(vacío)"
    try:
        f = round(float(str(v).replace(",", ".").strip()), 2)
        return str(int(f)) if f == int(f) else f"{f:.2f}"
    except (ValueError, TypeError):
        return str(v).strip()


def _fmt_stock(v) -> str:
    if v in (None, ""):
        return "(vacío)"
    try:
        return str(int(float(str(v).replace(",", ".").strip())))
    except (ValueError, TypeError):
        return str(v).strip()


def _fmt_plain(v) -> str:
    return str(v).strip() if v not in (None, "") else "(vacío)"

# Versión por defecto de la Admin API. REST quedó legacy (oct-2024); usamos GraphQL.
DEFAULT_API_VERSION = "2026-04"

# Cache de tokens en memoria del proceso. El client_credentials grant devuelve
# un token que dura 24h, así que lo reutilizamos hasta poco antes de que expire.
# Clave: (domain, client_id) -> {"token": str, "expires_at": float epoch}
_TOKEN_CACHE: Dict[tuple, Dict[str, Any]] = {}


class ShopifyConnector(BaseConnector):
    """
    Conector para tiendas Shopify (multi-tienda).

    Autenticación: client_credentials grant (apps del Dev Dashboard instaladas en
    tiendas de la misma organización que tú posees). Intercambia client_id +
    client_secret por un access token de 24h. NO requiere flujo OAuth con redirects.

    Lectura: GraphQL Admin API. Cada fila devuelta es UNA variante de producto
    (porque el SKU vive en la variante), con: sku, product_title, price,
    inventory_quantity, inventory_item_id, variant_id, product_id, status.
    """

    def __init__(self, connection_config: Dict[str, Any]):
        super().__init__(connection_config)
        raw_domain = (self.config.get("shopify_domain") or "").strip()
        # Normalizar: aceptar "tienda", "tienda.myshopify.com" o una URL completa.
        raw_domain = raw_domain.replace("https://", "").replace("http://", "").strip("/")
        if raw_domain and not raw_domain.endswith(".myshopify.com"):
            raw_domain = f"{raw_domain}.myshopify.com"
        self.domain = raw_domain
        self.client_id = (self.config.get("shopify_client_id") or "").strip()
        self.client_secret = (self.config.get("shopify_client_secret") or "").strip()
        # Token directo (shpat_...) de un custom app del admin. Si está, se usa tal cual
        # y se omite el client_credentials grant.
        self.access_token = (self.config.get("shopify_access_token") or "").strip()
        self.api_version = (self.config.get("shopify_api_version") or DEFAULT_API_VERSION).strip()

    # ------------------------------------------------------------------ auth
    def _get_access_token(self) -> str:
        """
        Devuelve un access token válido. Dos modos:
        - Token directo (shopify_access_token, ej. shpat_...): se usa tal cual.
        - client_credentials (client_id + client_secret): pide token de 24h y lo cachea.
        """
        if not self.domain:
            raise ValueError("Falta el dominio de la tienda Shopify (shopify_domain).")

        # Modo 1: token estático provisto por el usuario.
        if self.access_token:
            return self.access_token

        # Modo 2: client_credentials grant.
        if not self.client_id or not self.client_secret:
            raise ValueError(
                "Faltan credenciales Shopify: provee un Access Token directo (shpat_...) "
                "o un par Client ID + Client Secret."
            )

        cache_key = (self.domain, self.client_id)
        cached = _TOKEN_CACHE.get(cache_key)
        # Margen de 5 min antes de la expiración real.
        if cached and cached["expires_at"] - 300 > time.time():
            return cached["token"]

        url = f"https://{self.domain}/admin/oauth/access_token"
        resp = requests.post(url, json={
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "grant_type": "client_credentials",
        }, timeout=15, verify=_CA_BUNDLE)
        if resp.status_code != 200:
            raise ValueError(
                f"No se pudo obtener token de Shopify ({resp.status_code}): {resp.text[:300]}"
            )
        data = resp.json()
        token = data.get("access_token")
        if not token:
            raise ValueError(f"Respuesta de token inesperada de Shopify: {data}")
        expires_in = int(data.get("expires_in", 86399))
        _TOKEN_CACHE[cache_key] = {"token": token, "expires_at": time.time() + expires_in}
        return token

    # --------------------------------------------------------------- graphql
    def _graphql(self, query: str, variables: Dict[str, Any] = None) -> Dict[str, Any]:
        """Ejecuta una consulta GraphQL con reintentos básicos ante throttling/5xx."""
        token = self._get_access_token()
        url = f"https://{self.domain}/admin/api/{self.api_version}/graphql.json"
        headers = {"X-Shopify-Access-Token": token, "Content-Type": "application/json"}
        payload = {"query": query, "variables": variables or {}}

        last_err = ""
        for attempt in range(5):
            resp = requests.post(url, json=payload, headers=headers, timeout=30, verify=_CA_BUNDLE)
            if resp.status_code == 429 or resp.status_code >= 500:
                last_err = f"HTTP {resp.status_code}: {resp.text[:200]}"
                time.sleep(2 ** attempt)
                continue
            if resp.status_code != 200:
                raise ValueError(f"Error GraphQL Shopify ({resp.status_code}): {resp.text[:300]}")
            body = resp.json()
            if body.get("errors"):
                # THROTTLED viene como error de GraphQL, no como 429.
                msg = str(body["errors"])
                if "THROTTLED" in msg.upper():
                    last_err = msg[:200]
                    time.sleep(2 ** attempt)
                    continue
                raise ValueError(f"GraphQL devolvió errores: {msg[:300]}")
            return body.get("data", {})
        raise ValueError(f"Shopify GraphQL falló tras reintentos. Último error: {last_err}")

    # --------------------------------------------------------------- fetching
    @staticmethod
    def _products_query(with_inventory: bool) -> str:
        # inventoryQuantity/inventoryItem requieren el scope read_inventory.
        # Si no está, se omiten y se traen igual productos/SKU/precio.
        inv = "inventoryQuantity\n                      inventoryItem { id }" if with_inventory else ""
        return """
        query ($cursor: String) {
          products(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id
                title
                status
                vendor
                productType
                variants(first: 100) {
                  edges {
                    node {
                      id
                      sku
                      title
                      price
                      compareAtPrice
                      barcode
                      %s
                    }
                  }
                }
              }
            }
          }
        }
        """ % inv

    def fetch_data(self, source_path: str) -> List[Dict[str, Any]]:
        """
        Descarga productos y sus variantes como filas planas (una por variante).
        source_path se ignora (Shopify no tiene "hojas"); se usa "Products" por convención.
        Si falta el scope read_inventory, reintenta sin los campos de inventario.
        """
        with_inventory = True
        query = self._products_query(with_inventory)
        rows: List[Dict[str, Any]] = []
        cursor = None
        while True:
            try:
                data = self._graphql(query, {"cursor": cursor})
            except ValueError as e:
                msg = str(e).lower()
                # Degradar a consulta sin inventario si el scope no está concedido.
                if with_inventory and ("inventory" in msg or "access_denied" in msg or "scope" in msg):
                    with_inventory = False
                    query = self._products_query(with_inventory)
                    rows = []
                    cursor = None
                    continue
                raise
            products = data.get("products", {})
            for p_edge in products.get("edges", []):
                node = p_edge.get("node", {})
                for v_edge in node.get("variants", {}).get("edges", []):
                    v = v_edge.get("node", {})
                    inv_item = v.get("inventoryItem") or {}
                    rows.append({
                        "sku": v.get("sku") or "",
                        "product_title": node.get("title") or "",
                        "variant_title": v.get("title") or "",
                        "price": v.get("price") or "",
                        "compare_at_price": v.get("compareAtPrice") or "",
                        "barcode": v.get("barcode") or "",
                        "inventory_quantity": v.get("inventoryQuantity"),
                        "inventory_item_id": inv_item.get("id") or "",
                        "variant_id": v.get("id") or "",
                        "product_id": node.get("id") or "",
                        "vendor": node.get("vendor") or "",
                        "product_type": node.get("productType") or "",
                        "status": node.get("status") or "",
                    })
            page = products.get("pageInfo", {})
            if page.get("hasNextPage"):
                cursor = page.get("endCursor")
            else:
                break
        return rows

    def normalize_data(self, raw_data: List[Dict[str, Any]], field_mappings: Dict[str, str]) -> List[Dict[str, Any]]:
        """Estandariza columnas Shopify -> columnas de la Tabla Maestra."""
        normalized = []
        for row in raw_data:
            new_row = {}
            for src_col, master_col in field_mappings.items():
                val = row.get(src_col, "")
                new_row[master_col] = "" if val is None else str(val)
            normalized.append(new_row)
        return normalized

    def get_available_columns(self) -> List[str]:
        """Columnas que expone este conector, para que el mapeo en la UI las ofrezca."""
        return [
            "sku", "product_title", "variant_title", "price", "barcode",
            "inventory_quantity", "inventory_item_id", "variant_id",
            "product_id", "vendor", "product_type", "status",
        ]

    # --------------------------------------------------------------- writing
    @staticmethod
    def _normalize_sku(s: str) -> str:
        """Mismas reglas que services.normalize_sku_for_match (única fuente en
        sku_utils): unifica guiones/espacios unicode, invisibles, decimales y
        ceros a la izquierda. Solo para cruzar, no altera el SKU guardado."""
        return normalize_sku_for_match(s)

    def get_primary_location_id(self) -> str:
        """
        Primera ubicación de la tienda (solo el id; pedir 'name' exigiría read_locations).
        """
        # Pedimos varias (solo id, no requiere read_locations) para detectar multi-bodega.
        try:
            data = self._graphql('{ locations(first: 10) { edges { node { id } } } }')
        except ValueError as e:
            if "ACCESS_DENIED" in str(e).upper() or "read_locations" in str(e).lower():
                raise ValueError(
                    "Para escribir inventario falta el scope 'read_locations' en la app Shopify. "
                    "Agrégalo (Versiones → Nueva versión) y reinstala."
                )
            raise
        edges = data.get("locations", {}).get("edges", [])
        if not edges:
            raise ValueError("La tienda no tiene ubicaciones para actualizar inventario.")
        if len(edges) > 1:
            raise ValueError(
                "Tu tienda tiene VARIAS ubicaciones. Agrega el scope 'read_locations', "
                "reinstala la app y elige la bodega en 'Enviar a Shopify' para no escribir en la equivocada."
            )
        return edges[0]["node"]["id"]

    def get_locations(self) -> List[Dict[str, str]]:
        """Lista de ubicaciones (id + nombre) para que el usuario elija dónde escribir.
        Leer el 'name' requiere el scope read_locations."""
        try:
            data = self._graphql('{ locations(first: 50) { edges { node { id name isActive } } } }')
        except ValueError as e:
            if "read_locations" in str(e).lower() or "ACCESS_DENIED" in str(e).upper():
                raise ValueError(
                    "Falta el scope 'read_locations' para listar ubicaciones. "
                    "Agrégalo (Versiones → Nueva versión) y reinstala la app."
                )
            raise
        out = []
        for e in data.get("locations", {}).get("edges", []):
            n = e.get("node", {})
            out.append({"id": n.get("id", ""), "name": n.get("name", ""), "active": n.get("isActive", True)})
        return out

    def index_variants_by_sku(self) -> Dict[str, Dict[str, Any]]:
        """{ sku_normalizado: {variant_id, product_id, inventory_item_id, sku} } leyendo el catálogo."""
        idx: Dict[str, Dict[str, Any]] = {}
        for r in self.fetch_data("Products"):
            sku = r.get("sku") or ""
            if not sku:
                continue
            idx[self._normalize_sku(sku)] = {
                "variant_id": r.get("variant_id") or "",
                "product_id": r.get("product_id") or "",
                "inventory_item_id": r.get("inventory_item_id") or "",
                "sku": sku,
                # Valores actuales en Shopify — se usan solo para armar el "antes" del
                # preview (dry_run); la escritura real no los necesita.
                "current_price": r.get("price") or "",
                "current_compare_price": r.get("compare_at_price") or "",
                "current_barcode": r.get("barcode") or "",
                "current_stock": r.get("inventory_quantity"),
                "current_title": r.get("product_title") or "",
                "current_product_type": r.get("product_type") or "",
            }
        return idx

    def _price_bulk_update(self, product_id: str, variants: List[Dict[str, str]]):
        q = """
        mutation ($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            userErrors { field message }
          }
        }"""
        data = self._graphql(q, {"productId": product_id, "variants": variants})
        errs = (data.get("productVariantsBulkUpdate") or {}).get("userErrors", [])
        if errs:
            raise ValueError(str(errs)[:250])

    def _product_update(self, product_id: str, fields: Dict[str, str]):
        """Actualiza campos a nivel PRODUCTO (nombre/categoría), no de variante.
        Si el SKU comparte producto con otras variantes, el cambio aplica al
        producto entero — nunca crea uno nuevo, siempre requiere `id`."""
        q = """
        mutation ($product: ProductUpdateInput!) {
          productUpdate(product: $product) {
            userErrors { field message }
          }
        }"""
        data = self._graphql(q, {"product": {"id": product_id, **fields}})
        errs = (data.get("productUpdate") or {}).get("userErrors", [])
        if errs:
            raise ValueError(str(errs)[:250])

    def _inventory_set(self, quantities: List[Dict[str, Any]]):
        # @idempotent es obligatorio en 2026-04; key única por llamada evita duplicados en reintentos.
        key = str(uuid.uuid4())
        q = """
        mutation ($input: InventorySetQuantitiesInput!) {
          inventorySetQuantities(input: $input) @idempotent(key: "%s") {
            userErrors { field message }
          }
        }""" % key
        inp = {"name": "available", "reason": "correction", "quantities": quantities}
        data = self._graphql(q, {"input": inp})
        errs = (data.get("inventorySetQuantities") or {}).get("userErrors", [])
        if errs:
            raise ValueError(str(errs)[:250])

    def push_updates(self, updates: List[Dict[str, Any]], do_price: bool, do_stock: bool,
                     dry_run: bool = False, location_id: str = None,
                     do_compare_price: bool = False, do_barcode: bool = False,
                     do_title: bool = False, do_product_type: bool = False) -> Dict[str, Any]:
        """
        Escribe campos en Shopify cruzando por SKU (nunca crea productos).
        updates: [{"sku":..., "price":..., "stock":..., "compare_at_price":..., "barcode":...,
                   "title":..., "product_type":...}].
        Cada do_* activa el campo correspondiente; solo se escriben los que traen valor.
        Precio/stock/comparativo/barcode son de VARIANTE. Título/categoría son de
        PRODUCTO: si varias variantes (SKU) del mismo producto — ej. distintos
        colores del mismo modelo, o de una sub-línea con letra (cuero "-C1..",
        deportiva "-D1..") — traen valores DISTINTOS para el mismo campo, manda
        la variante PRINCIPAL de esa referencia/línea (el SKU con sufijo "-1" o
        "-<letra>1", ej. "3076-1" o "827-C1" — `is_primary_variant_sku`): su
        valor es el que se aplica al producto, los demás se ignoran (no la
        pisan) — pero SOLO si la diferencia entre las variantes es nomás el
        código de SKU que cada una trae pegado adelante (`strip_sku_label`); si
        el contenido real difiere (ej. una variante agrega texto que las demás
        no tienen — podría ser información real, no ruido de formato), no se
        resuelve solo. Sin una principal única, o con contenido real distinto,
        no se aplica ninguna — se reporta como conflicto (`conflicts`/
        `conflicts_total`) para que el usuario lo resuelva a mano. Solo se
        escribe cuando todas las variantes del producto piden el mismo valor,
        o cuando se resuelve de forma segura por la variante principal.
        dry_run solo reporta el cruce.
        location_id: ubicación donde SET del inventario. Si None, usa la primera (arriesgado
        si hay varias bodegas) — la UI debería mandarlo explícito.
        """
        idx = self.index_variants_by_sku()
        matched, not_found = [], []
        for u in updates:
            key = self._normalize_sku(u.get("sku", ""))
            if key and key in idx:
                matched.append((u, idx[key]))
            else:
                not_found.append(u.get("sku", ""))

        summary = {
            "total": len(updates),
            "matched": len(matched),
            "not_found_count": len(not_found),
            "not_found": not_found[:200],
            "price_updated": 0,
            "stock_updated": 0,
            "compare_price_updated": 0,
            "barcode_updated": 0,
            "title_updated": 0,
            "product_type_updated": 0,
            "conflicts_total": 0,
            "errors": [],
        }

        # Título/categoría son de PRODUCTO: si dos SKU (variantes/colores) del
        # MISMO producto piden valores distintos para el mismo campo, se
        # resuelve por la variante PRINCIPAL de la referencia (sufijo "-1" del
        # SKU, ej. "3076-1" entre "3076-1".."3076-6") — su valor manda, los
        # demás se ignoran. Sin una "-1" única entre las que difieren, queda
        # como conflicto sin resolver (no se aplica ninguno). Se detecta acá
        # (se usa tanto en dry_run como en la escritura real) el valor
        # resuelto por producto/campo, y qué productos quedan en conflicto.
        conflict_pids = {"title": set(), "product_type": set()}
        resolved_values: Dict[str, Dict[str, str]] = {"title": {}, "product_type": {}}
        if do_title or do_product_type:
            by_product_entries: Dict[str, Dict[str, list]] = {}
            for u, info in matched:
                pid = info.get("product_id")
                if not pid:
                    continue
                sku = info.get("sku") or u.get("sku")
                entries = by_product_entries.setdefault(pid, {"title": [], "product_type": []})
                if do_title and u.get("title") not in (None, ""):
                    entries["title"].append((sku, str(u["title"]).strip()))
                if do_product_type and u.get("product_type") not in (None, ""):
                    entries["product_type"].append((sku, str(u["product_type"]).strip()))
            for pid, entries in by_product_entries.items():
                for field in ("title", "product_type"):
                    vals = entries[field]
                    if not vals:
                        continue
                    distinct = {v for _, v in vals}
                    if len(distinct) == 1:
                        resolved_values[field][pid] = next(iter(distinct))
                        continue
                    primary_vals = {v for sku, v in vals if is_primary_variant_sku(sku)}
                    # Antes de aplicar la de la principal, chequear que la
                    # diferencia sea SOLO el código de SKU que cada variante
                    # trae pegado adelante (ej. "3076-3 POEDAGAR..." vs
                    # "3076-1 POEDAGAR..." → mismo resto) — si el CONTENIDO
                    # real difiere (ej. una variante agrega "TIPO PATEK
                    # PHILIPPE" que la principal no tiene), no se resuelve
                    # solo: podría perderse información real del catálogo.
                    residues = {strip_sku_label(sku, v) for sku, v in vals}
                    if len(primary_vals) == 1 and len(residues) == 1:
                        resolved_values[field][pid] = next(iter(primary_vals))
                    else:
                        conflict_pids[field].add(pid)
        summary["conflicts_total"] = len(conflict_pids["title"]) + len(conflict_pids["product_type"])

        if dry_run:
            # Vista previa SKU/campo/antes→después (mismo espíritu que el preview
            # de "Correr flujo" en el sync Fuente→Maestra). Solo se listan cambios
            # REALES: si el valor nuevo ya coincide con el actual en Shopify
            # (una vez normalizado el formato), no se reporta como cambio.
            checks = []
            if do_price:
                checks.append(("price", "current_price", "Precio", _fmt_price, None))
            if do_stock:
                checks.append(("stock", "current_stock", "Stock", _fmt_stock, None))
            if do_compare_price:
                checks.append(("compare_at_price", "current_compare_price", "Precio comparativo", _fmt_price, None))
            if do_barcode:
                checks.append(("barcode", "current_barcode", "Código de barras", _fmt_plain, None))
            if do_title:
                checks.append(("title", "current_title", "Nombre", _fmt_plain, "title"))
            if do_product_type:
                checks.append(("product_type", "current_product_type", "Categoría", _fmt_plain, "product_type"))

            changes = []
            conflicts = []
            ignored_secondary = []
            for u, info in matched:
                pid = info.get("product_id")
                sku = info.get("sku") or u.get("sku")
                for key, cur_key, label, fmt, conflict_key in checks:
                    if u.get(key) in (None, ""):
                        continue
                    if conflict_key:
                        if pid in conflict_pids[conflict_key]:
                            conflicts.append({"sku": sku, "field": label, "value": fmt(u.get(key))})
                            continue
                        resolved = resolved_values[conflict_key].get(pid)
                        if resolved is not None and str(u.get(key)).strip() != resolved:
                            # Variante secundaria: la principal ("-1") ya fijó
                            # el valor del producto, esta propuesta se ignora.
                            ignored_secondary.append({"sku": sku, "field": label, "value": fmt(u.get(key)),
                                                       "applied": fmt(resolved)})
                            continue
                    after = fmt(u.get(key))
                    before = fmt(info.get(cur_key))
                    if after == before:
                        continue
                    changes.append({"sku": sku, "field": label, "before": before, "after": after})
            summary["changes"] = changes[:300]
            summary["changes_total"] = len(changes)
            summary["conflicts"] = conflicts[:300]
            summary["conflicts_total"] = len(conflicts)
            summary["ignored_secondary"] = ignored_secondary[:300]
            summary["ignored_secondary_total"] = len(ignored_secondary)
            return summary

        # Campos de variante (precio, precio comparativo, barcode): se agrupan por
        # producto y se mandan en una sola llamada bulk (productVariantsBulkUpdate).
        if do_price or do_compare_price or do_barcode:
            by_product: Dict[str, List[Dict[str, str]]] = {}
            for u, info in matched:
                if not info.get("product_id") or not info.get("variant_id"):
                    continue
                vin: Dict[str, str] = {"id": info["variant_id"]}
                if do_price:
                    price = u.get("price")
                    if price not in (None, ""):
                        vin["price"] = str(price).replace(",", ".").strip()
                if do_compare_price:
                    cmp_price = u.get("compare_at_price")
                    if cmp_price not in (None, ""):
                        vin["compareAtPrice"] = str(cmp_price).replace(",", ".").strip()
                if do_barcode:
                    barcode = u.get("barcode")
                    if barcode not in (None, ""):
                        vin["barcode"] = str(barcode).strip()
                if len(vin) > 1:  # además del id, trae al menos un campo
                    by_product.setdefault(info["product_id"], []).append(vin)
            for pid, variants in by_product.items():
                try:
                    self._price_bulk_update(pid, variants)
                    summary["price_updated"] += sum(1 for v in variants if "price" in v)
                    summary["compare_price_updated"] += sum(1 for v in variants if "compareAtPrice" in v)
                    summary["barcode_updated"] += sum(1 for v in variants if "barcode" in v)
                except Exception as e:
                    summary["errors"].append(f"variante (producto {pid[-8:]}): {str(e)[:140]}")

        # Campos de PRODUCTO (nombre, categoría): una llamada por producto (no por
        # variante). El valor a escribir por producto/campo ya viene resuelto
        # arriba (resolved_values): único si todas las variantes coincidían, o
        # el de la variante principal "-1" si había conflicto y se pudo
        # resolver. Los productos que quedaron en conflict_pids no aparecen acá.
        if do_title or do_product_type:
            by_product_fields: Dict[str, Dict[str, str]] = {}
            for pid, value in resolved_values["title"].items():
                by_product_fields.setdefault(pid, {})["title"] = value
            for pid, value in resolved_values["product_type"].items():
                by_product_fields.setdefault(pid, {})["productType"] = value
            for pid, fields in by_product_fields.items():
                if not fields:
                    continue
                try:
                    self._product_update(pid, fields)
                    if "title" in fields:
                        summary["title_updated"] += 1
                    if "productType" in fields:
                        summary["product_type_updated"] += 1
                except Exception as e:
                    summary["errors"].append(f"producto ({pid[-8:]}): {str(e)[:140]}")

        # Inventario: por lotes a la ubicación elegida (o la primera si no se indicó).
        if do_stock:
            if not location_id:
                location_id = self.get_primary_location_id()
            summary["location_id"] = location_id
            quantities = []
            for u, info in matched:
                raw = u.get("stock")
                if raw in (None, "") or not info.get("inventory_item_id"):
                    continue
                try:
                    qty = int(float(str(raw).replace(",", ".").strip()))
                except (ValueError, TypeError):
                    continue
                quantities.append({
                    "inventoryItemId": info["inventory_item_id"],
                    "locationId": location_id,
                    "quantity": qty,
                    "changeFromQuantity": None,
                })
            for chunk in _chunks(quantities, 200):
                try:
                    self._inventory_set(chunk)
                    summary["stock_updated"] += len(chunk)
                except Exception as e:
                    summary["errors"].append(f"stock (lote): {str(e)[:140]}")

        return summary

    def test_connection(self) -> Tuple[bool, str]:
        # 1) Validar credenciales/token leyendo info básica de la tienda.
        try:
            data = self._graphql("{ shop { name myshopifyDomain } }")
            shop = data.get("shop", {})
            shop_name = shop.get("name", "?")
        except Exception as e:
            return False, f"Fallo de conexión/credenciales: {str(e)}"

        # 2) Validar que el token TIENE los scopes de productos (read_products).
        #    El query anterior puede pasar sin scopes; este confirma el permiso real.
        try:
            self._graphql("{ products(first: 1) { edges { node { id } } } }")
        except Exception as e:
            msg = str(e)
            if "ACCESS_DENIED" in msg.upper() or "access denied" in msg.lower() or "scope" in msg.lower():
                return False, (
                    f"Credenciales OK ({shop_name}), pero faltan PERMISOS de lectura de productos. "
                    f"Activa 'read_products' + 'read_inventory' en la app y reinstálala. Detalle: {msg[:160]}"
                )
            return False, f"Credenciales OK ({shop_name}), pero falló la lectura de productos: {msg[:200]}"

        return True, f"Conexión Shopify exitosa: {shop_name} ({shop.get('myshopifyDomain', self.domain)}). Lectura de productos OK."
