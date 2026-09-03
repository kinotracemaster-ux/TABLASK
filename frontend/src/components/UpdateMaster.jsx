import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  UploadCloud, Link2, Server, Store, Database, ChevronRight, ChevronDown, ChevronUp,
  ArrowRight, Download, FileDown, Eye, Send, XCircle, AlertTriangle,
  Globe, Zap, X, Trash2, RefreshCw, Save,
} from 'lucide-react';
import { extractError, formatError } from '../utils/errors';
import RunFlowModal from './RunFlowModal';
import ShopifyFieldMapper from './ShopifyFieldMapper';

const API = import.meta.env.VITE_API_URL || '';
const ALLOWED_FILE_EXT = ['.csv', '.xls', '.xlsx'];

function ModalShell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Campos para conectar/crear una tienda Shopify — solo se usa acá para dar de
// alta un destino Shopify nuevo (sección 5, opcional).
function ShopifyConnectFields({ domain, setDomain, authMode, setAuthMode, clientId, setClientId, clientSecret, setClientSecret, token, setToken }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Dominio de la tienda</label>
        <input value={domain} onChange={e => setDomain(e.target.value)}
          placeholder="mi-tienda.myshopify.com"
          className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
      </div>
      <div className="flex gap-1 text-xs">
        <button type="button" onClick={() => setAuthMode('client')}
          className={`px-3 py-1 rounded-md border ${authMode === 'client' ? 'bg-green-600 text-white border-green-600' : 'border-gray-300 text-gray-600'}`}>
          Client ID + Secret
        </button>
        <button type="button" onClick={() => setAuthMode('token')}
          className={`px-3 py-1 rounded-md border ${authMode === 'token' ? 'bg-green-600 text-white border-green-600' : 'border-gray-300 text-gray-600'}`}>
          Access Token (shpat_)
        </button>
      </div>
      {authMode === 'client' ? (
        <div className="flex gap-2">
          <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="Client ID"
            className="flex-1 border border-gray-300 rounded-lg p-2 text-sm" />
          <input type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder="Client Secret"
            className="flex-1 border border-gray-300 rounded-lg p-2 text-sm" />
        </div>
      ) : (
        <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="shpat_..."
          className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
      )}
    </div>
  );
}

const ORIGIN_CONN_TYPE = { upload: 'local_file', api: 'http_api', sheets: 'google_sheets' };

/**
 * Pantalla única "Actualizar Maestra": reemplaza a los antiguos "+ Nueva
 * Fuente" (wizard de 3 pasos) y "Archivo → Maestra → Shopify" (fijo a
 * Shopify). Dos caminos, sin navegar entre páginas:
 *   1) Fuentes ya conectadas -> Reemplazar archivo (si aplica) + Correr ahora.
 *   2) Origen nuevo -> mapeo inline (con aviso si es ambiguo) -> al guardar
 *      se abre la vista previa (RunFlowModal) al toque, y opcionalmente se
 *      puede agregar un destino nuevo para esa Fuente.
 * La gestión fina de lo ya creado (editar, pausar, borrar) sigue en "Mis
 * Flujos"; el módulo "Shopify → Maestra" (bajada) es aparte a propósito.
 */
