"""Pruebas del destino 'canal API genérica' (Maestra → API).

Fijan las reglas nuevas:
- El payload por fila se arma con la plantilla del canal (export_engine) o,
  sin plantilla, con todas las columnas de la Maestra tal cual.
- El diff quirúrgico filtra por SKU NORMALIZADO (01203 cruza con 1203.0).
- El auth_token es write-only: nunca aparece en las respuestas del API.
- push-now con dry_run devuelve muestra del payload SIN llamar a la API.
Sin red: el envío HTTP se monkeypatchea.
"""
import pytest

from backend.api_push import (
    affected_skus_from_diff,
    build_request,
    rows_from_master,
    send_rows,
)


class _FakeSub:
    """Doble mínimo de ApiSubscription para las funciones puras."""
    def __init__(self, **kw):
        self.name = kw.get("name", "Canal X")
        self.url = kw.get("url", "https://api.ejemplo.com/hook")
        self.http_method = kw.get("http_method", "POST")
        self.auth_header_name = kw.get("auth_header_name", "Authorization")
        self.auth_token = kw.get("auth_token")
        self.extra_headers = kw.get("extra_headers")
        self.transform_spec = kw.get("transform_spec")


MASTER = [
    ["sku", "name", "price", "stock"],
    ["01203", "Reloj KARDOO", "45000", "5"],
    ["45", "Pulsera", "38000", "2"],
    ["ABC-1", "Correa", "12000", "0"],
]


# ─────────────────────────── rows_from_master ───────────────────────────

def test_sin_plantilla_salen_todas_las_columnas():
    rows = rows_from_master(MASTER)
    assert len(rows) == 3
    assert rows[0] == {"sku": "01203", "name": "Reloj KARDOO", "price": "45000", "stock": "5"}


def test_con_plantilla_se_transforma():
    spec = [
        {"output": "Codigo", "type": "field", "source": "sku"},
        {"output": "Nombre", "type": "concat", "sources": ["sku", "name"], "sep": " "},
        {"output": "Precio", "type": "price", "source": "price", "multiplier": 2},
    ]
    rows = rows_from_master(MASTER, transform_spec=spec)
    assert rows[0] == {"Codigo": "01203", "Nombre": "01203 Reloj KARDOO", "Precio": "90000"}


def test_diff_filtra_por_sku_normalizado():
    # El diff trae '1203.0' (formato Sheets); en la Maestra está '01203'.
    skus = {"1203"}
    rows = rows_from_master(MASTER, only_skus=skus, sku_column="sku")
    assert len(rows) == 1
    assert rows[0]["sku"] == "01203"


def test_diff_sin_columna_sku_no_manda_nada():
    assert rows_from_master(MASTER, only_skus={"1203"}, sku_column="no_existe") == []


def test_maestra_vacia():
    assert rows_from_master([]) == []
    assert rows_from_master([["sku"]]) == []


# ───────────────────────── affected_skus_from_diff ─────────────────────────

def test_skus_afectados_combina_cambios_y_nuevas():
    changes = [{"sku": "01203", "field": "price", "new": "1"}]
    new_rows = [{"sku": "45.0", "fields": {}}, {"sku": "", "fields": {}}]
    skus = affected_skus_from_diff(changes, new_rows)
    assert skus == {"1203", "45"}  # normalizados; el vacío no entra


# ─────────────────────────── build_request / send_rows ───────────────────────────

def test_request_lleva_token_y_headers_extra():
    sub = _FakeSub(auth_token="Bearer abc", extra_headers='{"X-Canal": "effi"}')
    req = build_request(sub, [{"sku": "1"}])
    assert req["headers"]["Authorization"] == "Bearer abc"
    assert req["headers"]["X-Canal"] == "effi"
    assert req["json"]["rows"] == [{"sku": "1"}]
    assert req["json"]["count"] == 1


def test_metodo_invalido_cae_a_post():
    assert build_request(_FakeSub(http_method="GET"), [])["method"] == "POST"
    assert build_request(_FakeSub(http_method="put"), [])["method"] == "PUT"


def test_send_rows_resume_ok_y_error(monkeypatch):
    class _Resp:
        status_code = 200
        text = '{"ok": true}'

    called = {}

    def fake_request(**kw):
        called.update(kw)
        return _Resp()

    import requests
    monkeypatch.setattr(requests, "request", lambda **kw: fake_request(**kw))
    summary = send_rows(_FakeSub(), [{"sku": "1"}])
    assert summary["ok"] is True and summary["sent"] == 1 and summary["status_code"] == 200
    assert called["url"] == "https://api.ejemplo.com/hook"

    def boom(**kw):
        raise ConnectionError("sin red")

    monkeypatch.setattr(requests, "request", lambda **kw: boom(**kw))
    summary = send_rows(_FakeSub(), [{"sku": "1"}])
    assert summary["ok"] is False and "sin red" in summary["error"]


# ─────────────────────────── Router (CRUD + push-now) ───────────────────────────

@pytest.fixture
def client():
    import backend.main
    from fastapi.testclient import TestClient
    return TestClient(backend.main.app)


def test_token_es_write_only_y_se_conserva_al_editar(client):
    created = client.post("/api/api-subscriptions/", json={
        "name": "Effi API", "url": "https://effi.example/api", "auth_token": "secreto-123",
    }).json()
    try:
        assert created["has_token"] is True
        assert "auth_token" not in created
        assert "secreto-123" not in str(created)

        # Editar SIN token: el guardado se conserva.
        updated = client.put(f"/api/api-subscriptions/{created['id']}", json={
            "name": "Effi API v2", "url": "https://effi.example/api",
        }).json()
        assert updated["name"] == "Effi API v2"
        assert updated["has_token"] is True
    finally:
        client.delete(f"/api/api-subscriptions/{created['id']}")


def test_url_invalida_rechazada(client):
    resp = client.post("/api/api-subscriptions/", json={"name": "Mal", "url": "ftp://nope"})
    assert resp.status_code == 400


def test_push_now_dry_run_no_llama_la_api(client, monkeypatch):
    # La Maestra se lee monkeypatcheada (sin credenciales de Google) y el
    # envío HTTP DEBE NO ocurrir en dry_run.
    import backend.services as services
    import backend.api_push as api_push
    monkeypatch.setattr(services, "get_sheet_data", lambda conn, rng: MASTER)

    def _no_debe_llamarse(*a, **kw):
        raise AssertionError("dry_run no debe enviar nada a la API externa")
    monkeypatch.setattr(api_push, "send_rows", _no_debe_llamarse)

    created = client.post("/api/api-subscriptions/", json={
        "name": "Canal dry", "url": "https://x.example/api",
        "transform_spec": [{"output": "Codigo", "type": "field", "source": "sku"}],
    }).json()
    try:
        preview = client.post(f"/api/api-subscriptions/{created['id']}/push-now?dry_run=true").json()
        assert preview["dry_run"] is True
        assert preview["rows_total"] == 3
        assert preview["columns"] == ["Codigo"]
        assert preview["sample"][0] == {"Codigo": "01203"}
    finally:
        client.delete(f"/api/api-subscriptions/{created['id']}")
