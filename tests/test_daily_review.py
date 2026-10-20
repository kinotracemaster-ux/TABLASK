"""Pruebas de la Revisión diaria (modo "review" del piloto automático).

Lo crítico a fijar:
- Revisar NO escribe nada: ni en la Maestra ni en Shopify.
- Al aprobar se aplica SOLO lo revisado que siga vigente (si un valor cambió
  desde la revisión, no se aplica a ciegas).
- El Guardián también frena en la revisión.
- El link del auditor exige token.
Sin red: Maestra y BASE son CSV subidos; la tienda Shopify es un
ShopifyConnector real con los métodos de red reemplazados por una tienda en
memoria (así se ejercita el filtro `only` de verdad).
"""
import csv
import io
import json
from datetime import datetime, timedelta, timezone

import pytest

from backend.connectors.shopify import ShopifyConnector
from backend.review import (project_master, price_jumps, stock_to_zero,
                            master_change_key, store_change_key)
from backend.scheduler import next_daily_run


# ─────────────────────────────────────────────────────────── helpers puros
def test_next_daily_run_misma_dia_y_dia_siguiente():
    bogota = timezone(timedelta(hours=-5))
    # 6:00 en Bogotá (11:00 UTC) → hoy a las 7:00 (12:00 UTC)
    assert next_daily_run(datetime(2026, 10, 19, 11, 0), 7, bogota) == datetime(2026, 10, 19, 12, 0)
    # 7:00 en punto → estrictamente después: mañana
    assert next_daily_run(datetime(2026, 10, 19, 12, 0), 7, bogota) == datetime(2026, 10, 20, 12, 0)
    # 23:30 local (04:30 UTC del día siguiente) → 7:00 de ese día siguiente
    assert next_daily_run(datetime(2026, 10, 20, 4, 30), 7, bogota) == datetime(2026, 10, 20, 12, 0)


def test_project_master_actualiza_por_sku_normalizado_y_agrega_altas():
    projected = [["SKU", "price"], ["01203", "100"], ["A2", "200"]]
    project_master(projected, ["SKU", "price", "estado"], "SKU",
                   changes=[{"sku": "1203", "field": "price", "new": "150"}],
                   new_rows=[{"sku": "N9", "fields": {"SKU": "N9", "price": "9", "estado": "NUEVO"}},
                             {"sku": "A2", "fields": {"SKU": "A2", "price": "1"}}])  # ya existe: no duplica
    assert projected[0] == ["SKU", "price", "estado"]
    assert projected[1][1] == "150"
    assert projected[3] == ["N9", "9", "NUEVO"]
    assert len(projected) == 4


def test_alertas_saltos_de_precio_y_agotados():
    changes = [
        {"sku": "A", "field": "Precio", "before": "100", "after": "180"},   # +80% → salto
        {"sku": "B", "field": "Precio", "before": "100", "after": "110"},   # +10% → normal
        {"sku": "C", "field": "Stock", "before": "4", "after": "0"},        # agotado
        {"sku": "D", "field": "Stock", "before": "(vacío)", "after": "0"},  # no tenía stock: no cuenta
    ]
    assert [c["sku"] for c in price_jumps(changes)] == ["A"]
    assert [c["sku"] for c in stock_to_zero(changes)] == ["C"]


def test_claves_de_cambio_ignoran_formato_del_sku():
    assert master_change_key({"sku": "01203", "field": "price", "new": "5 "}) == \
        master_change_key({"sku": "1203", "field": "price", "new": "5"})
    assert store_change_key({"sku": "A-1", "field": "Stock", "after": "3"}) != \
        store_change_key({"sku": "A-1", "field": "Stock", "after": "4"})


# ─────────────────────────────────────────── conector: filtro `only` al escribir
@pytest.fixture
def shop(monkeypatch):
    c = ShopifyConnector({"shopify_domain": "demo", "shopify_access_token": "shpat_test"})
    index = {
        "3076-1": {"variant_id": "V1", "product_id": "P1", "inventory_item_id": "I1", "sku": "3076-1"},
        "3076-2": {"variant_id": "V2", "product_id": "P1", "inventory_item_id": "I2", "sku": "3076-2"},
        "900": {"variant_id": "V3", "product_id": "P2", "inventory_item_id": "I3", "sku": "900"},
    }
    monkeypatch.setattr(c, "index_variants_by_sku", lambda: index)
    calls = {"price": [], "stock": [], "product": []}
    monkeypatch.setattr(c, "_price_bulk_update", lambda pid, v: calls["price"].append((pid, v)))
    monkeypatch.setattr(c, "_inventory_set", lambda q: calls["stock"].append(q))
    monkeypatch.setattr(c, "_product_update", lambda pid, f: calls["product"].append((pid, f)))
    monkeypatch.setattr(c, "get_primary_location_id", lambda: "L1")
    c._calls = calls
    return c