export default function UpdateMaster() {
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState(null);

  // Maestra
  const [masterConnId, setMasterConnId] = useState(null);
  const [masterSheetName, setMasterSheetName] = useState(null);
  const [masterSkuDefault, setMasterSkuDefault] = useState('');
  const [masterCols, setMasterCols] = useState([]);
  const [masterRows, setMasterRows] = useState(null);
  const [masterDestSheets, setMasterDestSheets] = useState({}); // {pestaña: [columnas]} de la propia Maestra
  const [masterDestSheet, setMasterDestSheet] = useState('');

  const [connections, setConnections] = useState([]);
  const [processes, setProcesses] = useState([]);

  const refreshMaster = () => {
    fetch(`${API}/api/master`).then(r => r.json()).then(m => setMasterRows(m.total_rows ?? null)).catch(() => {});
  };

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [projsRes, masterRes, colsRes, connsRes, procsRes, presetsRes] = await Promise.all([
        fetch(`${API}/api/projects/`),
        fetch(`${API}/api/master`),
        fetch(`${API}/api/master-columns`),
        fetch(`${API}/api/connections/`),
        fetch(`${API}/api/processes/`),
        fetch(`${API}/api/exports/presets`),
      ]);
      const projs = await projsRes.json();
      let pid = null;
      if (Array.isArray(projs) && projs.length > 0) { pid = projs[0].id; setProjectId(pid); }
      const m = await masterRes.json();
      if (masterRes.ok) {
        setMasterConnId(m.master_connection_id || null);
        setMasterSheetName(m.master_sheet_name || null);
        setMasterSkuDefault(m.master_sku_column || '');
        setMasterRows(m.total_rows ?? null);
        setMasterDestSheet(m.master_sheet_name || '');
        if (m.master_connection_id) {
          try {
            const mMeta = await fetch(`${API}/api/connections/${m.master_connection_id}/metadata`).then(r => r.json());
            setMasterDestSheets(mMeta.sheets || {});
          } catch (e) { console.error('No se pudieron leer las pestañas de la Maestra', e); }
        }
      }
      const cols = await colsRes.json();
      setMasterCols(colsRes.ok && Array.isArray(cols) ? cols : []);
      const conns = await connsRes.json();
      setConnections(Array.isArray(conns) ? conns : []);
      const procs = await procsRes.json();
      setProcesses(Array.isArray(procs) ? procs : []);
      if (presetsRes.ok) setExportPresets(await presetsRes.json());
      // Destinos ya configurados: se muestran de una, no hace falta crear una
      // Fuente nueva para verlos/agregar otro (un destino Shopify/Sheet/CSV/API
      // se conecta a la Maestra en general, no a una Fuente puntual).
      if (pid) await loadDestinations(pid);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const connById = (id) => connections.find(c => c.id === id);

  // ══════════════════════════════════════════════════════════════════
  // Sección 1 — Fuentes ya conectadas: reemplazar archivo + correr ahora
  // ══════════════════════════════════════════════════════════════════
  const [runProcs, setRunProcs] = useState(null);
  const [fileSwapProc, setFileSwapProc] = useState(null);
  const [fileSwapBusy, setFileSwapBusy] = useState(false);
  const [fileSwapError, setFileSwapError] = useState(null);

  // Antes de correr una Fuente cuyo origen es un archivo local, ofrecemos
  // reemplazarlo por uno más nuevo (recomendación, no obligatorio) — mismo
  // patrón que "Mis Flujos".
  const maybeRunProc = (proc) => {
    const conn = connById(proc.source_connection_id);
    if (conn && conn.connection_type === 'local_file') {
      setFileSwapError(null);
      setFileSwapProc(proc);
    } else {
      setRunProcs([{ id: proc.id, name: proc.name }]);
    }
  };

  const handleReplaceAndRun = async (file) => {
    if (!file || !fileSwapProc) return;
    setFileSwapBusy(true); setFileSwapError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API}/api/connections/${fileSwapProc.source_connection_id}/replace-file`, {
        method: 'POST', body: form,
      });
      const data = await res.json();
      if (!res.ok) { setFileSwapError(formatError(data)); return; }
      setConnections(prev => prev.map(c => (c.id === data.id ? data : c)));
      const proc = fileSwapProc;
      setFileSwapProc(null);
      setRunProcs([{ id: proc.id, name: proc.name }]);
    } catch (err) {
      setFileSwapError(err.message || 'No se pudo reemplazar el archivo.');
    }
    setFileSwapBusy(false);
  };

  // ══════════════════════════════════════════════════════════════════
  // Sección 2 — Conectar un origen nuevo
  // ══════════════════════════════════════════════════════════════════
  const [showNewSource, setShowNewSource] = useState(false);
  const [originType, setOriginType] = useState('upload'); // 'upload' | 'api' | 'sheets'
  const [showAdvancedOrigin, setShowAdvancedOrigin] = useState(false); // revela Google Sheet
  const [sourceName, setSourceName] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [fileDragActive, setFileDragActive] = useState(false);
  const [apiUrl, setApiUrl] = useState('');
  const [apiMethod, setApiMethod] = useState('GET');
  const [apiHeaders, setApiHeaders] = useState('');
  const [existingConnId, setExistingConnId] = useState('');
  const [creatingSource, setCreatingSource] = useState(false);
  const [deletingConn, setDeletingConn] = useState(false);
  const [sourceConn, setSourceConn] = useState(null);

  const existingForType = connections.filter(c => c.connection_type === ORIGIN_CONN_TYPE[originType]);

  const pickOriginType = (t) => { setOriginType(t); setExistingConnId(''); };

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

  const handleDeleteConnection = async (connId) => {
    const conn = connById(parseInt(connId));
    if (!conn) return;
    if (!window.confirm(`¿Eliminar "${conn.name}"? Esta conexión y su archivo subido se borran. No se puede deshacer.`)) return;
    setDeletingConn(true);
    try {
      const res = await fetch(`${API}/api/connections/${connId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await extractError(res));
      setConnections(prev => prev.filter(c => String(c.id) !== String(connId)));
      if (String(existingConnId) === String(connId)) setExistingConnId('');
    } catch (err) {
      alert(err.message || 'No se pudo eliminar la conexión.');
    }
    setDeletingConn(false);
  };

  const handleCreateSource = async (e) => {
    e.preventDefault();
    setCreatingSource(true);
    try {
      let conn;
      if (existingConnId) {
        conn = connById(parseInt(existingConnId));
        if (!conn) throw new Error('No se encontró la conexión elegida.');
      } else if (originType === 'upload') {
        if (!file) { alert('Elegí un archivo primero.'); setCreatingSource(false); return; }
        const form = new FormData();
        form.append('name', sourceName || file.name);
        form.append('file', file);
        const res = await fetch(`${API}/api/connections/upload`, { method: 'POST', body: form });
        if (!res.ok) throw new Error(await extractError(res));
        conn = await res.json();
        setConnections(prev => [...prev, conn]);
      } else if (originType === 'api') {
        const res = await fetch(`${API}/api/connections/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: sourceName || 'Nueva fuente', connection_type: 'http_api',
            http_url: apiUrl, http_method: apiMethod, http_headers: apiHeaders || null,
          }),
        });
        if (!res.ok) throw new Error(await extractError(res));
        conn = await res.json();
        setConnections(prev => [...prev, conn]);
      } else {
        if (!sheetUrl) { alert('Falta la URL del Google Sheet.'); setCreatingSource(false); return; }
        const res = await fetch(`${API}/api/connections/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: sourceName || 'Nueva fuente', connection_type: 'google_sheets', google_sheet_url: sheetUrl }),
        });
        if (!res.ok) throw new Error(await extractError(res));
        conn = await res.json();
        setConnections(prev => [...prev, conn]);
      }
      await loadSourceMeta(conn);
    } catch (err) {
      alert(err.message || 'No se pudo conectar el origen.');
    }
    setCreatingSource(false);
  };

  // ══════════════════════════════════════════════════════════════════
  // Sección 3 — Mapeo inline (SKU + campos, con aviso de ambigüedad)
  // ══════════════════════════════════════════════════════════════════
  const [sourceSheets, setSourceSheets] = useState({});
  const [sourceSheet, setSourceSheet] = useState('');
  const [skuColSource, setSkuColSource] = useState('');
  const [masterSkuCol, setMasterSkuCol] = useState('');
  const [fieldMappings, setFieldMappings] = useState([{ src: '', dst: '' }]);
  const [processName, setProcessName] = useState('');
  const [loadingMap, setLoadingMap] = useState(false);
  const [savingProcess, setSavingProcess] = useState(false);
  const [createdProc, setCreatedProc] = useState(null);

  const sourceCols = sourceSheet && sourceSheets[sourceSheet] ? sourceSheets[sourceSheet] : [];
  // Columnas de destino: la pestaña de la Maestra elegida (si hay varias), si no las de /api/master-columns.
  const masterDestCols = masterDestSheet && masterDestSheets[masterDestSheet] ? masterDestSheets[masterDestSheet] : masterCols;

  const autoDetect = async (connId, sheetName, headers, destCols) => {
    try {
      const [skuRes, mapRes] = await Promise.all([
        fetch(`${API}/api/intelligence/suggest-sku?connection_id=${connId}&sheet_name=${encodeURIComponent(sheetName)}`),
        fetch(`${API}/api/intelligence/auto-map`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_headers: headers, target_headers: destCols }),
        }),
      ]);
      const skuData = await skuRes.json();
      const mapData = await mapRes.json();
      const suggestions = mapData.mappings || [];
      const suggestedSku = skuData.suggested_sku || headers[0] || '';
      setSkuColSource(suggestedSku);

      const bySrc = Object.fromEntries(suggestions.map(s => [s.source_field, s]));
      const guessedMasterSku = bySrc[suggestedSku]?.target_field;
      setMasterSkuCol(masterSkuDefault || (guessedMasterSku && destCols.includes(guessedMasterSku) ? guessedMasterSku : ''));

      const mapped = suggestions
        .filter(s => s.source_field !== suggestedSku && s.confidence !== 'none')
        .map(s => ({ src: s.source_field, dst: s.target_field, confidence: s.confidence, candidates: s.candidates || [] }));
      setFieldMappings(mapped.length > 0 ? mapped : [{ src: '', dst: '' }]);
    } catch (err) { console.error('Auto-detect falló', err); }
  };

  const loadSourceMeta = async (conn) => {
    setSourceConn(conn);
    setCreatedProc(null);
    setProcessName(`Traer ${conn.name} → Maestra`);
    setLoadingMap(true);
    try {
      const metaRes = await fetch(`${API}/api/connections/${conn.id}/metadata`);
      const meta = await metaRes.json();
      if (!metaRes.ok) throw new Error(meta.detail || 'No se pudo leer el origen.');
      const sheets = meta.sheets || {};
      setSourceSheets(sheets);
      const first = Object.keys(sheets)[0] || '';
      setSourceSheet(first);
      if (first && sheets[first]) await autoDetect(conn.id, first, sheets[first], masterDestCols);
    } catch (err) { alert(err.message); }
    setLoadingMap(false);
  };

  const handleSheetChange = async (sheetName) => {
    setSourceSheet(sheetName);
    await autoDetect(sourceConn.id, sheetName, sourceSheets[sheetName] || [], masterDestCols);
  };

  // Cambiar la pestaña destino dentro de la Maestra: re-sugiere el mapeo
  // contra las columnas de la nueva hoja.
  const handleMasterDestChange = async (sheetName) => {
    setMasterDestSheet(sheetName);
    const destHeaders = masterDestSheets[sheetName] || [];
    if (!sourceConn) return;
    await autoDetect(sourceConn.id, sourceSheet, sourceCols, destHeaders);
  };

  const saveProcess = async () => {
    const map = {};
    fieldMappings.forEach(({ src, dst }) => { if (src && dst) map[src] = dst; });
    if (!skuColSource || !masterSkuCol) { alert('Confirmá la columna SKU (origen y Maestra).'); return; }
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
          ...(masterConnId && masterDestSheet ? { target_connection_id: masterConnId, target_sheet_name: masterDestSheet } : {}),
          add_new_rows: true,
          is_active: true,
        }),
      });
      if (!res.ok) throw new Error(await extractError(res));
      const created = await res.json();
      setCreatedProc({ id: created.id, name: created.name });
      setProcesses(prev => [...prev, created]);
      setShowDestinos(false);
      if (projectId) await loadDestinations(projectId);
      // Vista previa inmediata: sin paso extra para llegar a confirmar el envío.
      setRunProcs([{ id: created.id, name: created.name }]);
    } catch (err) {
      alert(err.message || 'No se pudo guardar.');
    }
    setSavingProcess(false);
  };

  // ══════════════════════════════════════════════════════════════════
  // Sección 5 (opcional) — agregar un destino nuevo para la Fuente recién
  // creada. Los destinos de fuentes YA existentes siguen propagándose solos
  // en cada corrida (no hace falta reconfigurar nada acá).
  // ══════════════════════════════════════════════════════════════════
  const [showDestinos, setShowDestinos] = useState(false);
  const [destinations, setDestinations] = useState([]);
  const [destType, setDestType] = useState('sheet');
  const [destName, setDestName] = useState('');
  const [destConnId, setDestConnId] = useState('');
  const [destSheets, setDestSheets] = useState({});
  const [destSheet, setDestSheet] = useState('');
  const [destSkuCol, setDestSkuCol] = useState('');
  const [destMappings, setDestMappings] = useState([{ src: '', dst: '' }]);
  const [savingDest, setSavingDest] = useState(false);
  const [exportPresets, setExportPresets] = useState([]);
  const [csvPreset, setCsvPreset] = useState(null);
  const [presetFieldMap, setPresetFieldMap] = useState({});
  const [apiDestUrl, setApiDestUrl] = useState('');
  const [apiDestMethod, setApiDestMethod] = useState('POST');
  const [apiDestToken, setApiDestToken] = useState('');
  const [masterSheetsAll, setMasterSheetsAll] = useState({});

  const [newShopDomain, setNewShopDomain] = useState('');
  const [newShopAuthMode, setNewShopAuthMode] = useState('client');
  const [newShopClientId, setNewShopClientId] = useState('');
  const [newShopClientSecret, setNewShopClientSecret] = useState('');
  const [newShopToken, setNewShopToken] = useState('');
  const [creatingShopConn, setCreatingShopConn] = useState(false);
  const [shopConnId, setShopConnId] = useState('');
  const [shopTab, setShopTab] = useState('');
  const [shopSkuCol, setShopSkuCol] = useState('');
  const [shopPriceCol, setShopPriceCol] = useState('');
  const [shopStockCol, setShopStockCol] = useState('');
  const [shopCompareCol, setShopCompareCol] = useState('');
  const [shopBarcodeCol, setShopBarcodeCol] = useState('');
  const [shopTitleCol, setShopTitleCol] = useState('');
  const [shopProductTypeCol, setShopProductTypeCol] = useState('');
  const [shopLocations, setShopLocations] = useState([]);
  const [shopLocId, setShopLocId] = useState('');
  const [shopLocError, setShopLocError] = useState(null);
  const [shopBusy, setShopBusy] = useState(false);
  const [shopPreview, setShopPreview] = useState(null);
  const [shopResult, setShopResult] = useState(null);
  const [shopError, setShopError] = useState(null);
  const [shopDestName, setShopDestName] = useState('');
  const [savingShopSub, setSavingShopSub] = useState(false);
  const [shopSubSaved, setShopSubSaved] = useState(null);

  const destCols = destType === 'sheet' && destSheet && destSheets[destSheet] ? destSheets[destSheet] : [];
  const shopStoreConns = connections.filter(c => c.connection_type === 'shopify');
  const shopTabCols = shopTab && masterSheetsAll[shopTab] ? masterSheetsAll[shopTab] : [];

  const loadDestinations = async (pid) => {
    try {
      const [subsRes, expRes, connsRes, apiSubsRes] = await Promise.all([
        fetch(`${API}/api/subscriptions/?project_id=${pid}`),
        fetch(`${API}/api/exports/?project_id=${pid}`),
        fetch(`${API}/api/connections/`),
        fetch(`${API}/api/api-subscriptions/`),
      ]);
      const subs = await subsRes.json();
      const exps = await expRes.json();
      const apiSubs = apiSubsRes.ok ? await apiSubsRes.json() : [];
      setConnections(await connsRes.json());
      setDestinations([
        ...subs.map(s => ({ id: `sub-${s.id}`, name: s.name, kind: 'Google Sheet' })),
        ...exps.map(e => ({ id: `exp-${e.id}`, name: e.name, kind: 'CSV' })),
        ...apiSubs.map(a => ({ id: `apisub-${a.id}`, name: a.name, kind: 'API' })),
      ]);
    } catch (err) { console.error(err); }
  };

  const loadDestSheets = async (connId) => {
    setDestConnId(connId);
    setDestSheet('');
    if (!connId) return;
    try {
      const res = await fetch(`${API}/api/connections/${connId}/metadata`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Fallo');
      setDestSheets(data.sheets || {});
    } catch (err) {
      alert(err.message);
      setDestSheets({});
    }
  };

  const handleAutoMapDest = async () => {
    if (masterCols.length === 0 || destCols.length === 0) return;
    try {
      const res = await fetch(`${API}/api/intelligence/auto-map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_headers: masterCols, target_headers: destCols }),
      });
      const data = await res.json();
      const newMappings = Object.entries(data.mapping || {})
        .filter(([, dst]) => dst !== destSkuCol)
        .map(([src, dst]) => ({ src, dst }));
      if (newMappings.length > 0) setDestMappings(newMappings);
    } catch (err) { console.error(err); }
  };

  const presetSourceFields = (preset) => {
    const fields = new Set();
    (preset?.spec || []).forEach(col => {
      if (col.source) fields.add(col.source);
      (col.sources || []).forEach(s => fields.add(s));
      if (col.type === 'template') (col.template.match(/\{([^{}]+)\}/g) || []).forEach(m => fields.add(m.slice(1, -1)));
    });
    return [...fields];
  };

  const applyCsvPreset = (preset) => {
    setCsvPreset(preset);
    if (!preset) { setPresetFieldMap({}); return; }
    const fmap = {};
    presetSourceFields(preset).forEach(f => {
      const match = masterCols.find(c => c.toLowerCase() === f.toLowerCase());
      fmap[f] = match || '';
    });
    setPresetFieldMap(fmap);
    if (!destName) setDestName(preset.name);
  };

  const buildTransformSpec = (preset, fmap) => preset.spec.map(col => {
    const nc = { ...col };
    if (col.source) nc.source = fmap[col.source] || col.source;
    if (col.sources) nc.sources = col.sources.map(s => fmap[s] || s);
    if (col.type === 'template') nc.template = col.template.replace(/\{([^{}]+)\}/g, (m, f) => `{${fmap[f] || f}}`);
    return nc;
  });

  const handleCreateDestination = async (e) => {
    e.preventDefault();

    if (destType === 'apipush') {
      if (!apiDestUrl.trim()) { alert('Falta la URL del endpoint destino.'); return; }
      setSavingDest(true);
      try {
        const res = await fetch(`${API}/api/api-subscriptions/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: destName || (csvPreset ? `${csvPreset.name} (API)` : 'Canal API'),
            url: apiDestUrl.trim(),
            http_method: apiDestMethod,
            auth_token: apiDestToken || null,
            transform_spec: csvPreset ? buildTransformSpec(csvPreset, presetFieldMap) : null,
            is_active: true,
          }),
        });
        if (!res.ok) throw new Error(await extractError(res));
        setDestName(''); setApiDestUrl(''); setApiDestToken(''); setCsvPreset(null); setPresetFieldMap({});
        await loadDestinations(projectId);
      } catch (err) {
        alert(err.message || 'No se pudo crear el canal API.');
      }
      setSavingDest(false);
      return;
    }

    if (destType === 'csv' && csvPreset) {
      if (!masterConnId) { alert('No hay una Tabla Maestra enlazada todavía.'); return; }
      setSavingDest(true);
      try {
        const res = await fetch(`${API}/api/exports/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: destName || csvPreset.name,
            project_id: projectId,
            source_connection_id: masterConnId,
            source_sheet_name: masterSheetName,
            columns_mapping: {},
            transform_spec: buildTransformSpec(csvPreset, presetFieldMap),
            output_type: 'csv_download',
          }),
        });
        if (!res.ok) throw new Error(await extractError(res));
        setDestName(''); setCsvPreset(null); setPresetFieldMap({});
        await loadDestinations(projectId);
      } catch (err) {
        alert(err.message || 'No se pudo crear la plantilla.');
      }
      setSavingDest(false);
      return;
    }

    const mappings = {};
    destMappings.forEach(({ src, dst }) => { if (src && dst) mappings[src] = dst; });
    if (Object.keys(mappings).length === 0) { alert('Agregá al menos un campo a enviar.'); return; }
    setSavingDest(true);
    try {
      let res;
      if (destType === 'csv') {
        if (!masterConnId) { alert('No hay una Tabla Maestra enlazada todavía.'); setSavingDest(false); return; }
        res = await fetch(`${API}/api/exports/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: destName || 'Nueva exportación CSV',
            project_id: projectId,
            source_connection_id: masterConnId,
            source_sheet_name: masterSheetName,
            columns_mapping: mappings,
            output_type: 'csv_download',
          }),
        });
      } else {
        if (!destConnId || !destSheet || !destSkuCol) { alert('Elegí conexión, pestaña y columna llave del destino.'); setSavingDest(false); return; }
        res = await fetch(`${API}/api/subscriptions/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: projectId,
            target_connection_id: parseInt(destConnId),
            target_sheet_name: destSheet,
            sku_column_target: destSkuCol,
            field_mappings: mappings,
            is_active: true,
            name: destName || 'Nueva Suscripción',
          }),
        });
      }
      if (!res.ok) throw new Error(await extractError(res));
      setDestName(''); setDestConnId(''); setDestSheet(''); setDestSkuCol('');
      setDestMappings([{ src: '', dst: '' }]);
      await loadDestinations(projectId);
    } catch (err) {
      alert(err.message || 'No se pudo crear el destino.');
    }
    setSavingDest(false);
  };

  const loadMasterSheetsAll = async () => {
    if (!masterConnId) return;
    try {
      const res = await fetch(`${API}/api/connections/${masterConnId}/metadata`);
      const data = await res.json();
      if (res.ok) setMasterSheetsAll(data.sheets || {});
    } catch (err) { console.error(err); }
  };

  const handleSelectDestType = (t) => {
    setDestType(t);
    if (t === 'shopify') {
      if (Object.keys(masterSheetsAll).length === 0) loadMasterSheetsAll();
      if (!shopTab && masterSheetName) setShopTab(masterSheetName);
    }
  };

  const saveShopifySubscription = async () => {
    setShopError(null); setShopSubSaved(null);
    if (!shopConnId) { setShopError('Elegí la tienda Shopify.'); return; }
    if (!shopPriceCol && !shopStockCol && !shopCompareCol && !shopBarcodeCol && !shopTitleCol && !shopProductTypeCol) { setShopError('Mapeá al menos un campo (precio, stock, precio comparativo, código de barras, nombre o categoría) para guardar el destino.'); return; }
    if (shopStockCol && shopLocations.length > 1 && !shopLocId) { setShopError('Tu tienda tiene varias bodegas: elegí la ubicación destino del stock.'); return; }
    setSavingShopSub(true);
    try {
      const store = shopStoreConns.find(c => String(c.id) === String(shopConnId));
      const res = await fetch(`${API}/api/shopify-subscriptions/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
      });
      const data = await res.json();
      if (!res.ok) { setShopError(formatError(data)); return; }
      setShopSubSaved(data);
      setShopDestName('');
    } catch (e) {
      setShopError(e.message);
    } finally {
      setSavingShopSub(false);
    }
  };

  const handleCreateShopConn = async (e) => {
    e.preventDefault();
    if (!newShopDomain) { alert('Falta el dominio de la tienda.'); return; }
    setCreatingShopConn(true);
    try {
      const body = { name: newShopDomain, connection_type: 'shopify', shopify_domain: newShopDomain };
      if (newShopAuthMode === 'token') body.shopify_access_token = newShopToken;
      else { body.shopify_client_id = newShopClientId; body.shopify_client_secret = newShopClientSecret; }
      const res = await fetch(`${API}/api/connections/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await extractError(res));
      const conn = await res.json();
      setConnections(prev => [...prev, conn]);
      setShopConnId(String(conn.id));
      setNewShopDomain(''); setNewShopClientId(''); setNewShopClientSecret(''); setNewShopToken('');
    } catch (err) {
      alert(err.message || 'No se pudo conectar la tienda.');
    }
    setCreatingShopConn(false);
  };

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

  const runShopifyPush = async (dryRun) => {
    setShopError(null); setShopResult(null); setShopPreview(null);
    if (!shopConnId || !shopTab || !shopSkuCol) { setShopError('Elegí tienda, hoja y columna SKU.'); return; }
    if (!shopPriceCol && !shopStockCol && !shopCompareCol && !shopBarcodeCol && !shopTitleCol && !shopProductTypeCol) { setShopError('Mapeá al menos un campo (precio, stock, precio comparativo, código de barras, nombre o categoría).'); return; }
    if (shopStockCol && shopLocations.length > 1 && !shopLocId) { setShopError('Tu tienda tiene varias bodegas: elegí la ubicación destino del stock.'); return; }
    setShopBusy(true);
    try {
      const res = await fetch(`${API}/api/shopify/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopify_connection_id: parseInt(shopConnId),
          source_connection_id: masterConnId,
          source_sheet_name: shopTab,
          sku_column: shopSkuCol,
          price_column: shopPriceCol || null,
          stock_column: shopStockCol || null,
          compare_price_column: shopCompareCol || null,
          barcode_column: shopBarcodeCol || null,
          title_column: shopTitleCol || null,
          product_type_column: shopProductTypeCol || null,
          location_id: shopLocId || null,
          dry_run: dryRun,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setShopError(formatError(data)); return; }
      if (dryRun) setShopPreview(data); else setShopResult(data);
    } catch (e) {
      setShopError(e.message);
    } finally {
      setShopBusy(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando...</div>;

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <RefreshCw className="w-6 h-6 text-indigo-600" /> Actualizar Maestra
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Traé datos de cualquier origen y actualizá la Tabla Maestra, con vista previa antes de confirmar.
          Nunca se escribe a ciegas.
        </p>
      </div>

      {masterConnId ? (
        <div className="flex items-center gap-2 text-sm bg-indigo-50/60 border border-indigo-100 rounded-xl px-4 py-2.5 text-gray-600">
          <Database className="w-4 h-4 text-indigo-500 flex-shrink-0" />
          <span>
            Tu Maestra:&nbsp;<span className="font-semibold text-gray-800">"{masterSheetName}"</span>
            {masterRows != null && <span className="text-gray-400"> · {masterRows} filas</span>}
          </span>
          <Link to="/" className="ml-auto text-indigo-600 font-medium hover:underline flex-shrink-0">Ver Maestra →</Link>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-amber-800">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <span>Todavía no hay una Tabla Maestra enlazada: los datos no tendrán a dónde escribirse.</span>
        </div>
      )}

      {/* ── Sección 1: fuentes ya conectadas ── */}
      {processes.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-1">¿Actualizás algo que ya tenés conectado?</h2>
          <p className="text-xs text-gray-500 mb-4">Un clic: si el origen es un archivo, te ofrece reemplazarlo antes de correr.</p>
          <div className="space-y-2">
            {processes.map(proc => {
              const conn = connById(proc.source_connection_id);
              return (
                <div key={proc.id} className="flex items-center justify-between gap-3 border border-gray-200 rounded-lg p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{proc.name}</p>
                    <p className="text-xs text-gray-500 flex items-center gap-1">
                      <Link2 className="w-3 h-3" /> {conn?.name || '—'}
                      {!proc.is_active && <span className="ml-1 text-amber-600">· pausada</span>}
                    </p>
                  </div>
                  <button type="button" onClick={() => maybeRunProc(proc)} disabled={!proc.is_active}
                    className="flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:opacity-40 flex-shrink-0">
                    <Zap className="w-3.5 h-3.5" /> Correr ahora
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-3">
            <Link to="/flujos" className="text-xs text-indigo-600 hover:underline">Editar mapeos o destinos en Mis Flujos →</Link>
            {!showNewSource && (
              <button type="button" onClick={() => setShowNewSource(true)}
                className="text-sm text-gray-600 font-medium hover:underline">
                + Conectar un origen nuevo
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Sección 2+3: conectar origen nuevo + mapeo inline ── */}
      {(processes.length === 0 || showNewSource) && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">Conectar un origen nuevo</h2>

          <div className="grid grid-cols-2 gap-2 mb-4">
            <button type="button" onClick={() => pickOriginType('upload')}
              className={`flex flex-col items-center justify-center gap-1 p-3 rounded-lg text-xs font-medium border transition ${originType === 'upload' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              <UploadCloud className="w-4 h-4" /> Subir archivo
            </button>
            <button type="button" onClick={() => pickOriginType('api')}
              className={`flex flex-col items-center justify-center gap-1 p-3 rounded-lg text-xs font-medium border transition ${originType === 'api' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              <Server className="w-4 h-4" /> API externa
            </button>
          </div>

          {!showAdvancedOrigin ? (
            <button type="button" onClick={() => setShowAdvancedOrigin(true)}
              className="text-xs text-gray-500 hover:underline mb-4">más opciones (Google Sheet)</button>
          ) : (
            <div className="mb-4">
              <button type="button" onClick={() => pickOriginType('sheets')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${originType === 'sheets' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                <Link2 className="w-3.5 h-3.5" /> Google Sheet
              </button>
            </div>
          )}

          <form onSubmit={handleCreateSource} className="space-y-4">
            {existingForType.length > 0 && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Ya tenés {existingForType.length} conexión(es) de este tipo — ¿usar una?
                </label>
                <div className="flex items-center gap-2 max-w-md">
                  <select value={existingConnId} onChange={e => setExistingConnId(e.target.value)}
                    className="flex-1 border border-gray-300 rounded-lg p-2 text-sm bg-white">
                    <option value="">— No, conectar una nueva —</option>
                    {existingForType.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.connection_type === 'shopify' && c.shopify_domain ? ` (${c.shopify_domain})` : ''}
                      </option>
                    ))}
                  </select>
                  {existingConnId && (
                    <button type="button" onClick={() => handleDeleteConnection(existingConnId)} disabled={deletingConn}
                      title="Eliminar esta conexión"
                      className="flex items-center gap-1 text-red-600 border border-red-200 hover:bg-red-50 rounded-lg px-2.5 py-2 text-xs font-medium disabled:opacity-50 flex-shrink-0">
                      <Trash2 className="w-4 h-4" /> {deletingConn ? 'Eliminando...' : 'Eliminar'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {!existingConnId && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre (referencia)</label>
                <input value={sourceName} onChange={e => setSourceName(e.target.value)}
                  placeholder="Ej: Proveedor X, Base semanal"
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm max-w-md" />
              </div>
            )}

            {!existingConnId && originType === 'upload' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Archivo (.csv, .xls, .xlsx)</label>
                {!file ? (
                  <label
                    htmlFor="umFile"
                    onDragOver={e => { e.preventDefault(); setFileDragActive(true); }}
                    onDragLeave={e => { e.preventDefault(); setFileDragActive(false); }}
                    onDrop={e => { e.preventDefault(); setFileDragActive(false); pickFile(e.dataTransfer.files?.[0]); }}
                    className={`flex flex-col items-center justify-center gap-2 text-center border-2 border-dashed rounded-xl p-8 cursor-pointer transition ${fileDragActive ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 hover:border-indigo-400 hover:bg-gray-50'}`}>
                    <UploadCloud className={`w-8 h-8 ${fileDragActive ? 'text-indigo-600' : 'text-gray-400'}`} />
                    <p className="text-sm font-medium text-gray-700">Arrastrá tu archivo o <span className="text-indigo-600">buscalo en tu computadora</span></p>
                    <p className="text-xs text-gray-400">CSV, XLS o XLSX</p>
                    <input id="umFile" type="file" accept=".csv,.xls,.xlsx" onChange={e => pickFile(e.target.files?.[0])} className="hidden" />
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
                )}
                {fileError && <p className="flex items-center gap-1 text-xs text-red-600 mt-2"><AlertTriangle className="w-3.5 h-3.5" /> {fileError}</p>}
              </div>
            )}

            {!existingConnId && originType === 'api' && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <select value={apiMethod} onChange={e => setApiMethod(e.target.value)}
                    className="w-24 border border-gray-300 rounded-lg p-2 text-sm bg-white">
                    <option>GET</option>
                    <option>POST</option>
                  </select>
                  <input value={apiUrl} onChange={e => setApiUrl(e.target.value)} required
                    placeholder="https://api.proveedor.com/v1/productos"
                    className="flex-1 border border-gray-300 rounded-lg p-2 text-sm" />
                </div>
                <textarea value={apiHeaders} onChange={e => setApiHeaders(e.target.value)}
                  placeholder='Headers (JSON opcional), ej: {"Authorization": "Bearer TOKEN"}'
                  rows={2} className="w-full border border-gray-300 rounded-lg p-2 text-sm font-mono" />
              </div>
            )}

            {!existingConnId && originType === 'sheets' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL del Google Sheet</label>
                <input value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} required
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
              </div>
            )}

            <button type="submit" disabled={creatingSource}
              className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 text-sm">
              {creatingSource ? 'Leyendo columnas...' : <>{existingConnId ? 'Usar esta conexión' : 'Leer columnas'} <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>

          {/* Mapeo (aparece tras leer columnas, en la misma pantalla) */}
          {loadingMap && <p className="text-gray-500 text-sm mt-4">Leyendo columnas y sugiriendo el mapeo...</p>}
          {sourceConn && !loadingMap && sourceCols.length > 0 && (
            <div className="mt-5 bg-indigo-50 border border-indigo-200 rounded-xl p-4">
              <div>
                <label className="block text-sm font-medium text-indigo-800 mb-1">Nombre del proceso</label>
                <input value={processName} onChange={e => setProcessName(e.target.value)}
                  className="w-full border border-indigo-200 rounded-lg p-2 text-sm bg-white max-w-md mb-3" />
              </div>

              {Object.keys(sourceSheets).length > 1 && (
                <div className="mb-3">
                  <label className="block text-sm font-medium text-indigo-800 mb-1">Pestaña / hoja del origen</label>
                  <select value={sourceSheet} onChange={e => handleSheetChange(e.target.value)}
                    className="w-full border border-indigo-200 rounded-lg p-2 text-sm bg-white max-w-sm">
                    {Object.keys(sourceSheets).map(sh => <option key={sh} value={sh}>{sh}</option>)}
                  </select>
                </div>
              )}

              {Object.keys(masterDestSheets).length > 1 && (
                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Hoja destino en la Maestra (avanzado)</label>
                  <select value={masterDestSheet} onChange={e => handleMasterDestChange(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg p-1.5 text-xs bg-white max-w-xs text-gray-600">
                    {Object.keys(masterDestSheets).map(sh => <option key={sh} value={sh}>{sh}</option>)}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-indigo-800 mb-1">🔑 SKU en el origen</label>
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
                    {masterDestCols.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <label className="block text-sm font-medium text-indigo-800 mb-1">Campos (nombre, precio, stock...)</label>
              <p className="text-xs text-indigo-600 mb-2">Auto-sugeridos; ajustá si hace falta.</p>
              {fieldMappings.map((m, i) => {
                const ambiguous = m.confidence === 'ambiguous';
                return (
                  <div key={i} className="mb-2">
                    <div className="flex gap-2 items-center">
                      <select value={m.src} onChange={e => { const n = [...fieldMappings]; n[i] = { ...n[i], src: e.target.value }; setFieldMappings(n); }}
                        className="flex-1 border border-indigo-200 rounded-md p-1.5 text-sm bg-white">
                        <option value="">[Origen] Columna...</option>
                        {sourceCols.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <ChevronRight className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                      <select value={m.dst} onChange={e => { const n = [...fieldMappings]; n[i] = { ...n[i], dst: e.target.value, confidence: 'manual' }; setFieldMappings(n); }}
                        className={`flex-1 border rounded-md p-1.5 text-sm bg-white ${ambiguous && !m.dst ? 'border-amber-400 ring-1 ring-amber-300' : 'border-indigo-200'}`}>
                        <option value="">[Maestra] Columna...</option>
                        {masterDestCols.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      {fieldMappings.length > 1 && (
                        <button type="button" onClick={() => setFieldMappings(fieldMappings.filter((_, idx) => idx !== i))}
                          className="text-red-400 hover:text-red-600 text-sm">✕</button>
                      )}
                    </div>
                    {ambiguous && !m.dst && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                        Mapeo ambiguo: "{m.src}" podría ir a {m.candidates.join(' o ')} — elegí cuál (si no elegís, este campo no se sincroniza).
                      </p>
                    )}
                  </div>
                );
              })}
              <button type="button" onClick={() => setFieldMappings([...fieldMappings, { src: '', dst: '' }])}
                className="text-indigo-600 text-sm font-medium hover:underline mt-1">+ Añadir campo</button>

              <div className="mt-4">
                <button type="button" onClick={saveProcess} disabled={savingProcess}
                  className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 text-sm">
                  <Save className="w-4 h-4" /> {savingProcess ? 'Guardando...' : (createdProc ? 'Guardado — correr de nuevo' : 'Guardar y ver vista previa')}
                </button>
                {createdProc && <span className="ml-2 text-sm text-green-700">✓ Fuente lista.</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Sección 5: destinos (Shopify, otra hoja, CSV, API) — independiente
          de cualquier Fuente puntual, se conectan a la Maestra en general.
          Siempre visible: no hace falta crear un origen nuevo para llegar acá. ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          {!showDestinos ? (
            <button type="button" onClick={() => setShowDestinos(true)}
              className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-indigo-700">
              <ChevronDown className="w-4 h-4" /> Destinos (Shopify, otra hoja, CSV, API): crear o agregar uno nuevo
            </button>
          ) : (
            <>
              <button type="button" onClick={() => setShowDestinos(false)}
                className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-indigo-700 mb-4">
                <ChevronUp className="w-4 h-4" /> Destinos (Shopify, otra hoja, CSV, API)
              </button>
              <p className="text-xs text-gray-500 mb-4">
                Se conectan a la Maestra en general (no a una Fuente puntual): se actualizan solos en
                cada sync, sin importar qué Fuente la disparó. Para editar/pausar/borrar uno ya
                guardado, andá a "Mis Flujos" — acá es solo para crear uno nuevo.
              </p>

              {destinations.length > 0 && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
                  <p className="text-xs font-semibold text-gray-700 mb-2">Destinos ya configurados</p>
                  <div className="flex flex-wrap gap-2">
                    {destinations.map(d => (
                      <span key={d.id} className="text-xs bg-white text-gray-700 border border-gray-200 px-2.5 py-1 rounded-full">
                        {d.kind === 'CSV' ? <FileDown className="w-3 h-3 inline mr-1" /> : <Download className="w-3 h-3 inline mr-1" />}
                        {d.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-4 gap-2 mb-4">
                <button type="button" onClick={() => handleSelectDestType('sheet')}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-lg text-sm font-medium border transition ${destType === 'sheet' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  <Download className="w-4 h-4" /> Google Sheet
                </button>
                <button type="button" onClick={() => handleSelectDestType('csv')}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-lg text-sm font-medium border transition ${destType === 'csv' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  <FileDown className="w-4 h-4" /> Archivo CSV
                </button>
                <button type="button" onClick={() => handleSelectDestType('apipush')}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-lg text-sm font-medium border transition ${destType === 'apipush' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  <Globe className="w-4 h-4" /> API externa
                </button>
                <button type="button" onClick={() => handleSelectDestType('shopify')}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-lg text-sm font-medium border transition ${destType === 'shopify' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  <Store className="w-4 h-4" /> Shopify
                </button>
              </div>

              {destType !== 'shopify' ? (
                <form onSubmit={handleCreateDestination} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
                    <input value={destName} onChange={e => setDestName(e.target.value)} required
                      placeholder={destType === 'csv' ? 'Ej: KYTE, Effi' : 'Ej: Catálogo, Shopi-Kino'}
                      className="w-full border border-gray-300 rounded-lg p-2 text-sm max-w-md" />
                  </div>

                  {destType === 'apipush' && (
                    <div className="space-y-3">
                      <p className="text-xs text-gray-500">
                        TablasK va a <strong>empujar</strong> las filas de la Maestra a este endpoint: automáticamente tras
                        cada sync (solo lo que cambió) y completo con "Enviar ahora" desde Mis Flujos.
                      </p>
                      <div className="flex gap-2">
                        <select value={apiDestMethod} onChange={e => setApiDestMethod(e.target.value)}
                          className="w-24 border border-gray-300 rounded-lg p-2 text-sm bg-white">
                          <option>POST</option>
                          <option>PUT</option>
                          <option>PATCH</option>
                        </select>
                        <input value={apiDestUrl} onChange={e => setApiDestUrl(e.target.value)} required
                          placeholder="https://api.cliente.com/catalogo"
                          className="flex-1 border border-gray-300 rounded-lg p-2 text-sm" />
                      </div>
                      <input type="password" value={apiDestToken} onChange={e => setApiDestToken(e.target.value)}
                        placeholder='Token de autenticación (opcional), ej: Bearer abc123'
                        className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
                    </div>
                  )}

                  {(destType === 'csv' || destType === 'apipush') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Plantilla</label>
                      <div className="flex flex-wrap gap-2">
                        {exportPresets.map(p => (
                          <button type="button" key={p.key} onClick={() => applyCsvPreset(p)} title={p.description}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${csvPreset?.key === p.key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                            {p.name}
                          </button>
                        ))}
                        <button type="button" onClick={() => applyCsvPreset(null)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${!csvPreset ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                          {destType === 'apipush' ? 'Todas las columnas' : 'Mapeo manual'}
                        </button>
                      </div>
                      {csvPreset && <p className="text-xs text-gray-500 mt-2">{csvPreset.description}</p>}
                    </div>
                  )}

                  {destType === 'sheet' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Conexión Google Sheets</label>
                        <select value={destConnId} onChange={e => loadDestSheets(e.target.value)} required
                          className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                          <option value="">Seleccionar...</option>
                          {connections.filter(c => c.connection_type === 'google_sheets').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Pestaña destino</label>
                        <select value={destSheet} onChange={e => setDestSheet(e.target.value)} required disabled={!destConnId}
                          className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                          <option value="">Seleccionar...</option>
                          {Object.keys(destSheets).map(sh => <option key={sh} value={sh}>{sh}</option>)}
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">🔑 Columna llave en destino (SKU)</label>
                        <select value={destSkuCol} onChange={e => setDestSkuCol(e.target.value)} required disabled={destCols.length === 0}
                          className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white max-w-sm">
                          <option value="">Seleccionar...</option>
                          {destCols.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                    </div>
                  )}

                  {(destType === 'csv' || destType === 'apipush') && csvPreset ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{destType === 'apipush' ? 'Campos que se envían' : 'Columnas del archivo'}</label>
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3">
                        <div className="flex flex-wrap gap-1.5">
                          {csvPreset.spec.map((col, i) => (
                            <span key={i} className="text-xs bg-white border border-gray-200 rounded px-2 py-1 text-gray-600">{col.output}</span>
                          ))}
                        </div>
                      </div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">De qué columna de la Maestra sale cada dato</label>
                      <div className="space-y-2">
                        {presetSourceFields(csvPreset).map(field => (
                          <div key={field} className="flex gap-2 items-center">
                            <span className="text-sm text-gray-600 w-32 flex-shrink-0 font-mono">{field}</span>
                            <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                            <select value={presetFieldMap[field] || ''} onChange={e => setPresetFieldMap({ ...presetFieldMap, [field]: e.target.value })}
                              className={`flex-1 border rounded-md p-1.5 text-sm bg-white ${!presetFieldMap[field] ? 'border-amber-300' : 'border-gray-300'}`}>
                              <option value="">— (queda vacío) —</option>
                              {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : destType === 'apipush' ? (
                    <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
                      Sin plantilla, cada fila se envía con <strong>todas las columnas de la Maestra</strong> tal cual.
                    </p>
                  ) : (
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-sm font-medium text-gray-700">Campos a enviar</label>
                        {destType === 'sheet' && (
                          <button type="button" onClick={handleAutoMapDest} className="bg-gray-100 text-gray-700 px-3 py-1 rounded-md text-xs font-semibold hover:bg-gray-200">
                            ✨ Auto-Mapear
                          </button>
                        )}
                      </div>
                      {destMappings.map((m, i) => (
                        <div key={i} className="flex gap-2 items-center mb-2">
                          <select value={m.src} onChange={e => { const n = [...destMappings]; n[i].src = e.target.value; setDestMappings(n); }}
                            className="flex-1 border border-gray-300 rounded-md p-1.5 text-sm bg-white">
                            <option value="">[Maestra] Columna...</option>
                            {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                          {destType === 'csv' ? (
                            <input value={m.dst} onChange={e => { const n = [...destMappings]; n[i].dst = e.target.value; setDestMappings(n); }}
                              placeholder="Nombre de columna en el CSV..."
                              className="flex-1 border border-gray-300 rounded-md p-1.5 text-sm bg-white" />
                          ) : (
                            <select value={m.dst} onChange={e => { const n = [...destMappings]; n[i].dst = e.target.value; setDestMappings(n); }}
                              className="flex-1 border border-gray-300 rounded-md p-1.5 text-sm bg-white">
                              <option value="">[Destino] Columna...</option>
                              {destCols.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          )}
                          {destMappings.length > 1 && (
                            <button type="button" onClick={() => setDestMappings(destMappings.filter((_, idx) => idx !== i))}
                              className="text-red-400 hover:text-red-600 text-sm">✕</button>
                          )}
                        </div>
                      ))}
                      <button type="button" onClick={() => setDestMappings([...destMappings, { src: '', dst: '' }])}
                        className="text-gray-600 text-sm font-medium hover:underline mt-1">+ Añadir campo</button>
                    </div>
                  )}

                  <button type="submit" disabled={savingDest}
                    className="bg-green-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 text-sm">
                    {savingDest ? 'Guardando...' : 'Guardar destino'}
                  </button>
                </form>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-gray-500">
                    Nunca se crean productos en la tienda: solo se actualizan los que cruzan por SKU.
                  </p>

                  {shopStoreConns.length === 0 ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                      <p className="text-sm text-amber-800 mb-3 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" /> Todavía no conectaste ninguna tienda Shopify.
                      </p>
                      <form onSubmit={handleCreateShopConn} className="space-y-3">
                        <ShopifyConnectFields
                          domain={newShopDomain} setDomain={setNewShopDomain}
                          authMode={newShopAuthMode} setAuthMode={setNewShopAuthMode}
                          clientId={newShopClientId} setClientId={setNewShopClientId}
                          clientSecret={newShopClientSecret} setClientSecret={setNewShopClientSecret}
                          token={newShopToken} setToken={setNewShopToken}
                        />
                        <button type="submit" disabled={creatingShopConn}
                          className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                          {creatingShopConn ? 'Conectando...' : 'Conectar tienda'}
                        </button>
                      </form>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Tienda</label>
                          <select value={shopConnId} onChange={e => setShopConnId(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                            <option value="">Seleccionar...</option>
                            {shopStoreConns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.shopify_domain})</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Hoja de la Maestra a enviar</label>
                          <select value={shopTab} onChange={e => { setShopTab(e.target.value); setShopSkuCol(''); setShopPriceCol(''); setShopStockCol(''); setShopCompareCol(''); setShopBarcodeCol(''); setShopTitleCol(''); setShopProductTypeCol(''); }}
                            className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                            <option value="">Seleccionar...</option>
                            {Object.keys(masterSheetsAll).map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>

                      {shopConnId && (
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Ubicación / Bodega (para el stock)</label>
                          {shopLocError ? (
                            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">{shopLocError} Si la tienda tiene una sola ubicación, igual se puede escribir el stock.</p>
                          ) : (
                            <select value={shopLocId} onChange={e => setShopLocId(e.target.value)}
                              className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white max-w-sm">
                              <option value="">Seleccionar ubicación...</option>
                              {shopLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                            </select>
                          )}
                        </div>
                      )}

                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">🔑 SKU</label>
                        <select value={shopSkuCol} onChange={e => setShopSkuCol(e.target.value)} disabled={!shopTabCols.length}
                          className="w-full max-w-xs border border-gray-300 rounded-lg p-2 text-sm bg-white">
                          <option value="">—</option>
                          {shopTabCols.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>

                      <ShopifyFieldMapper masterCols={shopTabCols} disabled={!shopTabCols.length} fields={[
                        { key: 'price', label: 'Precio', value: shopPriceCol, setValue: setShopPriceCol },
                        { key: 'stock', label: 'Stock', value: shopStockCol, setValue: setShopStockCol },
                        { key: 'compare', label: 'Precio comparativo / oferta', value: shopCompareCol, setValue: setShopCompareCol },
                        { key: 'barcode', label: 'Código de barras', value: shopBarcodeCol, setValue: setShopBarcodeCol },
                        { key: 'title', label: 'Nombre del producto', value: shopTitleCol, setValue: setShopTitleCol },
                        { key: 'product_type', label: 'Categoría', value: shopProductTypeCol, setValue: setShopProductTypeCol },
                      ]} />
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                        Nombre y categoría son a nivel PRODUCTO: si el SKU comparte producto con otras variantes, el cambio afecta al producto entero.
                      </p>

                      <div className="flex gap-2">
                        <button type="button" onClick={() => runShopifyPush(true)} disabled={shopBusy}
                          className="flex items-center gap-2 border border-green-300 text-green-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-50 disabled:opacity-50">
                          <Eye className="w-4 h-4" /> {shopBusy ? 'Calculando...' : 'Previsualizar'}
                        </button>
                        <button type="button"
                          onClick={() => { if (window.confirm('Esto ESCRIBIRÁ precio/stock en la tienda Shopify. ¿Continuar?')) runShopifyPush(false); }}
                          disabled={shopBusy || !shopPreview}
                          className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                          <Send className="w-4 h-4" /> Enviar a Shopify
                        </button>
                      </div>

                      {shopError && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex gap-2">
                          <XCircle className="w-4 h-4 shrink-0" /> {shopError}
                        </div>
                      )}
                      {shopPreview && (
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm">
                          Cruzan (se actualizarán): <b className="text-green-700">{shopPreview.matched}</b> de {shopPreview.total}
                          {shopPreview.not_found_count > 0 && <span className="text-amber-700"> · sin cruzar: {shopPreview.not_found_count}</span>}
                        </div>
                      )}
                      {shopResult && (
                        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
                          ✅ Precios: {shopResult.price_updated} · Stock: {shopResult.stock_updated}
                          {shopResult.compare_price_updated ? ` · Comparativo: ${shopResult.compare_price_updated}` : ''}
                          {shopResult.barcode_updated ? ` · Barcode: ${shopResult.barcode_updated}` : ''}
                          {shopResult.title_updated ? ` · Nombre: ${shopResult.title_updated}` : ''}
                          {shopResult.product_type_updated ? ` · Categoría: ${shopResult.product_type_updated}` : ''}
                        </div>
                      )}

                      <div className="border-t border-gray-200 pt-4">
                        <p className="text-sm font-medium text-gray-700 mb-1">Guardar como destino permanente</p>
                        <p className="text-xs text-gray-500 mb-3">
                          Queda en "Mis Flujos" y se actualiza solo con cada sync de la Maestra.
                        </p>
                        <div className="flex gap-2 items-center">
                          <input value={shopDestName} onChange={e => setShopDestName(e.target.value)}
                            placeholder="Nombre del destino (ej. Shopi-Poe)"
                            className="flex-1 border border-gray-300 rounded-lg p-2 text-sm max-w-xs" />
                          <button type="button" onClick={saveShopifySubscription} disabled={savingShopSub}
                            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                            {savingShopSub ? 'Guardando...' : 'Guardar destino'}
                          </button>
                        </div>
                        {shopSubSaved && (
                          <p className="text-sm text-green-700 mt-2">
                            ✅ Destino "{shopSubSaved.name}" guardado. Lo podés pausar o borrar desde "Mis Flujos".
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
      </div>

      {fileSwapProc && (() => {
        const conn = connById(fileSwapProc.source_connection_id);
        return (
          <ModalShell title={`Antes de correr "${fileSwapProc.name}"`} onClose={() => setFileSwapProc(null)}>
            <p className="text-sm text-gray-600 mb-4">
              Esta fuente lee del archivo <span className="font-medium text-gray-800">"{conn?.name}"</span>
              {conn?.file_updated_at && (
                <> · subido el {new Date(conn.file_updated_at).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })}</>
              )}. Si tenés una versión más nueva, te recomendamos reemplazarlo antes de correr.
            </p>
            {fileSwapError && <p className="text-xs text-red-600 mb-3">{fileSwapError}</p>}
            <div className="flex flex-col gap-2">
              <label className={`flex items-center justify-center gap-2 border-2 border-dashed rounded-lg p-3 text-sm font-medium transition ${fileSwapBusy ? 'border-gray-200 text-gray-400 cursor-wait' : 'border-indigo-300 text-indigo-700 cursor-pointer hover:bg-indigo-50'}`}>
                <UploadCloud className="w-4 h-4" /> {fileSwapBusy ? 'Subiendo...' : 'Reemplazar archivo y correr'}
                <input type="file" accept=".csv,.xls,.xlsx" className="hidden" disabled={fileSwapBusy}
                  onChange={e => handleReplaceAndRun(e.target.files?.[0])} />
              </label>
              <button type="button" disabled={fileSwapBusy}
                onClick={() => { const proc = fileSwapProc; setFileSwapProc(null); setRunProcs([{ id: proc.id, name: proc.name }]); }}
                className="text-sm text-gray-500 hover:underline disabled:opacity-50">
                Continuar con el archivo actual
              </button>
            </div>
          </ModalShell>
        );
      })()}

      {runProcs && (
        <RunFlowModal
          procs={runProcs}
          onClose={() => setRunProcs(null)}
          onDone={() => { refreshMaster(); loadAll(); }}
        />
      )}
    </div>
  );
}
