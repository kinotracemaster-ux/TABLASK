"""Pruebas de la normalización del dominio de tienda en ShopifyConnector.

Encontrado en producción: un usuario cargó su dominio propio ("mitienda.com",
el que ven los clientes) en vez del dominio de administración de Shopify. El
código le pegaba ".myshopify.com" a lo que fuera, armando un host que no
existe ("mitienda.com.myshopify.com") — la falla recién aparecía mucho más
adelante como un SSLError críptico al pedir el token. Ahora se detecta antes
y se avisa con un mensaje claro.
"""
import pytest

from backend.connectors.shopify import ShopifyConnector


def _domain(raw):
    return ShopifyConnector({"shopify_domain": raw, "shopify_access_token": "shpat_test"}).domain


def test_handle_simple_le_pega_myshopify():
    assert _domain("mitienda") == "mitienda.myshopify.com"


def test_dominio_myshopify_completo_se_conserva():
    assert _domain("mitienda.myshopify.com") == "mitienda.myshopify.com"


def test_url_completa_se_limpia():
    assert _domain("https://mitienda.myshopify.com/") == "mitienda.myshopify.com"


def test_dominio_propio_de_la_tienda_se_rechaza_con_mensaje_claro():
    with pytest.raises(ValueError, match="dominio de administración de Shopify"):
        _domain("poedagarcolombiaoficial.com")
