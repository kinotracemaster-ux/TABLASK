import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertOctagon, AlertTriangle, Info,
  Settings, Loader2, FolderOpen, ChevronDown, ChevronUp, Database,
} from 'lucide-react';
import { extractError } from '../utils/errors';

const API = import.meta.env.VITE_API_URL || '';
const PAGE = 100;

const ALERT_STYLE = {
  danger: { icon: AlertOctagon, cls: 'bg-red-50 border-red-200 text-red-800' },
  warning: { icon: AlertTriangle, cls: 'bg-amber-50 border-amber-200 text-amber-800' },
  info: { icon: Info, cls: 'bg-slate-50 border-slate-200 text-slate-700' },
};

const ORIGEN = { archivo: 'subido en la app', drive: 'llegó a la carpeta de Drive', manual: 'revisión a mano', programada: 'revisión programada' };

// Mismo patrón que backend/review.py::es_doble_numero (503B-11, 836-C11…).
const esDobleNumero = (sku) => /-[A-Z]?\d{2,}$/i.test(String(sku || '').trim());

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function Numero({ label, value, tone = 'text-gray-800' }) {
  return (
    <div className="bg-white rounded-xl border p-4 text-center">
      <p className={`text-3xl font-bold ${tone}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  );
}

/** Caja para soltar o elegir el archivo del SYS. */
function Soltar({ onFile, busy, compacta }) {
  const input = useRef(null);
  const [encima, setEncima] = useState(false);
  const elegir = (files) => { if (files && files[0]) onFile(files[0]); };
  return (
    <div
      onDragOver={e => { e.preventDefault(); setEncima(true); }}
      onDragLeave={() => setEncima(false)}
      onDrop={e => { e.preventDefault(); setEncima(false); if (!busy) elegir(e.dataTransfer.files); }}
      onClick={() => !busy && input.current?.click()}
      className={`cursor-pointer rounded-2xl border-2 border-dashed text-center transition ${
        compacta ? 'p-4' : 'p-12'
      } ${encima ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-white hover:border-indigo-400 hover:bg-indigo-50/40'}`}>
      <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="hidden"
        onChange={e => { elegir(e.target.files); e.target.value = ''; }} />
      {busy ? (
        <div className="flex items-center justify-center gap-2 text-indigo-700 font-medium">
          <Loader2 className="w-5 h-5 animate-spin" /> Revisando el archivo… (puede tardar un minuto)
        </div>
      ) : compacta ? (
        <p className="text-sm text-gray-600 flex items-center justify-center gap-2">
          <Upload className="w-4 h-4" /> Subir otro archivo del SYS
        </p>
      ) : (
        <>
          <FileSpreadsheet className="w-12 h-12 text-indigo-500 mx-auto mb-3" />
          <p className="text-lg font-semibold text-gray-800">Arrastrá aquí el archivo del SYS</p>
          <p className="text-sm text-gray-500 mt-1">o hacé clic para elegirlo (.xlsx, .xls o .csv)</p>
        </>
      )}
    </div>
  );
}

/** Tabla única antes → después de lo que se manda a Shopify. */
function Cambios({ filas, variasTiendas }) {
  const [filtro, setFiltro] = useState('todo');
  const [todo, setTodo] = useState(false);
  const vistas = filtro === 'todo' ? filas : filas.filter(f => f.field === filtro);
  const shown = todo ? vistas : vistas.slice(0, PAGE);
  const campos = [...new Set(filas.map(f => f.field))];
  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="flex items-center gap-1 px-3 py-2 border-b bg-gray-50 text-xs">
        {['todo', ...campos].map(c => (
          <button key={c} type="button" onClick={() => setFiltro(c)}
            className={`px-2.5 py-1 rounded-full ${filtro === c ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-200'}`}>
            {c === 'todo' ? `Todo (${filas.length})` : `${c} (${filas.filter(f => f.field === c).length})`}
          </button>
        ))}
      </div>
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs sticky top-0">
            <tr>
              <th className="text-left px-3 py-2 font-medium">SKU</th>
              {variasTiendas && <th className="text-left px-3 py-2 font-medium">Tienda</th>}
              <th className="text-left px-3 py-2 font-medium">Qué</th>
              <th className="text-left px-3 py-2 font-medium">Antes</th>
              <th className="text-left px-3 py-2 font-medium">Después</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const negativo = r.field === 'Stock' && Number(r.after) < 0;
              return (
                <tr key={i} className="border-t">
                  <td className="px-3 py-1.5 font-mono text-gray-700">{r.sku}</td>
                  {variasTiendas && <td className="px-3 py-1.5 text-gray-500 text-xs">{r.tienda}</td>}
                  <td className="px-3 py-1.5 text-gray-600">{r.field}</td>
                  <td className="px-3 py-1.5 text-gray-400 line-through decoration-gray-300">{String(r.before ?? '')}</td>
                  <td className={`px-3 py-1.5 font-semibold ${negativo ? 'text-red-700' : 'text-gray-900'}`}>{String(r.after ?? '')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {vistas.length > PAGE && (
        <button type="button" onClick={() => setTodo(v => !v)}
          className="w-full text-xs text-indigo-700 py-2 border-t hover:bg-indigo-50">
          {todo ? 'Mostrar menos' : `Mostrar las ${vistas.length} líneas`}
        </button>
      )}
    </div>
  );
}

function Plegable({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-xl border">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700">
        {title} {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

/** Lo que trae la revisión, armado para leer de un vistazo. */
function Revision({ rev, busy, onAprobar, onDescartar }) {
  const report = rev.report || {};
  const stores = (report.stores || []).filter(s => s.status === 'ok');
  const filas = stores.flatMap(s => (s.changes || []).map(c => ({ ...c, tienda: s.name })));
  const precios = filas.filter(f => f.field === 'Precio').length;
  const stock = filas.filter(f => f.field === 'Stock').length;
  const faltan = [...new Set(stores.flatMap(s => s.not_found || []))];
  const faltanTotal = Math.max(faltan.length, ...stores.map(s => s.not_found_count || 0), 0);
  const alerts = report.alerts || [];
  const importantes = alerts.filter(a => a.level !== 'info').length;
  const t = report.totals || {};

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-800">Esto va a cambiar en Shopify</h2>
        <p className="text-sm text-gray-500">
          Archivo {ORIGEN[rev.trigger] || rev.trigger} · {when(rev.created_at)}
        </p>
        <p className="text-sm text-gray-500">Todavía no se cambió nada.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Numero label="Precios que cambian" value={precios} tone="text-indigo-700" />
        <Numero label="Stocks que cambian" value={stock} tone="text-green-700" />
        <Numero label="No existen en Shopify" value={faltanTotal} tone={faltanTotal ? 'text-amber-600' : 'text-gray-800'} />
        <Numero label="Alertas para mirar" value={importantes} tone={importantes ? 'text-red-600' : 'text-gray-800'} />
      </div>

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a, i) => {
            const s = ALERT_STYLE[a.level] || ALERT_STYLE.info;
            const Icon = s.icon;
            return (
              <div key={i} className={`text-sm border rounded-xl px-4 py-2.5 flex gap-2 ${s.cls}`}>
                <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p>{a.text}</p>
                  {a.samples?.length > 0 && (
                    <p className="opacity-75 mt-0.5 text-xs font-mono break-all">{a.samples.join(' · ')}{a.samples.length >= 10 ? ' …' : ''}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {filas.length > 0
        ? <Cambios filas={filas} variasTiendas={stores.length > 1} />
        : <p className="text-sm text-gray-500 bg-white border rounded-xl p-4">En Shopify no cambia nada; solo se actualiza la Tabla Maestra.</p>}

      {faltan.length > 0 && (
        <Plegable title={`Productos del archivo que no existen en Shopify (${faltanTotal}): no se crean solos`}>
          <div className="flex flex-wrap gap-1.5">
            {faltan.map(sku => (
              <span key={sku} className={`text-xs font-mono px-2 py-0.5 rounded ${esDobleNumero(sku) ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-700'}`}>
                {sku}{esDobleNumero(sku) && ' · nuevo'}
              </span>
            ))}
          </div>
          {faltanTotal > faltan.length && <p className="text-xs text-gray-400 mt-2">Se muestran los primeros {faltan.length}.</p>}
        </Plegable>
      )}

      <div className="flex items-center gap-3 flex-wrap pt-2">
        <button onClick={onAprobar} disabled={!!busy}
          className="flex items-center gap-2 text-base font-semibold text-white bg-indigo-600 rounded-xl px-6 py-3 hover:bg-indigo-700 disabled:opacity-50">
          {busy === 'apply' ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
          {busy === 'apply' ? 'Actualizando Shopify…' : 'Aprobar y actualizar Shopify'}
        </button>
        <button onClick={onDescartar} disabled={!!busy}
          className="flex items-center gap-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-xl px-4 py-3 hover:bg-gray-50 disabled:opacity-50">
          <XCircle className="w-4 h-4" /> Descartar
        </button>
        {t.master_changes + t.master_new > 0 && (
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <Database className="w-3.5 h-3.5" /> También se actualiza la Tabla Maestra.
          </span>
        )}
      </div>
    </div>
  );
}

function Resultado({ rev }) {
  const ap = rev.apply_summary || {};
  const stores = ap.stores || [];
  const errores = stores.flatMap(s => [s.error, ...(s.errors || [])].filter(Boolean));
  const ok = rev.status === 'aplicada';
  return (
    <div className={`rounded-2xl border p-6 ${ok ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
      <div className="flex items-center gap-3">
        {ok ? <CheckCircle2 className="w-8 h-8 text-green-600" /> : <AlertOctagon className="w-8 h-8 text-red-600" />}
        <div>
          <h2 className="text-xl font-bold text-gray-800">{ok ? 'Listo: Shopify actualizado' : 'Se actualizó con errores'}</h2>
          <p className="text-sm text-gray-600">{when(rev.resolved_at)}</p>
        </div>
      </div>
      <ul className="mt-4 space-y-1 text-sm text-gray-700">
        {stores.map((s, i) => (
          <li key={i}><span className="font-medium">{s.name}</span>: {s.applied || 0} cambios enviados
            {s.not_approved > 0 && <> · {s.not_approved} cambiaron desde la revisión (quedan para la próxima)</>}</li>
        ))}
      </ul>
      {errores.length > 0 && (
        <p className="mt-3 text-xs text-red-700">{errores.length} error(es): {errores[0]}</p>
      )}
    </div>
  );
}

/**
 * Pantalla de todos los días: subir el archivo del SYS → ver qué va a cambiar
 * → aprobar. Todo lo demás vive en Administración (/admin).
 */
export default function Actualizar() {
  const [estado, setEstado] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/actualizar`);
      if (r.ok) setEstado(await r.json());
      else setMsg(await extractError(r, 'No se pudo leer el estado.'));
    } catch { setMsg('No se pudo conectar con el servidor.'); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // Si el archivo llega por Drive, la revisión aparece sola.
  useEffect(() => {
    const id = setInterval(() => { if (!busy) load(); }, 60000);
    return () => clearInterval(id);
  }, [busy, load]);

  const subir = async (file) => {
    setBusy('upload'); setMsg(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await fetch(`${API}/api/actualizar/archivo`, { method: 'POST', body: fd });
      if (!r.ok) setMsg(await extractError(r, 'No se pudo revisar el archivo.'));
      await load();
    } catch { setMsg('No se pudo conectar con el servidor.'); }
    setBusy(null);
  };

  const accion = async (kind) => {
    const rev = estado?.revision;
    if (!rev) return;
    if (kind === 'apply' && !window.confirm('¿Actualizar Shopify con estos cambios?')) return;
    if (kind === 'discard' && !window.confirm('¿Descartar? No se cambia nada.')) return;
    setBusy(kind); setMsg(null);
    try {
      const r = await fetch(`${API}/api/reviews/${rev.id}/${kind}`, { method: 'POST' });
      if (!r.ok) setMsg(await extractError(r, 'No se pudo completar.'));
      await load();
    } catch { setMsg('No se pudo conectar con el servidor.'); }
    setBusy(null);
  };

  const rev = estado?.revision;
  const pendiente = rev?.status === 'pendiente';
  const aplicada = rev && ['aplicada', 'con_errores'].includes(rev.status);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-bold text-indigo-600 flex items-center gap-2">
            <Database className="w-5 h-5" /> Tablas K · Actualizar
          </h1>
          <Link to="/admin" className="text-xs text-gray-500 hover:text-indigo-600 flex items-center gap-1">
            <Settings className="w-3.5 h-3.5" /> Administración
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {estado && !estado.listo && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm">
            Falta elegir a qué Fuente va el archivo del SYS.{' '}
            <Link to="/admin/actualizar" className="font-semibold underline">Configurarlo en Administración</Link>.
          </div>
        )}

        {!pendiente && (
          <>
            <Soltar onFile={subir} busy={busy === 'upload'} />
            {estado?.drive?.carpeta && (
              <p className="text-sm text-gray-500 flex items-center gap-2 justify-center">
                <FolderOpen className="w-4 h-4" /> O dejalo en la carpeta de Drive: se revisa solo en unos minutos
                {estado.drive.ultimo?.name && <> · último: {estado.drive.ultimo.name}</>}
              </p>
            )}
          </>
        )}

        {msg && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 whitespace-pre-line">{msg}</p>}

        {pendiente && (
          <>
            <Revision rev={rev} busy={busy} onAprobar={() => accion('apply')} onDescartar={() => accion('discard')} />
            <Soltar onFile={subir} busy={busy === 'upload'} compacta />
          </>
        )}

        {!pendiente && aplicada && <Resultado rev={rev} />}
        {!pendiente && rev?.status === 'sin_cambios' && (
          <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-xl p-4">
            Último archivo revisado {when(rev.created_at)}: todo cuadra, no había nada que actualizar.
          </p>
        )}
        {!pendiente && rev?.status === 'error' && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-4">
            No se pudo revisar el último archivo: {rev.report?.reason || rev.reason || 'error desconocido'}
          </p>
        )}
      </main>
    </div>
  );
}
