"""Pantalla "Actualizar": subir el archivo del SYS (o soltarlo en la carpeta de
Drive) arma la revisión SIN escribir en Shopify, con las alertas de Kino:
SKU repetidos, stock negativo (se respeta), SKU que no existen en la tienda y
códigos de número doble.

Reusa el entorno sin red de test_daily_review (Maestra/BASE en CSV, tienda
Shopify en memoria)."""
import pytest

from backend import avisos
from backend.review import es_doble_numero, stock_negative
from tests.test_daily_review import env  # noqa: F401  (fixture)

SYS_NUEVO = ("Codigo,Descripcion,PRECIO,STOCK\n"
             "A1,RELOJ A,150,5\n"
             "A2,RELOJ B,200,-1\n"                       # negativo: pasa tal cual
             "A3,RELOJ C,300,4\n"
             "A3,RELOJ C,310,4\n"                        # repetido en el archivo
             "503B-11,503B-11 POEDAGAR DAMA,99,2\n"      # no está en la web, número doble
             "CU-77,CURREN HOMBRE,80,9\n")               # otra marca: se ignora


def _subir(client, contenido=SYS_NUEVO, nombre="SYS 26-oct.csv"):
    return client.post("/api/actualizar/archivo", files={"file": (nombre, contenido, "text/csv")})


# ─────────────────────────────────────────────────────────── helpers puros
def test_doble_numero():
    for sku in ("503B-11", "810-11", "1401-20", "836-C11"):
        assert es_doble_numero(sku), sku
    for sku in ("503B-1", "810-4", "P921", "1409", "836-C1", ""):
        assert not es_doble_numero(sku), sku


def test_stock_negativo():
    changes = [{"sku": "A", "field": "Stock", "before": "2", "after": "-1"},
               {"sku": "B", "field": "Stock", "before": "2", "after": "0"},
               {"sku": "C", "field": "Precio", "before": "2", "after": "-5"}]
    assert [c["sku"] for c in stock_negative(changes)] == ["A"]


def test_texto_del_aviso(monkeypatch):
    monkeypatch.setenv("TABLASK_PUBLIC_URL", "https://tablask.example/")
    txt = avisos.texto_revision({"totals": {"store_changes": 7, "master_new": 1, "alerts_danger": 1}},
                                "pendiente", origen="SYS.xlsx")
    assert "Cambios para la tienda: 7" in txt and "https://tablask.example/" in txt
    assert "Todo cuadra" in avisos.texto_revision({"totals": {}}, "sin_cambios")