def test_only_limita_campos_y_skus_escritos(shop):
    updates = [{"sku": "3076-1", "price": "10", "stock": "5"},
               {"sku": "900", "price": "20", "stock": "0"}]
    shop.push_updates(updates, do_price=True, do_stock=True, only={"900": {"price"}})
    # Solo el precio de 900: ni el stock 0 (no aprobado) ni nada de 3076-1.
    assert shop._calls["price"] == [("P2", [{"id": "V3", "price": "20"}])]
    assert shop._calls["stock"] == []


def test_only_sin_filtro_es_el_comportamiento_de_siempre(shop):
    updates = [{"sku": "900", "price": "20", "stock": "0"}]
    shop.push_updates(updates, do_price=True, do_stock=True)
    assert len(shop._calls["price"]) == 1
    assert shop._calls["stock"][0][0]["quantity"] == 0


def test_only_nombre_respeta_la_variante_principal(shop):
    # Las dos variantes piden nombres distintos (solo difiere el SKU pegado):
    # manda la principal "-1". Aunque lo aprobado sea la secundaria, el producto
    # recibe el valor resuelto — nunca el de la secundaria.
    updates = [{"sku": "3076-1", "title": "3076-1 RELOJ DAMA"},
               {"sku": "3076-2", "title": "3076-2 RELOJ DAMA"}]
    shop.push_updates(updates, do_price=False, do_stock=False, do_title=True,
                      only={"3076-2": {"title"}})
    assert shop._calls["product"] == [("P1", {"title": "3076-1 RELOJ DAMA"})]


def test_only_nombre_no_aprobado_no_se_escribe(shop):
    updates = [{"sku": "900", "title": "NUEVO NOMBRE", "price": "5"}]
    shop.push_updates(updates, do_price=True, do_stock=False, do_title=True, only={"900": {"price"}})
    assert shop._calls["product"] == []
    assert len(shop._calls["price"]) == 1


# ─────────────────────────────────────────────── integración (API + archivos)
MASTER_CSV = "sku,name,price,stock\nA1,Reloj A,100,5\nA2,Reloj B,200,3\nA3,Reloj C,300,4\n"
BASE_CSV = "Codigo,PRECIO,STOCK\nA1,150,5\nA2,200,7\nA3,300,4\nNEW9,99,1\n"


class FakeStore:
    """Tienda Shopify en memoria: el índice refleja lo que se va escribiendo."""

    def __init__(self, products):
        self.p = products  # sku -> {price, stock, pid}
        self.calls = {"price": [], "stock": [], "product": []}

    def connector(self, monkeypatch):
        c = ShopifyConnector({"shopify_domain": "demo", "shopify_access_token": "shpat_test"})

        def index():
            return {ShopifyConnector._normalize_sku(sku): {"variant_id": f"V-{sku}", "product_id": d["pid"],
                                  "inventory_item_id": f"I-{sku}", "sku": sku,
                                  "current_price": d["price"], "current_stock": d["stock"]}
                    for sku, d in self.p.items()}

        def price(pid, variants):
            self.calls["price"].append((pid, variants))
            for v in variants:
                self.p[v["id"][2:]]["price"] = v["price"]

        def stock(quantities):
            self.calls["stock"].append(quantities)
            for q in quantities:
                self.p[q["inventoryItemId"][2:]]["stock"] = q["quantity"]

        monkeypatch.setattr(c, "index_variants_by_sku", index)
        monkeypatch.setattr(c, "_price_bulk_update", price)
        monkeypatch.setattr(c, "_inventory_set", stock)
        monkeypatch.setattr(c, "_product_update", lambda pid, f: self.calls["product"].append((pid, f)))
        monkeypatch.setattr(c, "get_primary_location_id", lambda: "L1")
        return c


