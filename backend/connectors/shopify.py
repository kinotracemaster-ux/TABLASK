import time
import requests
from typing import List, Dict, Any, Tuple
from .base import BaseConnector

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
        self.api_version = (self.config.get("shopify_api_version") or DEFAULT_API_VERSION).strip()

    # ------------------------------------------------------------------ auth
    def _get_access_token(self) -> str:
        """Obtiene un access token válido (cacheado 24h) vía client_credentials."""
        if not self.domain:
            raise ValueError("Falta el dominio de la tienda Shopify (shopify_domain).")
        if not self.client_id or not self.client_secret:
            raise ValueError("Faltan las credenciales Shopify (client_id / client_secret).")

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
        }, timeout=15)
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
            resp = requests.post(url, json=payload, headers=headers, timeout=30)
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
    def fetch_data(self, source_path: str) -> List[Dict[str, Any]]:
        """
        Descarga productos y sus variantes como filas planas (una por variante).
        source_path se ignora (Shopify no tiene "hojas"); se usa "Products" por convención.
        """
        query = """
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
                      barcode
                      inventoryQuantity
                      inventoryItem { id }
                    }
                  }
                }
              }
            }
          }
        }
        """
        rows: List[Dict[str, Any]] = []
        cursor = None
        while True:
            data = self._graphql(query, {"cursor": cursor})
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
