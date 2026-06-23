import { useState, useEffect } from 'react';
import { Database, CheckCircle2, XCircle, AlertTriangle, Search, Filter, Link2, PlusCircle } from 'lucide-react';
import { extractError } from '../utils/errors';

const API = import.meta.env.VITE_API_URL || '';

export default function StagingQueue() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState({}); // `${batchId}::${sku}` -> true
  const [resolving, setResolving] = useState({}); // batchId -> bool

  const keyFor = (batchId, sku) => `${batchId}::${sku}`;

  const toggleSelect = (batchId, sku) => {
    const k = keyFor(batchId, sku);
    setSelected(prev => ({ ...prev, [k]: !prev[k] }));
  };

  const toggleSelectAll = (batch, suspects) => {
    const allOn = suspects.every(s => selected[keyFor(batch.id, s.sku)]);
    setSelected(prev => {
      const next = { ...prev };
      suspects.forEach(s => { next[keyFor(batch.id, s.sku)] = !allOn; });
      return next;
    });
  };

  const selectedCount = (batch, suspects) =>
    suspects.filter(s => selected[keyFor(batch.id, s.sku)]).length;

  const handleResolve = async (batch, suspects, action) => {
    const resolutions = suspects
      .filter(s => selected[keyFor(batch.id, s.sku)])
      .map(s => action === 'create'
        ? { sku: s.sku, action: 'create' }
        : { sku: s.sku, action: 'cross', target_sku: s.suggested_sku });
    if (resolutions.length === 0) return;
    setResolving(prev => ({ ...prev, [batch.id]: true }));
    try {
      const res = await fetch(`${API}/api/staging/${batch.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolutions }),
      });
      if (res.ok) {
        // limpiar selección de este lote y recargar para ver contadores actualizados
        setSelected(prev => {
          const next = { ...prev };
          suspects.forEach(s => { delete next[keyFor(batch.id, s.sku)]; });
          return next;
        });
        await fetchPendingBatches();
      } else {
        alert(await extractError(res));
      }
    } catch (e) {
      console.error(e);
      alert('Fallo al cruzar los códigos.');
    } finally {
      setResolving(prev => ({ ...prev, [batch.id]: false }));
    }
  };

  useEffect(() => {
    fetchPendingBatches();
  }, []);

  const fetchPendingBatches = async () => {
    try {
      const res = await fetch(`${API}/api/staging/pending`);
      if (res.ok) {
        const data = await res.json();
        setBatches(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (batchId) => {
    try {
      const res = await fetch(`${API}/api/staging/${batchId}/approve`, { method: 'POST' });
      if (res.ok) {
        setBatches(batches.filter(b => b.id !== batchId));
      } else {
        const errMsg = await extractError(res);
        alert(errMsg);
      }
    } catch (e) {
      console.error(e);
      alert("Fallo al aprobar");
    }
  };

  const handleReject = async (batchId) => {
    try {
      const res = await fetch(`${API}/api/staging/${batchId}/reject`, { method: 'POST' });
      if (res.ok) {
        setBatches(batches.filter(b => b.id !== batchId));
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold text-gray-800 flex items-center gap-3">
            <Database className="w-8 h-8 text-indigo-600" />
            Cola de Aprobación (Staging)
          </h2>
          <p className="text-gray-500 mt-2">Revisa y aprueba los datos antes de que entren a la Tabla Maestra.</p>
        </div>
        <button 
          onClick={fetchPendingBatches}
          className="px-4 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-sm font-medium"
        >
          Actualizar
        </button>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="text-center p-8 text-gray-500 bg-white rounded-xl shadow-sm border border-gray-200">
            Cargando lotes pendientes...
          </div>
        ) : batches.length === 0 ? (
          <div className="text-center p-12 text-gray-500 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col items-center">
            <CheckCircle2 className="w-12 h-12 text-green-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-800">Todo al día</h3>
            <p>No hay datos en cuarentena esperando revisión.</p>
          </div>
        ) : (
          batches.map(batch => {
            const diff = JSON.parse(batch.diff_result);
            return (
              <div key={batch.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-6 border-b border-gray-200 flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                      Lote #{batch.id} (Proceso {batch.process_id})
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Recibido: {new Date(batch.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleReject(batch.id)}
                      className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium border border-red-200 flex items-center gap-2"
                    >
                      <XCircle className="w-4 h-4" />
                      Rechazar
                    </button>
                    <button 
                      onClick={() => handleApprove(batch.id)}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium flex items-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Aprobar y Escribir
                    </button>
                  </div>
                </div>
                
                <div className="p-6 bg-gray-50 grid grid-cols-3 gap-4">
                  <div className="bg-white p-4 rounded-lg border border-gray-200 text-center">
                    <span className="block text-2xl font-bold text-blue-600">{diff.rows_to_update || 0}</span>
                    <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">Se rellenan</span>
                  </div>
                  <div className="bg-white p-4 rounded-lg border border-gray-200 text-center">
                    <span className="block text-2xl font-bold text-gray-500">{diff.rows_ignored || 0}</span>
                    <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">No coinciden</span>
                  </div>
                  <div className="bg-white p-4 rounded-lg border border-gray-200 text-center">
                    <span className="block text-2xl font-bold text-gray-400">{diff.rows_unchanged || 0}</span>
                    <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">Sin cambios</span>
                  </div>
                </div>

                {diff.suspects && diff.suspects.length > 0 && (() => {
                  const suspects = diff.suspects;
                  const allOn = suspects.every(s => selected[keyFor(batch.id, s.sku)]);
                  const nSel = selectedCount(batch, suspects);
                  const busy = !!resolving[batch.id];
                  return (
                  <div className="p-4 bg-amber-50 border-t border-amber-200">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <h4 className="text-sm font-bold text-amber-800 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        Se parecen a un SKU existente — revisa ({suspects.length})
                      </h4>
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => handleResolve(batch, suspects, 'create')}
                          disabled={nSel === 0 || busy}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <PlusCircle className="w-3.5 h-3.5" />
                          {busy ? '...' : `Crear como nuevos (${nSel})`}
                        </button>
                        <button
                          onClick={() => handleResolve(batch, suspects, 'cross')}
                          disabled={nSel === 0 || busy}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                          {busy ? '...' : `Cruzar con sugerido (${nSel})`}
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-amber-700 mb-3">
                      Marca los códigos y decide: <b>Cruzar con sugerido</b> (mismo producto → sus datos actualizan la fila del SKU sugerido) o <b>Crear como nuevos</b> (sí es un producto distinto → entra como fila nueva). Los que no marques quedan sin tocar.
                    </p>
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-amber-200 bg-white">
                      <table className="w-full text-sm">
                        <thead className="bg-amber-100 text-amber-900 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 w-10 text-center">
                              <input type="checkbox" checked={allOn} onChange={() => toggleSelectAll(batch, suspects)} />
                            </th>
                            <th className="text-left px-3 py-2 font-semibold">Código del origen</th>
                            <th className="text-left px-3 py-2 font-semibold">Cruzar con (Maestra)</th>
                            <th className="text-left px-3 py-2 font-semibold">Motivo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {suspects.map((s, i) => {
                            const on = !!selected[keyFor(batch.id, s.sku)];
                            return (
                            <tr key={i} className={`border-t border-amber-100 ${on ? 'bg-amber-50' : ''}`}>
                              <td className="px-3 py-2 text-center">
                                <input type="checkbox" checked={on} onChange={() => toggleSelect(batch.id, s.sku)} />
                              </td>
                              <td className="px-3 py-2 font-mono text-gray-800">{s.sku}</td>
                              <td className="px-3 py-2 font-mono text-amber-700 font-semibold">{s.suggested_sku}</td>
                              <td className="px-3 py-2">
                                <span className="inline-block px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs">
                                  {s.reason === 'formato'
                                    ? 'Formato (.0 / ceros / mayúsculas)'
                                    : s.reason === 'variante'
                                    ? 'Variante (sufijo -1 / -2)'
                                    : `Similar${s.similarity ? ` (${Math.round(s.similarity * 100)}%)` : ''}`}
                                </span>
                              </td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  );
                })()}

                {diff.new_candidates && diff.new_candidates.length > 0 && (() => {
                  const items = diff.new_candidates;
                  const allOn = items.every(s => selected[keyFor(batch.id, s.sku)]);
                  const nSel = selectedCount(batch, items);
                  const busy = !!resolving[batch.id];
                  return (
                  <div className="p-4 bg-sky-50 border-t border-sky-200">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <h4 className="text-sm font-bold text-sky-800 flex items-center gap-2">
                        <PlusCircle className="w-4 h-4" />
                        No aparecen en la Maestra — revisa ({items.length})
                      </h4>
                      <button
                        onClick={() => handleResolve(batch, items, 'create')}
                        disabled={nSel === 0 || busy}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                      >
                        <PlusCircle className="w-3.5 h-3.5" />
                        {busy ? '...' : `Crear como nuevos (${nSel})`}
                      </button>
                    </div>
                    <p className="text-xs text-sky-700 mb-3">
                      Estos códigos no existen ni se parecen a nada en la Maestra. No se crean solos: marca los que quieras dar de alta como productos nuevos. Los que no marques quedan sin tocar.
                    </p>
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-sky-200 bg-white">
                      <table className="w-full text-sm">
                        <thead className="bg-sky-100 text-sky-900 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 w-10 text-center">
                              <input type="checkbox" checked={allOn} onChange={() => toggleSelectAll(batch, items)} />
                            </th>
                            <th className="text-left px-3 py-2 font-semibold">Código del origen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((s, i) => {
                            const on = !!selected[keyFor(batch.id, s.sku)];
                            return (
                            <tr key={i} className={`border-t border-sky-100 ${on ? 'bg-sky-50' : ''}`}>
                              <td className="px-3 py-2 text-center">
                                <input type="checkbox" checked={on} onChange={() => toggleSelect(batch.id, s.sku)} />
                              </td>
                              <td className="px-3 py-2 font-mono text-gray-800">{s.sku}</td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  );
                })()}

                {diff.warnings && diff.warnings.length > 0 && (
                  <div className="p-4 bg-yellow-50 border-t border-yellow-100">
                    <h4 className="text-sm font-bold text-yellow-800 flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4" />
                      Advertencias detectadas
                    </h4>
                    <ul className="text-sm text-yellow-700 list-disc list-inside">
                      {diff.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
