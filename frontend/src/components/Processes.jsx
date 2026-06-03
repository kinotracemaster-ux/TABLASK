import { useState, useEffect } from 'react';
import { Settings2, Plus, Trash2, Play, Eye, RefreshCw, CheckCircle2, XCircle, ChevronDown, ChevronUp, Zap } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';

export default function Processes() {
  const [processes, setProcesses] = useState([]);
  const [connections, setConnections] = useState([]);
  const [masterCols, setMasterCols] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sourceConnId, setSourceConnId] = useState('');
  const [sourceSheets, setSourceSheets] = useState({});
  const [sourceSheet, setSourceSheet] = useState('');
  const [skuColSource, setSkuColSource] = useState('');
  const [skuColMaster, setSkuColMaster] = useState('');
  const [fieldMappings, setFieldMappings] = useState([{ src: '', dst: '' }]);

  // Preview/Run state per process
  const [processStatus, setProcessStatus] = useState({}); // { [id]: { loading, preview, result } }

  // Run All state
  const [runAllLoading, setRunAllLoading] = useState(false);
  const [runAllResult, setRunAllResult] = useState(null);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [procsRes, connsRes, colsRes] = await Promise.all([
        fetch(`${API}/api/processes/`),
        fetch(`${API}/api/connections/`),
        fetch(`${API}/api/master-columns`)
      ]);
      setProcesses(await procsRes.json());
      setConnections(await connsRes.json());
      setMasterCols(await colsRes.json());
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const loadSourceSheets = async (connId) => {
    setSourceConnId(connId);
    if (!connId) return;
    try {
      const res = await fetch(`${API}/api/connections/${connId}/metadata`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Error');
      setSourceSheets(data.sheets || {});
    } catch (err) {
      alert(err.message);
      setSourceSheets({});
    }
  };

  const sourceCols = sourceSheet && sourceSheets[sourceSheet] ? sourceSheets[sourceSheet] : [];

  const handleCreate = async (e) => {
    e.preventDefault();
    const mappings = {};
    fieldMappings.forEach(m => { if (m.src && m.dst) mappings[m.src] = m.dst; });

    if (Object.keys(mappings).length === 0) {
      alert("Debes asignar al menos un campo de datos.");
      return;
    }

    const res = await fetch(`${API}/api/processes/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, description,
        source_connection_id: parseInt(sourceConnId),
        source_sheet_name: sourceSheet,
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
      const data = await res.json();
      alert('Error: ' + (data.detail || JSON.stringify(data)));
    }
  };

  const resetForm = () => {
    setName(''); setDescription(''); setSourceConnId(''); setSourceSheet('');
    setSkuColSource(''); setSkuColMaster('');
    setFieldMappings([{ src: '', dst: '' }]);
    setSourceSheets({});
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
        setProcessStatus(s => ({ ...s, [id]: { loading: false, error: data.detail } }));
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
        setProcessStatus(s => ({ ...s, [id]: { loading: false, result: data } }));
        loadAll();
      } else {
        setProcessStatus(s => ({ ...s, [id]: { loading: false, error: data.detail } }));
      }
    } catch (err) {
      setProcessStatus(s => ({ ...s, [id]: { loading: false, error: err.message } }));
    }
  };

  const handleRunAll = async () => {
    setRunAllLoading(true);
    setRunAllResult(null);
    try {
      const res = await fetch(`${API}/api/run-all`, { method: 'POST' });
      const data = await res.json();
      setRunAllResult(data);
    } catch (err) {
      setRunAllResult({ message: 'Error de conexión: ' + err.message, errors: [{ process: 'Red', error: err.message }] });
    }
    setRunAllLoading(false);
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
            Procesos de Importación
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Cada proceso trae datos de una fuente externa hacia tu Tabla Maestra usando el SKU como llave.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleRunAll} disabled={runAllLoading || processes.length === 0}
            className="flex items-center gap-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white px-5 py-2.5 rounded-xl font-semibold hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 transition shadow-sm text-sm">
            <Zap className={`w-4 h-4 ${runAllLoading ? 'animate-pulse' : ''}`} />
            {runAllLoading ? 'Ejecutando todo...' : '⚡ Correr Procesos'}
          </button>
          <button onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl font-medium hover:bg-indigo-700 transition text-sm">
            <Plus className="w-4 h-4" /> Nuevo Proceso
          </button>
        </div>
      </div>

      {/* Diagrama de flujo */}
      <div className="flex items-center gap-3 bg-gradient-to-r from-blue-50 via-purple-50 to-green-50 border border-blue-100 rounded-xl p-4 mb-6 text-sm">
        <div className="bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg font-medium">📎 Fuentes Externas</div>
        <span className="text-gray-400">→</span>
        <div className="bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-lg font-medium">⚙️ Procesos</div>
        <span className="text-gray-400">→</span>
        <div className="bg-purple-100 text-purple-700 px-3 py-1.5 rounded-lg font-medium">📊 Tabla Maestra</div>
        <span className="text-gray-400">→</span>
        <div className="bg-green-100 text-green-700 px-3 py-1.5 rounded-lg font-medium">📤 Hojas Destino</div>
      </div>

      {/* Run All Result */}
      {runAllResult && (
        <div className={`mb-6 rounded-xl border p-5 ${runAllResult.errors?.length > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'}`}>
          <h3 className="font-semibold text-gray-800 mb-3">{runAllResult.message}</h3>
          <div className="grid grid-cols-4 gap-3 mb-3">
            <div className="bg-white p-2 rounded-lg text-center border">
              <p className="text-xs text-gray-500">Procesos OK</p>
              <p className="text-lg font-bold text-indigo-700">{runAllResult.summary?.processes_ok || 0}</p>
            </div>
            <div className="bg-white p-2 rounded-lg text-center border">
              <p className="text-xs text-gray-500">Formatos OK</p>
              <p className="text-lg font-bold text-green-700">{runAllResult.summary?.exports_ok || 0}</p>
            </div>
            <div className="bg-white p-2 rounded-lg text-center border">
              <p className="text-xs text-gray-500">Filas actualizadas</p>
              <p className="text-lg font-bold text-blue-700">{runAllResult.summary?.total_rows_updated || 0}</p>
            </div>
            <div className="bg-white p-2 rounded-lg text-center border">
              <p className="text-xs text-gray-500">Filas nuevas</p>
              <p className="text-lg font-bold text-emerald-700">{runAllResult.summary?.total_rows_added || 0}</p>
            </div>
          </div>
          {runAllResult.errors?.length > 0 && (
            <div className="space-y-1">
              {runAllResult.errors.map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-red-700 bg-red-50 rounded p-2">
                  <XCircle className="w-4 h-4" /> <span className="font-medium">{e.process}:</span> {e.error}
                </div>
              ))}
            </div>
          )}
          <button onClick={() => setRunAllResult(null)} className="text-xs text-gray-400 mt-2 hover:text-gray-600">Cerrar</button>
        </div>
      )}

      {/* Create Form */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 text-indigo-800">Nuevo Proceso de Importación</h2>
          <p className="text-sm text-gray-500 mb-4">Define de dónde vienen los datos y qué columnas actualizar en la Maestra.</p>
          <form onSubmit={handleCreate} className="space-y-4">
            {/* Nombre */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del proceso</label>
                <input value={name} onChange={e => setName(e.target.value)} required
                  placeholder="Ej: Actualizar Inventario, Actualizar Precios"
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descripción (opcional)</label>
                <input value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="Ej: Trae stock del proveedor XYZ"
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
              </div>
            </div>

            {/* Fuente */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">📎 Fuente de datos (Conexión)</label>
                <select value={sourceConnId} onChange={e => loadSourceSheets(e.target.value)} required
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm">
                  <option value="">Seleccionar conexión...</option>
                  {connections.map(c => <option key={c.id} value={c.id}>{c.name} ({c.connection_type})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hoja del origen</label>
                <select value={sourceSheet} onChange={e => setSourceSheet(e.target.value)} required
                  disabled={!sourceConnId} className="w-full border border-gray-300 rounded-lg p-2 text-sm">
                  <option value="">Seleccionar hoja...</option>
                  {Object.keys(sourceSheets).map(sh => <option key={sh} value={sh}>{sh}</option>)}
                </select>
              </div>
            </div>

            {/* Llaves */}
            <div className="grid grid-cols-2 gap-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div>
                <label className="block text-sm font-medium text-amber-800 mb-1">🔑 Columna llave en ORIGEN</label>
                <select value={skuColSource} onChange={e => setSkuColSource(e.target.value)} required
                  disabled={!sourceSheet} className="w-full border border-gray-300 rounded-lg p-2 text-sm">
                  <option value="">Seleccionar (ej: Código, SKU)...</option>
                  {sourceCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <p className="text-xs text-amber-600 mt-1">El nombre de la columna que contiene el SKU en la fuente</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-amber-800 mb-1">🔑 Columna llave en MAESTRA</label>
                <select value={skuColMaster} onChange={e => setSkuColMaster(e.target.value)} required
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm">
                  <option value="">Seleccionar (ej: SKU)...</option>
                  {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <p className="text-xs text-amber-600 mt-1">El nombre puede ser diferente, lo importante es que el contenido sea el mismo</p>
              </div>
            </div>

            {/* Mapeo de campos */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-medium text-gray-700">
                  Campos a importar <span className="text-gray-400">(Origen → Maestra)</span>
                </label>
                <button type="button" onClick={() => setFieldMappings([...fieldMappings, { src: '', dst: '' }])}
                  className="text-indigo-600 text-sm font-medium hover:underline">+ Añadir campo</button>
              </div>
              {fieldMappings.map((m, i) => (
                <div key={i} className="flex gap-3 items-center mb-2">
                  <select value={m.src} onChange={e => { const u = [...fieldMappings]; u[i].src = e.target.value; setFieldMappings(u); }}
                    className="flex-1 border border-gray-300 rounded-lg p-2 text-sm">
                    <option value="">Campo origen...</option>
                    {sourceCols.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <span className="text-gray-400">→</span>
                  <select value={m.dst} onChange={e => { const u = [...fieldMappings]; u[i].dst = e.target.value; setFieldMappings(u); }}
                    className="flex-1 border border-gray-300 rounded-lg p-2 text-sm">
                    <option value="">Campo maestra...</option>
                    {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {fieldMappings.length > 1 && (
                    <button type="button" onClick={() => setFieldMappings(fieldMappings.filter((_, idx) => idx !== i))}
                      className="text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-2 pt-2">
              <button type="submit" className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-indigo-700 text-sm">
                Guardar Proceso
              </button>
              <button type="button" onClick={() => { setShowForm(false); resetForm(); }}
                className="text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 text-sm">Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {/* Processes List */}
      {processes.length === 0 && !showForm ? (
        <div className="text-center py-16 text-gray-400">
          <Settings2 className="w-14 h-14 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium mb-1">No hay procesos configurados</p>
          <p className="text-sm mb-4">Crea un proceso para empezar a importar datos a tu Tabla Maestra.</p>
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
                      <p className="text-xs text-gray-500">
                        {connName(proc.source_connection_id)} → Hoja "{proc.source_sheet_name}"
                        <span className="ml-2 text-gray-400">|</span>
                        <span className="ml-2">🔑 {proc.sku_column_source} → {proc.sku_column_master}</span>
                        <span className="ml-2 text-gray-400">|</span>
                        <span className="ml-2">{Object.keys(proc.field_mappings).length} campo(s)</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handlePreview(proc.id)} disabled={st?.loading}
                      className="flex items-center gap-1 text-sm text-indigo-600 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50">
                      <Eye className="w-3.5 h-3.5" /> Preview
                    </button>
                    <button onClick={() => handleRun(proc.id)} disabled={st?.running}
                      className="flex items-center gap-1 text-sm text-green-700 border border-green-200 px-3 py-1.5 rounded-lg hover:bg-green-50">
                      <Play className="w-3.5 h-3.5" /> Ejecutar
                    </button>
                    <button onClick={() => handleDelete(proc.id)}
                      className="text-red-400 hover:text-red-600 p-1.5"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>

                {/* Preview/Result Panel */}
                {st?.preview && (
                  <div className="border-t border-gray-100 bg-gray-50 p-4">
                    <div className="grid grid-cols-4 gap-3 mb-3">
                      <div className="bg-white p-2 rounded-lg border text-center">
                        <p className="text-xs text-gray-500">Total Origen</p>
                        <p className="text-lg font-bold text-gray-800">{st.preview.total_origen}</p>
                      </div>
                      <div className="bg-blue-50 p-2 rounded-lg border border-blue-200 text-center">
                        <p className="text-xs text-blue-600">Actualizarán</p>
                        <p className="text-lg font-bold text-blue-700">{st.preview.rows_updated}</p>
                      </div>
                      <div className="bg-green-50 p-2 rounded-lg border border-green-200 text-center">
                        <p className="text-xs text-green-600">Nuevos</p>
                        <p className="text-lg font-bold text-green-700">{st.preview.rows_added}</p>
                      </div>
                      <div className="bg-gray-50 p-2 rounded-lg border text-center">
                        <p className="text-xs text-gray-500">Sin Cambio</p>
                        <p className="text-lg font-bold text-gray-600">{st.preview.rows_unchanged}</p>
                      </div>
                    </div>
                    {(st.preview.rows_updated > 0 || st.preview.rows_added > 0) && (
                      <button onClick={() => handleRun(proc.id)} disabled={st.running}
                        className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                        {st.running ? 'Escribiendo...' : `✅ Confirmar (${st.preview.rows_updated + st.preview.rows_added} cambios)`}
                      </button>
                    )}
                    <button onClick={() => setProcessStatus(s => ({ ...s, [proc.id]: null }))}
                      className="ml-2 text-gray-400 text-sm hover:text-gray-600">Cerrar</button>
                  </div>
                )}

                {st?.result && (
                  <div className="border-t border-gray-100 bg-green-50 p-4 flex items-center gap-2 text-sm text-green-700">
                    <CheckCircle2 className="w-4 h-4" />
                    ✅ {st.result.rows_updated} actualizadas, {st.result.rows_added} nuevas
                    <button onClick={() => setProcessStatus(s => ({ ...s, [proc.id]: null }))}
                      className="ml-auto text-gray-400 text-xs hover:text-gray-600">Cerrar</button>
                  </div>
                )}

                {st?.error && (
                  <div className="border-t border-gray-100 bg-red-50 p-4 flex items-center gap-2 text-sm text-red-700">
                    <XCircle className="w-4 h-4" /> {st.error}
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
