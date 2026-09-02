import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Settings2, Download, Link2, Power, Trash2, FileDown, Plus, CheckCircle2, Pencil, X, ChevronRight, ArrowRight, Store, Send, Zap, Globe, Copy, Check, Database, AlertTriangle, UploadCloud } from 'lucide-react';
import { extractError, formatError } from '../utils/errors';
import RunFlowModal from './RunFlowModal';
import ShopifyPushModal from './ShopifyPushModal';
import ShopifyFieldMapper from './ShopifyFieldMapper';
import AutoSyncPanel from './AutoSyncPanel';

const API = import.meta.env.VITE_API_URL || '';

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

function MappingEditor({ mappings, setMappings, srcOptions, dstOptions, srcLabel, dstLabel }) {
  return (
    <div>
      {mappings.map((m, i) => (
        <div key={i} className="flex gap-2 items-center mb-2">
          <select value={m.src} onChange={e => { const n = [...mappings]; n[i] = { ...n[i], src: e.target.value }; setMappings(n); }}
            className="flex-1 border border-gray-300 rounded-md p-1.5 text-sm bg-white">
            <option value="">[{srcLabel}] Columna...</option>
            {srcOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
          <select value={m.dst} onChange={e => { const n = [...mappings]; n[i] = { ...n[i], dst: e.target.value }; setMappings(n); }}
            className="flex-1 border border-gray-300 rounded-md p-1.5 text-sm bg-white">
            <option value="">[{dstLabel}] Columna...</option>
            {dstOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {mappings.length > 1 && (
            <button type="button" onClick={() => setMappings(mappings.filter((_, idx) => idx !== i))}
              className="text-red-400 hover:text-red-600 text-sm">✕</button>
          )}
        </div>
      ))}
      <button type="button" onClick={() => setMappings([...mappings, { src: '', dst: '' }])}
        className="text-indigo-600 text-sm font-medium hover:underline mt-1">+ Añadir campo</button>
    </div>
  );
}

export default function Flujos() {
  const [loading, setLoading] = useState(true);
  const [processes, setProcesses] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [shopifySubs, setShopifySubs] = useState([]);
  const [apiSubs, setApiSubs] = useState([]);
  const [exports, setExports] = useState([]);
  const [connections, setConnections] = useState([]);
  const [testing, setTesting] = useState(null);
  const [shopPushModal, setShopPushModal] = useState(null); // {id, name} del destino a previsualizar/enviar
  const [pushingApiSub, setPushingApiSub] = useState(null);
  const [copiedLink, setCopiedLink] = useState(null);
  const [runProcs, setRunProcs] = useState(null); // [{id, name}] a correr en el modal de vista previa

  // Recomendación de reemplazar el archivo antes de correr una Fuente puntual
  // (solo si su origen es un archivo local; no aplica a "Correr todo").
  const [fileSwapProc, setFileSwapProc] = useState(null); // {id, name, source_connection_id} pendiente de decisión
  const [fileSwapBusy, setFileSwapBusy] = useState(false);
  const [fileSwapError, setFileSwapError] = useState(null);

  // Deep-link desde el diagrama (PipelineBar): /flujos?action=...&node=...
  const [searchParams, setSearchParams] = useSearchParams();
  const handledDeepLink = useRef(false);

  // Maestra enlazada (para el banner "a dónde va todo")
  const [masterInfo, setMasterInfo] = useState(null);   // {sheet, rows} o null
  const [masterChecked, setMasterChecked] = useState(false);

  // --- Edición: Destino API genérica ---
  const [editApiSub, setEditApiSub] = useState(null);
  const [editApiSaving, setEditApiSaving] = useState(false);
  const [eaName, setEaName] = useState('');
  const [eaUrl, setEaUrl] = useState('');
  const [eaMethod, setEaMethod] = useState('POST');
  const [eaToken, setEaToken] = useState('');

  // --- Edición: Fuente (Proceso) ---
  const [editProc, setEditProc] = useState(null);
  const [editProcSheets, setEditProcSheets] = useState({});
  const [editProcMasterCols, setEditProcMasterCols] = useState([]);
  const [editProcLoading, setEditProcLoading] = useState(false);
  const [editProcSaving, setEditProcSaving] = useState(false);
  const [epName, setEpName] = useState('');
  const [epSheet, setEpSheet] = useState('');
  const [epSkuSrc, setEpSkuSrc] = useState('');
  const [epSkuMaster, setEpSkuMaster] = useState('');
  const [epMappings, setEpMappings] = useState([{ src: '', dst: '' }]);
  const [epAddNewRows, setEpAddNewRows] = useState(true);
  const [epZeroMissingStock, setEpZeroMissingStock] = useState(false);

  // --- Edición: Destino Shopify (Maestra → tienda) ---
  const [editShopSub, setEditShopSub] = useState(null);
  const [editShopSubSaving, setEditShopSubSaving] = useState(false);
  const [editShopSubCols, setEditShopSubCols] = useState([]);
  const [essName, setEssName] = useState('');
  const [essConnId, setEssConnId] = useState('');
  const [essPrice, setEssPrice] = useState('');
  const [essStock, setEssStock] = useState('');
  const [essCompare, setEssCompare] = useState('');
  const [essBarcode, setEssBarcode] = useState('');
  const [essTitle, setEssTitle] = useState('');
  const [essProductType, setEssProductType] = useState('');
  const [essLocation, setEssLocation] = useState('');

  // --- Edición: Destino (Suscripción) ---
  const [editSub, setEditSub] = useState(null);
  const [editSubSheets, setEditSubSheets] = useState({});
  const [editSubMasterCols, setEditSubMasterCols] = useState([]);
  const [editSubLoading, setEditSubLoading] = useState(false);
  const [editSubSaving, setEditSubSaving] = useState(false);
  const [esName, setEsName] = useState('');
  const [esSheet, setEsSheet] = useState('');
  const [esSkuTarget, setEsSkuTarget] = useState('');
  const [esMappings, setEsMappings] = useState([{ src: '', dst: '' }]);

  // --- Edición: Conexión ---
  const [editConn, setEditConn] = useState(null);
  const [editConnSaving, setEditConnSaving] = useState(false);
  const [ecName, setEcName] = useState('');
  const [ecSheetUrl, setEcSheetUrl] = useState('');
  const [ecHttpUrl, setEcHttpUrl] = useState('');
  const [ecHttpMethod, setEcHttpMethod] = useState('GET');
  const [ecHttpHeaders, setEcHttpHeaders] = useState('');
  const [ecShopDomain, setEcShopDomain] = useState('');
  const [ecShopAuthMode, setEcShopAuthMode] = useState('client');
  const [ecShopClientId, setEcShopClientId] = useState('');
  const [ecShopClientSecret, setEcShopClientSecret] = useState('');
  const [ecShopToken, setEcShopToken] = useState('');

  // --- Selección múltiple (borrar en masa) ---
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState({ proc: [], shopSub: [], apiSub: [], sub: [], exp: [], conn: [] });
  const [bulkDeleting, setBulkDeleting] = useState(false);

  useEffect(() => { loadAll(); }, []);

  // Solo la PRIMERA carga bloquea la pantalla entera con "Cargando...". Sin
  // esto, cada refresco posterior (ej. el que dispara onDone tras confirmar
  // un flujo) desmontaba TODO — incluido el modal recién cerrado con el
  // resultado — porque el gate de "loading" está antes del return del JSX.
  // El usuario nunca llegaba a ver si el envío salió bien.
  const loadedOnce = useRef(false);

  const loadAll = async () => {
    if (!loadedOnce.current) setLoading(true);
    try {
      const projsRes = await fetch(`${API}/api/projects/`);
      const projs = await projsRes.json();
      const pid = projs[0]?.id;

      // Maestra enlazada (para el banner). Tolerante a fallo: no rompe la pantalla.
      try {
        const masterRes = await fetch(`${API}/api/master`);
        const m = await masterRes.json();
        setMasterInfo(masterRes.ok && m.master_connection_id
          ? { sheet: m.master_sheet_name, rows: m.total_rows ?? null, connectionId: m.master_connection_id }
          : null);
      } catch { setMasterInfo(null); }
      setMasterChecked(true);

      const [procsRes, connsRes, subsRes, expRes, shopSubsRes, apiSubsRes] = await Promise.all([
        fetch(`${API}/api/processes/`),
        fetch(`${API}/api/connections/`),
        pid ? fetch(`${API}/api/subscriptions/?project_id=${pid}`) : Promise.resolve(null),
        pid ? fetch(`${API}/api/exports/?project_id=${pid}`) : Promise.resolve(null),
        fetch(`${API}/api/shopify-subscriptions/`),
        fetch(`${API}/api/api-subscriptions/`),
      ]);
      setProcesses(await procsRes.json());
      setConnections(await connsRes.json());
      setSubscriptions(subsRes ? await subsRes.json() : []);
      setExports(expRes ? await expRes.json() : []);
      setShopifySubs(shopSubsRes.ok ? await shopSubsRes.json() : []);
      setApiSubs(apiSubsRes.ok ? await apiSubsRes.json() : []);
    } catch (err) { console.error(err); }
    setLoading(false);
    loadedOnce.current = true;
  };

  const connName = (id) => connections.find(c => c.id === id)?.name || `Conexión ${id}`;

  // Pastilla visual para mostrar "de qué Conexión viene/a qué Conexión va" en
  // las tarjetas de Fuente/Destino — mismo look en todos lados para que se
  // note que es LA MISMA conexión que aparece abajo, en "Conexiones".
  const ConnBadge = ({ id }) => (
    <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded-md text-xs font-medium">
      <Link2 className="w-3 h-3 text-gray-400" /> {connName(id)}
    </span>
  );

  // Para qué se está usando una Conexión ahora mismo (Fuente y/o Destino/s).
  // Se muestra dentro de la tarjeta de Conexiones para que no sea un dato
  // suelto: si no se usa en nada, se avisa (útil para detectar duplicados
  // viejos que ya no hacen falta).
  const connUsage = (id) => [
    ...(masterInfo?.connectionId === id ? [{ label: 'Es tu Tabla Maestra', kind: 'master' }] : []),
    ...processes.filter(p => p.source_connection_id === id).map(p => ({ label: `Fuente: ${p.name}`, kind: 'proc' })),
    ...shopifySubs.filter(s => s.connection_id === id).map(s => ({ label: `Destino Shopify: ${s.name}`, kind: 'shopSub' })),
    ...subscriptions.filter(s => s.target_connection_id === id).map(s => ({ label: `Destino Sheets: ${s.name}`, kind: 'sub' })),
  ];

  // Antes de correr una Fuente cuyo origen es un archivo local, ofrecemos
  // reemplazarlo por uno más nuevo (recomendación, no obligatorio).
  const maybeRunProc = (proc) => {
    const conn = connections.find(c => c.id === proc.source_connection_id);
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
      setConnections(prev => prev.map(c => c.id === data.id ? data : c));
      const proc = fileSwapProc;
      setFileSwapProc(null);
      setRunProcs([{ id: proc.id, name: proc.name }]);
    } catch (err) {
      setFileSwapError(err.message || 'No se pudo reemplazar el archivo.');
    }
    setFileSwapBusy(false);
  };

  // --- Fuentes (Procesos) ---
  const toggleProcess = async (proc) => {
    const res = await fetch(`${API}/api/processes/${proc.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...proc, is_active: !proc.is_active })
    });
    if (res.ok) loadAll();
    else alert(await extractError(res));
  };

  const deleteProcess = async (id) => {
    if (!window.confirm('¿Eliminar esta fuente?')) return;
    const res = await fetch(`${API}/api/processes/${id}`, { method: 'DELETE' });
    if (res.ok) loadAll();
    else alert(await extractError(res));
  };

  // --- Destinos (Suscripciones) ---
  const toggleSub = async (sub) => {
    const res = await fetch(`${API}/api/subscriptions/${sub.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sub, is_active: !sub.is_active })
    });
    if (res.ok) loadAll();
    else alert(await extractError(res));
  };

  const deleteSub = async (id) => {
    if (!window.confirm('¿Eliminar este destino?')) return;
    await fetch(`${API}/api/subscriptions/${id}`, { method: 'DELETE' });
    loadAll();
  };

  // --- Destinos (Suscripciones Shopify: Maestra → tienda) ---
  const toggleShopSub = async (sub) => {
    const res = await fetch(`${API}/api/shopify-subscriptions/${sub.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sub, is_active: !sub.is_active })
    });
    if (res.ok) loadAll();
    else alert(await extractError(res));
  };

  const deleteShopSub = async (id) => {
    if (!window.confirm('¿Eliminar este destino Shopify? (No borra nada en la tienda)')) return;
    const res = await fetch(`${API}/api/shopify-subscriptions/${id}`, { method: 'DELETE' });
    if (res.ok) loadAll();
    else alert(await extractError(res));
  };

  // Abre el modal de preview (SKU/campo/antes→después) — el envío real queda
  // a cargo del modal, recién al confirmar (ver ShopifyPushModal.jsx).
  const pushNowShopSub = (sub) => setShopPushModal({ id: sub.id, name: sub.name });

  const shopSubDetail = (sub) => {
    const parts = [];
    if (sub.price_column_master) parts.push(`Precio: ${sub.price_column_master}`);
    if (sub.stock_column_master) parts.push(`Stock: ${sub.stock_column_master}`);
    if (sub.compare_price_column_master) parts.push(`Comparativo: ${sub.compare_price_column_master}`);
    if (sub.barcode_column_master) parts.push(`Barcode: ${sub.barcode_column_master}`);
    if (sub.title_column_master) parts.push(`Nombre: ${sub.title_column_master}`);
    if (sub.product_type_column_master) parts.push(`Categoría: ${sub.product_type_column_master}`);
    return parts.join(' · ');
  };

  const shopSubLastPush = (sub) => {
    if (!sub.last_pushed_at) return 'Aún sin envíos';
    try {
      const s = JSON.parse(sub.last_push_summary || '{}');
      return `Último envío: ${new Date(sub.last_pushed_at).toLocaleString()} · ${s.price_updated ?? 0} precios, ${s.stock_updated ?? 0} stock`;
    } catch {
      return `Último envío: ${new Date(sub.last_pushed_at).toLocaleString()}`;
    }
  };

  const openEditShopSub = async (sub) => {
    setEditShopSub(sub);
    setEssName(sub.name);
    setEssConnId(sub.connection_id);
    setEssPrice(sub.price_column_master || '');
    setEssStock(sub.stock_column_master || '');
    setEssCompare(sub.compare_price_column_master || '');
    setEssBarcode(sub.barcode_column_master || '');
    setEssTitle(sub.title_column_master || '');
    setEssProductType(sub.product_type_column_master || '');
    setEssLocation(sub.location_id || '');
    try {
      const res = await fetch(`${API}/api/master-columns`);
      const cols = await res.json();
      setEditShopSubCols(res.ok && Array.isArray(cols) ? cols : []);
    } catch { setEditShopSubCols([]); }
  };

  const saveEditShopSub = async (e) => {
    e.preventDefault();
    if (!essPrice && !essStock && !essCompare && !essBarcode && !essTitle && !essProductType) { alert('Mapeá al menos un campo (precio, stock, precio comparativo, código de barras, nombre o categoría).'); return; }
    setEditShopSubSaving(true);
    try {
      const res = await fetch(`${API}/api/shopify-subscriptions/${editShopSub.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: essName || editShopSub.name,
          connection_id: Number(essConnId),
          price_column_master: essPrice || null,
          stock_column_master: essStock || null,
          compare_price_column_master: essCompare || null,
          barcode_column_master: essBarcode || null,
          title_column_master: essTitle || null,
          product_type_column_master: essProductType || null,
          location_id: essLocation || null,
          is_active: editShopSub.is_active,
        })
      });
      if (!res.ok) throw new Error(await extractError(res));
      setEditShopSub(null);
      loadAll();
    } catch (err) { alert(err.message || 'No se pudo guardar.'); }
    setEditShopSubSaving(false);
  };

  // --- Destinos (Canales API genéricos: Maestra → endpoint del cliente) ---
  const toggleApiSub = async (sub) => {
    const res = await fetch(`${API}/api/api-subscriptions/${sub.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sub, is_active: !sub.is_active })
    });
    if (res.ok) loadAll();
    else alert(await extractError(res));
  };

  const deleteApiSub = async (id) => {
    if (!window.confirm('¿Eliminar este canal API? (No borra nada en el sistema destino)')) return;
    const res = await fetch(`${API}/api/api-subscriptions/${id}`, { method: 'DELETE' });
    if (res.ok) loadAll();
    else alert(await extractError(res));
  };

  const pushNowApiSub = async (sub) => {
    setPushingApiSub(sub.id);
    try {
      // 1) Preview (dry run): cuántas filas y con qué columnas
      let res = await fetch(`${API}/api/api-subscriptions/${sub.id}/push-now?dry_run=true`, { method: 'POST' });
      if (!res.ok) { alert(await extractError(res)); return; }
      const prev = await res.json();
      const ok = window.confirm(
        `Se enviarán ${prev.rows_total} filas de la Maestra a "${prev.channel}"\n` +
        `(${prev.url})\nColumnas: ${(prev.columns || []).join(', ')}\n\n¿Enviar ahora?`
      );
      if (!ok) return;
      // 2) Envío real
      res = await fetch(`${API}/api/api-subscriptions/${sub.id}/push-now?dry_run=false`, { method: 'POST' });
      if (!res.ok) { alert(await extractError(res)); return; }
      const result = await res.json();
      alert(result.ok
        ? `✅ Enviadas ${result.sent} filas a "${result.channel}" (HTTP ${result.status_code}).`
        : `❌ El envío a "${result.channel}" falló: ${result.error || result.response_excerpt || `HTTP ${result.status_code}`}`);
      loadAll();
    } catch (err) {
      alert(err.message || 'Error enviando al canal API.');
    } finally {
      setPushingApiSub(null);
    }
  };

  const apiSubLastPush = (sub) => {
    if (!sub.last_pushed_at) return 'Aún sin envíos';
    try {
      const s = JSON.parse(sub.last_push_summary || '{}');
      return `Último envío: ${new Date(sub.last_pushed_at).toLocaleString()} · ${s.sent ?? 0} filas` +
        (s.ok === false ? ' · ⚠️ falló' : '');
    } catch {
      return `Último envío: ${new Date(sub.last_pushed_at).toLocaleString()}`;
    }
  };

  const openEditApiSub = (sub) => {
    setEditApiSub(sub);
    setEaName(sub.name);
    setEaUrl(sub.url);
    setEaMethod(sub.http_method || 'POST');
    setEaToken('');
  };

  const saveEditApiSub = async (e) => {
    e.preventDefault();
    setEditApiSaving(true);
    try {
      const res = await fetch(`${API}/api/api-subscriptions/${editApiSub.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: eaName || editApiSub.name,
          url: eaUrl,
          http_method: eaMethod,
          auth_header_name: editApiSub.auth_header_name || 'Authorization',
          auth_token: eaToken || null,   // en blanco = mantener el guardado
          extra_headers: editApiSub.extra_headers,
          transform_spec: editApiSub.transform_spec,
          is_active: editApiSub.is_active
        })
      });
      if (!res.ok) throw new Error(await extractError(res));
      setEditApiSub(null);
      loadAll();
    } catch (err) { alert(err.message || 'No se pudo guardar.'); }
    setEditApiSaving(false);
  };

  // --- Link fijo de descarga por canal CSV ---
  const exportLink = (exp) => {
    const base = API && API.startsWith('http') ? API : `${window.location.origin}${API}`;
    return `${base}/api/exports/${exp.id}/download${exp.public_token ? `?token=${exp.public_token}` : ''}`;
  };

  const copyExportLink = (exp) => {
    navigator.clipboard.writeText(exportLink(exp));
    setCopiedLink(exp.id);
    setTimeout(() => setCopiedLink(null), 2000);
  };

  const deleteExport = async (id) => {
    if (!window.confirm('¿Eliminar esta exportación CSV?')) return;
    await fetch(`${API}/api/exports/${id}`, { method: 'DELETE' });
    loadAll();
  };

  // --- Conexiones (limpieza) ---
  const deleteConnection = async (id) => {
    if (!window.confirm('¿Eliminar esta conexión?')) return;
    const res = await fetch(`${API}/api/connections/${id}`, { method: 'DELETE' });
    if (res.ok) loadAll();
    else alert(await extractError(res));
  };

  const testConnection = async (id) => {
    setTesting(id);
    try {
      const res = await fetch(`${API}/api/connections/${id}/test`, { method: 'POST' });
      const data = await res.json();
      alert(data.success ? `✅ ${data.message}` : `❌ ${data.message}`);
    } catch (err) {
      alert('❌ Error probando la conexión.');
    }
    setTesting(null);
  };

  const kindLabel = (type) => ({
    google_sheets: 'Google Sheet', local_file: 'Archivo subido', http_api: 'API externa', shopify: 'Shopify'
  }[type] || type);

  // --- Selección múltiple (borrar en masa) ---
  // Metadatos por tipo: endpoint de borrado, etiqueta legible y de dónde sacar
  // el nombre para el resumen de errores. El orden importa: se borran destinos
  // y fuentes ANTES que conexiones, así si en la misma tanda se selecciona un
  // destino Shopify duplicado Y su conexión, la protección relacional (una
  // conexión no se borra si algo activo la usa) no bloquea la conexión.
  const KIND_META = {
    exp: { label: 'exportación CSV', endpoint: id => `/api/exports/${id}`, list: exports },
    sub: { label: 'destino Sheets', endpoint: id => `/api/subscriptions/${id}`, list: subscriptions },
    shopSub: { label: 'destino Shopify', endpoint: id => `/api/shopify-subscriptions/${id}`, list: shopifySubs },
    apiSub: { label: 'canal API', endpoint: id => `/api/api-subscriptions/${id}`, list: apiSubs },
    proc: { label: 'fuente', endpoint: id => `/api/processes/${id}`, list: processes },
    conn: { label: 'conexión', endpoint: id => `/api/connections/${id}`, list: connections },
  };
  const BULK_ORDER = ['exp', 'sub', 'shopSub', 'apiSub', 'proc', 'conn'];

  const isSelected = (kind, id) => selected[kind].includes(id);
  const toggleSelected = (kind, id) => {
    setSelected(prev => ({
      ...prev,
      [kind]: prev[kind].includes(id) ? prev[kind].filter(x => x !== id) : [...prev[kind], id]
    }));
  };
  const clearSelection = () => setSelected({ proc: [], shopSub: [], apiSub: [], sub: [], exp: [], conn: [] });
  const exitSelectMode = () => { setSelectMode(false); clearSelection(); };
  const selectedCount = Object.values(selected).reduce((n, l) => n + l.length, 0);

  const bulkDelete = async () => {
    if (selectedCount === 0 || bulkDeleting) return;
    const summary = BULK_ORDER.filter(k => selected[k].length > 0)
      .map(k => `${selected[k].length} ${KIND_META[k].label}(s)`).join(', ');
    if (!window.confirm(`¿Eliminar ${summary}?\n\nEsta acción no se puede deshacer.`)) return;
    setBulkDeleting(true);
    const failed = [];
    for (const kind of BULK_ORDER) {
      for (const id of selected[kind]) {
        const name = KIND_META[kind].list.find(x => x.id === id)?.name || `#${id}`;
        try {
          const res = await fetch(`${API}${KIND_META[kind].endpoint(id)}`, { method: 'DELETE' });
          if (!res.ok) failed.push(`${KIND_META[kind].label} "${name}": ${await extractError(res)}`);
        } catch (err) {
          failed.push(`${KIND_META[kind].label} "${name}": ${err.message || 'error de red'}`);
        }
      }
    }
    setBulkDeleting(false);
    exitSelectMode();
    await loadAll();
    if (failed.length > 0) {
      alert(`Algunos no se pudieron borrar (probablemente siguen en uso por algo activo):\n\n${failed.join('\n')}`);
    }
  };

  // --- Edición: Fuente (Proceso) ---
  const openEditProcess = async (proc) => {
    setEditProc(proc);
    setEpName(proc.name);
    setEpSheet(proc.source_sheet_name);
    setEpSkuSrc(proc.sku_column_source);
    setEpSkuMaster(proc.sku_column_master);
    setEpMappings(Object.entries(proc.field_mappings || {}).map(([src, dst]) => ({ src, dst })));
    setEpAddNewRows(proc.add_new_rows);
    setEpZeroMissingStock(proc.zero_missing_stock ?? false);
    setEditProcLoading(true);
    try {
      const [metaRes, colsRes] = await Promise.all([
        fetch(`${API}/api/connections/${proc.source_connection_id}/metadata`),
        fetch(`${API}/api/master-columns`)
      ]);
      const meta = await metaRes.json();
      setEditProcSheets(metaRes.ok ? (meta.sheets || {}) : {});
      const cols = await colsRes.json();
      setEditProcMasterCols(colsRes.ok && Array.isArray(cols) ? cols : []);
    } catch (err) { console.error(err); }
    setEditProcLoading(false);
  };

  const saveEditProcess = async (e) => {
    e.preventDefault();
    const mappings = {};
    epMappings.forEach(({ src, dst }) => { if (src && dst) mappings[src] = dst; });
    if (!epSkuSrc || !epSkuMaster) { alert('Falta confirmar la columna SKU (origen y maestra).'); return; }
    if (Object.keys(mappings).length === 0) { alert('Agregá al menos un campo.'); return; }
    setEditProcSaving(true);
    try {
      const res = await fetch(`${API}/api/processes/${editProc.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: epName || editProc.name,
          description: editProc.description,
          source_connection_id: editProc.source_connection_id,
          source_sheet_name: epSheet,
          target_connection_id: editProc.target_connection_id,
          target_sheet_name: editProc.target_sheet_name,
          sku_column_source: epSkuSrc,
          sku_column_master: epSkuMaster,
          field_mappings: mappings,
          add_new_rows: epAddNewRows,
          zero_missing_stock: epZeroMissingStock,
          is_active: editProc.is_active
        })
      });
      if (!res.ok) throw new Error(await extractError(res));
      setEditProc(null);
      loadAll();
    } catch (err) { alert(err.message || 'No se pudo guardar.'); }
    setEditProcSaving(false);
  };

  // --- Edición: Destino (Suscripción) ---
  const openEditSub = async (sub) => {
    setEditSub(sub);
    setEsName(sub.name);
    setEsSheet(sub.target_sheet_name);
    setEsSkuTarget(sub.sku_column_target);
    setEsMappings(Object.entries(sub.field_mappings || {}).map(([src, dst]) => ({ src, dst })));
    setEditSubLoading(true);
    try {
      const [metaRes, colsRes] = await Promise.all([
        fetch(`${API}/api/connections/${sub.target_connection_id}/metadata`),
        fetch(`${API}/api/master-columns`)
      ]);
      const meta = await metaRes.json();
      setEditSubSheets(metaRes.ok ? (meta.sheets || {}) : {});
      const cols = await colsRes.json();
      setEditSubMasterCols(colsRes.ok && Array.isArray(cols) ? cols : []);
    } catch (err) { console.error(err); }
    setEditSubLoading(false);
  };

  const saveEditSub = async (e) => {
    e.preventDefault();
    const mappings = {};
    esMappings.forEach(({ src, dst }) => { if (src && dst) mappings[src] = dst; });
    if (!esSkuTarget) { alert('Falta la columna llave (SKU) del destino.'); return; }
    if (Object.keys(mappings).length === 0) { alert('Agregá al menos un campo.'); return; }
    setEditSubSaving(true);
    try {
      const res = await fetch(`${API}/api/subscriptions/${editSub.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: editSub.project_id,
          target_connection_id: editSub.target_connection_id,
          target_sheet_name: esSheet,
          sku_column_target: esSkuTarget,
          field_mappings: mappings,
          is_active: editSub.is_active,
          name: esName || editSub.name
        })
      });
      if (!res.ok) throw new Error(await extractError(res));
      setEditSub(null);
      loadAll();
    } catch (err) { alert(err.message || 'No se pudo guardar.'); }
    setEditSubSaving(false);
  };

  // --- Edición: Conexión ---
  const openEditConn = (conn) => {
    setEditConn(conn);
    setEcName(conn.name);
    setEcSheetUrl(conn.google_sheet_url || '');
    setEcHttpUrl(conn.http_url || '');
    setEcHttpMethod(conn.http_method || 'GET');
    setEcHttpHeaders(conn.http_headers || '');
    setEcShopDomain(conn.shopify_domain || '');
    setEcShopAuthMode('client');
    setEcShopClientId(conn.shopify_client_id || '');
    setEcShopClientSecret('');
    setEcShopToken('');
  };

  const saveEditConn = async (e) => {
    e.preventDefault();
    setEditConnSaving(true);
    try {
      const body = { name: ecName || editConn.name };
      if (editConn.connection_type === 'google_sheets') {
        body.google_sheet_url = ecSheetUrl;
      } else if (editConn.connection_type === 'http_api') {
        body.http_url = ecHttpUrl;
        body.http_method = ecHttpMethod;
        body.http_headers = ecHttpHeaders || null;
      } else if (editConn.connection_type === 'shopify') {
        body.shopify_domain = ecShopDomain;
        if (ecShopAuthMode === 'token') {
          if (ecShopToken) body.shopify_access_token = ecShopToken;
        } else {
          body.shopify_client_id = ecShopClientId;
          if (ecShopClientSecret) body.shopify_client_secret = ecShopClientSecret;
        }
      }
      const res = await fetch(`${API}/api/connections/${editConn.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(await extractError(res));
      setEditConn(null);
      loadAll();
    } catch (err) { alert(err.message || 'No se pudo guardar.'); }
    setEditConnSaving(false);
  };

  // Al llegar desde el diagrama con ?action=&node=, dispara la acción sobre el
  // nodo indicado (una sola vez, cuando los datos ya cargaron) y limpia la URL.
  useEffect(() => {
    if (loading || handledDeepLink.current) return;
    const action = searchParams.get('action');
    const node = searchParams.get('node');
    if (!action || !node) return;
    handledDeepLink.current = true;

    // node: id de fuente (numérico) o destino con prefijo (shop-/api-/sub-/csv-).
    const num = (prefix) => Number(node.slice(prefix.length));
    if (/^\d+$/.test(node)) {
      const proc = processes.find(p => p.id === Number(node));
      if (proc) {
        if (action === 'run') maybeRunProc(proc);
        else if (action === 'editFuente') openEditProcess(proc);
      }
    } else if (node.startsWith('shop-')) {
      const sub = shopifySubs.find(s => s.id === num('shop-'));
      if (sub) { if (action === 'send') pushNowShopSub(sub); else openEditShopSub(sub); }
    } else if (node.startsWith('api-')) {
      const sub = apiSubs.find(s => s.id === num('api-'));
      if (sub) { if (action === 'send') pushNowApiSub(sub); else openEditApiSub(sub); }
    } else if (node.startsWith('sub-')) {
      const sub = subscriptions.find(s => s.id === num('sub-'));
      if (sub) openEditSub(sub);
    }

    // Sacar los parámetros de la URL para que no se re-dispare al recargar/volver.
    searchParams.delete('action');
    searchParams.delete('node');
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, processes, shopifySubs, apiSubs, subscriptions]);

  const epSourceCols = epSheet && editProcSheets[epSheet] ? editProcSheets[epSheet] : [];
  const esTargetCols = esSheet && editSubSheets[esSheet] ? editSubSheets[esSheet] : [];

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando...</div>;

  const nothing = processes.length === 0 && subscriptions.length === 0 && shopifySubs.length === 0 && apiSubs.length === 0 && exports.length === 0 && connections.length === 0;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Mis Flujos</h1>
          <p className="text-gray-500 text-sm mt-1">Todo lo que ya conectaste: fuentes, destinos y conexiones. Pausá o borrá lo que no uses.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!nothing && (
            <button onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium transition text-sm border ${selectMode ? 'bg-gray-800 text-white border-gray-800 hover:bg-gray-900' : 'text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
              <CheckCircle2 className="w-4 h-4" /> {selectMode ? 'Cancelar selección' : 'Seleccionar varios'}
            </button>
          )}
          <Link to="/nueva-fuente"
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl font-medium hover:bg-indigo-700 transition text-sm">
            <Plus className="w-4 h-4" /> Nueva Fuente
          </Link>
        </div>
      </div>

      {/* Cómo se relacionan los 3 conceptos de esta pantalla, en una línea:
          una Conexión (el enchufe a tu tienda/Sheet/archivo) puede ser el
          origen de una Fuente y, a la vez, el destino de uno o más Destinos
          — por eso la misma tienda puede aparecer repetida más abajo. */}
      {!nothing && (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-gray-700 overflow-x-auto">
            <span className="flex items-center gap-1.5 whitespace-nowrap"><Link2 className="w-3.5 h-3.5 text-gray-400" /> Conexión</span>
            <span className="text-gray-300 whitespace-nowrap font-normal">tu tienda / Sheet / archivo</span>
            <ArrowRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
            <span className="flex items-center gap-1.5 whitespace-nowrap"><Settings2 className="w-3.5 h-3.5 text-indigo-500" /> Fuente</span>
            <span className="text-gray-300 whitespace-nowrap font-normal">trae datos</span>
            <ArrowRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
            <span className="flex items-center gap-1.5 whitespace-nowrap text-indigo-700"><Database className="w-3.5 h-3.5" /> Maestra</span>
            <ArrowRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
            <span className="flex items-center gap-1.5 whitespace-nowrap"><Download className="w-3.5 h-3.5 text-green-600" /> Destino</span>
            <span className="text-gray-300 whitespace-nowrap font-normal">saca datos</span>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            Una misma Conexión puede ser el origen de una Fuente <span className="italic">y</span> el destino de uno o
            varios Destinos a la vez — por eso puede aparecer repetida más abajo (mirá la pastilla 🔗 en cada tarjeta).
          </p>
        </div>
      )}

      {/* A dónde va todo: la Maestra ya enlazada (o el aviso si falta) */}
      {masterChecked && (masterInfo ? (
        <div className="flex items-center gap-2 text-sm bg-indigo-50/60 border border-indigo-100 rounded-xl px-4 py-2.5 text-gray-600">
          <Database className="w-4 h-4 text-indigo-500 flex-shrink-0" />
          <span>
            Todos los flujos pasan por tu Maestra:&nbsp;
            <span className="font-semibold text-gray-800">"{masterInfo.sheet}"</span>
            {masterInfo.rows != null && <span className="text-gray-400"> · {masterInfo.rows} filas</span>}
          </span>
          <Link to="/" className="ml-auto text-indigo-600 font-medium hover:underline flex-shrink-0">Ver Maestra →</Link>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-amber-800">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <span>No hay una Tabla Maestra enlazada: los flujos no tienen a dónde escribir.</span>
          <Link to="/" className="ml-auto text-amber-700 font-semibold hover:underline flex-shrink-0">Enlazarla primero →</Link>
        </div>
      ))}

      {processes.length > 0 && <AutoSyncPanel />}

      {nothing && (
        <div className="text-center py-16 text-gray-400">
          <CheckCircle2 className="w-14 h-14 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium mb-1">Todavía no hay nada configurado</p>
          <p className="text-sm">Arrancá desde "+ Nueva Fuente".</p>
        </div>
      )}

      {processes.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
              <Settings2 className="w-4 h-4" /> Fuentes ({processes.length})
            </h2>
            {processes.filter(p => p.is_active).length > 1 && (
              <button
                onClick={() => setRunProcs(processes.filter(p => p.is_active).map(p => ({ id: p.id, name: p.name })))}
                className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5 hover:bg-green-100 transition">
                <Zap className="w-3.5 h-3.5" /> Correr todo
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {processes.map(proc => (
              <div key={proc.id} className={`bg-white rounded-xl shadow-sm border p-4 ${selectMode && isSelected('proc', proc.id) ? 'ring-2 ring-indigo-400' : ''} ${!proc.is_active ? 'opacity-60 grayscale' : 'border-gray-200'}`}>
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                    {selectMode && (
                      <input type="checkbox" checked={isSelected('proc', proc.id)} onChange={() => toggleSelected('proc', proc.id)}
                        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                    )}
                    {proc.name}
                  </h3>
                  <div className="flex gap-1">
                    <button onClick={() => openEditProcess(proc)} title="Editar"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => toggleProcess(proc)} title={proc.is_active ? 'Pausar' : 'Activar'}
                      className={`p-1.5 rounded-lg transition ${proc.is_active ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}>
                      <Power className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteProcess(proc.id)} className="text-red-400 hover:bg-red-50 p-1.5 rounded-lg">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-500 flex items-center gap-1.5 flex-wrap"><ConnBadge id={proc.source_connection_id} /> / "{proc.source_sheet_name}"</p>
                <p className="text-xs text-gray-400 mt-1">Llave: {proc.sku_column_source} ↔ {proc.sku_column_master} · {Object.keys(proc.field_mappings || {}).length} campo(s)</p>
                <button
                  onClick={() => maybeRunProc(proc)}
                  disabled={!proc.is_active}
                  title={proc.is_active ? 'Correr este flujo con vista previa' : 'Activá el flujo para poder correrlo'}
                  className="mt-3 w-full flex items-center justify-center gap-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:from-green-700 hover:to-emerald-700 transition disabled:opacity-40 disabled:cursor-not-allowed">
                  <Zap className="w-4 h-4" /> Correr flujo
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {(subscriptions.length > 0 || shopifySubs.length > 0 || apiSubs.length > 0 || exports.length > 0) && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
            <Download className="w-4 h-4" /> Destinos ({subscriptions.length + shopifySubs.length + apiSubs.length + exports.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {shopifySubs.map(sub => (
              <div key={`shopsub-${sub.id}`} className={`bg-white rounded-xl shadow-sm border p-4 ${selectMode && isSelected('shopSub', sub.id) ? 'ring-2 ring-indigo-400' : ''} ${!sub.is_active ? 'opacity-60 grayscale' : 'border-green-200'}`}>
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-semibold text-gray-800 flex items-center gap-1.5">
                    {selectMode && (
                      <input type="checkbox" checked={isSelected('shopSub', sub.id)} onChange={() => toggleSelected('shopSub', sub.id)}
                        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                    )}
                    <Store className="w-4 h-4 text-green-600" /> {sub.name}
                  </h3>
                  <div className="flex gap-1">
                    <button onClick={() => pushNowShopSub(sub)} title="Enviar toda la Maestra ahora (con vista previa)"
                      className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 transition">
                      <Send className="w-4 h-4" />
                    </button>
                    <button onClick={() => openEditShopSub(sub)} title="Editar"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => toggleShopSub(sub)} title={sub.is_active ? 'Pausar' : 'Activar'}
                      className={`p-1.5 rounded-lg transition ${sub.is_active ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}>
                      <Power className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteShopSub(sub.id)} className="text-red-400 hover:bg-red-50 p-1.5 rounded-lg">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-500 flex items-center gap-1.5 flex-wrap"><ConnBadge id={sub.connection_id} /> · {shopSubDetail(sub)}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {shopSubLastPush(sub)}
                  {sub.is_active ? ' · se actualiza con cada sync' : ' · pausado'}
                </p>
              </div>
            ))}
            {apiSubs.map(sub => (
              <div key={`apisub-${sub.id}`} className={`bg-white rounded-xl shadow-sm border p-4 ${selectMode && isSelected('apiSub', sub.id) ? 'ring-2 ring-indigo-400' : ''} ${!sub.is_active ? 'opacity-60 grayscale' : 'border-sky-200'}`}>
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-semibold text-gray-800 flex items-center gap-1.5">
                    {selectMode && (
                      <input type="checkbox" checked={isSelected('apiSub', sub.id)} onChange={() => toggleSelected('apiSub', sub.id)}
                        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                    )}
                    <Globe className="w-4 h-4 text-sky-600" /> {sub.name}
                  </h3>
                  <div className="flex gap-1">
                    <button onClick={() => pushNowApiSub(sub)} title="Enviar toda la Maestra ahora (con vista previa)"
                      disabled={pushingApiSub === sub.id}
                      className="p-1.5 rounded-lg text-sky-600 hover:bg-sky-50 transition disabled:opacity-50">
                      <Send className="w-4 h-4" />
                    </button>
                    <button onClick={() => openEditApiSub(sub)} title="Editar"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => toggleApiSub(sub)} title={sub.is_active ? 'Pausar' : 'Activar'}
                      className={`p-1.5 rounded-lg transition ${sub.is_active ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}>
                      <Power className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteApiSub(sub.id)} className="text-red-400 hover:bg-red-50 p-1.5 rounded-lg">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-500 truncate" title={sub.url}>API · {sub.http_method || 'POST'} {sub.url}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {pushingApiSub === sub.id ? 'Enviando…' : apiSubLastPush(sub)}
                  {sub.is_active ? ' · se actualiza con cada sync' : ' · pausado'}
                  {sub.transform_spec ? ' · con plantilla' : ' · todas las columnas'}
                </p>
              </div>
            ))}
            {subscriptions.map(sub => (
              <div key={`sub-${sub.id}`} className={`bg-white rounded-xl shadow-sm border p-4 ${selectMode && isSelected('sub', sub.id) ? 'ring-2 ring-indigo-400' : ''} ${!sub.is_active ? 'opacity-60 grayscale' : 'border-gray-200'}`}>
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                    {selectMode && (
                      <input type="checkbox" checked={isSelected('sub', sub.id)} onChange={() => toggleSelected('sub', sub.id)}
                        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                    )}
                    {sub.name}
                  </h3>
                  <div className="flex gap-1">
                    <button onClick={() => openEditSub(sub)} title="Editar"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => toggleSub(sub)} title={sub.is_active ? 'Pausar' : 'Activar'}
                      className={`p-1.5 rounded-lg transition ${sub.is_active ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}>
                      <Power className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteSub(sub.id)} className="text-red-400 hover:bg-red-50 p-1.5 rounded-lg">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-500 flex items-center gap-1.5 flex-wrap"><ConnBadge id={sub.target_connection_id} /> / "{sub.target_sheet_name}"</p>
                <p className="text-xs text-gray-400 mt-1">{Object.keys(sub.field_mappings || {}).length} campo(s)</p>
              </div>
            ))}
            {exports.map(exp => (
              <div key={`exp-${exp.id}`} className={`bg-white rounded-xl shadow-sm border border-gray-200 p-4 ${selectMode && isSelected('exp', exp.id) ? 'ring-2 ring-indigo-400' : ''}`}>
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                    {selectMode && (
                      <input type="checkbox" checked={isSelected('exp', exp.id)} onChange={() => toggleSelected('exp', exp.id)}
                        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                    )}
                    {exp.name}
                  </h3>
                  <div className="flex gap-1">
                    <a href={exportLink(exp)} title="Descargar CSV"
                      className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 transition">
                      <FileDown className="w-4 h-4" />
                    </a>
                    <button onClick={() => copyExportLink(exp)}
                      title="Copiar link fijo: cualquier sistema puede bajar este CSV con esa URL, sin abrir la app"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-sky-600 hover:bg-sky-50 transition">
                      {copiedLink === exp.id ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button onClick={() => deleteExport(exp.id)} className="text-red-400 hover:bg-red-50 p-1.5 rounded-lg">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-500">Descarga CSV · link fijo disponible</p>
                <p className="text-xs text-gray-400 mt-1">
                  {exp.transform_spec ? `Plantilla (${exp.transform_spec.length} columnas)` : `${Object.keys(exp.columns_mapping || {}).length} campo(s)`}
                  {copiedLink === exp.id && <span className="text-green-600 font-medium"> · ¡Link copiado!</span>}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {connections.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
            <Link2 className="w-4 h-4" /> Conexiones ({connections.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {connections.map(conn => {
              const usage = connUsage(conn.id);
              return (
              <div key={conn.id} className={`bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-start justify-between gap-2 ${selectMode && isSelected('conn', conn.id) ? 'ring-2 ring-indigo-400' : ''}`}>
                <div className="min-w-0 flex items-start gap-2">
                  {selectMode && (
                    <input type="checkbox" checked={isSelected('conn', conn.id)} onChange={() => toggleSelected('conn', conn.id)}
                      className="w-4 h-4 mt-1 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                  <h3 className="font-semibold text-gray-800 truncate">{conn.name}</h3>
                  <p className="text-xs text-gray-500">{kindLabel(conn.connection_type)}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {usage.length === 0 ? (
                      <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Sin usar en ningún flujo</span>
                    ) : usage.map((u, i) => (
                      <span key={i} className={`text-xs rounded px-1.5 py-0.5 ${u.kind === 'master' ? 'text-indigo-700 bg-indigo-50 font-medium' : 'text-gray-600 bg-gray-100'}`}>{u.label}</span>
                    ))}
                  </div>
                  {(conn.connection_type === 'shopify' || conn.connection_type === 'http_api') && (
                    <button onClick={() => testConnection(conn.id)} disabled={testing === conn.id}
                      className="mt-2 text-xs px-2.5 py-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                      {testing === conn.id ? 'Probando...' : 'Probar conexión'}
                    </button>
                  )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openEditConn(conn)} title="Editar"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => deleteConnection(conn.id)} className="text-red-400 hover:bg-red-50 p-1.5 rounded-lg">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        </section>
      )}

      {editProc && (
        <ModalShell title={`Editar fuente: ${editProc.name}`} onClose={() => setEditProc(null)}>
          {editProcLoading ? (
            <p className="text-gray-500 text-sm">Cargando columnas...</p>
          ) : (
            <form onSubmit={saveEditProcess} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
                <input value={epName} onChange={e => setEpName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
              </div>

              {Object.keys(editProcSheets).length > 1 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pestaña / hoja</label>
                  <select value={epSheet} onChange={e => setEpSheet(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                    {Object.keys(editProcSheets).map(sh => <option key={sh} value={sh}>{sh}</option>)}
                  </select>
                </div>
              )}

              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-indigo-800 mb-1">🔑 SKU en el origen</label>
                    <select value={epSkuSrc} onChange={e => setEpSkuSrc(e.target.value)}
                      className="w-full border border-indigo-200 rounded-lg p-2 text-sm bg-white">
                      <option value="">Seleccionar...</option>
                      {epSourceCols.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-indigo-800 mb-1">🔑 SKU en la Maestra</label>
                    <select value={epSkuMaster} onChange={e => setEpSkuMaster(e.target.value)}
                      className="w-full border border-indigo-200 rounded-lg p-2 text-sm bg-white">
                      <option value="">Seleccionar...</option>
                      {editProcMasterCols.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <label className="block text-sm font-medium text-indigo-800 mb-2">Campos</label>
                <MappingEditor mappings={epMappings} setMappings={setEpMappings}
                  srcOptions={epSourceCols} dstOptions={editProcMasterCols}
                  srcLabel="Origen" dstLabel="Maestra" />
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={epAddNewRows} onChange={e => setEpAddNewRows(e.target.checked)} />
                Agregar filas nuevas que no existan en la Maestra
              </label>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={epZeroMissingStock} onChange={e => setEpZeroMissingStock(e.target.checked)} />
                Agotar faltantes: poner stock 0 a los SKU de la Maestra que no lleguen en esta fuente
              </label>
              {epZeroMissingStock && (
                <p className="text-xs text-amber-700 -mt-1 ml-6">
                  ⚠️ Activá esto SOLO en la fuente de verdad del inventario (BASE-SYS).
                  Una fuente parcial vaciaría el catálogo.
                </p>
              )}

              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={editProcSaving}
                  className="bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 text-sm">
                  {editProcSaving ? 'Guardando...' : 'Guardar cambios'}
                </button>
                <button type="button" onClick={() => setEditProc(null)}
                  className="text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 text-sm font-medium">Cancelar</button>
              </div>
            </form>
          )}
        </ModalShell>
      )}

      {editSub && (
        <ModalShell title={`Editar destino: ${editSub.name}`} onClose={() => setEditSub(null)}>
          {editSubLoading ? (
            <p className="text-gray-500 text-sm">Cargando columnas...</p>
          ) : (
            <form onSubmit={saveEditSub} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
                <input value={esName} onChange={e => setEsName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
              </div>

              {Object.keys(editSubSheets).length > 1 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pestaña destino</label>
                  <select value={esSheet} onChange={e => setEsSheet(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                    {Object.keys(editSubSheets).map(sh => <option key={sh} value={sh}>{sh}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">🔑 Columna llave en destino (SKU)</label>
                <select value={esSkuTarget} onChange={e => setEsSkuTarget(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white max-w-sm">
                  <option value="">Seleccionar...</option>
                  {esTargetCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Campos a enviar</label>
                <MappingEditor mappings={esMappings} setMappings={setEsMappings}
                  srcOptions={editSubMasterCols} dstOptions={esTargetCols}
                  srcLabel="Maestra" dstLabel="Destino" />
              </div>

              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={editSubSaving}
                  className="bg-green-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 text-sm">
                  {editSubSaving ? 'Guardando...' : 'Guardar cambios'}
                </button>
                <button type="button" onClick={() => setEditSub(null)}
                  className="text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 text-sm font-medium">Cancelar</button>
              </div>
            </form>
          )}
        </ModalShell>
      )}

      {editConn && (
        <ModalShell title={`Editar conexión: ${editConn.name}`} onClose={() => setEditConn(null)}>
          <form onSubmit={saveEditConn} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
              <input value={ecName} onChange={e => setEcName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
            </div>

            {editConn.connection_type === 'google_sheets' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL del Google Sheet</label>
                <input value={ecSheetUrl} onChange={e => setEcSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
              </div>
            )}

            {editConn.connection_type === 'local_file' && (
              <p className="text-xs text-gray-500">Los archivos subidos solo se pueden renombrar. Para reemplazar el archivo, borrá esta conexión y subí uno nuevo desde "+ Nueva Fuente".</p>
            )}

            {editConn.connection_type === 'http_api' && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <select value={ecHttpMethod} onChange={e => setEcHttpMethod(e.target.value)}
                    className="w-24 border border-gray-300 rounded-lg p-2 text-sm bg-white">
                    <option>GET</option>
                    <option>POST</option>
                  </select>
                  <input value={ecHttpUrl} onChange={e => setEcHttpUrl(e.target.value)}
                    placeholder="https://api.proveedor.com/v1/productos"
                    className="flex-1 border border-gray-300 rounded-lg p-2 text-sm" />
                </div>
                <textarea value={ecHttpHeaders} onChange={e => setEcHttpHeaders(e.target.value)}
                  placeholder='Headers (JSON opcional), ej: {"Authorization": "Bearer TOKEN"}'
                  rows={2} className="w-full border border-gray-300 rounded-lg p-2 text-sm font-mono" />
              </div>
            )}

            {editConn.connection_type === 'shopify' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Dominio de la tienda</label>
                  <input value={ecShopDomain} onChange={e => setEcShopDomain(e.target.value)}
                    placeholder="mi-tienda.myshopify.com"
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
                </div>
                <p className="text-xs text-gray-500">
                  {editConn.has_shopify_secret ? 'Ya hay credenciales guardadas. Dejá los campos en blanco para mantenerlas, o completalos para reemplazarlas.' : 'Todavía no hay credenciales guardadas.'}
                </p>
                <div className="flex gap-1 text-xs">
                  <button type="button" onClick={() => setEcShopAuthMode('client')}
                    className={`px-3 py-1 rounded-md border ${ecShopAuthMode === 'client' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-600'}`}>
                    Client ID + Secret
                  </button>
                  <button type="button" onClick={() => setEcShopAuthMode('token')}
                    className={`px-3 py-1 rounded-md border ${ecShopAuthMode === 'token' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-600'}`}>
                    Access Token (shpat_)
                  </button>
                </div>
                {ecShopAuthMode === 'client' ? (
                  <div className="flex gap-2">
                    <input value={ecShopClientId} onChange={e => setEcShopClientId(e.target.value)} placeholder="Client ID"
                      className="flex-1 border border-gray-300 rounded-lg p-2 text-sm" />
                    <input type="password" value={ecShopClientSecret} onChange={e => setEcShopClientSecret(e.target.value)}
                      placeholder="Client Secret (dejar en blanco para mantener)"
                      className="flex-1 border border-gray-300 rounded-lg p-2 text-sm" />
                  </div>
                ) : (
                  <input type="password" value={ecShopToken} onChange={e => setEcShopToken(e.target.value)}
                    placeholder="shpat_... (dejar en blanco para mantener)"
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
                )}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button type="submit" disabled={editConnSaving}
                className="bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 text-sm">
                {editConnSaving ? 'Guardando...' : 'Guardar cambios'}
              </button>
              <button type="button" onClick={() => setEditConn(null)}
                className="text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 text-sm font-medium">Cancelar</button>
            </div>
          </form>
        </ModalShell>
      )}

      {editApiSub && (
        <ModalShell title={`Editar canal API: ${editApiSub.name}`} onClose={() => setEditApiSub(null)}>
          <form onSubmit={saveEditApiSub} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
              <input value={eaName} onChange={e => setEaName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
            </div>
            <div className="flex gap-2">
              <select value={eaMethod} onChange={e => setEaMethod(e.target.value)}
                className="w-24 border border-gray-300 rounded-lg p-2 text-sm bg-white">
                <option>POST</option>
                <option>PUT</option>
                <option>PATCH</option>
              </select>
              <input value={eaUrl} onChange={e => setEaUrl(e.target.value)} required
                placeholder="https://api.cliente.com/catalogo"
                className="flex-1 border border-gray-300 rounded-lg p-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Token de autenticación</label>
              <input type="password" value={eaToken} onChange={e => setEaToken(e.target.value)}
                placeholder={editApiSub.has_token ? 'Ya hay uno guardado (en blanco lo mantiene)' : 'Ej: Bearer abc123 (opcional)'}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
              <p className="text-xs text-gray-400 mt-1">Se envía tal cual en el header "{editApiSub.auth_header_name || 'Authorization'}".</p>
            </div>
            <div className="flex gap-2 pt-2">
              <button type="submit" disabled={editApiSaving}
                className="bg-sky-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-sky-700 disabled:opacity-50 text-sm">
                {editApiSaving ? 'Guardando...' : 'Guardar cambios'}
              </button>
              <button type="button" onClick={() => setEditApiSub(null)}
                className="text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 text-sm font-medium">Cancelar</button>
            </div>
          </form>
        </ModalShell>
      )}

      {editShopSub && (
        <ModalShell title={`Editar destino Shopify: ${editShopSub.name}`} onClose={() => setEditShopSub(null)}>
          <form onSubmit={saveEditShopSub} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
              <input value={essName} onChange={e => setEssName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tienda Shopify</label>
              <select value={essConnId} onChange={e => setEssConnId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                {connections.filter(c => c.connection_type === 'shopify').map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <ShopifyFieldMapper masterCols={editShopSubCols} fields={[
                { key: 'price', label: 'Precio', value: essPrice, setValue: setEssPrice },
                { key: 'stock', label: 'Stock', value: essStock, setValue: setEssStock },
                { key: 'compare', label: 'Precio comparativo / oferta', value: essCompare, setValue: setEssCompare },
                { key: 'barcode', label: 'Código de barras', value: essBarcode, setValue: setEssBarcode },
                { key: 'title', label: 'Nombre del producto', value: essTitle, setValue: setEssTitle },
                { key: 'product_type', label: 'Categoría', value: essProductType, setValue: setEssProductType },
              ]} />
            </div>
            <p className="text-xs text-gray-500 -mt-1">
              Elegí uno o varios campos. Nunca se crean productos en Shopify: solo se
              actualizan productos/variantes que ya existen (cruce por SKU). Nombre y
              categoría son a nivel PRODUCTO — si el SKU comparte producto con otras
              variantes, el cambio afecta al producto entero.
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bodega / Location ID (opcional)</label>
              <input value={essLocation} onChange={e => setEssLocation(e.target.value)}
                placeholder="Dejar en blanco para la bodega principal"
                className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
            </div>

            <div className="flex gap-2 pt-2">
              <button type="submit" disabled={editShopSubSaving}
                className="bg-green-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 text-sm">
                {editShopSubSaving ? 'Guardando...' : 'Guardar cambios'}
              </button>
              <button type="button" onClick={() => setEditShopSub(null)}
                className="text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 text-sm font-medium">Cancelar</button>
            </div>
          </form>
        </ModalShell>
      )}

      {fileSwapProc && (() => {
        const conn = connections.find(c => c.id === fileSwapProc.source_connection_id);
        return (
          <ModalShell title={`Antes de correr "${fileSwapProc.name}"`} onClose={() => setFileSwapProc(null)}>
            <p className="text-sm text-gray-600 mb-4">
              Esta fuente lee del archivo <span className="font-medium text-gray-800">"{conn?.name}"</span>
              {conn?.file_updated_at && (
                <> · subido el {new Date(conn.file_updated_at).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })}</>
              )}. Si tenés una versión más nueva, te recomendamos reemplazarlo antes de correr para no sincronizar datos viejos.
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
          onDone={() => loadAll()}
        />
      )}

      {shopPushModal && (
        <ShopifyPushModal
          subId={shopPushModal.id}
          subName={shopPushModal.name}
          onClose={() => setShopPushModal(null)}
          onDone={() => loadAll()}
        />
      )}

      {selectMode && selectedCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-gray-900 text-white rounded-xl shadow-xl px-5 py-3 flex items-center gap-4">
          <span className="text-sm font-medium">{selectedCount} seleccionado{selectedCount === 1 ? '' : 's'}</span>
          <button onClick={bulkDelete} disabled={bulkDeleting}
            className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm font-semibold transition">
            <Trash2 className="w-4 h-4" /> {bulkDeleting ? 'Borrando...' : 'Borrar seleccionados'}
          </button>
          <button onClick={exitSelectMode} disabled={bulkDeleting} className="text-gray-300 hover:text-white text-sm disabled:opacity-50">
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
