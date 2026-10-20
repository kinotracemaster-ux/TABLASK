"""Sube los Excel/CSV de tu computador a sus Fuentes en TablasK.

Pensado para correr solo (Programador de tareas de Windows) un rato antes de
la Revisión diaria: así la revisión compara contra el archivo de HOY y no
contra el último que subiste a mano.

- Solo sube un archivo si cambió desde la última vez (compara su huella), o
  si ya pasó casi un día (para que la app sepa que el archivo es el de hoy).
- La "ruta" puede tener comodines (ej. C:\\Inventario\\BASE-SYS*.xlsx): se
  toma el archivo más reciente que coincida.
- Reemplaza el archivo de la Fuente SIN crear otra (mismo botón "Reemplazar
  archivo" de Mis Flujos), así los flujos y destinos siguen igual.
- Con --revisar (o "revisar_al_terminar": true) pide una revisión al final.

No escribe nada en la Maestra ni en las tiendas: eso solo pasa cuando
apruebas la revisión en la app.

Uso:
    python subir_excel.py                  # usa config.json al lado del script
    python subir_excel.py --revisar        # y después genera la revisión
    python subir_excel.py --forzar         # sube aunque no haya cambiado
    python subir_excel.py --config otra.json

Solo usa la librería estándar de Python (no hay que instalar nada).
"""
import argparse
import glob
import hashlib
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime

AQUI = os.path.dirname(os.path.abspath(__file__))
TIMEOUT = 180


def log(msg, archivo_log=None):
    linea = f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}"
    print(linea)
    if archivo_log:
        try:
            with open(archivo_log, "a", encoding="utf-8") as f:
                f.write(linea + "\n")
        except OSError:
            pass


