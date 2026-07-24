import React, { useState, useEffect, useCallback } from 'react';
import { Inbox, Check, X, RefreshCw, PackagePlus, AlertCircle } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';

// Bandeja de Nuevos: los SKUs que una fuente trajo y NO existían en la Maestra
// (procesos con "crear nuevos" desactivado) quedan retenidos aquí. El usuario
// marca cuáles crear ANTES de que se escriban en la Maestra.
export default function NewRecordsTray() {
  const [records, setRecords] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const fetchTray = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/tray?status=pending`);
      if (!res.ok) throw new Error('No se pudo cargar la Bandeja de Nuevos');
      const data = await res.json();
      setRecords(data.records || []);
      setSelected(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTray(); }, [fetchTray]);

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(prev =>
      prev.size === records.length ? new Set() : new Set(records.map(r => r.id))
    );
  };

  const act = async (path, verb) => {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${API}/api/tray/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `No se pudo ${verb}`);
      if (path === 'approve') {
        const errs = (data.errors || []).length;
        setNotice(`${data.rows_added} registro(s) creado(s) en la Maestra${errs ? ` · ${errs} con error` : ''}.`);
      } else {
        setNotice(`${data.rejected} registro(s) rechazado(s).`);
      }
      await fetchTray();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const fieldChips = (fields) =>
    Object.entries(fields || {}).map(([k, v]) => (
      <span key={k} className="inline-flex items-center gap-1 bg-gray-100 text-gray-600 text-[11px] px-1.5 py-0.5 rounded mr-1 mb-1">
        <span className="font-medium text-gray-500">{k}:</span>
        <span className="font-mono">{String(v) || '—'}</span>
      </span>
    ));

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Inbox className="w-6 h-6 text-indigo-600" /> Bandeja de Nuevos
        </h2>
        <button onClick={fetchTray} disabled={loading}
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-indigo-600 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        SKUs que llegaron de tus fuentes y <b>no existían</b> en la Maestra. Nada se creó todavía:
        marcá cuáles querés crear y confirmá, o rechazá los que no correspondan.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 flex items-start gap-2 bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 text-sm">
          <Check className="w-4 h-4 mt-0.5 flex-shrink-0" /> {notice}
        </div>
      )}

      {loading ? (
        <div className="text-gray-400 text-sm py-12 text-center">Cargando…</div>
      ) : records.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <Inbox className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">La bandeja está vacía</p>
          <p className="text-gray-400 text-sm mt-1">No hay registros nuevos esperando revisión.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-3">
            <button onClick={() => act('approve', 'crear')} disabled={busy || selected.size === 0}
              className="flex items-center gap-1.5 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50">
              <PackagePlus className="w-4 h-4" /> Crear seleccionados ({selected.size})
            </button>
            <button onClick={() => act('reject', 'rechazar')} disabled={busy || selected.size === 0}
              className="flex items-center gap-1.5 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">
              <X className="w-4 h-4" /> Rechazar
            </button>
            <span className="text-sm text-gray-400 ml-auto">{records.length} pendiente(s)</span>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox" className="rounded border-gray-300 text-indigo-600 w-4 h-4"
                      checked={selected.size === records.length && records.length > 0}
                      onChange={toggleAll} />
                  </th>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Datos que se crearían</th>
                  <th className="px-4 py-3">Origen</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id}
                    className={`border-t border-gray-100 cursor-pointer hover:bg-indigo-50/40 ${selected.has(r.id) ? 'bg-indigo-50/60' : ''}`}
                    onClick={() => toggle(r.id)}>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="rounded border-gray-300 text-indigo-600 w-4 h-4"
                        checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-gray-800 whitespace-nowrap">{r.sku}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap">{fieldChips(r.fields)}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{r.source_label || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
