import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardCheck, AlertOctagon, AlertTriangle, Info, CheckCircle2, ChevronDown, ChevronUp,
  Database, Store, RefreshCw, Link2, XCircle,
} from 'lucide-react';
import { extractError } from '../utils/errors';

const API = import.meta.env.VITE_API_URL || '';
const PAGE = 100;

const STATUS = {
  pendiente: { label: 'Pendiente de tu aprobación', cls: 'bg-amber-100 text-amber-800' },
  sin_cambios: { label: 'Todo cuadra', cls: 'bg-green-100 text-green-800' },
  aplicada: { label: 'Aplicada', cls: 'bg-indigo-100 text-indigo-800' },
  con_errores: { label: 'Aplicada con errores', cls: 'bg-red-100 text-red-700' },
  descartada: { label: 'Descartada', cls: 'bg-gray-100 text-gray-600' },
  reemplazada: { label: 'Reemplazada por una más nueva', cls: 'bg-gray-100 text-gray-600' },
  vencida: { label: 'Vencida', cls: 'bg-gray-100 text-gray-600' },
  error: { label: 'Error', cls: 'bg-red-100 text-red-700' },
};

const ALERT_STYLE = {
  danger: { icon: AlertOctagon, cls: 'bg-red-50 border-red-200 text-red-800' },
  warning: { icon: AlertTriangle, cls: 'bg-amber-50 border-amber-200 text-amber-800' },
  info: { icon: Info, cls: 'bg-slate-50 border-slate-200 text-slate-700' },
};

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function Tile({ label, value, tone = 'text-gray-800' }) {
  return (
    <div className="bg-white p-3 rounded-lg text-center border">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-bold ${tone}`}>{value ?? 0}</p>
    </div>
  );
}

/** Tabla SKU / campo / antes → después, con "ver todo" para listas largas. */
function DiffTable({ rows, before = 'before', after = 'after' }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return <p className="text-xs text-gray-400 px-1">Sin cambios.</p>;
  const shown = all ? rows : rows.slice(0, PAGE);
  return (
    <div className="border rounded-lg overflow-hidden bg-white">
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-500 sticky top-0">
            <tr>
              <th className="text-left px-3 py-1.5 font-medium">SKU</th>
              <th className="text-left px-3 py-1.5 font-medium">Campo</th>
              <th className="text-left px-3 py-1.5 font-medium">Antes</th>
              <th className="text-left px-3 py-1.5 font-medium">Después</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-1 font-mono text-gray-700">{r.sku}</td>
                <td className="px-3 py-1 text-gray-600">
                  {r.field}
                  {r.orphan_zero && <span className="ml-1 text-[10px] text-red-600">(agotado: no viene en el archivo)</span>}
                </td>
                <td className="px-3 py-1 text-gray-400 line-through decoration-gray-300">{String(r[before] ?? '') || '(vacío)'}</td>
                <td className="px-3 py-1 font-medium text-gray-800">{String(r[after] ?? '') || '(vacío)'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > PAGE && (
        <button type="button" onClick={() => setAll(v => !v)}
          className="w-full text-xs text-indigo-700 py-1.5 border-t hover:bg-indigo-50">
          {all ? 'Mostrar menos' : `Mostrar las ${rows.length} líneas`}
        </button>
      )}
    </div>
  );
}

function Block({ icon: Icon, title, subtitle, badge, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-lg bg-white/70">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 rounded-lg">
        <Icon className="w-4 h-4 text-indigo-500 flex-shrink-0" />
        <span className="font-medium text-sm text-gray-800">{title}</span>
        {badge}
        <span className="text-xs text-gray-500 truncate">{subtitle}</span>
        <span className="ml-auto text-gray-400">{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</span>
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );
}

/**
 * Revisión diaria: lo que el piloto encontró para actualizar (Fuentes →
 * Maestra → tiendas Shopify), sin haber escrito nada. Aprobás y se aplica SOLO
 * lo revisado que siga vigente.
 */
export default function DailyReviewPanel({ refreshKey }) {
  const [rev, setRev] = useState(undefined);
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([fetch(`${API}/api/reviews/latest`), fetch(`${API}/api/schedule`)]);
      setRev(r.ok ? await r.json() : null);
      if (c.ok) setCfg(await c.json());
    } catch (err) { console.error(err); setRev(null); }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const act = async (kind) => {
    if (kind === 'apply' && !window.confirm(
      '¿Aplicar esta revisión?\n\nSe escriben en la Maestra y en las tiendas SOLO los cambios revisados que sigan vigentes. Lo que cambió desde la revisión queda para la próxima.')) return;
    if (kind === 'discard' && !window.confirm('¿Descartar esta revisión? No se aplica nada.')) return;
    setBusy(kind); setMsg(null);
    try {
      const url = kind === 'run' ? `${API}/api/reviews/run-now` : `${API}/api/reviews/${rev.id}/${kind}`;
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) setMsg(await extractError(res, 'No se pudo completar.'));
      await load();
    } catch {
      setMsg('No se pudo conectar con el servidor.');
    }
    setBusy(null);
  };

  const copyLink = async () => {
    const base = API || window.location.origin;
    const link = `${base}/api/reviews/latest/public?token=${cfg.report_token}`;
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { window.prompt('Copiá el link:', link); }
  };

  if (rev === undefined) return null;
  // Solo se muestra si el piloto está en modo revisión o ya hubo alguna.
  if (!rev && cfg?.mode !== 'review') return null;

  const report = rev?.report || {};
  const t = report.totals || {};
  const st = STATUS[rev?.status] || STATUS.error;
  const alerts = report.alerts || [];
  const pending = rev?.status === 'pendiente';
  const applied = rev?.apply_summary;
  const downstream = report.downstream || {};

  return (
    <div className="rounded-xl border border-indigo-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-100 text-indigo-600"><ClipboardCheck className="w-5 h-5" /></div>
          <div>
            <h3 className="font-semibold text-gray-800 text-sm flex items-center gap-2 flex-wrap">
              Revisión diaria {rev && <span className="text-gray-400 font-normal">#{rev.id}</span>}
              {rev && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.cls}`}>{st.label}</span>}
            </h3>
            <p className="text-xs text-gray-500">
              {rev ? <>Generada {when(rev.created_at)} ({rev.trigger === 'manual' ? 'a mano' : 'programada'})
                {rev.resolved_at && <> · resuelta {when(rev.resolved_at)}</>}</>
                : 'Todavía no hay revisiones. Generá la primera con "Revisar ahora".'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => act('run')} disabled={!!busy}
            className="flex items-center gap-1.5 text-sm font-medium text-indigo-700 bg-white border border-indigo-200 rounded-lg px-3 py-1.5 hover:bg-indigo-50 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${busy === 'run' ? 'animate-spin' : ''}`} /> {busy === 'run' ? 'Revisando…' : 'Revisar ahora'}
          </button>
        </div>
      </div>

      {rev?.status === 'error' && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
          No se pudo armar la revisión: {report.reason || 'error desconocido'}
        </p>
      )}

      {rev && rev.status !== 'error' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Tile label="Cambios en la Maestra" value={t.master_changes} />
            <Tile label="Productos nuevos" value={t.master_new} tone="text-indigo-700" />
            <Tile label="Quedan en 0 en tiendas" value={t.store_zeroed} tone={t.store_zeroed ? 'text-red-700' : 'text-gray-800'} />
            <Tile label="Cambios en tiendas" value={t.store_changes} tone="text-green-700" />
          </div>

          {alerts.length > 0 && (
            <div className="space-y-1.5">
              {alerts.map((a, i) => {
                const s = ALERT_STYLE[a.level] || ALERT_STYLE.info;
                const Icon = s.icon;
                return (
                  <div key={i} className={`text-xs border rounded-lg px-3 py-2 flex gap-2 ${s.cls}`}>
                    <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <p>{a.text}</p>
                      {a.samples?.length > 0 && (
                        <p className="opacity-75 mt-0.5 font-mono break-all">{a.samples.join(' · ')}{a.samples.length >= 10 ? ' …' : ''}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="space-y-2">
            {(report.processes || []).map(p => (
              <Block key={`p${p.process_id}`} icon={Database} title={p.name}
                badge={p.status !== 'ok' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">{p.status === 'guardian' ? 'frenada por el Guardián' : 'error'}</span>}
                subtitle={p.status === 'ok'
                  ? `→ Maestra: ${p.changes_total || 0} cambios · ${p.new_total || 0} nuevos${p.coherence != null ? ` · coincidencia ${p.coherence}%` : ''}`
                  : (p.error || '')}>
                <DiffTable rows={p.changes || []} before="old" after="new" />
                {(p.new_rows || []).length > 0 && (
                  <div className="text-xs text-gray-600">
                    <p className="font-medium mb-1">Productos nuevos que se crearían ({p.new_rows.length}):</p>
                    <p className="font-mono break-all text-gray-500">{p.new_rows.slice(0, 200).map(n => n.sku).join(' · ')}{p.new_rows.length > 200 ? ' …' : ''}</p>
                  </div>
                )}
              </Block>
            ))}
            {(report.stores || []).map(s => (
              <Block key={`s${s.subscription_id}`} icon={Store} title={s.name}
                badge={s.status !== 'ok' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">error</span>}
                subtitle={s.status === 'ok'
                  ? `Maestra → tienda: ${s.changes_total || 0} cambios${Object.keys(s.by_field || {}).length ? ` (${Object.entries(s.by_field).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ')})` : ''}`
                  : (s.error || '')}>
                <DiffTable rows={s.changes || []} />
                {s.not_found_count > 0 && (
                  <p className="text-xs text-gray-500">{s.not_found_count} SKU de la Maestra no existen en esta tienda: no se crean.</p>
                )}
              </Block>
            ))}
          </div>

          {pending && ((downstream.sheets || []).length > 0 || (downstream.api || []).length > 0 || (report.stores_not_reviewed || []).length > 0) && (
            <p className="text-xs text-gray-500">
              {((downstream.sheets || []).length > 0 || (downstream.api || []).length > 0) && (
                <>Al aprobar, como en un correr normal, también se actualizan: {[...(downstream.sheets || []), ...(downstream.api || [])].join(', ')}. </>
              )}
              {(report.stores_not_reviewed || []).length > 0 && (
                <>Tiendas fuera de la revisión (no se tocan): {report.stores_not_reviewed.join(', ')}.</>
              )}
            </p>
          )}

          {pending && (
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => act('apply')} disabled={!!busy}
                className="flex items-center gap-1.5 text-sm font-semibold text-white bg-indigo-600 rounded-lg px-4 py-2 hover:bg-indigo-700 disabled:opacity-50">
                <CheckCircle2 className="w-4 h-4" /> {busy === 'apply' ? 'Aplicando…' : 'Aprobar y aplicar'}
              </button>
              <button onClick={() => act('discard')} disabled={!!busy}
                className="flex items-center gap-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50 disabled:opacity-50">
                <XCircle className="w-4 h-4" /> Descartar
              </button>
              <span className="text-xs text-gray-400">Solo se aplica lo revisado que siga vigente.</span>
            </div>
          )}

          {applied && (
            <div className="text-xs bg-indigo-50 border border-indigo-100 rounded-lg p-3 space-y-1 text-gray-700">
              <p className="font-semibold text-indigo-800">Resultado de la aplicación</p>
              {(applied.processes || []).map((p, i) => (
                <p key={`ap${i}`}>
                  <span className="font-medium">{p.name}</span>: {p.applied_changes} cambios y {p.applied_new} altas en la Maestra
                  {p.no_longer_valid > 0 && <> · {p.no_longer_valid} ya no aplicaban</>}
                  {p.not_approved > 0 && <> · {p.not_approved} nuevos desde la revisión (quedan para la próxima)</>}
                  {p.skipped && <> · {p.skipped}</>}
                  {p.error && <span className="text-red-700"> · error: {p.error}</span>}
                </p>
              ))}
              {(applied.stores || []).map((s, i) => (
                <p key={`as${i}`}>
                  <span className="font-medium">{s.name}</span>: {s.applied} cambios enviados
                  {s.no_longer_valid > 0 && <> · {s.no_longer_valid} ya no aplicaban</>}
                  {s.not_approved > 0 && <> · {s.not_approved} nuevos desde la revisión (quedan para la próxima)</>}
                  {s.skipped && <> · {s.skipped}</>}
                  {s.error && <span className="text-red-700"> · error: {s.error}</span>}
                  {(s.errors || []).length > 0 && <span className="text-red-700"> · {s.errors.length} error(es): {s.errors[0]}</span>}
                </p>
              ))}
            </div>
          )}
        </>
      )}

      {msg && <p className="text-xs text-red-700">{msg}</p>}

      {cfg?.report_token && (
        <div className="pt-2 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-500">
          <Link2 className="w-3.5 h-3.5" />
          Link de solo lectura del último reporte (para tu auditor diario):
          <button type="button" onClick={copyLink} className="text-indigo-700 font-medium hover:underline">
            {copied ? '¡Copiado!' : 'copiar link'}
          </button>
        </div>
      )}
    </div>
  );
}