@pytest.fixture
def env(monkeypatch):
    import backend.main
    from fastapi.testclient import TestClient
    from backend import models, services
    from backend.database import SessionLocal

    client = TestClient(backend.main.app)

    # Guardar estado global para restaurarlo (otros tests dependen de él).
    db = SessionLocal()
    project = db.query(models.Project).first()
    saved_link = (project.master_connection_id, project.master_sheet_name, project.master_sku_column) if project else None
    db.close()

    for p in client.get("/api/processes/").json():
        client.delete(f"/api/processes/{p['id']}")
    for s in client.get("/api/shopify-subscriptions/").json():
        client.delete(f"/api/shopify-subscriptions/{s['id']}")

    def upload(name, content):
        return client.post("/api/connections/upload", data={"name": name},
                           files={"file": (f"{name}.csv", content, "text/csv")}).json()["id"]

    master_id = upload("rev_master", MASTER_CSV)
    base_id = upload("rev_base", BASE_CSV)
    client.post("/api/master/link", json={"master_connection_id": master_id,
                                           "master_sheet_name": "CSV Data", "master_sku_column": "sku"})
    proc = client.post("/api/processes/", json={
        "name": "BASE-SYS", "source_connection_id": base_id, "source_sheet_name": "CSV Data",
        "sku_column_source": "Codigo", "sku_column_master": "sku",
        "field_mappings": {"PRECIO": "price", "STOCK": "stock"}, "add_new_rows": True, "is_active": True,
    }).json()

    # Tienda: A3 tiene 9 en la tienda pero 4 en la Maestra → cambio propio de la tienda.
    store = FakeStore({"A1": {"price": "100", "stock": 5, "pid": "P1"},
                       "A2": {"price": "200", "stock": 3, "pid": "P2"},
                       "A3": {"price": "300", "stock": 9, "pid": "P3"}})
    shop_conn = client.post("/api/connections/", json={
        "name": "Shopi-Kino", "connection_type": "shopify",
        "shopify_domain": "demo", "shopify_access_token": "shpat_test"}).json()["id"]
    sub = client.post("/api/shopify-subscriptions/", json={
        "name": "Shopi-Kino", "connection_id": shop_conn,
        "price_column_master": "price", "stock_column_master": "stock", "is_active": True}).json()

    fake_conn = store.connector(monkeypatch)
    real_create = services._create_connector
    monkeypatch.setattr(services, "_create_connector",
                        lambda c: fake_conn if c.connection_type == "shopify" else real_create(c))

    writes = []

    def fake_write(spreadsheet_id, sheet_name, headers, changes, new_rows, total_rows_before):
        """Escritura quirúrgica simulada sobre el CSV de la Maestra (en la DB)."""
        writes.append({"changes": changes, "new_rows": new_rows})
        s = SessionLocal()
        conn = s.query(models.Connection).filter(models.Connection.id == master_id).first()
        rows = list(csv.reader(io.StringIO(conn.file_content.decode())))
        hdr = list(headers)
        rows[0] = hdr
        for r in rows[1:]:
            r.extend([""] * (len(hdr) - len(r)))
        for ch in changes:
            rows[ch["row_index"]][hdr.index(ch["field"])] = ch["new"]
        for nr in new_rows:
            rows.append([nr["fields"].get(h, "") for h in hdr])
        out = io.StringIO()
        csv.writer(out, lineterminator="\n").writerows(rows)
        conn.file_content = out.getvalue().encode()
        s.commit()
        s.close()
        return {"total_updates": len(changes)}

    monkeypatch.setattr(services, "write_sheet_data_surgical", fake_write)
    # Que la propagación a hojas hijas / canales API no haga nada en estos tests.
    import backend.propagation as propagation
    monkeypatch.setattr(propagation, "_propagate_changes", lambda *a, **k: None)
    monkeypatch.setattr(propagation, "_push_api_subscriptions", lambda *a, **k: None)

    client.put("/api/schedule", json={"enabled": False, "interval_hours": 24, "mode": "review",
                                      "review_all_shopify": True})

    yield {"client": client, "store": store, "writes": writes, "base_id": base_id,
           "master_id": master_id, "sub": sub, "proc": proc}

    # Restaurar: modo auto, sin procesos/destinos de este test, link original.
    client.put("/api/schedule", json={"enabled": False, "interval_hours": 6, "mode": "auto",
                                      "use_daily_hour": False, "review_all_shopify": True})
    client.delete(f"/api/processes/{proc['id']}")
    client.delete(f"/api/shopify-subscriptions/{sub['id']}")
    if saved_link and saved_link[0]:
        client.post("/api/master/link", json={"master_connection_id": saved_link[0],
                                               "master_sheet_name": saved_link[1],
                                               "master_sku_column": saved_link[2]})


