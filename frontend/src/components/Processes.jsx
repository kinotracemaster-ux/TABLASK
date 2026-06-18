import { useState, useEffect } from 'react';
import { Settings2, Plus, Trash2, Play, Eye, RefreshCw, CheckCircle2, XCircle, ChevronDown, ChevronUp, ShieldAlert, ChevronRight, Edit } from 'lucide-react';
import { extractError } from '../utils/errors';

const API = import.meta.env.VITE_API_URL || '';

export default function Processes() {
  const [processes, setProcesses] = useState([]);
  const [connections, setConnections] = useState([]);
  const [masterCols, setMasterCols] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [masterInfo, setMasterInfo] = useState(null);
  const [editingId, setEditingId] = useState(null);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sourceConnId, setSourceConnId] = useState('');
  const [sourceSheets, setSourceSheets] = useState({});
  const [sourceSheet, setSourceSheet] = useState('');
  
  const [targetConnId, setTargetConnId] = useState('');
  const [targetSheets, setTargetSheets] = useState({});
  const [targetSheet, setTargetSheet] = useState('');

  const [masterSheets, setMasterSheets] = useState({});
  const [skuColSource, setSkuColSource] = useState('');
  const [skuColMaster, setSkuColMaster] = useState('');
  const [fieldMappings, setFieldMappings] = useState([{ src: '', dst: '' }]);

  // Preview/Run state per process
  const [processStatus, setProcessStatus] = useState({});

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [procsRes, connsRes, colsRes, projsRes] = await Promise.all([
        fetch(`${API}/api/processes/`),
        fetch(`${API}/api/connections/`),
        fetch(`${API}/api/master-columns`),
        fetch(`${API}/api/projects/`)
      ]);
      setProcesses(await procsRes.json());
      setConnections(await connsRes.json());
      setMasterCols(await colsRes.json());

      const projs = await projsRes.json();
      if (projs.length > 0 && projs[0].master_sheet_name) {
        const mi = { connId: projs[0].master_connection_id, sheetName: projs[0].master_sheet_name };
        setMasterInfo(mi);
        // Pre-cargar hojas de la maestra para el selector de destino
        if (mi.connId) {
          const mRes = await fetch(`${API}/api/connections/${mi.connId}/metadata`);
          const mData = await mRes.json();
          setMasterSheets(mData.sheets || {});
          setTargetSheet(mi.sheetName);
        }
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const loadSourceSheets = async (connId) => {
    setSourceConnId(connId);
    if (!connId) return;
    try {
      const res = await fetch(`${API}/api/connections/${connId}/metadata`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Fallo');
      setSourceSheets(data.sheets || {});
    } catch (err) {
      alert(err.message);
      setSourceSheets({});
    }
  };

  // targetCols = columnas de la hoja maestra seleccionada (o masterCols como fallback)
  const sourceCols = sourceSheet && sourceSheets[sourceSheet] ? sourceSheets[sourceSheet] : [];
  const targetCols = (targetSheet && masterSheets[targetSheet]) ? masterSheets[targetSheet] : masterCols;

  // Auto-detect SKU when source sheet changes
  useEffect(() => {
    if (sourceConnId && sourceSheet) {
      autoDetectSku();
    }
  }, [sourceConnId, sourceSheet]);

  const autoDetectSku = async () => {
    try {
      const res = await fetch(`${API}/api/intelligence/suggest-sku?connection_id=${sourceConnId}&sheet_name=${sourceSheet}`);
      const data = await res.json();
      if (res.ok && data.suggested_sku) {
        setSkuColSource(data.suggested_sku);
      }
    } catch (err) { console.error("Auto-detect failed", err); }
  };

  const handleAutoMap = async () => {
    if (sourceCols.length === 0 || targetCols.length === 0) return;
    try {
      const res = await fetch(`${API}/api/intelligence/auto-map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_headers: sourceCols, target_headers: targetCols })
      });
      const data = await res.json();
      if (res.ok && data.mapping) {
        const newMappings = [];
        for (const [src, dst] of Object.entries(data.mapping)) {
          if (src !== skuColSource) { // no mapear la llave principal como campo extra si no queremos
            newMappings.push({ src, dst });
          }
        }
        if (newMappings.length > 0) {
          setFieldMappings(newMappings);
        } else {
          alert("No se encontraron mapeos automáticos obvios.");
        }
      }
    } catch (err) { console.error("Auto-map failed", err); }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!masterInfo && !targetConnId) {
      alert("No hay conexión maestra. Ve al panel de Tabla Maestra y enlaza una, o configura un destino manual.");
      return;
    }

    const mappings = {};
    fieldMappings.forEach(m => { if (m.src && m.dst) mappings[m.src] = m.dst; });

    if (Object.keys(mappings).length === 0) {
      alert("Debes asignar al menos un campo de datos.");
      return;
    }

    const url = editingId ? `${API}/api/processes/${editingId}` : `${API}/api/processes/`;
    const method = editingId ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, description,
        source_connection_id: parseInt(sourceConnId),
        source_sheet_name: sourceSheet,
        target_connection_id: masterInfo?.connId || targetConnId,
        target_sheet_name: masterInfo?.sheetName || targetSheet,
        sku_column_source: skuColSource,
        sku_column_master: skuColMaster,
        field_mappings: mappings
      })
    });

    if (res.ok) {
      setShowForm(false);
      resetForm();
      loadAll();
    } else {
      const errMsg = await extractError(res);
      alert(errMsg);
    }
  };

  const resetForm = () => {
    setName(''); setDescription(''); setSourceConnId(''); setSourceSheet('');
    setSkuColSource(''); setSkuColMaster('');
    setFieldMappings([{ src: '', dst: '' }]);
    setSourceSheets({});
    setTargetSheet(masterInfo?.sheetName || '');
    setEditingId(null);
  };

  const handleEdit = async (proc) => {
    setName(proc.name);
    setDescription(proc.description || '');
    
    // Set source connection and trigger sheets load
    setSourceConnId(proc.source_connection_id);
    await loadSourceSheets(proc.source_connection_id);
    setSourceSheet(proc.source_sheet_name);
    
    setSkuColSource(proc.sku_column_source);
    setSkuColMaster(proc.sku_column_master);
    if (proc.target_sheet_name) setTargetSheet(proc.target_sheet_name);

    // Parse mappings back to array
    const mappedArray = Object.entries(proc.field_mappings).map(([src, dst]) => ({ src, dst }));
    setFieldMappings(mappedArray.length > 0 ? mappedArray : [{ src: '', dst: '' }]);
    
    setEditingId(proc.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id) => {
    if (!window.confirm("¿Eliminar este proceso?")) return;
    await fetch(`${API}/api/processes/${id}`, { method: 'DELETE' });
    loadAll();
  };

  const handlePreview = async (id) => {
    setProcessStatus(s => ({ ...s, [id]: { loading: true } }));
    try {
      const res = await fetch(`${API}/api/processes/${id}/preview`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setProcessStatus(s => ({ ...s, [id]: { loading: false, preview: data } }));
      } else {
        const errMsg = await extractError(res);
        setProcessStatus(s => ({ ...s, [id]: { loading: false, error: errMsg } }));
      }
    } catch (err) {
      setProcessStatus(s => ({ ...s, [id]: { loading: false, error: err.message } }));
    }
  };

  const handleStage = async (id) => {
    setProcessStatus(s => ({ ...s, [id]: { ...s[id], running: true } }));
    try {
      const res = await fetch(`${API}/api/processes/${id}/stage`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setProcessStatus(s => ({ ...s, [id]: { loading: false, result: data } }));
        loadAll();
      } else {
        const errMsg = await extractError(res);
        setProcessStatus(s => ({ ...s, [id]: { loading: false, error: errMsg } }));
      }
    } catch (err) {
      setProcessStatus(s => ({ ...s, [id]: { loading: false, error: err.message } }));
    }
  };

  const handleRun = async (id) => {
    setProcessStatus(s => ({ ...s, [id]: { ...s[id], running: true } }));
    try {
      const res = await fetch(`${API}/api/processes/${id}/run`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setProcessStatus(s => ({ ...s, [id]: { loading: false, runResult: data } }));
        loadAll();
      } else {
        const errMsg = await extractError(res);
        setProcessStatus(s => ({ ...s, [id]: { loading: false, error: errMsg } }));
      }
    } catch (err) {
      setProcessStatus(s => ({ ...s, [id]: { loading: false, error: err.message } }));
    }
  };

  const connName = (id) => connections.find(c => c.id === id)?.name || `Conexión ${id}`;

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando procesos...</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Settings2 className="w-6 h-6 text-indigo-600" />
            Procesos de Actualización
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Cada proceso trae datos de un origen y actualiza tu hoja destino usando una columna llave.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setShowForm(!showForm); if(showForm) resetForm(); }}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl font-medium hover:bg-indigo-700 transition text-sm">
            <Plus className="w-4 h-4" /> {editingId ? 'Cancelar Edición' : 'Nuevo Proceso'}
          </button>
        </div>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 text-indigo-800">{editingId ? 'Editar Proceso' : 'Configurar Nuevo Proceso'}</h2>
          <p className="text-sm text-gray-500 mb-5">Configura de dónde vienen los datos (origen) y a dónde van (destino).</p>

          <form onSubmit={handleCreate} className="space-y-5">
            {/* Nombre */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del proceso</label>
                <input value={name} onChange={e => setName(e.target.value)} required
                  placeholder="Ej: Actualizar Inventario, Sync Precios"
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descripción (opcional)</label>
                <input value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="Ej: Trae stock del proveedor XYZ"
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
              </div>
            </div>

            {/* ── BLOQUE ORIGEN ── */}
            <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl">
              <h3 className="text-sm font-semibold text-blue-800 mb-3">📎 ORIGEN — ¿De dónde vienen los datos?</h3>
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Conexión Origen</label>
                  <select value={sourceConnId} onChange={e => loadSourceSheets(e.target.value)} required
                    className="w-full border border-blue-200 rounded-lg p-2 text-sm bg-white">
                    <option value="">Seleccionar archivo origen...</option>
                    {connections.map(c => <option key={c.id} value={c.id}>{c.name} ({c.connection_type})</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Hoja Origen</label>
                  <select value={sourceSheet} onChange={e => setSourceSheet(e.target.value)} required
                    disabled={!sourceConnId} className="w-full border border-blue-200 rounded-lg p-2 text-sm bg-white">
                    <option value="">Seleccionar hoja...</option>
                    {Object.keys(sourceSheets).map(sh => <option key={sh} value={sh}>{sh}</option>)}
                  </select>
                </div>
              </div>

              <div className="mb-3">
                <label className="block text-sm font-medium text-blue-800 mb-1">🔑 Columna llave en Origen (para cruzar datos)</label>
                <select value={skuColSource} onChange={e => setSkuColSource(e.target.value)} required
                  disabled={sourceCols.length === 0}
                  className="w-full border border-blue-200 rounded-lg p-2 text-sm bg-white max-w-sm">
                  <option value="">Seleccionar columna llave...</option>
                  {sourceCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-blue-800 mb-1">Columnas a copiar del Origen</label>
                <p className="text-xs text-blue-600 mb-2">Selecciona qué columnas del origen quieres traer.</p>
                {fieldMappings.map((m, i) => (
                  <div key={i} className="flex gap-2 items-center mb-2">
                    <select value={m.src} onChange={e => {
                      const n = [...fieldMappings]; n[i].src = e.target.value; setFieldMappings(n);
                    }} className="flex-1 border border-blue-200 rounded-md p-1.5 text-sm bg-white">
                      <option value="">Seleccionar columna origen...</option>
                      {sourceCols.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {fieldMappings.length > 1 && (
                      <button type="button" onClick={() => setFieldMappings(fieldMappings.filter((_, idx) => idx !== i))}
                        className="text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => setFieldMappings([...fieldMappings, { src: '', dst: '' }])}
                  className="text-blue-600 text-sm font-medium hover:underline mt-1">+ Añadir columna</button>
              </div>
            </div>

            {/* ── BLOQUE DESTINO ── */}
            <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-xl">
              <div className="flex justify-between items-start mb-3">
                <h3 className="text-sm font-semibold text-indigo-800">📤 DESTINO — Tabla Maestra</h3>
                <button type="button" onClick={handleAutoMap} className="bg-indigo-200 text-indigo-800 px-3 py-1 rounded-md text-xs font-semibold hover:bg-indigo-300">
                  ✨ Auto-Mapear Columnas
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Conexión Maestra</label>
                  <div className="w-full border border-indigo-100 bg-indigo-100 rounded-lg p-2 text-sm text-indigo-700 font-medium">
                    {connections.find(c => c.id === masterInfo?.connId)?.name || 'Tabla Maestra'}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Hoja Destino</label>
                  <select value={targetSheet} onChange={e => { setTargetSheet(e.target.value); setSkuColMaster(''); }}
                    className="w-full border border-indigo-200 rounded-lg p-2 text-sm bg-white">
                    <option value="">Seleccionar hoja...</option>
                    {Object.keys(masterSheets).map(sh => <option key={sh} value={sh}>{sh}</option>)}
                  </select>
                </div>
              </div>

              <div className="mb-3">
                <label className="block text-sm font-medium text-indigo-800 mb-1">🔑 Columna llave en Destino (para cruzar datos)</label>
                <select value={skuColMaster} onChange={e => setSkuColMaster(e.target.value)} required
                  disabled={targetCols.length === 0}
                  className="w-full border border-indigo-200 rounded-lg p-2 text-sm bg-white max-w-sm">
                  <option value="">Seleccionar columna llave...</option>
                  {targetCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-indigo-800 mb-1">Columnas destino a actualizar</label>
                <p className="text-xs text-indigo-600 mb-2">Para cada columna origen (arriba), selecciona en qué columna del destino se escribirá.</p>
                {fieldMappings.map((m, i) => (
                  <div key={i} className="flex gap-2 items-center mb-2">
                    <span className="text-xs text-gray-500 bg-white border rounded px-2 py-1.5 min-w-[140px] truncate">{m.src || `Columna origen ${i+1}`}</span>
                    <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <select value={m.dst} onChange={e => {
                      const n = [...fieldMappings]; n[i].dst = e.target.value; setFieldMappings(n);
                    }} className="flex-1 border border-indigo-200 rounded-md p-1.5 text-sm bg-white">
                      <option value="">Seleccionar columna destino...</option>
                      {targetCols.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button type="submit" disabled={!sourceConnId || !sourceSheet}
                className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed">
                Guardar Proceso
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="text-gray-500 px-4 py-2 rounded-lg font-medium hover:bg-gray-100 transition">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Processes List */}
      {processes.length === 0 && !showForm ? (
        <div className="text-center py-16 text-gray-400">
          <Settings2 className="w-14 h-14 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium mb-1">No hay procesos configurados</p>
          <p className="text-sm mb-4">Crea un proceso para empezar a actualizar tus hojas de datos.</p>
          <button onClick={() => setShowForm(true)}
            className="bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-medium hover:bg-indigo-700">
            <Plus className="w-4 h-4 inline mr-1" /> Crear Primer Proceso
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {processes.map(proc => {
            const st = processStatus[proc.id];
            return (
              <div key={proc.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                      <Settings2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-800">{proc.name}</h3>
                      <p className="text-xs text-gray-500 mb-0.5">
                        <span className="font-medium text-gray-600">Origen:</span> {connName(proc.source_connection_id)} / Hoja "{proc.source_sheet_name}" 
                        <span className="mx-2">→</span> 
                        <span className="font-medium text-indigo-600">Destino:</span> {masterInfo ? `${connName(masterInfo.connId)} / Hoja "${masterInfo.sheetName}"` : 'Tabla Maestra'}
                      </p>
                      <p className="text-xs text-gray-500">
                        <span className="text-gray-400">🔑 {proc.sku_column_source} → {proc.sku_column_master}</span>
                        <span className="mx-2 text-gray-300">|</span>
                        <span>{Object.keys(proc.field_mappings).length} campo(s) mapeados</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handlePreview(proc.id)} disabled={st?.loading}
                      className="flex items-center gap-1 text-sm text-indigo-600 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50">
                      <Eye className="w-3.5 h-3.5" /> Preview
                    </button>
                    <button onClick={() => handleEdit(proc)}
                      className="text-gray-400 hover:text-blue-600 p-1.5"><Edit className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(proc.id)}
                      className="text-red-400 hover:text-red-600 p-1.5"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>

                {/* Preview/Result Panel */}
                {st?.preview && (
                  <div className="border-t border-gray-100 bg-gray-50 p-4">
                    <div className="grid grid-cols-4 gap-3 mb-3">
                      <div className="bg-white p-2 rounded-lg border text-center">
                        <p className="text-xs text-gray-500">Filas de Origen</p>
                        <p className="text-lg font-bold text-gray-800">{st.preview.total_origen}</p>
                      </div>
                      <div className="bg-blue-50 p-2 rounded-lg border border-blue-200 text-center">
                        <p className="text-[10px] font-bold text-blue-600 uppercase">Se Sobreescribirán</p>
                        <p className="text-lg font-bold text-blue-700">{st.preview.rows_updated}</p>
                      </div>
                      <div className="bg-green-50 p-2 rounded-lg border border-green-200 text-center">
                        <p className="text-[10px] font-bold text-green-600 uppercase">Se Añadirán (Nuevos)</p>
                        <p className="text-lg font-bold text-green-700">{st.preview.rows_added}</p>
                      </div>
                      <div className="bg-gray-50 p-2 rounded-lg border text-center">
                        <p className="text-[10px] font-bold text-gray-500 uppercase">Iguales (Sin Cambio)</p>
                        <p className="text-lg font-bold text-gray-600">{st.preview.rows_unchanged}</p>
                      </div>
                    </div>
                    {(st.preview.rows_updated > 0 || st.preview.rows_added > 0) && (
                      <div className="flex items-center gap-3 mt-3">
                        <button onClick={() => handleRun(proc.id)} disabled={st.running}
                          className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
                          <Play className="w-4 h-4" />
                          {st.running ? 'Ejecutando...' : `Ejecutar (${st.preview.rows_updated + st.preview.rows_added} cambios)`}
                        </button>
                        <button onClick={() => handleStage(proc.id)} disabled={st.running}
                          className="text-xs text-yellow-700 hover:underline">
                          o enviar a Staging
                        </button>
                      </div>
                    )}
                    <button onClick={() => setProcessStatus(s => ({ ...s, [proc.id]: null }))}
                      className="ml-2 text-gray-400 text-sm hover:text-gray-600">Cerrar</button>
                  </div>
                )}

                {st?.runResult && (
                  <div className="border-t border-gray-100 bg-green-50 p-4 flex items-center gap-2 text-sm text-green-800">
                    <CheckCircle2 className="w-4 h-4" />
                    ✅ {st.runResult.process_name}: {st.runResult.rows_updated} actualizadas, {st.runResult.rows_added} nuevas
                    <button onClick={() => setProcessStatus(s => ({ ...s, [proc.id]: null }))}
                      className="ml-auto text-gray-400 text-xs hover:text-gray-600">Cerrar</button>
                  </div>
                )}

                {st?.result && (
                  <div className="border-t border-gray-100 bg-yellow-50 p-4 flex items-center gap-2 text-sm text-yellow-800">
                    <CheckCircle2 className="w-4 h-4" />
                    ✅ {st.result.message}
                    <button onClick={() => setProcessStatus(s => ({ ...s, [proc.id]: null }))}
                      className="ml-auto text-yellow-600 text-xs hover:underline font-medium">Cerrar</button>
                  </div>
                )}

                {st?.error && (
                  <div className="border-t border-gray-100 bg-red-50 p-4 flex items-center gap-2 text-sm text-red-700">
                    <XCircle className="w-4 h-4 flex-shrink-0" /> <span className="flex-1 break-words whitespace-normal min-w-0">{st.error}</span>
                    <button onClick={() => setProcessStatus(s => ({ ...s, [proc.id]: null }))}
                      className="ml-auto text-gray-400 text-xs hover:text-gray-600">Cerrar</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
