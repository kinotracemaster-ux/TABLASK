import { useState, useEffect } from 'react';
import { Send, CheckCircle2, X, Store } from 'lucide-react';
import { ShopifyPushPreviewDetails, ShopifyPushResultSummary } from './ShopifyPushDetails';

const API = import.meta.env.VITE_API_URL || '';

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
            <ShopifyPushResultSummary result={result} />
            <button onClick={onClose} className="mt-3 bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-900">Cerrar</button>
          </div>
        )}

        {!loading && preview && !error && !result && (
          <>
            <ShopifyPushPreviewDetails preview={preview} />

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
