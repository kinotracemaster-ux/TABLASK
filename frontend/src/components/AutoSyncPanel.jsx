import { useState, useEffect } from 'react';
import { Clock, Play, Search, Zap } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';

const INTERVALS = [
  { h: 1, label: 'cada hora' },
  { h: 3, label: 'cada 3 horas' },
  { h: 6, label: 'cada 6 horas' },
  { h: 12, label: 'cada 12 horas' },
  { h: 24, label: 'cada 24 horas' },
];

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function hourLabel(h) {
  if (h == null) return '';
  const suf = h < 12 ? 'a. m.' : 'p. m.';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:00 ${suf}`;
}

function timeAgo(iso) {
  if (!iso) return null;
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).getTime()) / 1000));
  if (s < 60) return 'hace segundos';
  const m = Math.floor(s / 60); if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60); if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

function timeUntil(iso) {
  if (!iso) return null;
  const s = Math.floor((new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).getTime() - Date.now()) / 1000);
  if (s <= 0) return 'en breve';
  const m = Math.floor(s / 60); if (m < 60) return `en ${m} min`;
  const h = Math.floor(m / 60); return `en ${h} h`;
}

/**
 * Piloto automático. Dos modos:
 * - "review" (Revisión diaria): calcula qué cambiaría y deja un reporte para
 *   aprobar; no toca la Maestra ni las tiendas sin tu OK.
 * - "auto": corre las fuentes y escribe solo (comportamiento original).
 * onRan: avisa al padre que se generó algo nuevo (para refrescar la revisión).
 */
export default function AutoSyncPanel({ onRan }) {
  const [cfg, setCfg] = useState(null);
  const [stores, setStores] = useState([]);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState(null);

  const load = async () => {
    try {
      const res = await fetch(`${API}/api/schedule`);
      if (res.ok) setCfg(await res.json());
    } catch (err) { console.error(err); }
  };
  useEffect(() => {
    load();
    fetch(`${API}/api/shopify-subscriptions/`).then(r => r.ok ? r.json() : []).then(setStores).catch(() => {});
  }, []);

  const save = async (patch) => {
    setSaving(true);
    const next = { ...cfg, ...patch };
    const body = {
      enabled: next.enabled,
      interval_hours: next.interval_hours,
      mode: next.mode,
    };
    if (next.daily_hour == null) body.use_daily_hour = false; else body.daily_hour = next.daily_hour;
    if (next.review_shopify_ids == null) body.review_all_shopify = true;
    else body.review_shopify_ids = next.review_shopify_ids;
    try {
      const res = await fetch(`${API}/api/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) setCfg(await res.json());
    } catch (err) { console.error(err); }
    setSaving(false);
  };

  const runNow = async () => {
    setRunning(true); setRunMsg(null);
    try {
      const res = await fetch(`${API}/api/schedule/run-now`, { method: 'POST' });
      const d = await res.json();
      if (d.mode === 'review') {
        const t = d.totals || {};
        setRunMsg(d.status === 'error'
          ? `No se pudo revisar: ${d.reason || 'error'}`
          : d.status === 'sin_cambios'
            ? '✅ Todo cuadra: no hay nada que actualizar.'
            : `🔍 Revisión lista: ${t.master_changes || 0} cambios y ${t.master_new || 0} altas en la Maestra, ${t.store_changes || 0} en tiendas. Revisala abajo.`);
      } else {
        setRunMsg(d.ran ? `✅ ${d.rows_updated || 0} actualizadas, ${d.rows_added || 0} nuevas en ${d.processes || 0} fuente(s).` : `${d.reason || 'Sin cambios.'}`);
      }
      load();
      onRan && onRan();
    } catch {
      setRunMsg('Error al correr.');
    }
    setRunning(false);
  };

  if (!cfg) return null;
  const on = cfg.enabled;
  const review = cfg.mode === 'review';
  const daily = cfg.daily_hour != null;
  const freqLabel = daily
    ? `todos los días a las ${hourLabel(cfg.daily_hour)}`
    : (INTERVALS.find(i => i.h === cfg.interval_hours)?.label || `cada ${cfg.interval_hours} h`);
  const selectedIds = cfg.review_shopify_ids; // null = todas
  const activeStores = stores.filter(s => s.is_active);

  const toggleStore = (id) => {
    const current = selectedIds ?? activeStores.map(s => s.id);
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
    save({ review_shopify_ids: next.length === activeStores.length ? null : next });
  };

  return (
    <div className={`rounded-xl border p-4 ${on ? 'border-indigo-200 bg-indigo-50/50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${on ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}>
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-800 text-sm">
              Piloto automático {review && <span className="text-indigo-600">· Revisión diaria</span>}
            </h3>
            <p className="text-xs text-gray-500">
              {on
                ? <>{review ? 'Revisa' : 'Corre todas las fuentes'} {freqLabel}
                    {review && ' y te deja el reporte para aprobar'}
                    {cfg.next_run_at && <> · próxima {timeUntil(cfg.next_run_at)}</>}</>
                : review
                  ? 'Revisá todos los días sin abrir la app: nada se aplica sin tu OK.'
                  : 'Sincronizá sin abrir la app. Corre las fuentes cada X horas.'}
              {cfg.last_run_at && <> · última {timeAgo(cfg.last_run_at)}</>}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={runNow} disabled={running}
            title={review ? 'Revisar ahora (no escribe nada)' : 'Correr todas las fuentes ahora'}
            className="flex items-center gap-1.5 text-sm font-medium text-indigo-700 bg-white border border-indigo-200 rounded-lg px-3 py-1.5 hover:bg-indigo-50 disabled:opacity-50">
            {review ? <Search className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {running ? (review ? 'Revisando…' : 'Corriendo…') : (review ? 'Revisar ahora' : 'Correr ahora')}
          </button>
          <button onClick={() => save({ enabled: !on })} disabled={saving} aria-label="Activar piloto automático"
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${on ? 'bg-indigo-600' : 'bg-gray-300'}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${on ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>

      {/* Ajustes: modo, horario y tiendas */}
      <div className="mt-3 pt-3 border-t border-indigo-100/70 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
          <button disabled={saving} onClick={() => save({ mode: 'review' })}
            className={`flex items-center gap-1.5 px-3 py-1.5 ${review ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
            <Search className="w-3.5 h-3.5" /> Revisar y avisar
          </button>
          <button disabled={saving} onClick={() => save({ mode: 'auto' })}
            className={`flex items-center gap-1.5 px-3 py-1.5 border-l border-gray-200 ${!review ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
            <Zap className="w-3.5 h-3.5" /> Aplicar solo
          </button>
        </div>

        <div className="flex items-center gap-2">
          <select value={daily ? 'daily' : String(cfg.interval_hours)} disabled={saving}
            onChange={e => e.target.value === 'daily'
              ? save({ daily_hour: cfg.daily_hour ?? 7 })
              : save({ daily_hour: null, interval_hours: parseInt(e.target.value) })}
            className="border border-gray-300 rounded-lg p-1.5 text-sm bg-white">
            <option value="daily">Todos los días a las…</option>
            {INTERVALS.map(i => <option key={i.h} value={String(i.h)}>{i.label}</option>)}
          </select>
          {daily && (
            <select value={cfg.daily_hour} disabled={saving}
              onChange={e => save({ daily_hour: parseInt(e.target.value) })}
              className="border border-gray-300 rounded-lg p-1.5 text-sm bg-white">
              {HOURS.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
          )}
        </div>

        {review && activeStores.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-gray-500">Tiendas a revisar:</span>
            {activeStores.map(s => (
              <label key={s.id} className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                <input type="checkbox" disabled={saving}
                  checked={selectedIds == null || selectedIds.includes(s.id)}
                  onChange={() => toggleStore(s.id)} />
                {s.name}
              </label>
            ))}
          </div>
        )}
      </div>
      {!review && on && (
        <p className="text-xs text-amber-700 mt-2 pl-1">
          En "Aplicar solo" los cambios se escriben en la Maestra y en las tiendas sin revisión previa.
        </p>
      )}
      {runMsg && <p className="text-xs text-gray-600 mt-2 pl-1">{runMsg}</p>}
    </div>
  );
}
