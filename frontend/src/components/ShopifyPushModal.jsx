import { useState, useEffect } from 'react';
import { Send, XCircle, CheckCircle2, ChevronDown, ChevronUp, X, Store } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';
const DETAIL_LIMIT = 50;

/**
 * Modal de "enviar a Shopify" con vista previa humana (SKU / campo / antes →
 * después) antes de escribir en la tienda. Mismo espíritu que RunFlowModal
 * (Fuente → Maestra) pero para el push Maestra → Shopify de un
 * ShopifySubscription ya guardado — reusa el mismo endpoint que "Mis Flujos"
 * y "Archivo → Maestra → Shopify" (ambos pegan a /push-now).
 *
 * props:
 *   subId, subName: destino a correr (POST /api/shopify-subscriptions/{subId}/push-now)
 *   onClose(): cerrar sin enviar
 *   onDone(result): tras enviar con éxito (para refrescar la lista de afuera)
 */
export default function ShopifyPushModal({ subId, subName, onClose, onDone }) {
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [showChanges, setShowChanges] = useState(true);
  const [showNotFound, setShowNotFound] = useState(false);

  useEffect(() => { loadPreview(); /* eslint-disable-next-line */ }, []);

  const loadPreview = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch(`${API}/api/shopify-subscriptions/${subId}/push-now?dry_run=true`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.detail || 'No se pudo calcular la vista previa.'); return; }
      setPreview(data);
    } catch (err) {
      setError(err.message || 'Error de conexión.');
    }
    setLoading(false);
  };

  const confirmSend = async () => {
    setSending(true);
    try {
      const res = await fetch(`${API}/api/shopify-subscriptions/${subId}/push-now?dry_run=false`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.detail || 'No se pudo enviar.'); setSending(false); return; }
      setResult(data);
      if (onDone) onDone(data);
    } catch (err) {
      setError(err.message || 'Error de conexión.');
    }
    setSending(false);
  };

  const changes = preview?.changes || [];
  const notFound = preview?.not_found || [];
  const changesTotal = preview?.changes_total ?? changes.length;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Store className="w-5 h-5 text-green-600" /> Enviar a Shopify: {subName}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {loading && <p className="text-gray-500 text-sm py-8 text-center">Calculando vista previa...</p>}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 whitespace-pre-line">{error}</div>
        )}

        {result && (
          <div className={`rounded-xl border p-4 mb-4 ${result.errors?.length > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'}`}>
            <h4 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" /> Enviado a "{result.store}"
            </h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-white p-2 rounded-lg text-center border">
                <p className="text-xs text-gray-500">Precios</p>
                <p className="text-lg font-bold text-blue-700">{result.price_updated || 0}</p>
              </div>
              <div className="bg-white p-2 rounded-lg text-center border">
                <p className="text-xs text-gray-500">Stock</p>
                <p className="text-lg font-bold text-emerald-700">{result.stock_updated || 0}</p>
              </div>
              {result.compare_price_updated > 0 && (
                <div className="bg-white p-2 rounded-lg text-center border">
                  <p className="text-xs text-gray-500">Precio comparativo</p>
                  <p className="text-lg font-bold text-purple-700">{result.compare_price_updated}</p>
                </div>
              )}
              {result.barcode_updated > 0 && (
                <div className="bg-white p-2 rounded-lg text-center border">
                  <p className="text-xs text-gray-500">Códigos de barras</p>
                  <p className="text-lg font-bold text-gray-700">{result.barcode_updated}</p>
                </div>
              )}
              {result.title_updated > 0 && (
                <div className="bg-white p-2 rounded-lg text-center border">
                  <p className="text-xs text-gray-500">Nombres</p>
                  <p className="text-lg font-bold text-indigo-700">{result.title_updated}</p>
                </div>
              )}
              {result.product_type_updated > 0 && (
                <div className="bg-white p-2 rounded-lg text-center border">
                  <p className="text-xs text-gray-500">Categorías</p>
                  <p className="text-lg font-bold text-amber-700">{result.product_type_updated}</p>
                </div>
              )}
            </div>
            {result.errors?.length > 0 && (
              <div className="mt-2 space-y-1">
                {result.errors.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-red-700 bg-red-50 rounded p-2">
                    <XCircle className="w-4 h-4 flex-shrink-0" /> {e}
                  </div>
                ))}
              </div>
            )}
            <button onClick={onClose} className="mt-3 bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-900">Cerrar</button>
          </div>
        )}

        {!loading && preview && !error && !result && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-white p-3 rounded-lg text-center border">
                <p className="text-xs text-gray-500">Se actualizarán</p>
                <p className="text-xl font-bold text-green-700">{preview.matched}</p>
              </div>
              <div className="bg-white p-3 rounded-lg text-center border">
                <p className="text-xs text-gray-500">Origen (Maestra)</p>
                <p className="text-xl font-bold text-gray-700">{preview.total}</p>
              </div>
              <div className="bg-white p-3 rounded-lg text-center border">
                <p className="text-xs text-gray-500">No existen en la tienda</p>
                <p className="text-xl font-bold text-amber-700">{preview.not_found_count}</p>
              </div>
            </div>

            {preview.not_found_count > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3">
                {preview.not_found_count} SKU(s) de la Maestra no existen en esta tienda — NO se crean productos, se ignoran.
              </p>
            )}

            <div className="flex gap-2 flex-wrap mb-2">
              {changes.length > 0 && (
                <button type="button" onClick={() => setShowChanges(v => !v)}
                  className="flex items-center gap-1 text-xs font-medium text-indigo-700 bg-white border border-indigo-200 rounded-lg px-3 py-1.5 hover:bg-indigo-50">
                  {showChanges ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  Ver los {changesTotal} cambio(s)
                </button>
              )}
              {notFound.length > 0 && (
                <button type="button" onClick={() => setShowNotFound(v => !v)}
                  className="flex items-center gap-1 text-xs font-medium text-amber-700 bg-white border border-amber-200 rounded-lg px-3 py-1.5 hover:bg-amber-50">
                  {showNotFound ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  Ver los {preview.not_found_count} sin cruzar
                </button>
              )}
            </div>

            {changes.length === 0 && preview.matched > 0 && (
              <p className="text-xs text-gray-400 mb-3">Los {preview.matched} SKU(s) que cruzan ya tienen estos valores en Shopify — no hay cambios reales para enviar.</p>
            )}

            {showChanges && changes.length > 0 && (
              <div className="mb-4 bg-white border rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-gray-50 text-gray-500 uppercase sticky top-0">
                      <tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Campo</th><th className="px-3 py-2">Antes → Después</th></tr>
                    </thead>
                    <tbody>
                      {changes.slice(0, DETAIL_LIMIT).map((c, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-1.5 font-medium text-gray-700 whitespace-nowrap">{c.sku}</td>
                          <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{c.field}</td>
                          <td className="px-3 py-1.5 text-gray-600"><span className="text-gray-400">{c.before}</span> → <span className="font-medium text-green-700">{c.after}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {changesTotal > DETAIL_LIMIT && (
                  <div className="bg-gray-50 text-center text-xs text-gray-500 p-2 border-t">Mostrando {DETAIL_LIMIT} de {changesTotal}.</div>
                )}
              </div>
            )}

            {showNotFound && notFound.length > 0 && (
              <div className="mb-4 bg-white border rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-48 overflow-y-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-gray-50 text-gray-500 uppercase sticky top-0">
                      <tr><th className="px-3 py-2">SKU (Maestra, no está en la tienda)</th></tr>
                    </thead>
                    <tbody>
                      {notFound.slice(0, DETAIL_LIMIT).map((sku, i) => (
                        <tr key={i} className="border-t"><td className="px-3 py-1.5 font-mono text-gray-700">{sku}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.not_found_count > DETAIL_LIMIT && (
                  <div className="bg-gray-50 text-center text-xs text-gray-500 p-2 border-t">Mostrando {DETAIL_LIMIT} de {preview.not_found_count}.</div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={onClose} className="text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100 text-sm font-medium">Cancelar</button>
              <button onClick={confirmSend} disabled={sending || preview.matched === 0}
                className="bg-green-600 text-white px-5 py-2 rounded-lg font-semibold hover:bg-green-700 text-sm disabled:opacity-50 flex items-center gap-2">
                <Send className="w-4 h-4" /> {sending ? 'Enviando...' : 'Confirmar y enviar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
