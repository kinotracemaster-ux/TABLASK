import { useState, useEffect } from 'react';
import { Store, RefreshCw, Save, CheckCircle2, AlertTriangle, Eye, Send } from 'lucide-react';
import { extractError, formatError } from '../utils/errors';

const API = import.meta.env.VITE_API_URL || '';

export default function ShopifyMasterSync() {
  const [loading, setLoading] = useState(true);
  const [shopConns, setShopConns] = useState([]);
  const [masterCols, setMasterCols] = useState([]);

  const [connectionId, setConnectionId] = useState('');
  const [skuCol, setSkuCol] = useState('');
  const [priceCol, setPriceCol] = useState('');
  const [stockCol, setStockCol] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [lastSummary, setLastSummary] = useState(null);
  const [savingConfig, setSavingConfig] = useState(false);

  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [connsRes, colsRes, configRes] = await Promise.all([
        fetch(`${API}/api/connections/`),
        fetch(`${API}/api/master-columns`),
        fetch(`${API}/api/shopify-master-sync/config`),
      ]);
      const conns = await connsRes.json();
      setShopConns(conns.filter(c => c.connection_type === 'shopify'));
      const cols = await colsRes.json();
      setMasterCols(colsRes.ok && Array.isArray(cols) ? cols : []);
      const config = await configRes.json();
      if (configRes.ok) {
        setConnectionId(config.connection_id ? String(config.connection_id) : '');
        setSkuCol(config.sku_column_master || '');
        setPriceCol(config.price_column_master || '');
        setStockCol(config.stock_column_master || '');
        setLastSyncedAt(config.last_synced_at || null);
        try { setLastSummary(config.last_sync_summary ? JSON.parse(config.last_sync_summary) : null); }
        catch { setLastSummary(null); }
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const saveConfig = async (e) => {
    e.preventDefault();
    if (!connectionId || !skuCol) { alert('Elegí la tienda Shopify y la columna SKU de la Maestra.'); return; }
    if (!priceCol && !stockCol) { alert('Mapeá al menos Precio o Stock.'); return; }
    setSavingConfig(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/shopify-master-sync/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connection_id: parseInt(connectionId),
          sku_column_master: skuCol,
          price_column_master: priceCol || null,
          stock_column_master: stockCol || null,
        })
      });
      if (!res.ok) throw new Error(await extractError(res));
      setPreview(null);
    } catch (err) { alert(err.message || 'No se pudo guardar la configuración.'); }
    setSavingConfig(false);
  };

  const runPreview = async () => {
    setError(null);
    setPreview(null);
    setPreviewing(true);
    try {
      const res = await fetch(`${API}/api/shopify-master-sync/preview`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(formatError(data)); return; }
      setPreview(data);
    } catch (err) { setError('No se pudo calcular la sincronización.'); }
    setPreviewing(false);
  };

  const runApply = async () => {
    if (!window.confirm('Esto va a ESCRIBIR precio/stock en la Tabla Maestra. ¿Continuar?')) return;
    setApplying(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/shopify-master-sync/apply`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(formatError(data)); return; }
      setLastSummary(data);
      setLastSyncedAt(new Date().toISOString());
      setPreview(null);
    } catch (err) { setError('No se pudo aplicar la sincronización.'); }
    setApplying(false);
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando...</div>;

  const configReady = connectionId && skuCol && (priceCol || stockCol);

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Store className="w-6 h-6 text-green-600" /> Shopify → Maestra
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Módulo independiente: trae precio y stock desde Shopify y actualiza los SKU que ya existen en la Tabla Maestra. No crea productos nuevos.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Configuración</h2>

        {shopConns.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Todavía no conectaste ninguna tienda Shopify. Conectá una desde "+ Nueva Fuente" (elegí Shopify como origen) y volvé acá.
          </div>
        ) : (
          <form onSubmit={saveConfig} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tienda Shopify</label>
              <select value={connectionId} onChange={e => setConnectionId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white max-w-sm">
                <option value="">Seleccionar...</option>
                {shopConns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.shopify_domain})</option>)}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">🔑 SKU (Maestra)</label>
                <select value={skuCol} onChange={e => setSkuCol(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                  <option value="">Seleccionar...</option>
                  {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Precio (Maestra)</label>
                <select value={priceCol} onChange={e => setPriceCol(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                  <option value="">— no actualizar —</option>
                  {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Stock (Maestra)</label>
                <select value={stockCol} onChange={e => setStockCol(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                  <option value="">— no actualizar —</option>
                  {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <button type="submit" disabled={savingConfig}
              className="flex items-center gap-2 bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-900 disabled:opacity-50">
              <Save className="w-4 h-4" /> {savingConfig ? 'Guardando...' : 'Guardar configuración'}
            </button>
          </form>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Sincronizar</h2>
        <p className="text-xs text-gray-500 mb-4">
          {lastSyncedAt
            ? `Última sincronización: ${new Date(lastSyncedAt).toLocaleString()}${lastSummary ? ` · ${lastSummary.updated} actualizados, ${lastSummary.not_found_count} sin cruzar` : ''}`
            : 'Todavía no se sincronizó nunca.'}
        </p>

        <div className="flex gap-2">
          <button onClick={runPreview} disabled={!configReady || previewing}
            className="flex items-center gap-2 border border-green-300 text-green-700 px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-green-50 disabled:opacity-50">
            <Eye className="w-4 h-4" /> {previewing ? 'Calculando...' : 'Previsualizar'}
          </button>
          <button onClick={runApply} disabled={!preview || applying}
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            <Send className="w-4 h-4" /> {applying ? 'Sincronizando...' : 'Sincronizar ahora'}
          </button>
        </div>

        {!configReady && <p className="text-xs text-gray-400 mt-2">Completá la configuración de arriba primero.</p>}

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 whitespace-pre-line">
            {error}
          </div>
        )}

        {preview && (
          <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm space-y-1">
            <p className="flex items-center gap-2 text-green-700 font-medium">
              <CheckCircle2 className="w-4 h-4" /> {preview.updated} SKU con cambios de precio/stock
            </p>
            <p className="text-gray-600">{preview.unchanged} sin cambios · {preview.total_master} en la Maestra ({preview.store})</p>
            {preview.not_found_count > 0 && (
              <p className="text-amber-700">⚠ {preview.not_found_count} SKU de la Maestra no se encontraron en Shopify (no se tocan).</p>
            )}
            {preview.updated === 0 && (
              <p className="text-gray-500 mt-2">No hay cambios para aplicar.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