def huella(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for bloque in iter(lambda: f.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest()


def resolver_ruta(ruta):
    """Ruta exacta, o la más reciente si trae comodines. Ignora los archivos
    temporales de Excel abierto (~$...)."""
    ruta = os.path.expandvars(os.path.expanduser(ruta))
    if any(c in ruta for c in "*?["):
        candidatos = [p for p in glob.glob(ruta)
                      if os.path.isfile(p) and not os.path.basename(p).startswith("~$")]
        if not candidatos:
            return None
        return max(candidatos, key=os.path.getmtime)
    return ruta if os.path.isfile(ruta) else None


def pedir(servidor, metodo, camino, cuerpo=None, cabeceras=None):
    req = urllib.request.Request(servidor.rstrip("/") + camino, data=cuerpo, method=metodo,
                                 headers=cabeceras or {})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            datos = r.read()
            return json.loads(datos) if datos else None
    except urllib.error.HTTPError as e:
        detalle = e.read().decode("utf-8", "replace")[:300]
        try:
            detalle = json.loads(detalle).get("detail", detalle)
        except (ValueError, AttributeError):
            pass
        raise RuntimeError(f"HTTP {e.code}: {detalle}") from None
    except urllib.error.URLError as e:
        raise RuntimeError(f"No se pudo conectar con {servidor}: {e.reason}") from None


def subir(servidor, conexion_id, ruta):
    limite = uuid.uuid4().hex
    nombre = os.path.basename(ruta)
    tipo = mimetypes.guess_type(nombre)[0] or "application/octet-stream"
    with open(ruta, "rb") as f:
        contenido = f.read()
    cuerpo = (
        f"--{limite}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{nombre}"\r\n'
        f"Content-Type: {tipo}\r\n\r\n"
    ).encode("utf-8") + contenido + f"\r\n--{limite}--\r\n".encode("utf-8")
    return pedir(servidor, "POST", f"/api/connections/{conexion_id}/replace-file", cuerpo,
                 {"Content-Type": f"multipart/form-data; boundary={limite}"})


def buscar_conexion(conexiones, item):
    if item.get("conexion_id"):
        cid = int(item["conexion_id"])
        c = next((c for c in conexiones if c["id"] == cid), None)
        if not c:
            raise RuntimeError(f"No existe la conexión #{cid}.")
        return c
    nombre = str(item.get("fuente", "")).strip().lower()
    if not nombre:
        raise RuntimeError("Falta 'fuente' (nombre de la conexión) o 'conexion_id'.")
    coinciden = [c for c in conexiones
                 if c.get("connection_type") == "local_file" and str(c.get("name", "")).strip().lower() == nombre]
    if not coinciden:
        disponibles = ", ".join(sorted(c["name"] for c in conexiones if c.get("connection_type") == "local_file"))
        raise RuntimeError(f"No hay una conexión de archivo llamada '{item.get('fuente')}'. "
                           f"Disponibles: {disponibles or '(ninguna)'}")
    if len(coinciden) > 1:
        ids = ", ".join(str(c["id"]) for c in coinciden)
        raise RuntimeError(f"Hay varias conexiones llamadas '{item.get('fuente')}' (ids {ids}): "
                           f"usá 'conexion_id' para elegir una.")
    return coinciden[0]


def main():
    ap = argparse.ArgumentParser(description="Sube tus Excel/CSV a TablasK.")
    ap.add_argument("--config", default=os.path.join(AQUI, "config.json"))
    ap.add_argument("--revisar", action="store_true", help="generar la revisión al terminar")
    ap.add_argument("--forzar", action="store_true", help="subir aunque el archivo no haya cambiado")
    args = ap.parse_args()

    if not os.path.isfile(args.config):
        print(f"No encuentro {args.config}. Copiá config.ejemplo.json como config.json y completalo.")
        return 2
    with open(args.config, encoding="utf-8") as f:
        cfg = json.load(f)

    carpeta = os.path.dirname(os.path.abspath(args.config))
    archivo_log = os.path.join(carpeta, "subir_excel.log")
    archivo_estado = os.path.join(carpeta, ".subir_excel_estado.json")
    servidor = cfg.get("servidor", "").strip()
    if not servidor.startswith("http"):
        log("Falta 'servidor' en la configuración (ej. https://tu-app.up.railway.app).", archivo_log)
        return 2

    try:
        with open(archivo_estado, encoding="utf-8") as f:
            estado = json.load(f)
    except (OSError, ValueError):
        estado = {}

    try:
        conexiones = pedir(servidor, "GET", "/api/connections/") or []
    except RuntimeError as e:
        log(f"ERROR: {e}", archivo_log)
        return 1

    errores = subidos = 0
    for item in cfg.get("archivos", []):
        etiqueta = item.get("fuente") or f"conexión #{item.get('conexion_id')}"
        ruta = resolver_ruta(item.get("ruta", ""))
        if not ruta:
            log(f"ERROR {etiqueta}: no encuentro el archivo '{item.get('ruta')}'.", archivo_log)
            errores += 1
            continue
        try:
            conexion = buscar_conexion(conexiones, item)
            h = huella(ruta)
            clave = str(conexion["id"])
            previo = estado.get(clave, {})
            # Sin cambios y subido hace poco → no hace falta. Si pasó casi un
            # día, se sube igual: así la app sabe que el archivo es el de hoy
            # (si no, la revisión avisaría "archivo desactualizado").
            reciente = False
            if previo.get("subido"):
                try:
                    reciente = (datetime.now() - datetime.fromisoformat(previo["subido"])).total_seconds() < 20 * 3600
                except ValueError:
                    reciente = False
            if not args.forzar and previo.get("huella") == h and reciente:
                log(f"Sin cambios: {etiqueta} ({os.path.basename(ruta)}), no se sube.", archivo_log)
                continue
            subir(servidor, conexion["id"], ruta)
            estado[clave] = {"huella": h, "archivo": ruta, "subido": datetime.now().isoformat(timespec="seconds")}
            subidos += 1
            log(f"Subido: {etiqueta} ← {ruta}", archivo_log)
        except (RuntimeError, OSError) as e:
            log(f"ERROR {etiqueta}: {e}", archivo_log)
            errores += 1

    with open(archivo_estado, "w", encoding="utf-8") as f:
        json.dump(estado, f, ensure_ascii=False, indent=2)

    if args.revisar or cfg.get("revisar_al_terminar"):
        try:
            rev = pedir(servidor, "POST", "/api/reviews/run-now") or {}
            t = rev.get("totals", {})
            log(f"Revisión #{rev.get('id')} ({rev.get('status')}): {t.get('master_changes', 0)} cambios y "
                f"{t.get('master_new', 0)} altas en la Maestra, {t.get('store_changes', 0)} cambios en tiendas. "
                f"Aprobala en Mis Flujos.", archivo_log)
        except RuntimeError as e:
            log(f"ERROR al pedir la revisión: {e}", archivo_log)
            errores += 1

    log(f"Listo: {subidos} archivo(s) subido(s), {errores} error(es).", archivo_log)
    return 1 if errores else 0


if __name__ == "__main__":
    sys.exit(main())
