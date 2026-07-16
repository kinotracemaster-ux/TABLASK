import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { UploadCloud, Link2, Server, Store, ChevronRight, CheckCircle2, ArrowRight, Sparkles, Download, FileDown, Eye, Send, XCircle, AlertTriangle, Globe, Database } from 'lucide-react';
import { extractError, formatError } from '../utils/errors';

const API = import.meta.env.VITE_API_URL || '';

const STEPS = [
  { key: 'origen', label: 'Traer datos' },
  { key: 'mapeo', label: 'Confirmar campos' },
  { key: 'destinos', label: 'Elegir destinos' },
];

// Campos para conectar/crear una tienda Shopify. Se reutiliza en el Paso 1
// (Shopify como origen de lectura) y en el Paso 3 (Shopify como destino de escritura).
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

export default function SourceWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState('origen');
  const [projectId, setProjectId] = useState(null);

  // --- Paso 1: Origen ---
  const [originType, setOriginType] = useState('sheets'); // 'sheets' | 'upload' | 'api' | 'shopify'
  const [sourceName, setSourceName] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [file, setFile] = useState(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const [fileError, setFileError] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [apiMethod, setApiMethod] = useState('GET');
  const [apiHeaders, setApiHeaders] = useState('');
  const [shopDomain, setShopDomain] = useState('');
  const [shopAuthMode, setShopAuthMode] = useState('client');
  const [shopClientId, setShopClientId] = useState('');
  const [shopClientSecret, setShopClientSecret] = useState('');
  const [shopToken, setShopToken] = useState('');
  const [creatingSource, setCreatingSource] = useState(false);
  const [sourceConn, setSourceConn] = useState(null); // conexión creada
  // Reusar algo ya conectado en la app (archivo subido, API, hoja, tienda)
  // en vez de crear una conexión nueva cada vez.
  const [existingConnId, setExistingConnId] = useState('');

  // --- Paso 2: Mapeo ---
  const [sourceSheets, setSourceSheets] = useState({});
  const [sourceSheet, setSourceSheet] = useState('');
  const [masterCols, setMasterCols] = useState([]);
  const [masterSkuCol, setMasterSkuCol] = useState('');
  const [skuColSource, setSkuColSource] = useState('');
  const [fieldMappings, setFieldMappings] = useState([{ src: '', dst: '' }]);
  const [processName, setProcessName] = useState('');
  const [loadingMap, setLoadingMap] = useState(false);
  const [savingProcess, setSavingProcess] = useState(false);

  // --- Paso 3: Destinos ---
  const [destinations, setDestinations] = useState([]); // suscripciones + csv exports ya existentes
  const [destType, setDestType] = useState('sheet'); // 'sheet' | 'csv' | 'apipush' | 'shopify'
  const [destName, setDestName] = useState('');
  const [destConnId, setDestConnId] = useState('');
  const [connections, setConnections] = useState([]);
  const [destSheets, setDestSheets] = useState({});
  const [destSheet, setDestSheet] = useState('');
  const [destSkuCol, setDestSkuCol] = useState('');
  const [destMappings, setDestMappings] = useState([{ src: '', dst: '' }]);
  const [savingDest, setSavingDest] = useState(false);
  // Plantillas de export predefinidas (§11): presets por canal con transformaciones
  const [exportPresets, setExportPresets] = useState([]);
  const [csvPreset, setCsvPreset] = useState(null);       // preset elegido, o null = mapeo manual
  const [presetFieldMap, setPresetFieldMap] = useState({}); // {campo_del_preset: columna_real_de_la_Maestra}
  // Canal API genérica como destino (Maestra → endpoint del cliente)
  const [apiDestUrl, setApiDestUrl] = useState('');
  const [apiDestMethod, setApiDestMethod] = useState('POST');
  const [apiDestToken, setApiDestToken] = useState('');
  const [masterConnId, setMasterConnId] = useState(null); // conexión real de la Maestra global (para el CSV)
  const [masterSheetNameRef, setMasterSheetNameRef] = useState(null);
  const [masterRowsRef, setMasterRowsRef] = useState(null);   // filas de la Maestra (para el banner)
  const [masterChecked, setMasterChecked] = useState(false);  // ya se consultó si hay Maestra
  const [masterSheetsAll, setMasterSheetsAll] = useState({}); // todas las pestañas de la Maestra (para push a Shopify)

  // Shopify como destino: push ahora y/o guardado como destino permanente (fase B)
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

  const sourceCols = sourceSheet && sourceSheets[sourceSheet] ? sourceSheets[sourceSheet] : [];
  const destCols = destType === 'sheet' && destSheet && destSheets[destSheet] ? destSheets[destSheet] : [];
  const shopStoreConns = connections.filter(c => c.connection_type === 'shopify');
  const shopTabCols = shopTab && masterSheetsAll[shopTab] ? masterSheetsAll[shopTab] : [];

  useEffect(() => {
    (async () => {
      try {
        const [projsRes, masterRes, presetsRes, connsRes] = await Promise.all([
          fetch(`${API}/api/projects/`),
          fetch(`${API}/api/master`),
          fetch(`${API}/api/exports/presets`),
          fetch(`${API}/api/connections/`)
        ]);
        if (connsRes.ok) setConnections(await connsRes.json());
        const projs = await projsRes.json();
        if (projs.length > 0) setProjectId(projs[0].id);
        const masterData = await masterRes.json();
        setMasterConnId(masterData.master_connection_id || null);
        setMasterSheetNameRef(masterData.master_sheet_name || null);
        setMasterRowsRef(masterData.total_rows ?? null);
        setMasterChecked(true);
        if (presetsRes.ok) setExportPresets(await presetsRes.json());
      } catch (err) { console.error(err); }
    })();
  }, []);

  const loadDestinations = async (pid) => {
    try {
      const [subsRes, expRes, connsRes, apiSubsRes] = await Promise.all([
        fetch(`${API}/api/subscriptions/?project_id=${pid}`),
        fetch(`${API}/api/exports/?project_id=${pid}`),
        fetch(`${API}/api/connections/`),
        fetch(`${API}/api/api-subscriptions/`)
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

  // ── Paso 1: selección de archivo (drag&drop + validación de extensión) ──
  const ALLOWED_FILE_EXT = ['.csv', '.xls', '.xlsx'];
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
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
  const handleFileDrop = (e) => {
    e.preventDefault();
    setFileDragActive(false);
    pickFile(e.dataTransfer.files?.[0]);
  };

  // Conexiones existentes que sirven como origen para el tipo elegido.
  const ORIGIN_CONN_TYPE = { sheets: 'google_sheets', upload: 'local_file', api: 'http_api', shopify: 'shopify' };
  const existingForType = connections.filter(c => c.connection_type === ORIGIN_CONN_TYPE[originType]);

  const pickOriginType = (t) => {
    setOriginType(t);
    setExistingConnId(''); // al cambiar de tipo, volver a "conectar nueva"
  };

  // ── Paso 1: crear la conexión origen (o reusar una existente) ──
  const handleCreateSource = async (e) => {
    e.preventDefault();
    setCreatingSource(true);
    try {
      // Reuso: la conexión ya existe en la app, no se crea ni se sube nada.
      if (existingConnId) {
        const conn = connections.find(c => c.id === parseInt(existingConnId));
        if (!conn) throw new Error('No se encontró la conexión elegida.');
        setSourceConn(conn);
        setProcessName(`Traer ${conn.name} → Maestra`);
        await loadMappingData(conn.id);
        setStep('mapeo');
        setCreatingSource(false);
        return;
      }

      let conn;
      if (originType === 'upload') {
        if (!file) { alert('Elegí un archivo primero.'); setCreatingSource(false); return; }
        const form = new FormData();
        form.append('name', sourceName || file.name);
        form.append('file', file);
        const res = await fetch(`${API}/api/connections/upload`, { method: 'POST', body: form });
        if (!res.ok) throw new Error(await extractError(res));
        conn = await res.json();
      } else if (originType === 'api') {
        const res = await fetch(`${API}/api/connections/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: sourceName || 'Nueva fuente', connection_type: 'http_api',
            http_url: apiUrl, http_method: apiMethod, http_headers: apiHeaders || null
          })
        });
        if (!res.ok) throw new Error(await extractError(res));
        conn = await res.json();
      } else if (originType === 'shopify') {
        if (!shopDomain) { alert('Falta el dominio de la tienda.'); setCreatingSource(false); return; }
        const body = { name: sourceName || 'Nueva fuente', connection_type: 'shopify', shopify_domain: shopDomain };
        if (shopAuthMode === 'token') body.shopify_access_token = shopToken;
        else { body.shopify_client_id = shopClientId; body.shopify_client_secret = shopClientSecret; }
        const res = await fetch(`${API}/api/connections/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(await extractError(res));
        conn = await res.json();
      } else {
        const res = await fetch(`${API}/api/connections/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: sourceName || 'Nueva fuente', connection_type: 'google_sheets', google_sheet_url: sheetUrl })
        });
        if (!res.ok) throw new Error(await extractError(res));
        conn = await res.json();
      }
      setSourceConn(conn);
      setProcessName(`Traer ${conn.name} → Maestra`);
      await loadMappingData(conn.id);
      setStep('mapeo');
    } catch (err) {
      alert(err.message || 'No se pudo crear la fuente.');
    }
    setCreatingSource(false);
  };

  // ── Paso 2: cargar hojas/columnas y auto-mapear ──
  const loadMappingData = async (connId) => {
    setLoadingMap(true);
    try {
      const [metaRes, masterColsRes, masterRes] = await Promise.all([
        fetch(`${API}/api/connections/${connId}/metadata`),
        fetch(`${API}/api/master-columns`),
        fetch(`${API}/api/master`)
      ]);
      const meta = await metaRes.json();
      if (!metaRes.ok) throw new Error(meta.detail || 'No se pudo leer el origen.');
      const sheets = meta.sheets || {};
      setSourceSheets(sheets);
      const firstSheet = Object.keys(sheets)[0] || '';
      setSourceSheet(firstSheet);

      const mColsData = await masterColsRes.json();
      const mCols = masterColsRes.ok && Array.isArray(mColsData) ? mColsData : [];
      setMasterCols(mCols);
      if (!masterColsRes.ok) alert('No se pudieron leer las columnas de la Tabla Maestra. Revisá que esté enlazada y accesible.');
      const masterInfo = await masterRes.json();
      setMasterSkuCol(masterRes.ok ? (masterInfo.master_sku_column || '') : '');

      if (firstSheet && sheets[firstSheet]) {
        await autoDetect(connId, firstSheet, sheets[firstSheet], mCols);
      }
    } catch (err) {
      alert(err.message);
    }
    setLoadingMap(false);
  };

  const autoDetect = async (connId, sheetName, headers, mCols) => {
    try {
      const [skuRes, mapRes] = await Promise.all([
        fetch(`${API}/api/intelligence/suggest-sku?connection_id=${connId}&sheet_name=${encodeURIComponent(sheetName)}`),
        fetch(`${API}/api/intelligence/auto-map`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_headers: headers, target_headers: mCols })
        })
      ]);
      const skuData = await skuRes.json();
      const mapData = await mapRes.json();
      const suggestedSku = skuData.suggested_sku || headers[0] || '';
      setSkuColSource(suggestedSku);

      const mapped = Object.entries(mapData.mapping || {})
        .filter(([src]) => src !== suggestedSku)
        .map(([src, dst]) => ({ src, dst }));
      setFieldMappings(mapped.length > 0 ? mapped : [{ src: '', dst: '' }]);
    } catch (err) { console.error('Auto-detect falló', err); }
  };

  const handleSheetChange = async (sheetName) => {
    setSourceSheet(sheetName);
    const headers = sourceSheets[sheetName] || [];
    await autoDetect(sourceConn.id, sheetName, headers, masterCols);
  };

  const handleSaveProcess = async (e) => {
    e.preventDefault();
    const mappings = {};
    fieldMappings.forEach(({ src, dst }) => { if (src && dst) mappings[src] = dst; });
    if (!skuColSource || !masterSkuCol) {
      alert('Falta confirmar la columna SKU (origen y maestra).');
      return;
    }
    if (Object.keys(mappings).length === 0) {
      alert('Agregá al menos un campo (nombre, precio o stock).');
      return;
    }
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
          field_mappings: mappings,
          add_new_rows: true,
          is_active: true
        })
      });
      if (!res.ok) throw new Error(await extractError(res));
      if (projectId) await loadDestinations(projectId);
      setStep('destinos');
    } catch (err) {
      alert(err.message || 'No se pudo guardar.');
    }
    setSavingProcess(false);
  };

  // ── Paso 3: destinos Sheets/CSV ──
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
        body: JSON.stringify({ source_headers: masterCols, target_headers: destCols })
      });
      const data = await res.json();
      const newMappings = Object.entries(data.mapping || {})
        .filter(([, dst]) => dst !== destSkuCol)
        .map(([src, dst]) => ({ src, dst }));
      if (newMappings.length > 0) setDestMappings(newMappings);
    } catch (err) { console.error(err); }
  };

  // Campos del núcleo que usa un preset (source/sources/refs de template)
  const presetSourceFields = (preset) => {
    const fields = new Set();
    (preset?.spec || []).forEach(col => {
      if (col.source) fields.add(col.source);
      (col.sources || []).forEach(s => fields.add(s));
      if (col.type === 'template') (col.template.match(/\{([^{}]+)\}/g) || []).forEach(m => fields.add(m.slice(1, -1)));
    });
    return [...fields];
  };

  // Al elegir una plantilla: auto-mapear sus campos contra las columnas reales de la Maestra
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

  // Reescribe el spec del preset con las columnas reales elegidas
  const buildTransformSpec = (preset, fmap) => preset.spec.map(col => {
    const nc = { ...col };
    if (col.source) nc.source = fmap[col.source] || col.source;
    if (col.sources) nc.sources = col.sources.map(s => fmap[s] || s);
    if (col.type === 'template') nc.template = col.template.replace(/\{([^{}]+)\}/g, (m, f) => `{${fmap[f] || f}}`);
    return nc;
  });

  const handleCreateDestination = async (e) => {
    e.preventDefault();

    // Canal API genérica: TablasK empuja las filas de la Maestra al endpoint
    // del cliente (diff automático tras cada sync + "Enviar ahora" en Flujos).
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
            is_active: true
          })
        });
        if (!res.ok) throw new Error(await extractError(res));
        setDestName(''); setApiDestUrl(''); setApiDestToken(''); setCsvPreset(null); setPresetFieldMap({});
        await loadDestinations(projectId);
        alert('✅ Canal API guardado. Se actualizará solo con cada sync; también podés "Enviar ahora" desde Mis Flujos.');
      } catch (err) {
        alert(err.message || 'No se pudo crear el canal API.');
      }
      setSavingDest(false);
      return;
    }

    // CSV con plantilla: se guarda transform_spec en vez de mapeo manual.
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
            source_sheet_name: masterSheetNameRef,
            columns_mapping: {},
            transform_spec: buildTransformSpec(csvPreset, presetFieldMap),
            output_type: 'csv_download'
          })
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
    if (Object.keys(mappings).length === 0) {
      alert('Agregá al menos un campo a enviar.');
      return;
    }
    setSavingDest(true);
    try {
      let res;
      if (destType === 'csv') {
        if (!masterConnId) {
          alert('No hay una Tabla Maestra enlazada todavía.');
          setSavingDest(false);
          return;
        }
        res = await fetch(`${API}/api/exports/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: destName || 'Nueva exportación CSV',
            project_id: projectId,
            source_connection_id: masterConnId,
            source_sheet_name: masterSheetNameRef,
            columns_mapping: mappings,
            output_type: 'csv_download'
          })
        });
      } else {
        if (!destConnId || !destSheet || !destSkuCol) {
          alert('Elegí conexión, pestaña y columna llave del destino.');
          setSavingDest(false);
          return;
        }
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
            name: destName || 'Nueva Suscripción'
          })
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

  // ── Paso 3: destino Shopify (push ahora) ──
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
      // Preseleccionar la pestaña principal de la Maestra: es la que se
      // actualiza con cada sync y la que alimenta el destino permanente.
      if (!shopTab && masterSheetNameRef) setShopTab(masterSheetNameRef);
    }
  };

  const saveShopifySubscription = async () => {
    setShopError(null); setShopSubSaved(null);
    if (!shopConnId) { setShopError('Elegí la tienda Shopify.'); return; }
    if (!shopPriceCol && !shopStockCol) { setShopError('Mapeá al menos Precio o Stock para guardar el destino.'); return; }
    if (shopStockCol && shopLocations.length > 1 && !shopLocId) {
      setShopError('Tu tienda tiene varias bodegas: elegí la ubicación destino del stock.'); return;
    }
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(await extractError(res));
      const conn = await res.json();
      setConnections([...connections, conn]);
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
    if (!shopPriceCol && !shopStockCol) { setShopError('Mapeá al menos Precio o Stock.'); return; }
    if (shopStockCol && shopLocations.length > 1 && !shopLocId) {
      setShopError('Tu tienda tiene varias bodegas: elegí la ubicación destino del stock.'); return;
    }
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

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-indigo-600" /> Nueva Fuente
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Traé tus datos, confirmá los campos y elegí a dónde se distribuyen. Sin pasos de más.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-6">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
              step === s.key ? 'bg-indigo-600 text-white' :
              STEPS.findIndex(x => x.key === step) > i ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-400'
            }`}>
              {STEPS.findIndex(x => x.key === step) > i ? <CheckCircle2 className="w-4 h-4" /> : <span>{i + 1}</span>}
              {s.label}
            </div>
            {i < STEPS.length - 1 && <ChevronRight className="w-4 h-4 text-gray-300" />}
          </div>
        ))}
      </div>

      {/* A dónde van los datos: la Maestra ya enlazada (o el aviso si falta) */}
      {masterChecked && (masterConnId ? (
        <div className="mb-6 flex items-center gap-2 text-sm bg-indigo-50/60 border border-indigo-100 rounded-xl px-4 py-2.5 text-gray-600">
          <Database className="w-4 h-4 text-indigo-500 flex-shrink-0" />
          <span>
            Esta fuente va a alimentar tu Maestra:&nbsp;
            <span className="font-semibold text-gray-800">"{masterSheetNameRef}"</span>
            {masterRowsRef != null && <span className="text-gray-400"> · {masterRowsRef} filas</span>}
          </span>
          <Link to="/" className="ml-auto text-indigo-600 font-medium hover:underline flex-shrink-0">Ver Maestra →</Link>
        </div>
      ) : (
        <div className="mb-6 flex items-center gap-2 text-sm bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-amber-800">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <span>Todavía no hay una Tabla Maestra enlazada: los datos no tendrán a dónde escribirse.</span>
          <Link to="/" className="ml-auto text-amber-700 font-semibold hover:underline flex-shrink-0">Enlazarla primero →</Link>
        </div>
      ))}

      {/* Paso 1: Origen */}
      {step === 'origen' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
            <button type="button" onClick={() => pickOriginType('sheets')}
              className={`flex flex-col items-center justify-center gap-1 p-3 rounded-lg text-xs font-medium border transition ${originType === 'sheets' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              <Link2 className="w-4 h-4" /> Google Sheet
            </button>
            <button type="button" onClick={() => pickOriginType('upload')}
              className={`flex flex-col items-center justify-center gap-1 p-3 rounded-lg text-xs font-medium border transition ${originType === 'upload' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              <UploadCloud className="w-4 h-4" /> Subir archivo
            </button>
            <button type="button" onClick={() => pickOriginType('api')}
              className={`flex flex-col items-center justify-center gap-1 p-3 rounded-lg text-xs font-medium border transition ${originType === 'api' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              <Server className="w-4 h-4" /> API externa
            </button>
            <button type="button" onClick={() => pickOriginType('shopify')}
              className={`flex flex-col items-center justify-center gap-1 p-3 rounded-lg text-xs font-medium border transition ${originType === 'shopify' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              <Store className="w-4 h-4" /> Shopify
            </button>
          </div>

          <form onSubmit={handleCreateSource} className="space-y-4">
            {/* Reusar lo ya conectado o subido en la app (no vuelve a crear nada) */}
            {existingForType.length > 0 && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Ya tenés {existingForType.length} conexión(es) de este tipo — ¿usar una?
                </label>
                <select value={existingConnId} onChange={e => setExistingConnId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white max-w-md">
                  <option value="">— No, conectar una nueva —</option>
                  {existingForType.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.connection_type === 'shopify' && c.shopify_domain ? ` (${c.shopify_domain})` : ''}
                    </option>
                  ))}
                </select>
                {existingConnId && (
                  <p className="text-xs text-green-600 mt-1.5">
                    ✓ Se reusa tal cual está conectada: pasás directo a confirmar los campos.
                  </p>
                )}
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

            {!existingConnId && originType === 'sheets' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL del Google Sheet</label>
                <input key="sheetUrl" value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} required
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
              </div>
            )}

            {!existingConnId && originType === 'upload' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Archivo base (.csv, .xls, .xlsx)</label>
                <p className="text-xs text-gray-500 mb-2">Este archivo se usará para actualizar el sistema: arrastralo o hacé click para elegirlo.</p>

                {!file ? (
                  <label
                    htmlFor="fileInput"
                    onDragOver={e => { e.preventDefault(); setFileDragActive(true); }}
                    onDragLeave={e => { e.preventDefault(); setFileDragActive(false); }}
                    onDrop={handleFileDrop}
                    className={`flex flex-col items-center justify-center gap-2 text-center border-2 border-dashed rounded-xl p-8 cursor-pointer transition ${
                      fileDragActive ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 hover:border-indigo-400 hover:bg-gray-50'
                    }`}
                  >
                    <UploadCloud className={`w-8 h-8 ${fileDragActive ? 'text-indigo-600' : 'text-gray-400'}`} />
                    <p className="text-sm font-medium text-gray-700">
                      Arrastrá tu archivo acá o <span className="text-indigo-600">buscalo en tu computadora</span>
                    </p>
                    <p className="text-xs text-gray-400">CSV, XLS o XLSX</p>
                    <input id="fileInput" key="fileInput" type="file" accept=".csv,.xls,.xlsx"
                      onChange={e => pickFile(e.target.files?.[0])}
                      className="hidden" />
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
                    <div className="flex items-center gap-2 shrink-0">
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                      <button type="button" onClick={() => { setFile(null); setFileError(''); }}
                        className="text-gray-400 hover:text-red-600" title="Quitar archivo">
                        <XCircle className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                )}

                {fileError && (
                  <p className="flex items-center gap-1 text-xs text-red-600 mt-2">
                    <AlertTriangle className="w-3.5 h-3.5" /> {fileError}
                  </p>
                )}
              </div>
            )}

            {!existingConnId && originType === 'api' && (
              <div key="apiFields" className="space-y-3">
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

            {!existingConnId && originType === 'shopify' && (
              <div key="shopifyFields">
                <ShopifyConnectFields
                  domain={shopDomain} setDomain={setShopDomain}
                  authMode={shopAuthMode} setAuthMode={setShopAuthMode}
                  clientId={shopClientId} setClientId={setShopClientId}
                  clientSecret={shopClientSecret} setClientSecret={setShopClientSecret}
                  token={shopToken} setToken={setShopToken}
                />
              </div>
            )}

            <button type="submit" disabled={creatingSource}
              className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 text-sm">
              {creatingSource ? (existingConnId ? 'Leyendo columnas...' : 'Conectando...')
                : <>{existingConnId ? 'Usar esta conexión' : 'Siguiente'} <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>
        </div>
      )}

      {/* Paso 2: Mapeo */}
      {step === 'mapeo' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          {loadingMap ? (
            <p className="text-gray-500 text-sm">Leyendo columnas y sugiriendo el mapeo...</p>
          ) : (
            <form onSubmit={handleSaveProcess} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del proceso</label>
                <input value={processName} onChange={e => setProcessName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm max-w-md" />
              </div>

              {Object.keys(sourceSheets).length > 1 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pestaña / hoja</label>
                  <select value={sourceSheet} onChange={e => handleSheetChange(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm max-w-sm bg-white">
                    {Object.keys(sourceSheets).map(sh => <option key={sh} value={sh}>{sh}</option>)}
                  </select>
                </div>
              )}

              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-indigo-800 mb-1">🔑 Columna SKU en el origen</label>
                    <select value={skuColSource} onChange={e => setSkuColSource(e.target.value)}
                      className="w-full border border-indigo-200 rounded-lg p-2 text-sm bg-white">
                      <option value="">Seleccionar...</option>
                      {sourceCols.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-indigo-800 mb-1">🔑 Columna SKU en la Maestra</label>
                    <select value={masterSkuCol} onChange={e => setMasterSkuCol(e.target.value)}
                      className="w-full border border-indigo-200 rounded-lg p-2 text-sm bg-white">
                      <option value="">Seleccionar...</option>
                      {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                <div className="flex justify-between items-center mb-2">
                  <div>
                    <label className="block text-sm font-medium text-indigo-800">Campos (nombre, precio, stock...)</label>
                    <p className="text-xs text-indigo-600">Ya vienen auto-sugeridos; ajustá si hace falta.</p>
                  </div>
                </div>
                {fieldMappings.map((m, i) => (
                  <div key={i} className="flex gap-2 items-center mb-2">
                    <select value={m.src} onChange={e => {
                      const n = [...fieldMappings]; n[i].src = e.target.value; setFieldMappings(n);
                    }} className="flex-1 border border-indigo-200 rounded-md p-1.5 text-sm bg-white">
                      <option value="">[Origen] Columna...</option>
                      {sourceCols.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <ChevronRight className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                    <select value={m.dst} onChange={e => {
                      const n = [...fieldMappings]; n[i].dst = e.target.value; setFieldMappings(n);
                    }} className="flex-1 border border-indigo-200 rounded-md p-1.5 text-sm bg-white">
                      <option value="">[Maestra] Columna...</option>
                      {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {fieldMappings.length > 1 && (
                      <button type="button" onClick={() => setFieldMappings(fieldMappings.filter((_, idx) => idx !== i))}
                        className="text-red-400 hover:text-red-600 text-sm">✕</button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => setFieldMappings([...fieldMappings, { src: '', dst: '' }])}
                  className="text-indigo-600 text-sm font-medium hover:underline mt-1">+ Añadir campo</button>
              </div>

              <div className="flex gap-2">
                <button type="submit" disabled={savingProcess}
                  className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 text-sm">
                  {savingProcess ? 'Guardando...' : <>Siguiente <ArrowRight className="w-4 h-4" /></>}
                </button>
                <button type="button" onClick={() => setStep('origen')}
                  className="text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 text-sm font-medium">Volver</button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Paso 3: Destinos */}
      {step === 'destinos' && (
        <div className="space-y-5">
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
            <div>
              <p className="font-semibold text-green-800">Fuente lista y activa.</p>
              <p className="text-sm text-green-700">Ya la va a tomar "⚡ Correr Procesos" en la próxima corrida. Ahora, opcionalmente, elegí a dónde se distribuyen los datos enriquecidos.</p>
            </div>
          </div>

          {destinations.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-sm font-semibold text-gray-700 mb-2">Destinos ya configurados</p>
              <div className="flex flex-wrap gap-2">
                {destinations.map(d => (
                  <span key={d.id} className="text-xs bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full">
                    {d.kind === 'CSV' ? <FileDown className="w-3 h-3 inline mr-1" /> : <Download className="w-3 h-3 inline mr-1" />}
                    {d.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Agregar un destino</h3>
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
                      TablasK va a <strong>empujar</strong> las filas de la Maestra a este endpoint: automáticamente tras cada
                      sync (solo lo que cambió) y completo con "Enviar ahora" desde Mis Flujos. Nunca borra nada en el destino.
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
                        <button type="button" key={p.key} onClick={() => applyCsvPreset(p)}
                          title={p.description}
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
                    <p className="text-xs text-gray-500 mb-3">
                      Estas columnas se generan solas (precio ×2, SKU embebido, slug…). Abajo confirmás de qué columna de la Maestra sale cada dato; lo que no coincida, elegilo a mano.
                    </p>
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
                    Sin plantilla, cada fila se envía con <strong>todas las columnas de la Maestra</strong> tal cual
                    (JSON: una fila = un objeto columna→valor).
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
                      <select value={m.src} onChange={e => {
                        const n = [...destMappings]; n[i].src = e.target.value; setDestMappings(n);
                      }} className="flex-1 border border-gray-300 rounded-md p-1.5 text-sm bg-white">
                        <option value="">[Maestra] Columna...</option>
                        {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                      {destType === 'csv' ? (
                        <input value={m.dst} onChange={e => {
                          const n = [...destMappings]; n[i].dst = e.target.value; setDestMappings(n);
                        }} placeholder="Nombre de columna en el CSV..."
                          className="flex-1 border border-gray-300 rounded-md p-1.5 text-sm bg-white" />
                      ) : (
                        <select value={m.dst} onChange={e => {
                          const n = [...destMappings]; n[i].dst = e.target.value; setDestMappings(n);
                        }} className="flex-1 border border-gray-300 rounded-md p-1.5 text-sm bg-white">
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
                  Elegí la tienda, revisá la previsualización y mandá cuando quieras. Si además lo guardás como
                  destino permanente, el precio/stock se enviará solo cada vez que se actualice la Maestra.
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
                        <select value={shopTab} onChange={e => { setShopTab(e.target.value); setShopSkuCol(''); setShopPriceCol(''); setShopStockCol(''); }}
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

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">🔑 SKU</label>
                        <select value={shopSkuCol} onChange={e => setShopSkuCol(e.target.value)} disabled={!shopTabCols.length}
                          className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                          <option value="">—</option>
                          {shopTabCols.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Precio</label>
                        <select value={shopPriceCol} onChange={e => setShopPriceCol(e.target.value)} disabled={!shopTabCols.length}
                          className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                          <option value="">— no enviar —</option>
                          {shopTabCols.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Stock</label>
                        <select value={shopStockCol} onChange={e => setShopStockCol(e.target.value)} disabled={!shopTabCols.length}
                          className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                          <option value="">— no enviar —</option>
                          {shopTabCols.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                    </div>

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
                      </div>
                    )}

                    <div className="border-t border-gray-200 pt-4">
                      <p className="text-sm font-medium text-gray-700 mb-1">Guardar como destino permanente</p>
                      <p className="text-xs text-gray-500 mb-3">
                        Queda en "Mis Flujos" y se actualiza automáticamente con cada sincronización de la Maestra
                        (solo se envían los SKUs que cambiaron precio/stock).
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
          </div>

          <button onClick={() => navigate('/')}
            className="flex items-center gap-2 bg-gray-800 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-gray-900 text-sm">
            Terminar e ir a la Tabla Maestra <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
