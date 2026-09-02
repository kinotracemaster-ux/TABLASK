import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { UploadCloud, Database, Store, ArrowRight, ChevronRight, CheckCircle2, AlertTriangle, Send, Save, Zap, FileDown, XCircle } from 'lucide-react';
import { extractError, formatError } from '../utils/errors';
import RunFlowModal from './RunFlowModal';
import ShopifyPushModal from './ShopifyPushModal';

const API = import.meta.env.VITE_API_URL || '';
const ALLOWED_FILE_EXT = ['.csv', '.xls', '.xlsx'];

// Insignia numerada de cada etapa del camino.
function StepBadge({ n, done, active }) {
  return (
    <span className={`flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold flex-shrink-0 ${
      done ? 'bg-green-600 text-white' : active ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'
    }`}>
      {done ? <CheckCircle2 className="w-4 h-4" /> : n}
    </span>
  );
}

/**
 * Página dedicada al flujo principal (subida): Archivo → Maestra → Shopify.
 * Tres tarjetas apiladas, al estilo del módulo "Shopify → Maestra":
 *   1) Archivo   — subir/elegir el archivo y confirmar el mapeo a la Maestra (crea la Fuente).
 *   2) Maestra   — correr: escribe el archivo en la Maestra (con vista previa).
 *   3) Shopify   — configurar el destino y enviar precio/stock a la tienda.
 * Reusa los endpoints existentes; no agrega lógica de backend.
 */