def test_aviso_sin_configurar_no_manda_nada(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    assert avisos.enviar("hola") is False


# ─────────────────────────────────────────────── integración (API + archivos)
def test_subir_archivo_arma_la_revision_sin_escribir(env):  # noqa: F811
    c = env["client"]
    estado = c.get("/api/actualizar").json()
    assert estado["listo"] and estado["archivo"]["conexion_id"] == env["base_id"]

    res = _subir(c)
    assert res.status_code == 200, res.text
    rev = res.json()
    assert rev["status"] == "pendiente" and rev["trigger"] == "archivo"
    # Nada escrito: ni Maestra ni tienda.
    assert env["writes"] == []
    assert env["store"].calls == {"price": [], "stock": [], "product": []}

    textos = " | ".join(a["text"] for a in rev["report"]["alerts"])
    assert "repetidos" in textos
    assert "NEGATIVO" in textos
    assert "no existen" in textos and "número doble" in textos

    store = rev["report"]["stores"][0]
    assert {"sku": "A2", "field": "Stock", "before": "3", "after": "-1"}.items() <= \
        next(x for x in store["changes"] if x["sku"] == "A2" and x["field"] == "Stock").items()
    assert "503B-11" in store["not_found"]
    # Solo Poedagar: la otra marca no llega ni a la tienda ni al alcance.
    assert "CU-77" not in store["not_found"]
    assert rev["report"]["alcance"] == 4
    assert "Se ignoran 1 de otras marcas" in textos

    # La pantalla muestra esta misma revisión.
    assert c.get("/api/actualizar").json()["revision"]["id"] == rev["id"]


def test_aprobar_aplica_el_negativo_en_la_tienda(env):  # noqa: F811
    c = env["client"]
    rev = _subir(c).json()
    out = c.post(f"/api/reviews/{rev['id']}/apply")
    assert out.status_code == 200, out.text
    assert env["store"].p["A2"]["stock"] == -1


def test_formato_de_archivo_invalido(env):  # noqa: F811
    res = _subir(env["client"], contenido="hola", nombre="foto.png")
    assert res.status_code == 400


def test_con_varias_fuentes_elige_la_de_poedagar(env):  # noqa: F811
    c = env["client"]
    otra = c.post("/api/connections/upload", data={"name": "EXISTENCIAS POEDAGAR"},
                  files={"file": ("otra.csv", "Codigo,PRECIO\nA1,1\n", "text/csv")}).json()["id"]
    proc = c.post("/api/processes/", json={
        "name": "OTRA", "source_connection_id": otra, "source_sheet_name": "CSV Data",
        "sku_column_source": "Codigo", "sku_column_master": "sku",
        "field_mappings": {"PRECIO": "price"}, "is_active": True}).json()
    try:
        assert c.get("/api/actualizar").json()["archivo"]["conexion_id"] == otra
        # Elegida a mano en Administración: manda esa.
        cfg = c.put("/api/actualizar/config", json={"upload_connection_id": env["base_id"]}).json()
        assert cfg["actual"]["id"] == env["base_id"]
        assert c.get("/api/actualizar").json()["archivo"]["conexion_id"] == env["base_id"]
    finally:
        c.delete(f"/api/processes/{proc['id']}")
        _limpiar_eleccion()


def _limpiar_eleccion():
    from backend.database import SessionLocal
    from backend.scheduler import get_or_create_config
    db = SessionLocal()
    cfg = get_or_create_config(db)
    cfg.upload_connection_id = None
    cfg.review_shopify_ids = None
    db.commit()
    db.close()


SYS_REAL = ("Artículo,Descripción,Exist. unidades,Precio\n"
            "A1,RELOJ A,5,150\n"
            "A2,RELOJ B,-1,200\n")


def test_mapeo_del_sys():
    from backend.actualizar import _mapeo_sys, ActualizarError
    m = _mapeo_sys(["Artículo", "Descripción", "Exist. unidades", "Precio"],
                   ["SKU", "Nombre", "Precio", "Costo", "Stock", "Color"], "SKU")
    assert m == {"sku_fuente": "Artículo", "mappings": {"Precio": "Precio", "Exist. unidades": "Stock"}}
    with pytest.raises(ActualizarError):
        _mapeo_sys(["Foto", "Color"], ["SKU", "Precio"], "SKU")


def test_primera_subida_crea_la_fuente_y_el_destino_poedagar(env, monkeypatch):  # noqa: F811
    import backend.actualizar as act
    from backend import models
    from backend.database import SessionLocal

    c = env["client"]
    # Sin Fuente de archivo ni destino Shopify activos: como la primera vez en producción.
    c.delete(f"/api/processes/{env['proc']['id']}")
    c.delete(f"/api/shopify-subscriptions/{env['sub']['id']}")
    tienda = env["sub"]["connection_id"]
    monkeypatch.setattr(act, "tiendas_shopify",
                        lambda db: db.query(models.Connection).filter(models.Connection.id == tienda).all())
    assert c.get("/api/actualizar").json()["listo"] is True

    res = _subir(c, contenido=SYS_REAL, nombre="INVENTARIO_POEDAGAR.csv")
    assert res.status_code == 200, res.text
    out = res.json()
    assert len(out["configurado"]) == 2
    db = SessionLocal()
    try:
        proc = db.query(models.Process).filter(models.Process.name == "SYS POEDAGAR → Maestra").first()
        assert proc and proc.sku_column_source == "Artículo"
        assert proc.field_mappings and '"Precio": "price"' in proc.field_mappings
        sub = db.query(models.ShopifySubscription).filter(models.ShopifySubscription.name == "Shopi-Poe").first()
        assert sub.price_multiplier == 2.8 and sub.price_column_master == "price" and sub.stock_column_master == "stock"
    finally:
        db.query(models.ShopifySubscription).filter(models.ShopifySubscription.name == "Shopi-Poe").delete()
        db.query(models.Process).filter(models.Process.name == "SYS POEDAGAR → Maestra").delete()
        db.commit()
        db.close()
        _limpiar_eleccion()

    # Precio en la tienda = precio del SYS × 2,8 (A1: 150 → 420).
    precios = {x["sku"]: x["after"] for x in out["report"]["stores"][0]["changes"] if x["field"] == "Precio"}
    assert precios.get("A1") == "420"
    # Nada escrito todavía.
    assert env["store"].calls["price"] == []


def test_elegir_tiendas_en_administracion(env):  # noqa: F811
    c = env["client"]
    try:
        cfg = c.put("/api/actualizar/config", json={"tiendas": [env["sub"]["id"]]}).json()
        assert [t["elegida"] for t in cfg["tiendas"]] == [True]
        # Elegir todas las activas = sin filtro.
        from backend.database import SessionLocal
        from backend.scheduler import get_or_create_config
        db = SessionLocal()
        assert get_or_create_config(db).review_shopify_ids is None
        db.close()
    finally:
        _limpiar_eleccion()


def test_buzon_de_drive_procesa_cada_archivo_una_vez(env, monkeypatch):  # noqa: F811
    from backend.connectors.google_drive import GoogleDriveConnector
    archivos = [{"id": "f1", "name": "SYS 26-oct.csv", "modifiedTime": "2026-10-26T10:00:00Z"},
                {"id": "x", "name": "~$SYS 26-oct.csv", "modifiedTime": "2026-10-26T11:00:00Z"}]
    monkeypatch.setattr(GoogleDriveConnector, "listar_archivos", lambda self: archivos)
    monkeypatch.setattr(GoogleDriveConnector, "descargar", lambda self, fid: SYS_NUEVO.encode())
    enviados = []
    monkeypatch.setattr(avisos, "enviar", lambda t: enviados.append(t) or True)

    c = env["client"]
    cfg = c.put("/api/actualizar/config",
                json={"drive_folder": "https://drive.google.com/drive/folders/CARPETA123?usp=sharing"}).json()
    assert cfg["drive_folder_id"] == "CARPETA123"
    try:
        r1 = c.post("/api/actualizar/drive/revisar").json()
        assert r1["ran"] and r1["status"] == "pendiente"
        assert len(enviados) == 1 and "SYS 26-oct.csv" in enviados[0]
        # El mismo archivo no se reprocesa.
        assert c.post("/api/actualizar/drive/revisar").json()["ran"] is False
        # Uno más nuevo sí.
        archivos.append({"id": "f2", "name": "SYS 27-oct.csv", "modifiedTime": "2026-10-27T10:00:00Z"})
        assert c.post("/api/actualizar/drive/revisar").json()["file"] == "SYS 27-oct.csv"
        assert len(enviados) == 2
        # Nada se escribió en la tienda.
        assert env["store"].calls["stock"] == []
    finally:
        c.put("/api/actualizar/config", json={"drive_folder": ""})


def test_columna_sku_de_la_maestra_sin_distinguir_mayusculas(env):  # noqa: F811
    """La Fuente guardó 'SKU' pero la Maestra dice 'sku' (y al revés en producción)."""
    from backend import models
    from backend.database import SessionLocal
    db = SessionLocal()
    p = db.query(models.Process).filter(models.Process.id == env["proc"]["id"]).first()
    p.sku_column_master = "SKU"
    db.commit()
    db.close()
    rev = _subir(env["client"]).json()
    assert rev["report"]["processes"][0]["status"] == "ok", rev["report"]["processes"][0]


def test_web_sin_archivo_se_avisa(env):  # noqa: F811
    env["store"].p["Z9"] = {"price": "1", "stock": 1, "pid": "P9"}
    rev = _subir(env["client"]).json()
    textos = " | ".join(a["text"] for a in rev["report"]["alerts"])
    assert "están en la web pero NO vienen en el archivo" in textos
    del env["store"].p["Z9"]


def test_multiplicador_editable(env):  # noqa: F811
    c = env["client"]
    sid = env["sub"]["id"]
    cfg = c.put("/api/actualizar/config", json={"multiplicadores": {str(sid): 2.8}}).json()
    assert [t["multiplicador"] for t in cfg["tiendas"] if t["id"] == sid] == [2.8]
    assert c.put("/api/actualizar/config", json={"multiplicadores": {str(sid): 0}}).status_code == 400
