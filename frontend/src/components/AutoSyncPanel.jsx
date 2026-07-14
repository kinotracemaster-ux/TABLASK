import { useState, useEffect } from 'react';
import { Clock, Zap, Play } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';

const INTERVALS = [
  { h: 1, label: 'cada hora' },
  { h: 3, label: 'cada 3 horas' },
  { h: 6, label: 'cada 6 horas' },
  { h: 12, label: 'cada 12 horas' },
  { h: 24, label: 'una vez al día' },
];

function timeAgo(iso) {
  if (!iso) return null;
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'hace segundos';
  const m = Math.floor(s / 60); if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60); if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

function timeUntil(iso) {
  if (!iso) return null;
  const s = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  if (s <= 0) return 'en breve';
  const m = Math.floor(s / 60); if (m < 60) return `en ${m} min`;
  const h = Math.floor(m / 60); return `en ${h} h`;
}

export default function AutoSyncPanel() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState(null);

  const load = async () => {
    try {
      const res = await fetch(`${API}/api/schedule`);
      if (res.ok) setCfg(await res.json());
    } catch (err) { console.error(err); }
  };
  useEffect(() => { load(); }, []);

  const save = async (enabled, interval_hours) => {
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, interval_hours }),
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
      setRunMsg(d.ran ? `✅ ${d.rows_updated || 0} actualizadas, ${d.rows_added || 0} nuevas en ${d.processes || 0} fuente(s).` : `${d.reason || 'Sin cambios.'}`);
      load();
    } catch (err) {
      setRunMsg('Error al correr.');
    }
    setRunning(false);
  };

  if (!cfg) return null;
  const on = cfg.enabled;

  return (
    <div className={`rounded-xl border p-4 ${on ? 'border-indigo-200 bg-indigo-50/50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${on ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}>
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-800 text-sm">Piloto automático</h3>
            <p className="text-xs text-gray-500">
              {on
                ? <>Corre todas las fuentes {INTERVALS.find(i => i.h === cfg.interval_hours)?.label || `cada ${cfg.interval_hours} h`}
                    {cfg.next_run_at && <> · próxima {timeUntil(cfg.next_run_at)}</>}</>
                : 'Sincronizá sin abrir la app. Corre las fuentes cada X horas.'}
              {cfg.last_run_at && <> · última {timeAgo(cfg.last_run_at)}</>}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {on && (
            <select value={cfg.interval_hours} disabled={saving}
              onChange={e => save(true, parseInt(e.target.value))}
              className="border border-gray-300 rounded-lg p-1.5 text-sm bg-white">
              {INTERVALS.map(i => <option key={i.h} value={i.h}>{i.label}</option>)}
            </select>
          )}
          <button onClick={runNow} disabled={running}
            title="Correr todas las fuentes ahora"
            className="flex items-center gap-1.5 text-sm font-medium text-indigo-700 bg-white border border-indigo-200 rounded-lg px-3 py-1.5 hover:bg-indigo-50 disabled:opacity-50">
            <Play className="w-3.5 h-3.5" /> {running ? 'Corriendo…' : 'Correr ahora'}
          </button>
          {/* Toggle on/off */}
          <button onClick={() => save(!on, cfg.interval_hours)} disabled={saving}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${on ? 'bg-indigo-600' : 'bg-gray-300'}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${on ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>
      {runMsg && <p className="text-xs text-gray-600 mt-2 pl-1">{runMsg}</p>}
    </div>
  );
}