export default function FileToShopify() {
  const [loading, setLoading] = useState(true);

  // Maestra global
  const [masterConnId, setMasterConnId] = useState(null);
  const [masterSheetName, setMasterSheetName] = useState(null);
  const [masterSkuDefault, setMasterSkuDefault] = useState('');
  const [masterCols, setMasterCols] = useState([]);
  const [masterRows, setMasterRows] = useState(null);

  // ── Etapa 1: Archivo ──
  const [connections, setConnections] = useState([]);
  const [fileMode, setFileMode] = useState('new');       // 'new' | 'existing'
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [fileDragActive, setFileDragActive] = useState(false);
  const [existingFileConnId, setExistingFileConnId] = useState('');
  const [sourceConn, setSourceConn] = useState(null);
  const [sourceSheets, setSourceSheets] = useState({});
  const [sourceSheet, setSourceSheet] = useState('');
  const [skuColSource, setSkuColSource] = useState('');
  const [masterSkuCol, setMasterSkuCol] = useState('');
  const [mappings, setMappings] = useState([{ src: '', dst: '' }]);
  const [loadingSource, setLoadingSource] = useState(false);
  const [savingProcess, setSavingProcess] = useState(false);
  const [processId, setProcessId] = useState(null);
  const [processName, setProcessName] = useState('');

  // ── Etapa 2: Maestra (correr) ──
  const [runProc, setRunProc] = useState(null);
  const [masterUpdated, setMasterUpdated] = useState(false);

  // ── Etapa 3: Shopify ──
  const [shopConnId, setShopConnId] = useState('');
  const [shopPriceCol, setShopPriceCol] = useState('');
  const [shopStockCol, setShopStockCol] = useState('');
  const [shopCompareCol, setShopCompareCol] = useState('');
  const [shopBarcodeCol, setShopBarcodeCol] = useState('');
  const [shopTitleCol, setShopTitleCol] = useState('');
  const [shopProductTypeCol, setShopProductTypeCol] = useState('');
  const [shopLocations, setShopLocations] = useState([]);
  const [shopLocId, setShopLocId] = useState('');
  const [shopLocError, setShopLocError] = useState(null);
  const [shopDestName, setShopDestName] = useState('');
  const [shopSubId, setShopSubId] = useState(null);
  const [savingShopSub, setSavingShopSub] = useState(false);
  const [shopError, setShopError] = useState(null);
  const [shopPushOpen, setShopPushOpen] = useState(false);
  const [shopSent, setShopSent] = useState(false);

  const sourceCols = sourceSheet && sourceSheets[sourceSheet] ? sourceSheets[sourceSheet] : [];
  const fileConns = connections.filter(c => c.connection_type === 'local_file');
  const shopConns = connections.filter(c => c.connection_type === 'shopify');

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [masterRes, colsRes, connsRes] = await Promise.all([
        fetch(`${API}/api/master`),
        fetch(`${API}/api/master-columns`),
        fetch(`${API}/api/connections/`),
      ]);
      const m = await masterRes.json();
      if (masterRes.ok) {
        setMasterConnId(m.master_connection_id || null);
        setMasterSheetName(m.master_sheet_name || null);
        setMasterSkuDefault(m.master_sku_column || '');
        setMasterRows(m.total_rows ?? null);
      }
      const cols = await colsRes.json();
      setMasterCols(colsRes.ok && Array.isArray(cols) ? cols : []);
      const conns = await connsRes.json();
      setConnections(Array.isArray(conns) ? conns : []);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  // ── Etapa 1 ──
  const pickFile = (candidate) => {
    if (!candidate) return;
    const ext = candidate.name.slice(candidate.name.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED_FILE_EXT.includes(ext)) {
      setFile(null);
      setFileError(`Formato no soportado (${ext || 'sin extensión'}). Usá .csv, .xls o .xlsx.`);
      return;
    }
    setFileError('');
    setFile(candidate);
  };

  const autoDetect = async (connId, sheetName, headers) => {
    try {
      const [skuRes, mapRes] = await Promise.all([
        fetch(`${API}/api/intelligence/suggest-sku?connection_id=${connId}&sheet_name=${encodeURIComponent(sheetName)}`),
        fetch(`${API}/api/intelligence/auto-map`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_headers: headers, target_headers: masterCols }),
        }),
      ]);
      const skuData = await skuRes.json();
      const mapping = (await mapRes.json()).mapping || {};
      const suggestedSku = skuData.suggested_sku || headers[0] || '';
      setSkuColSource(suggestedSku);

      // Si la Maestra no tiene SKU configurado, reaprovechamos el match
      // exacto/semántico que el auto-mapeo ya encontró (ej. "sku" -> "SKU").
      const guessedMasterSku = mapping[suggestedSku];
      setMasterSkuCol(masterSkuDefault || (guessedMasterSku && masterCols.includes(guessedMasterSku) ? guessedMasterSku : ''));

      const mapped = Object.entries(mapping)
        .filter(([src]) => src !== suggestedSku)
        .map(([src, dst]) => ({ src, dst }));
      setMappings(mapped.length > 0 ? mapped : [{ src: '', dst: '' }]);
    } catch (err) { console.error('Auto-detect falló', err); }
  };

  const loadSourceMeta = async (conn) => {
    setSourceConn(conn);
    setProcessId(null);
    setMasterUpdated(false);
    setProcessName(`Traer ${conn.name} → Maestra`);
    setLoadingSource(true);
    try {
      const metaRes = await fetch(`${API}/api/connections/${conn.id}/metadata`);
      const meta = await metaRes.json();
      if (!metaRes.ok) throw new Error(meta.detail || 'No se pudo leer el archivo.');
      const sheets = meta.sheets || {};
      setSourceSheets(sheets);
      const first = Object.keys(sheets)[0] || '';
      setSourceSheet(first);
      if (first && sheets[first]) await autoDetect(conn.id, first, sheets[first]);
    } catch (err) { alert(err.message); }
    setLoadingSource(false);
  };

  const handleSheetChange = async (sheetName) => {
    setSourceSheet(sheetName);
    await autoDetect(sourceConn.id, sheetName, sourceSheets[sheetName] || []);
  };

  // Sube el archivo (o usa uno existente) y carga columnas + auto-mapeo.
  const prepareSource = async () => {
    setLoadingSource(true);
    try {
      let conn;
      if (fileMode === 'existing') {
        conn = fileConns.find(c => String(c.id) === String(existingFileConnId));
        if (!conn) { alert('Elegí un archivo ya subido.'); setLoadingSource(false); return; }
      } else {
        if (!file) { alert('Elegí un archivo primero.'); setLoadingSource(false); return; }
        const form = new FormData();
        form.append('name', file.name);
        form.append('file', file);
        const res = await fetch(`${API}/api/connections/upload`, { method: 'POST', body: form });
        if (!res.ok) throw new Error(await extractError(res));
        conn = await res.json();
        setConnections(prev => [...prev, conn]);
      }
      await loadSourceMeta(conn);
    } catch (err) {
      alert(err.message || 'No se pudo preparar el archivo.');
      setLoadingSource(false);
    }
  };

  const saveProcess = async () => {
    const map = {};
    mappings.forEach(({ src, dst }) => { if (src && dst) map[src] = dst; });
    if (!skuColSource || !masterSkuCol) { alert('Confirmá la columna SKU (archivo y Maestra).'); return; }
    if (Object.keys(map).length === 0) { alert('Agregá al menos un campo (precio, stock, nombre...).'); return; }
    setSavingProcess(true);
    try {
      const res = await fetch(`${API}/api/processes/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: processName || `Traer ${sourceConn.name} → Maestra`,
          source_connection_id: sourceConn.id,
          source_sheet_name: sourceSheet,
          sku_column_source: skuColSource,
          sku_column_master: masterSkuCol,
          field_mappings: map,
          ...(masterConnId && masterSheetName ? { target_connection_id: masterConnId, target_sheet_name: masterSheetName } : {}),
          add_new_rows: true,
          is_active: true,
        }),
      });
      if (!res.ok) throw new Error(await extractError(res));
      const created = await res.json();
      setProcessId(created.id);
      setProcessName(created.name);
    } catch (err) { alert(err.message || 'No se pudo guardar.'); }
    setSavingProcess(false);
  };

  // ── Etapa 3: Shopify ──
  useEffect(() => {
    setShopLocations([]); setShopLocId(''); setShopLocError(null);
    if (!shopConnId) return;
    fetch(`${API}/api/shopify/locations?connection_id=${shopConnId}`)
      .then(async r => {
        const d = await r.json();
        if (!r.ok) { setShopLocError(formatError(d)); return; }
        setShopLocations(d.locations || []);
        if ((d.locations || []).length === 1) setShopLocId(d.locations[0].id);
      })
      .catch(e => setShopLocError(e.message));
  }, [shopConnId]);

  const saveShopSub = async () => {
    setShopError(null);
    if (!shopConnId) { setShopError('Elegí la tienda Shopify.'); return; }
    if (!shopPriceCol && !shopStockCol && !shopCompareCol && !shopBarcodeCol && !shopTitleCol && !shopProductTypeCol) { setShopError('Mapeá al menos un campo (precio, stock, precio comparativo, código de barras, nombre o categoría).'); return; }
    if (shopStockCol && shopLocations.length > 1 && !shopLocId) {
      setShopError('Tu tienda tiene varias bodegas: elegí la ubicación destino del stock.'); return;
    }
    setSavingShopSub(true);
    try {
      const store = shopConns.find(c => String(c.id) === String(shopConnId));
      const body = {
        name: shopDestName || `Shopify · ${store?.name || store?.shopify_domain || 'tienda'}`,
        connection_id: parseInt(shopConnId),
        price_column_master: shopPriceCol || null,
        stock_column_master: shopStockCol || null,
        compare_price_column_master: shopCompareCol || null,
        barcode_column_master: shopBarcodeCol || null,
        title_column_master: shopTitleCol || null,
        product_type_column_master: shopProductTypeCol || null,
        location_id: shopLocId || null,
        is_active: true,
      };
      // Si ya guardamos un destino en esta sesión, lo actualizamos; si no, lo creamos.
      const res = shopSubId
        ? await fetch(`${API}/api/shopify-subscriptions/${shopSubId}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch(`${API}/api/shopify-subscriptions/`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setShopError(formatError(data)); return; }
      setShopSubId(data.id);
      setShopPreview(null); setShopResult(null);
    } catch (err) { setShopError(err.message || 'No se pudo guardar el destino.'); }
    setSavingShopSub(false);
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando...</div>;

  const shopConfigReady = shopConnId && (shopPriceCol || shopStockCol || shopCompareCol || shopBarcodeCol || shopTitleCol || shopProductTypeCol);

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <UploadCloud className="w-6 h-6 text-indigo-600" /> Archivo → Maestra → Shopify
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          El flujo normal de subida: subís tu archivo, actualiza la Tabla Maestra y de ahí se envía
          precio/stock a Shopify. Nunca se crean productos: solo se actualizan los SKU que ya existen.
        </p>
      </div>

      {/* Camino visual */}
      <div className="flex items-center gap-2 text-xs font-medium text-gray-600 flex-wrap">
        <span className="flex items-center gap-1 bg-white border border-gray-200 rounded-full px-2.5 py-1"><UploadCloud className="w-3.5 h-3.5 text-indigo-500" /> Archivo</span>
        <ArrowRight className="w-3.5 h-3.5 text-gray-300" />
        <span className="flex items-center gap-1 bg-white border border-indigo-200 rounded-full px-2.5 py-1"><Database className="w-3.5 h-3.5 text-indigo-500" /> Maestra</span>
        <ArrowRight className="w-3.5 h-3.5 text-gray-300" />
        <span className="flex items-center gap-1 bg-white border border-green-200 rounded-full px-2.5 py-1"><Store className="w-3.5 h-3.5 text-green-600" /> Shopify</span>
      </div>

      {!masterConnId && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-amber-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          No hay una Tabla Maestra enlazada: los datos no tienen a dónde escribirse.
          <Link to="/" className="ml-auto text-amber-700 font-semibold hover:underline flex-shrink-0">Enlazarla primero →</Link>
        </div>
      )}

      {/* ── Tarjeta 1: Archivo ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <StepBadge n={1} done={!!processId} active={!processId} /> Archivo
        </h2>

        <div className="flex gap-2 mb-4">
          <button type="button" onClick={() => setFileMode('new')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${fileMode === 'new' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            Subir nuevo
          </button>
          {fileConns.length > 0 && (
            <button type="button" onClick={() => setFileMode('existing')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${fileMode === 'existing' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              Usar uno ya subido
            </button>
          )}
        </div>

        {fileMode === 'new' ? (
          !file ? (
            <label htmlFor="ftsFile"
              onDragOver={e => { e.preventDefault(); setFileDragActive(true); }}
              onDragLeave={e => { e.preventDefault(); setFileDragActive(false); }}
              onDrop={e => { e.preventDefault(); setFileDragActive(false); pickFile(e.dataTransfer.files?.[0]); }}
              className={`flex flex-col items-center justify-center gap-2 text-center border-2 border-dashed rounded-xl p-8 cursor-pointer transition ${fileDragActive ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 hover:border-indigo-400 hover:bg-gray-50'}`}>
              <UploadCloud className={`w-8 h-8 ${fileDragActive ? 'text-indigo-600' : 'text-gray-400'}`} />
              <p className="text-sm font-medium text-gray-700">Arrastrá tu archivo o <span className="text-indigo-600">buscalo en tu computadora</span></p>
              <p className="text-xs text-gray-400">CSV, XLS o XLSX</p>
              <input id="ftsFile" type="file" accept=".csv,.xls,.xlsx" onChange={e => pickFile(e.target.files?.[0])} className="hidden" />
            </label>
          ) : (
            <div className="flex items-center justify-between gap-3 border border-indigo-200 bg-indigo-50 rounded-xl p-4">
              <div className="flex items-center gap-3 min-w-0">
                <FileDown className="w-6 h-6 text-indigo-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{file.name}</p>
                  <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                </div>
              </div>
              <button type="button" onClick={() => { setFile(null); setFileError(''); }} className="text-gray-400 hover:text-red-600" title="Quitar archivo">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
          )
        ) : (
          <select value={existingFileConnId} onChange={e => setExistingFileConnId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white max-w-sm">
            <option value="">Elegí un archivo ya subido...</option>
            {fileConns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {fileError && <p className="flex items-center gap-1 text-xs text-red-600 mt-2"><AlertTriangle className="w-3.5 h-3.5" /> {fileError}</p>}

        <button type="button" onClick={prepareSource} disabled={loadingSource || (fileMode === 'new' ? !file : !existingFileConnId)}
          className="mt-4 flex items-center gap-2 bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-900 disabled:opacity-50">
          {loadingSource ? 'Leyendo columnas...' : <>Leer columnas <ArrowRight className="w-4 h-4" /></>}
        </button>

        {/* Mapeo (aparece tras leer columnas) */}
        {sourceConn && !loadingSource && sourceCols.length > 0 && (
          <div className="mt-5 bg-indigo-50 border border-indigo-200 rounded-xl p-4">
            {Object.keys(sourceSheets).length > 1 && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-indigo-800 mb-1">Pestaña / hoja</label>
                <select value={sourceSheet} onChange={e => handleSheetChange(e.target.value)}
                  className="w-full border border-indigo-200 rounded-lg p-2 text-sm bg-white max-w-sm">
                  {Object.keys(sourceSheets).map(sh => <option key={sh} value={sh}>{sh}</option>)}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-indigo-800 mb-1">🔑 SKU en el archivo</label>
                <select value={skuColSource} onChange={e => setSkuColSource(e.target.value)}
                  className="w-full border border-indigo-200 rounded-lg p-2 text-sm bg-white">
                  <option value="">Seleccionar...</option>
                  {sourceCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-indigo-800 mb-1">🔑 SKU en la Maestra</label>
                <select value={masterSkuCol} onChange={e => setMasterSkuCol(e.target.value)}
                  className="w-full border border-indigo-200 rounded-lg p-2 text-sm bg-white">
                  <option value="">Seleccionar...</option>
                  {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <label className="block text-sm font-medium text-indigo-800 mb-1">Campos (precio, stock, nombre...)</label>
            <p className="text-xs text-indigo-600 mb-2">Auto-sugeridos; ajustá si hace falta.</p>
            {mappings.map((m, i) => (
              <div key={i} className="flex gap-2 items-center mb-2">
                <select value={m.src} onChange={e => { const n = [...mappings]; n[i] = { ...n[i], src: e.target.value }; setMappings(n); }}
                  className="flex-1 border border-indigo-200 rounded-md p-1.5 text-sm bg-white">
                  <option value="">[Archivo] Columna...</option>
                  {sourceCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <ChevronRight className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                <select value={m.dst} onChange={e => { const n = [...mappings]; n[i] = { ...n[i], dst: e.target.value }; setMappings(n); }}
                  className="flex-1 border border-indigo-200 rounded-md p-1.5 text-sm bg-white">
                  <option value="">[Maestra] Columna...</option>
                  {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {mappings.length > 1 && (
                  <button type="button" onClick={() => setMappings(mappings.filter((_, idx) => idx !== i))} className="text-red-400 hover:text-red-600 text-sm">✕</button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setMappings([...mappings, { src: '', dst: '' }])}
              className="text-indigo-600 text-sm font-medium hover:underline mt-1">+ Añadir campo</button>

            <div className="mt-4">
              <button type="button" onClick={saveProcess} disabled={savingProcess}
                className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                <Save className="w-4 h-4" /> {savingProcess ? 'Guardando...' : (processId ? 'Guardar cambios' : 'Guardar archivo')}
              </button>
              {processId && <span className="ml-2 text-sm text-green-700">✓ Archivo listo.</span>}
            </div>
          </div>
        )}
      </div>

      {/* ── Tarjeta 2: Maestra ── */}
      <div className={`bg-white rounded-xl shadow-sm border p-6 ${processId ? 'border-gray-200' : 'border-gray-200 opacity-60'}`}>
        <h2 className="text-sm font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <StepBadge n={2} done={masterUpdated} active={!!processId && !masterUpdated} /> Maestra
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          {masterSheetName ? <>Tu Maestra: <span className="font-medium text-gray-700">"{masterSheetName}"</span>{masterRows != null && <span> · {masterRows} filas</span>}. </> : null}
          Escribe el archivo en la Maestra, con vista previa antes de confirmar.
        </p>
        <button type="button" onClick={() => processId && setRunProc({ id: processId, name: processName })} disabled={!processId}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
          <Zap className="w-4 h-4" /> Actualizar Maestra ahora
        </button>
        {!processId && <p className="text-xs text-gray-400 mt-2">Guardá el archivo (paso 1) primero.</p>}
        {masterUpdated && <p className="text-sm text-green-700 mt-2 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Maestra actualizada.</p>}
      </div>

      {/* ── Tarjeta 3: Shopify ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <StepBadge n={3} done={shopSent} active={masterUpdated && !shopSent} /> Shopify
        </h2>

        {shopConns.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Todavía no conectaste ninguna tienda Shopify. Conectá una desde "+ Nueva Fuente" (elegí Shopify) y volvé acá.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tienda Shopify</label>
                <select value={shopConnId} onChange={e => { setShopConnId(e.target.value); setShopSubId(null); setShopPreview(null); setShopResult(null); }}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                  <option value="">Seleccionar...</option>
                  {shopConns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.shopify_domain})</option>)}
                </select>
              </div>
              {shopConnId && !shopLocError && shopLocations.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ubicación / Bodega</label>
                  <select value={shopLocId} onChange={e => setShopLocId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                    <option value="">Seleccionar...</option>
                    {shopLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            <p className="text-xs text-gray-500 mb-2">Elegí uno o varios campos para enviar (todos por SKU, a nivel variante — no se crean productos):</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Precio (Maestra)</label>
                <select value={shopPriceCol} onChange={e => { setShopPriceCol(e.target.value); setShopSubId(null); }}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                  <option value="">— no enviar —</option>
                  {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Stock (Maestra)</label>
                <select value={shopStockCol} onChange={e => { setShopStockCol(e.target.value); setShopSubId(null); }}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                  <option value="">— no enviar —</option>
                  {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Precio comparativo / oferta</label>
                <select value={shopCompareCol} onChange={e => { setShopCompareCol(e.target.value); setShopSubId(null); }}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                  <option value="">— no enviar —</option>
                  {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Código de barras</label>
                <select value={shopBarcodeCol} onChange={e => { setShopBarcodeCol(e.target.value); setShopSubId(null); }}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                  <option value="">— no enviar —</option>
                  {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del producto</label>
                <select value={shopTitleCol} onChange={e => { setShopTitleCol(e.target.value); setShopSubId(null); }}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                  <option value="">— no enviar —</option>
                  {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Categoría</label>
                <select value={shopProductTypeCol} onChange={e => { setShopProductTypeCol(e.target.value); setShopSubId(null); }}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                  <option value="">— no enviar —</option>
                  {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3">
              Nombre y categoría son a nivel PRODUCTO: si el SKU comparte producto con otras variantes, el cambio afecta al producto entero.
            </p>
            {shopLocError && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3">{shopLocError} Si la tienda tiene una sola ubicación, igual se puede escribir el stock.</p>}

            <div className="flex flex-wrap gap-2 items-center">
              <input value={shopDestName} onChange={e => setShopDestName(e.target.value)} placeholder="Nombre del destino (ej. Shopi-Poe)"
                className="border border-gray-300 rounded-lg p-2 text-sm max-w-xs" />
              <button type="button" onClick={saveShopSub} disabled={savingShopSub || !shopConfigReady}
                className="flex items-center gap-2 bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-900 disabled:opacity-50">
                <Save className="w-4 h-4" /> {savingShopSub ? 'Guardando...' : (shopSubId ? 'Actualizar destino' : 'Guardar destino')}
              </button>
            </div>
            {shopSubId && <p className="text-xs text-green-700 mt-2">✓ Destino guardado. Queda en "Mis Flujos" y se envía solo con cada actualización de la Maestra.</p>}

            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setShopPushOpen(true)} disabled={!shopSubId}
                className="flex items-center gap-2 bg-green-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                <Send className="w-4 h-4" /> Enviar a Shopify
              </button>
            </div>
            {!shopSubId && <p className="text-xs text-gray-400 mt-2">Guardá el destino primero para previsualizar/enviar.</p>}
            {shopSent && <p className="text-sm text-green-700 mt-2 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Enviado a Shopify.</p>}

            {shopError && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 whitespace-pre-line flex gap-2">
                <XCircle className="w-4 h-4 shrink-0" /> {shopError}
              </div>
            )}
          </>
        )}
      </div>

      {runProc && (
        <RunFlowModal
          procs={[runProc]}
          onClose={() => setRunProc(null)}
          onDone={() => {
            setMasterUpdated(true);
            fetch(`${API}/api/master`).then(r => r.json()).then(m => setMasterRows(m.total_rows ?? null)).catch(() => {});
          }}
        />
      )}

      {shopPushOpen && (
        <ShopifyPushModal
          subId={shopSubId}
          subName={shopDestName || 'Shopify'}
          onClose={() => setShopPushOpen(false)}
          onDone={() => setShopSent(true)}
        />
      )}
    </div>
  );
}
