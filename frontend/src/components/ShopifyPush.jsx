import { useState, useEffect } from 'react';
import { Upload, Store, Eye, Send, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { formatError } from '../utils/errors';

const API = import.meta.env.VITE_API_URL || '';

export default function ShopifyPush() {
  const [shopConns, setShopConns] = useState([]);
  const [masterConnId, setMasterConnId] = useState(null);
  const [sheets, setSheets] = useState({}); // {tab: [columns]}
  const [loading, setLoading] = useState(true);

  const [shopId, setShopId] = useState('');
  const [tab, setTab] = useState('');
  const [skuCol, setSkuCol] = useState('');
  const [priceCol, setPriceCol] = useState('');
  const [stockCol, setStockCol] = useState('');
  const [locations, setLocations] = useState([]);
  const [locId, setLocId] = useState('');
  const [locError, setLocError] = useState(null);

  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [connsRes, projsRes] = await Promise.all([
        fetch(`${API}/api/connections/`),
        fetch(`${API}/api/projects/`),
      ]);
      const conns = await connsRes.json();
      setShopConns(conns.filter(c => c.connection_type === 'shopify'));

      const projs = await projsRes.json();
      const mc = projs.find(p => p.master_connection_id)?.master_connection_id;
      if (mc) {
        setMasterConnId(mc);
        const mRes = await fetch(`${API}/api/connections/${mc}/metadata`);
        const mData = await mRes.json();
        setSheets(mData.sheets || {});
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const cols = tab && sheets[tab] ? sheets[tab] : [];

  // Cargar ubicaciones al elegir tienda (para el stock).
  useEffect(() => {
    setLocations([]); setLocId(''); setLocError(null);
    if (!shopId) return;
    fetch(`${API}/api/shopify/locations?connection_id=${shopId}`)
      .then(async r => {
        const d = await r.json();
        if (!r.ok) { setLocError(formatError(d)); return; }
        setLocations(d.locations || []);
        // Si solo hay una, se elige sola.
        if ((d.locations || []).length === 1) setLocId(d.locations[0].id);
      })
      .catch(e => setLocError(e.message));
  }, [shopId]);

  const run = async (dryRun) => {
    setError(null); setResult(null); setPreview(null);
    if (!shopId || !tab || !skuCol) { setError('Elige tienda, hoja y columna SKU.'); return; }
    if (!priceCol && !stockCol) { setError('Mapea al menos Precio o Stock.'); return; }
    // Solo exigimos elegir ubicación si hay VARIAS. Con una sola (o si no se pudieron
    // listar por falta de read_locations), el backend resuelve la única ubicación.
    if (stockCol && locations.length > 1 && !locId) {
      setError('Tu tienda tiene varias bodegas: elige la ubicación destino del stock.'); return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/shopify/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopify_connection_id: parseInt(shopId),
          source_connection_id: masterConnId,
          source_sheet_name: tab,
          sku_column: skuCol,
          price_column: priceCol || null,
          stock_column: stockCol || null,
          location_id: locId || null,
          dry_run: dryRun,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(formatError(data)); return; }
      if (dryRun) setPreview(data); else setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando…</div>;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Upload className="w-6 h-6 text-green-600" /> Enviar a Shopify
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Toma una hoja (tab) de la Maestra y actualiza <b>precio</b> y/o <b>stock</b> en una tienda Shopify, cruzando por SKU.
        </p>
      </div>

      {shopConns.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 flex gap-2">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          No hay conexiones Shopify. Crea una en <b>Conexiones → Shopify</b> primero.
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
          {/* Tienda */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
              <Store className="w-4 h-4" /> Tienda Shopify (destino)
            </label>
            <select value={shopId} onChange={e => setShopId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
              <option value="">Seleccionar tienda…</option>
              {shopConns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.shopify_domain})</option>)}
            </select>
          </div>

          {/* Ubicación (para stock) */}
          {shopId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Ubicación / Bodega (para el stock)
              </label>
              {locError ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-800">
                  {locError}
                  <div className="mt-1 text-amber-700">
                    Si tu tienda tiene <b>una sola</b> ubicación, igual puedo escribir el stock.
                    Si tiene varias, agrega <b>read_locations</b> para elegir la correcta.
                  </div>
                </div>
              ) : (
                <select value={locId} onChange={e => setLocId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                  <option value="">Seleccionar ubicación…</option>
                  {locations.map(l => (
                    <option key={l.id} value={l.id}>{l.name}{l.active === false ? ' (inactiva)' : ''}</option>
                  ))}
                </select>
              )}
              <p className="text-xs text-gray-500 mt-1">
                El stock se <b>sobrescribe</b> en esta ubicación. Elige la bodega donde manejas el inventario real.
              </p>
            </div>
          )}

          {/* Hoja origen */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Hoja origen (tab de la Maestra)</label>
            <select value={tab} onChange={e => { setTab(e.target.value); setSkuCol(''); setPriceCol(''); setStockCol(''); }}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
              <option value="">Seleccionar hoja…</option>
              {Object.keys(sheets).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Columnas */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">🔑 Columna SKU</label>
              <select value={skuCol} onChange={e => setSkuCol(e.target.value)} disabled={!cols.length}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                <option value="">—</option>
                {cols.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Precio (opcional)</label>
              <select value={priceCol} onChange={e => setPriceCol(e.target.value)} disabled={!cols.length}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                <option value="">— no enviar —</option>
                {cols.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Stock (opcional)</label>
              <select value={stockCol} onChange={e => setStockCol(e.target.value)} disabled={!cols.length}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                <option value="">— no enviar —</option>
                {cols.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Acciones */}
          <div className="flex gap-2 pt-2">
            <button onClick={() => run(true)} disabled={busy}
              className="flex items-center gap-2 border border-green-300 text-green-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-50 disabled:opacity-50">
              <Eye className="w-4 h-4" /> {busy ? 'Calculando…' : 'Previsualizar (no escribe)'}
            </button>
            <button onClick={() => { if (window.confirm('Esto ESCRIBIRÁ precio/stock en la tienda Shopify. ¿Continuar?')) run(false); }}
              disabled={busy || !preview}
              title={!preview ? 'Previsualiza primero' : ''}
              className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
              <Send className="w-4 h-4" /> Enviar a Shopify
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex gap-2">
              <XCircle className="w-4 h-4 shrink-0" /> <span className="break-words">{error}</span>
            </div>
          )}

          {preview && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-gray-700 mb-2">Previsualización (cruce por SKU)</p>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-white rounded-lg border p-2">
                  <p className="text-xs text-gray-500">Filas en la hoja</p>
                  <p className="text-lg font-bold">{preview.total}</p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-2">
                  <p className="text-xs text-green-600">Cruzan (se actualizarán)</p>
                  <p className="text-lg font-bold text-green-700">{preview.matched}</p>
                </div>
                <div className={`rounded-lg border p-2 ${preview.not_found_count ? 'bg-amber-50 border-amber-200' : 'bg-white'}`}>
                  <p className="text-xs text-amber-600">No están en Shopify</p>
                  <p className="text-lg font-bold text-amber-700">{preview.not_found_count}</p>
                </div>
              </div>
              {preview.not_found_count > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-amber-700 mb-1">SKU sin cruzar (no existen en esa tienda):</p>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {preview.not_found.map((s, i) => (
                      <span key={i} className="bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded font-mono">{s || '(vacío)'}</span>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-gray-500 mt-3">Si los números se ven bien, pulsa <b>Enviar a Shopify</b>.</p>
            </div>
          )}

          {result && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
              <div className="flex items-center gap-2 font-semibold mb-1">
                <CheckCircle2 className="w-4 h-4" /> Enviado a {result.store}
              </div>
              <p>✅ Precios actualizados: <b>{result.price_updated}</b></p>
              <p>✅ Stock actualizado: <b>{result.stock_updated}</b></p>
              {result.not_found_count > 0 && <p className="text-amber-700">⚠️ Sin cruzar: {result.not_found_count}</p>}
              {result.errors?.length > 0 && (
                <div className="mt-2 text-red-700">
                  <p className="font-semibold">Errores:</p>
                  {result.errors.map((e, i) => <p key={i} className="text-xs">• {e}</p>)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