def test_revisar_no_escribe_nada(env):
    c = env["client"]
    rev = c.post("/api/reviews/run-now").json()
    assert rev["status"] == "pendiente"
    report = rev["report"]

    proc = report["processes"][0]
    assert proc["status"] == "ok"
    assert proc["changes_total"] == 2          # A1 precio, A2 stock
    assert proc["new_total"] == 1              # NEW9
    store = report["stores"][0]
    fields = sorted((ch["sku"], ch["field"]) for ch in store["changes"])
    # La tienda ve la Maestra PROYECTADA: A1 precio y A2 stock (vienen de BASE)
    # + A3 stock (la tienda tiene 9, la Maestra 4).
    assert fields == [("A1", "Precio"), ("A2", "Stock"), ("A3", "Stock")]
    assert store["not_found_count"] == 1       # NEW9 no existe en la tienda: no se crea

    # Lo esencial: NADA escrito.
    assert env["writes"] == []
    assert env["store"].calls == {"price": [], "stock": [], "product": []}


def test_aprobar_aplica_maestra_y_tienda(env):
    c = env["client"]
    rev = c.post("/api/reviews/run-now").json()
    done = c.post(f"/api/reviews/{rev['id']}/apply").json()
    assert done["status"] == "aplicada"

    # Maestra: los 2 cambios + la alta, en una sola escritura.
    assert len(env["writes"]) == 1
    w = env["writes"][0]
    assert sorted((ch["sku"], ch["field"], ch["new"]) for ch in w["changes"]) == \
        [("A1", "price", "150"), ("A2", "stock", "7")]
    assert [nr["sku"] for nr in w["new_rows"]] == ["NEW9"]

    # Tienda: exactamente lo revisado.
    s = env["store"].p
    assert float(s["A1"]["price"]) == 150
    assert s["A2"]["stock"] == 7
    assert s["A3"]["stock"] == 4
    summary = done["apply_summary"]
    assert summary["stores"][0]["applied"] == 3

    # No se puede aplicar dos veces.
    assert c.post(f"/api/reviews/{rev['id']}/apply").status_code == 400


def test_lo_que_cambio_desde_la_revision_no_se_aplica_a_ciegas(env):
    c = env["client"]
    rev = c.post("/api/reviews/run-now").json()

    # Después de revisar llega un archivo nuevo: A1 cambia de nuevo (175 en vez
    # de 150) y A3 trae un precio que nadie revisó.
    c.post(f"/api/connections/{env['base_id']}/replace-file",
           files={"file": ("rev_base.csv", "Codigo,PRECIO,STOCK\nA1,175,5\nA2,200,7\nA3,333,4\nNEW9,99,1\n",
                           "text/csv")})
    # Y en la tienda alguien vendió una unidad de A3 (9 → 8).
    env["store"].p["A3"]["stock"] = 8

    done = c.post(f"/api/reviews/{rev['id']}/apply").json()
    w = env["writes"][0]
    applied = sorted((ch["sku"], ch["field"], ch["new"]) for ch in w["changes"])
    # Solo A2 sigue igual a lo revisado. A1=175 y A3=333 NO se escriben.
    assert applied == [("A2", "stock", "7")]
    proc_res = done["apply_summary"]["processes"][0]
    assert proc_res["no_longer_valid"] == 1    # A1=150 ya no aplica
    assert proc_res["not_approved"] == 2       # A1=175 y A3=333 quedan para la próxima

    s = env["store"].p
    assert float(s["A1"]["price"]) == 100      # el 150 revisado ya no está en la Maestra
    assert s["A2"]["stock"] == 7               # sigue vigente: se aplica
    # A3: se revisó "dejar el stock en 4"; tras la venta la tienda tiene 8 y la
    # Maestra sigue diciendo 4 → el destino revisado (4) sigue vigente.
    assert s["A3"]["stock"] == 4


def test_guardian_frena_en_la_revision(env):
    c = env["client"]
    # Maestra con 726B-4; BASE trae dos casi-idénticos (guion perdido / cero de
    # más) que no cruzan exacto: formato de SKU roto (mismo caso que el piloto).
    c.post(f"/api/connections/{env['master_id']}/replace-file",
           files={"file": ("rev_master.csv", "sku,name,price,stock\n726B-4,Reloj,100,5\n", "text/csv")})
    c.post(f"/api/connections/{env['base_id']}/replace-file",
           files={"file": ("rev_base.csv", "Codigo,PRECIO,STOCK\n726B4,45000,1\n726B-04,38000,1\n", "text/csv")})
    rev = c.post("/api/reviews/run-now").json()
    proc = rev["report"]["processes"][0]
    assert proc["status"] == "guardian"
    assert proc["changes"] == [] and proc["new_rows"] == []
    assert any(a["level"] == "danger" and "Guardián" in a["text"] for a in rev["report"]["alerts"])


