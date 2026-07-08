import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Settings2, Download, Link2, Power, Trash2, FileDown, Plus, CheckCircle2, Pencil, X, ChevronRight } from 'lucide-react';
import { extractError } from '../utils/errors';

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
  const [exports, setExports] = useState([]);
  const [connections, setConnections] = useState([]);
  const [testing, setTesting] = useState(null);

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

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const projsRes = await fetch(`${API}/api/projects/`);
      const projs = await projsRes.json();
      const pid = projs[0]?.id;

      const [procsRes, connsRes, subsRes, expRes] = await Promise.all([
        fetch(`${API}/api/processes/`),
        fetch(`${API}/api/connections/`),
        pid ? fetch(`${API}/api/subscriptions/?project_id=${pid}`) : Promise.resolve(null),
        pid ? fetch(`${API}/api/exports/?project_id=${pid}`) : Promise.resolve(null),
      ]);
      setProcesses(await procsRes.json());
      setConnections(await connsRes.json());
      setSubscriptions(subsRes ? await subsRes.json() : []);
      setExports(expRes ? await expRes.json() : []);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const connName = (id) => connections.find(c => c.id === id)?.name || `Conexión ${id}`;

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

  // --- Edición: Fuente (Proceso) ---
  const openEditProcess = async (proc) => {
    setEditProc(proc);
    setEpName(proc.name);
    setEpSheet(proc.source_sheet_name);
    setEpSkuSrc(proc.sku_column_source);
    setEpSkuMaster(proc.sku_column_master);
    setEpMappings(Object.entries(proc.field_mappings || {}).map(([src, dst]) => ({ src, dst })));
    setEpAddNewRows(proc.add_new_rows);
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

  const epSourceCols = epSheet && editProcSheets[epSheet] ? editProcSheets[epSheet] : [];
  const esTargetCols = esSheet && editSubSheets[esSheet] ? editSubSheets[esSheet] : [];

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando...</div>;

  const nothing = processes.length === 0 && subscriptions.length === 0 && exports.length === 0 && connections.length === 0;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Mis Flujos</h1>
          <p className="text-gray-500 text-sm mt-1">Todo lo que ya conectaste: fuentes, destinos y conexiones. Pausá o borrá lo que no uses.</p>
        </div>
        <Link to="/nueva-fuente"
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl font-medium hover:bg-indigo-700 transition text-sm">
          <Plus className="w-4 h-4" /> Nueva Fuente
        </Link>
      </div>

      {nothing && (
        <div className="text-center py-16 text-gray-400">
          <CheckCircle2 className="w-14 h-14 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium mb-1">Todavía no hay nada configurado</p>
          <p className="text-sm">Arrancá desde "+ Nueva Fuente".</p>
        </div>
      )}

      {processes.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
            <Settings2 className="w-4 h-4" /> Fuentes ({processes.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {processes.map(proc => (
              <div key={proc.id} className={`bg-white rounded-xl shadow-sm border p-4 ${!proc.is_active ? 'opacity-60 grayscale' : 'border-gray-200'}`}>
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-semibold text-gray-800">{proc.name}</h3>
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
                <p className="text-sm text-gray-500">{connName(proc.source_connection_id)} / "{proc.source_sheet_name}"</p>
                <p className="text-xs text-gray-400 mt-1">Llave: {proc.sku_column_source} ↔ {proc.sku_column_master} · {Object.keys(proc.field_mappings || {}).length} campo(s)</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {(subscriptions.length > 0 || exports.length > 0) && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
            <Download className="w-4 h-4" /> Destinos ({subscriptions.length + exports.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {subscriptions.map(sub => (
              <div key={`sub-${sub.id}`} className={`bg-white rounded-xl shadow-sm border p-4 ${!sub.is_active ? 'opacity-60 grayscale' : 'border-gray-200'}`}>
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-semibold text-gray-800">{sub.name}</h3>
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
                <p className="text-sm text-gray-500">Google Sheet · {connName(sub.target_connection_id)} / "{sub.target_sheet_name}"</p>
                <p className="text-xs text-gray-400 mt-1">{Object.keys(sub.field_mappings || {}).length} campo(s)</p>
              </div>
            ))}
            {exports.map(exp => (
              <div key={`exp-${exp.id}`} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-semibold text-gray-800">{exp.name}</h3>
                  <div className="flex gap-1">
                    <a href={`${API}/api/exports/${exp.id}/download`} title="Descargar CSV"
                      className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 transition">
                      <FileDown className="w-4 h-4" />
                    </a>
                    <button onClick={() => deleteExport(exp.id)} className="text-red-400 hover:bg-red-50 p-1.5 rounded-lg">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-500">Descarga CSV</p>
                <p className="text-xs text-gray-400 mt-1">{Object.keys(exp.columns_mapping || {}).length} campo(s)</p>
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
            {connections.map(conn => (
              <div key={conn.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-start justify-between">
                <div className="min-w-0">
                  <h3 className="font-semibold text-gray-800 truncate">{conn.name}</h3>
                  <p className="text-xs text-gray-500">{kindLabel(conn.connection_type)}</p>
                  {(conn.connection_type === 'shopify' || conn.connection_type === 'http_api') && (
                    <button onClick={() => testConnection(conn.id)} disabled={testing === conn.id}
                      className="mt-2 text-xs px-2.5 py-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                      {testing === conn.id ? 'Probando...' : 'Probar conexión'}
                    </button>
                  )}
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
            ))}
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
    </div>
  );
}
