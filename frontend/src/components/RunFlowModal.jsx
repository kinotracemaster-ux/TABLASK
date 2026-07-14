import { useState, useEffect } from 'react';
import { Zap, XCircle, CheckCircle2, ShieldAlert, ChevronDown, ChevronUp, X } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';
const DETAIL_LIMIT = 50;

/**
 * Modal de "correr flujo(s)" con vista previa humana (Guardián/staging expuesto).
 * Reutilizable: recibe uno o varios procesos, los pone en staging, muestra qué
 * va a pasar (nuevas / actualizaciones / lavadero) y recién al confirmar escribe.
 *
 * props:
 *   procs: [{id, name}]  procesos a correr (uno para un flujo, varios para "correr todo")
 *   onClose(): cerrar sin ejecutar
 *   onDone(result): tras ejecutar con éxito (para refrescar la lista de afuera)
 */
export default function RunFlowModal({ procs, onClose, onDone }) {
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [detailTab, setDetailTab] = useState(null); // 'nuevas' | 'actualizaciones' | 'lavadero'

  const multi = procs.length > 1;

  useEffect(() => { stageAll(); /* eslint-disable-next-line */ }, []);

  const stageAll = async () => {
    setLoading(true);
    setResult(null);
    try {
      const previews = await Promise.all(procs.map(async (proc) => {
        try {
          const res = await fetch(`${API}/api/processes/${proc.id}/stage`, { method: 'POST' });
          const data = await res.json();
          if (res.ok) return { name: proc.name, ...data.diff, batch_id: data.batch_id, ok: true };
          return { name: proc.name, ok: false, error: data.detail || 'Error' };
        } catch (err) {
          return { name: proc.name, ok: false, error: err.message };
        }
      }));

      const ok = previews.filter(p => p.ok);
      const totalUpdated = ok.reduce((s, p) => s + (p.rows_to_update || 0), 0);
      const totalAdded = ok.reduce((s, p) => s + (p.rows_to_add || 0), 0);
      const totalOrigin = ok.reduce((s, p) => s + (p.total_origen || 0), 0);
      const batchIds = ok.map(p => p.batch_id);
      const errors = previews.filter(p => !p.ok);

      const newRowsDetail = ok.flatMap(p => (p.new_rows || []).map(r => ({ process: p.name, sku: r.sku, fields: r.fields || {} })));
      const changesDetail = ok.flatMap(p => (p.changes || []).map(c => ({ process: p.name, ...c })));

      const lavCleaned = ok.reduce((s, p) => s + (p.lavadero?.cleaned_count || 0), 0);
      const lavEmpties = ok.reduce((s, p) => s + (p.lavadero?.empties_skipped || 0), 0);
      const lavRejectedCount = ok.reduce((s, p) => s + (p.lavadero?.rejected_count || 0), 0);
      const lavReviewCount = ok.reduce((s, p) => s + (p.lavadero?.review_count || 0), 0);
      const lavHeldDetail = ok.flatMap(p => [
        ...(p.lavadero?.rejected || []).map(r => ({ process: p.name, tipo: 'Rechazado', ...r })),
        ...(p.lavadero?.review || []).map(r => ({ process: p.name, tipo: 'Revisar', ...r })),
      ]);

      setDetailTab(totalAdded > 0 ? 'nuevas' : totalUpdated > 0 ? 'actualizaciones' : lavHeldDetail.length ? 'lavadero' : null);
      setPreview({
        totalUpdated, totalAdded, totalOrigin, batchIds, errors,
        processesOk: ok.length,
        matchPercentage: totalOrigin > 0 ? (totalUpdated / totalOrigin) : 1,
        newRowsDetail, changesDetail,
        lavCleaned, lavEmpties, lavRejectedCount, lavReviewCount, lavHeldDetail,
      });
    } catch (err) {
      setPreview({ error: err.message });
    }
    setLoading(false);
  };

  const confirmRun = async () => {
    if (!preview?.batchIds?.length) return;
    setExecuting(true);
    try {
      const res = await fetch(`${API}/api/staging/execute-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_ids: preview.batchIds }),
      });
      const data = await res.json();
      setResult(data);
      if (res.ok && onDone) onDone(data);
    } catch (err) {
      setResult({ message: 'Fallo de conexión: ' + err.message, errors: [{ process: 'Red', error: err.message }] });
    }
    setExecuting(false);
  };

  const title = multi ? `Correr ${procs.length} flujos` : `Correr flujo: ${procs[0]?.name}`;
  const lowMatchBlocked = preview && preview.matchPercentage < 0.1 && preview.totalAdded > 0 && !acknowledged;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2"><Zap className="w-5 h-5 text-green-600" /> {title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {loading && <p className="text-gray-500 text-sm py-8 text-center">Calculando vista previa...</p>}

        {!loading && preview?.error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{preview.error}</div>
        )}

        {/* ── Resultado tras ejecutar ── */}
        {result && (
          <div className={`rounded-xl border p-4 mb-4 ${result.errors?.length > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'}`}>
            <h4 className="font-semibold text-gray-800 mb-2 flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-green-600" /> {result.message}</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-white p-2 rounded-lg text-center border">
                <p className="text-xs text-gray-500">Filas actualizadas</p>
                <p className="text-lg font-bold text-blue-700">{result.summary?.rows_updated || 0}</p>
              </div>
              <div className="bg-white p-2 rounded-lg text-center border">
                <p className="text-xs text-gray-500">Filas nuevas</p>
                <p className="text-lg font-bold text-emerald-700">{result.summary?.rows_added || 0}</p>
              </div>
            </div>
            {result.errors?.length > 0 && (
              <div className="mt-2 space-y-1">
                {result.errors.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-red-700 bg-red-50 rounded p-2">
                    <XCircle className="w-4 h-4 flex-shrink-0" /> <span className="font-medium">{e.process}:</span> {e.error}
                  </div>
                ))}
              </div>
            )}
            <button onClick={onClose} className="mt-3 bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-900">Cerrar</button>
          </div>
        )}

        {/* ── Vista previa (antes de ejecutar) ── */}
        {!loading && preview && !preview.error && !result && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-white p-3 rounded-lg text-center border">
                <p className="text-xs text-gray-500">Filas nuevas</p>
                <p className="text-xl font-bold text-emerald-700">{preview.totalAdded}</p>
              </div>
              <div className="bg-white p-3 rounded-lg text-center border">
                <p className="text-xs text-gray-500">Actualizaciones</p>
                <p className="text-xl font-bold text-blue-700">{preview.totalUpdated}</p>
              </div>
              <div className="bg-white p-3 rounded-lg text-center border">
                <p className="text-xs text-gray-500">Origen</p>
                <p className="text-xl font-bold text-gray-700">{preview.totalOrigin}</p>
              </div>
            </div>

            {/* Detalle: filas/campos concretos */}
            {(preview.totalAdded > 0 || preview.totalUpdated > 0) && (
              <div className="mb-4">
                <div className="flex gap-2 flex-wrap">
                  {preview.totalAdded > 0 && (
                    <button type="button" onClick={() => setDetailTab(detailTab === 'nuevas' ? null : 'nuevas')}
                      className="flex items-center gap-1 text-xs font-medium text-indigo-700 bg-white border border-indigo-200 rounded-lg px-3 py-1.5 hover:bg-indigo-50">
                      {detailTab === 'nuevas' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      Ver las {preview.totalAdded} fila(s) nueva(s)
                    </button>
                  )}
                  {preview.totalUpdated > 0 && (
                    <button type="button" onClick={() => setDetailTab(detailTab === 'actualizaciones' ? null : 'actualizaciones')}
                      className="flex items-center gap-1 text-xs font-medium text-indigo-700 bg-white border border-indigo-200 rounded-lg px-3 py-1.5 hover:bg-indigo-50">
                      {detailTab === 'actualizaciones' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      Ver las {preview.totalUpdated} actualización(es)
                    </button>
                  )}
                </div>

                {detailTab === 'nuevas' && (
                  <div className="mt-2 bg-white border rounded-lg overflow-hidden">
                    <div className="overflow-x-auto max-h-64 overflow-y-auto">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-gray-50 text-gray-500 uppercase sticky top-0">
                          <tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Campos a cargar</th>{multi && <th className="px-3 py-2">Fuente</th>}</tr>
                        </thead>
                        <tbody>
                          {preview.newRowsDetail.slice(0, DETAIL_LIMIT).map((r, i) => (
                            <tr key={i} className="border-t">
                              <td className="px-3 py-1.5 font-medium text-gray-700 whitespace-nowrap">{r.sku}</td>
                              <td className="px-3 py-1.5 text-gray-600">{Object.entries(r.fields).filter(([, v]) => v !== r.sku).map(([k, v]) => `${k}: ${v || '-'}`).join(' · ')}</td>
                              {multi && <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">{r.process}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {preview.newRowsDetail.length > DETAIL_LIMIT && <div className="bg-gray-50 text-center text-xs text-gray-500 p-2 border-t">Mostrando {DETAIL_LIMIT} de {preview.newRowsDetail.length}.</div>}
                  </div>
                )}

                {detailTab === 'actualizaciones' && (
                  <div className="mt-2 bg-white border rounded-lg overflow-hidden">
                    <div className="overflow-x-auto max-h-64 overflow-y-auto">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-gray-50 text-gray-500 uppercase sticky top-0">
                          <tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Campo</th><th className="px-3 py-2">Antes → Después</th>{multi && <th className="px-3 py-2">Fuente</th>}</tr>
                        </thead>
                        <tbody>
                          {preview.changesDetail.slice(0, DETAIL_LIMIT).map((c, i) => (
                            <tr key={i} className="border-t">
                              <td className="px-3 py-1.5 font-medium text-gray-700 whitespace-nowrap">{c.sku}</td>
                              <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{c.field}</td>
                              <td className="px-3 py-1.5 text-gray-600"><span className="text-gray-400">{c.old || '-'}</span> → <span className="font-medium text-blue-700">{c.new || '-'}</span></td>
                              {multi && <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">{c.process}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {preview.changesDetail.length > DETAIL_LIMIT && <div className="bg-gray-50 text-center text-xs text-gray-500 p-2 border-t">Mostrando {DETAIL_LIMIT} de {preview.changesDetail.length}.</div>}
                  </div>
                )}
              </div>
            )}

            {/* Lavadero */}
            {(preview.lavCleaned > 0 || preview.lavRejectedCount > 0 || preview.lavReviewCount > 0 || preview.lavEmpties > 0) && (
              <div className="mb-4">
                <div className={`rounded-lg border p-3 text-sm ${(preview.lavRejectedCount > 0 || preview.lavReviewCount > 0) ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-white border-indigo-100 text-gray-600'}`}>
                  <span className="font-medium">🧼 Lavadero:</span>{' '}
                  {preview.lavCleaned > 0 && <span>{preview.lavCleaned} limpiado(s)</span>}
                  {preview.lavCleaned > 0 && (preview.lavRejectedCount > 0 || preview.lavReviewCount > 0 || preview.lavEmpties > 0) && ' · '}
                  {preview.lavRejectedCount > 0 && <span className="font-medium">{preview.lavRejectedCount} rechazado(s)</span>}
                  {preview.lavRejectedCount > 0 && (preview.lavReviewCount > 0 || preview.lavEmpties > 0) && ' · '}
                  {preview.lavReviewCount > 0 && <span className="font-medium">{preview.lavReviewCount} para revisar</span>}
                  {preview.lavReviewCount > 0 && preview.lavEmpties > 0 && ' · '}
                  {preview.lavEmpties > 0 && <span>{preview.lavEmpties} vacío(s) que no pisaron datos</span>}
                  {(preview.lavRejectedCount > 0 || preview.lavReviewCount > 0) && <span className="block text-xs mt-1 opacity-80">Los valores retenidos NO se escriben: la Maestra conserva lo que tiene.</span>}
                </div>
                {preview.lavHeldDetail.length > 0 && (
                  <>
                    <button type="button" onClick={() => setDetailTab(detailTab === 'lavadero' ? null : 'lavadero')}
                      className="mt-2 flex items-center gap-1 text-xs font-medium text-amber-700 bg-white border border-amber-200 rounded-lg px-3 py-1.5 hover:bg-amber-50">
                      {detailTab === 'lavadero' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      Ver los {preview.lavHeldDetail.length} valor(es) retenido(s)
                    </button>
                    {detailTab === 'lavadero' && (
                      <div className="mt-2 bg-white border rounded-lg overflow-hidden">
                        <div className="overflow-x-auto max-h-64 overflow-y-auto">
                          <table className="w-full text-xs text-left">
                            <thead className="bg-gray-50 text-gray-500 uppercase sticky top-0">
                              <tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Campo</th><th className="px-3 py-2">Valor recibido</th><th className="px-3 py-2">Motivo</th>{multi && <th className="px-3 py-2">Fuente</th>}</tr>
                            </thead>
                            <tbody>
                              {preview.lavHeldDetail.slice(0, DETAIL_LIMIT).map((r, i) => (
                                <tr key={i} className="border-t">
                                  <td className="px-3 py-1.5 font-medium text-gray-700 whitespace-nowrap">{r.sku}</td>
                                  <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{r.field}</td>
                                  <td className="px-3 py-1.5 text-gray-600 font-mono">{r.value || '-'}</td>
                                  <td className="px-3 py-1.5"><span className={`px-1.5 py-0.5 rounded text-[11px] font-medium mr-1 ${r.tipo === 'Rechazado' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{r.tipo}</span><span className="text-gray-600">{r.reason}</span></td>
                                  {multi && <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">{r.process}</td>}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {preview.lavHeldDetail.length > DETAIL_LIMIT && <div className="bg-gray-50 text-center text-xs text-gray-500 p-2 border-t">Mostrando {DETAIL_LIMIT} de {preview.lavHeldDetail.length}.</div>}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Errores de staging */}
            {preview.errors.length > 0 && (
              <div className="mb-3 space-y-1">
                {preview.errors.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-red-700 bg-red-50 rounded p-2">
                    <XCircle className="w-4 h-4 flex-shrink-0" /> <span className="font-medium">{e.name}:</span> {e.error}
                  </div>
                ))}
              </div>
            )}

            {/* Warning de baja coincidencia */}
            {preview.matchPercentage < 0.1 && preview.totalAdded > 0 && (
              <div className="mb-4 p-4 bg-orange-50 border border-orange-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="text-sm font-bold text-orange-800">Advertencia: baja coincidencia de SKUs</h4>
                    <p className="text-sm text-orange-700 mt-1">Menos del 10% de los productos del origen existen en la Maestra. Se van a agregar <strong>{preview.totalAdded} filas nuevas</strong>, lo que podría indicar un formato incorrecto en la columna SKU.</p>
                    <label className="flex items-center gap-2 mt-3 cursor-pointer">
                      <input type="checkbox" className="rounded border-orange-300 text-orange-600 focus:ring-orange-500 w-4 h-4" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />
                      <span className="text-sm font-medium text-orange-900">Entiendo que se agregarán como productos nuevos y el SKU es correcto</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={onClose} className="text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100 text-sm font-medium">Cancelar</button>
              <button onClick={confirmRun} disabled={executing || !preview.batchIds.length || lowMatchBlocked}
                className="bg-green-600 text-white px-5 py-2 rounded-lg font-semibold hover:bg-green-700 text-sm disabled:opacity-50 flex items-center gap-2">
                <Zap className="w-4 h-4" /> {executing ? 'Ejecutando...' : 'Confirmar y ejecutar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