def test_revision_nueva_reemplaza_la_pendiente(env):
    c = env["client"]
    first = c.post("/api/reviews/run-now").json()
    second = c.post("/api/reviews/run-now").json()
    assert c.get(f"/api/reviews/{first['id']}").json()["status"] == "reemplazada"
    assert c.post(f"/api/reviews/{first['id']}/apply").status_code == 400
    assert c.post(f"/api/reviews/{second['id']}/discard").json()["status"] == "descartada"


def test_link_del_auditor_exige_token(env):
    c = env["client"]
    c.post("/api/reviews/run-now")
    token = c.get("/api/schedule").json()["report_token"]
    assert c.get("/api/reviews/latest/public?token=malo").status_code == 403
    pub = c.get(f"/api/reviews/latest/public?token={token}").json()
    assert pub["status"] == "pendiente"
    assert pub["totals"]["store_changes"] == 3
    assert pub["stores"][0]["by_field"] == {"Precio": 1, "Stock": 2}
    # Rotar el token invalida el anterior.
    c.post("/api/reviews/token/regenerate")
    assert c.get(f"/api/reviews/latest/public?token={token}").status_code == 403


def test_piloto_en_modo_revision_no_sincroniza(env):
    c = env["client"]
    summary = c.post("/api/schedule/run-now").json()
    assert summary["mode"] == "review"
    assert summary["status"] == "pendiente"
    assert env["writes"] == []


def test_config_hora_diaria(env):
    c = env["client"]
    cfg = c.put("/api/schedule", json={"enabled": True, "interval_hours": 24, "daily_hour": 7}).json()
    assert cfg["mode"] == "review"            # no se pierde al no mandarlo
    assert cfg["daily_hour"] == 7
    nxt = datetime.fromisoformat(cfg["next_run_at"])
    assert (nxt.hour, nxt.minute) == (12, 0)  # 7:00 en Bogotá = 12:00 UTC
    assert c.put("/api/schedule", json={"enabled": True, "interval_hours": 24, "daily_hour": 25}).status_code == 400


def test_si_la_maestra_falla_queda_con_errores_y_no_empuja_lo_que_dependia(env, monkeypatch):
    from backend import services

    def boom(**kw):
        raise RuntimeError("Faltan credenciales de Google Sheets.")
    monkeypatch.setattr(services, "write_sheet_data_surgical", boom)

    c = env["client"]
    rev = c.post("/api/reviews/run-now").json()
    assert rev["totals"]["store_zeroed"] == 0
    done = c.post(f"/api/reviews/{rev['id']}/apply").json()
    assert done["status"] == "con_errores"
    assert "credenciales" in done["apply_summary"]["processes"][0]["error"]

    s = env["store"].p
    # A1 (precio) y A2 (stock) dependían de escribir la Maestra: NO se empujan.
    assert s["A1"]["price"] == "100"
    assert s["A2"]["stock"] == 3
    # A3 no dependía de la Maestra (la tienda difería de lo que ya está): sí va.
    assert s["A3"]["stock"] == 4
    assert done["apply_summary"]["stores"][0]["applied"] == 1


def test_la_revision_usa_el_multiplicador_del_canal(env):
    """Si la revisión no aplicara el margen del canal, mostraría un precio y
    después se escribiría otro: lo aprobado no sería lo que se envía."""
    c = env["client"]
    sub_id = env["sub"]["id"]
    c.put(f"/api/shopify-subscriptions/{sub_id}", json={
        "name": "Shopi-Kino", "connection_id": env["sub"]["connection_id"],
        "price_column_master": "price", "stock_column_master": "stock",
        "price_multiplier": 2.8, "is_active": True})

    rev = c.post("/api/reviews/run-now").json()
    tienda = rev["report"]["stores"][0]
    precios = {ch["sku"]: ch["after"] for ch in tienda["changes"] if ch["field"] == "Precio"}
    # A1 pasa a 150 en la Maestra → la tienda recibe 150 × 2,8 = 420.
    assert precios["A1"] == "420"
    # A2 y A3 no cambian de precio en el archivo, pero igual quedan fuera de la
    # regla: la tienda tiene 200 y 300 y deberían ser 200×2,8 y 300×2,8.
    assert precios["A2"] == "560" and precios["A3"] == "840"

    c.post(f"/api/reviews/{rev['id']}/apply")
    # Y lo que se escribió en la tienda es exactamente eso, no el precio pelado.
    assert float(env["store"].p["A1"]["price"]) == 420
