import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Table2, Link2, ArrowDownToLine, RefreshCw, ExternalLink } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';

export default function MasterTable() {
  const { projectId } = useParams();
  const [loading, setLoading] = useState(true);

  // Data state
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [totalRows, setTotalRows] = useState(0);

  // Link state
  const [showLink, setShowLink] = useState(false);
  const [connections, setConnections] = useState([]);
  const [masterConnId, setMasterConnId] = useState('');
  const [masterSheets, setMasterSheets] = useState({});
  const [masterSheet, setMasterSheet] = useState('');
  const [linking, setLinking] = useState(false);

  // Active master info
  const [activeMasterConnId, setActiveMasterConnId] = useState(null);
  const [activeMasterSheet, setActiveMasterSheet] = useState(null);

  // Sync state
  const [showSync, setShowSync] = useState(false);
  const [syncConnId, setSyncConnId] = useState('');
  const [syncSheets, setSyncSheets] = useState({});
  const [syncSheet, setSyncSheet] = useState('');
  const [syncSkuColSource, setSyncSkuColSource] = useState('');
  const [syncSkuColMaster, setSyncSkuColMaster] = useState('');
  const [syncMappings, setSyncMappings] = useState([{ src: '', dst: '' }]);
  const [syncing, setSyncing] = useState(false);
  const [syncPreview, setSyncPreview] = useState(null); // resultado del preview

  useEffect(() => {
    loadConnections();
    loadMasterData();
  }, [projectId]);

  const loadConnections = async () => {
    try {
      const res = await fetch(`${API}/api/connections/`);
      const data = await res.json();
      setConnections(data);
    } catch (err) { console.error(err); }
  };

  const loadMasterData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/projects/${projectId}/master`);
      const data = await res.json();
      if (res.ok) {
        setColumns(data.columns || []);
        setRows(data.rows || []);
        setTotalRows(data.total_rows || 0);
        setActiveMasterConnId(data.master_connection_id);
        setActiveMasterSheet(data.master_sheet_name);
      } else {
        // If 404 (no master linked), just clear data
        setColumns([]);
        setRows([]);
        setTotalRows(0);
        setActiveMasterConnId(null);
        setActiveMasterSheet(null);
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  // --- Link Master ---
  const loadMasterSheets = async (connId) => {
    setMasterConnId(connId);
    if (!connId) return;
    try {
      const res = await fetch(`${API}/api/connections/${connId}/metadata`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Error cargando hojas');
      setMasterSheets(data.sheets || {});
    } catch (err) {
      alert(err.message);
      setMasterSheets({});
    }
  };

  const handleLink = async () => {
    setLinking(true);
    try {
      const res = await fetch(`${API}/api/projects/${projectId}/master-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          master_connection_id: parseInt(masterConnId),
          master_sheet_name: masterSheet
        })
      });
      if (res.ok) {
        alert(`✅ Tabla maestra enlazada correctamente`);
        setShowLink(false);
        loadMasterData();
      } else {
        const data = await res.json();
        alert('Error: ' + data.detail);
      }
    } catch (err) { console.error(err); }
    setLinking(false);
  };

  const handleUnlink = async () => {
    if(!window.confirm("¿Estás seguro de que deseas desvincular la tabla maestra actual?")) return;
    try {
      const res = await fetch(`${API}/api/projects/${projectId}/master-unlink`, { method: 'POST' });
      if (res.ok) {
        alert("✅ Tabla maestra desvinculada correctamente");
        setShowLink(false);
        loadMasterData();
      }
    } catch(err) { console.error(err); }
  };

  // --- Sync ---
  const loadSyncSheets = async (connId) => {
    setSyncConnId(connId);
    if (!connId) return;
    try {
      const res = await fetch(`${API}/api/connections/${connId}/metadata`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Error cargando hojas');
      setSyncSheets(data.sheets || {});
    } catch (err) {
      alert(err.message);
      setSyncSheets({});
    }
  };

  const getSyncPayload = () => {
    const fieldMappings = {};
    syncMappings.forEach(m => { if (m.src && m.dst) fieldMappings[m.src] = m.dst; });
    return {
      source_connection_id: parseInt(syncConnId),
      source_sheet_name: syncSheet,
      sku_column_source: syncSkuColSource,
      sku_column_master: syncSkuColMaster,
      field_mappings: fieldMappings,
      add_new_rows: true
    };
  };

  // Paso 1: Vista previa (no escribe)
  const handlePreviewSync = async () => {
    if (!syncSkuColSource || !syncSkuColMaster) {
      alert("Por favor selecciona ambas columnas llave (origen y maestra).");
      return;
    }
    const payload = getSyncPayload();
    if (Object.keys(payload.field_mappings).length === 0) {
      alert("Debes asignar al menos un campo de datos a sincronizar (aparte de la llave).");
      return;
    }
    setSyncing(true);
    setSyncPreview(null);
    try {
      const res = await fetch(`${API}/api/projects/${projectId}/master-sync-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        setSyncPreview(data);
      } else {
        const errorDetail = data.detail || data.traceback || JSON.stringify(data);
        alert('❌ Error al calcular preview:\n\n' + errorDetail);
      }
    } catch (err) {
      console.error(err);
      alert('❌ Error de conexión: ' + err.message);
    }
    setSyncing(false);
  };

  // Paso 2: Confirmar y escribir
  const handleConfirmSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${API}/api/projects/${projectId}/master-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getSyncPayload())
      });
      const data = await res.json();
      if (res.ok) {
        alert(`✅ ${data.message}`);
        setShowSync(false);
        setSyncPreview(null);
        loadMasterData();
      } else {
        const errorDetail = data.detail || data.traceback || JSON.stringify(data);
        alert('❌ Error en sincronización:\n\n' + errorDetail);
      }
    } catch (err) {
      console.error(err);
      alert('❌ Error de conexión: ' + err.message);
    }
    setSyncing(false);
  };

  const syncSourceCols = syncSheet && syncSheets[syncSheet] ? syncSheets[syncSheet] : [];

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Cargando Tabla Maestra...</div>;
  }

  return (
    <div className="p-8 max-w-full mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Table2 className="w-6 h-6 text-purple-600" />
            Tabla Maestra (Google Sheets)
          </h1>
          {activeMasterConnId ? (
            <p className="text-gray-500 text-sm mt-1">
              Enlazada a Google Sheet • {totalRows} filas
            </p>
          ) : (
            <p className="text-gray-500 text-sm mt-1">Ninguna tabla maestra enlazada</p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {!activeMasterConnId ? (
            <button onClick={() => setShowLink(!showLink)}
              className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-purple-700 transition text-sm">
              <Link2 className="w-4 h-4" /> Enlazar Tabla Maestra
            </button>
          ) : (
            <button onClick={handleUnlink}
              className="flex items-center gap-2 bg-red-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-600 transition text-sm">
              <Link2 className="w-4 h-4" /> Desvincular Tabla
            </button>
          )}

          {activeMasterConnId && (
            <button onClick={() => setShowSync(!showSync)}
              className="flex items-center gap-2 bg-orange-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-orange-700 transition text-sm">
              <ArrowDownToLine className="w-4 h-4" /> Sincronizar desde Origen
            </button>
          )}

          <button onClick={loadMasterData}
            className="flex items-center gap-2 border border-gray-300 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-50 transition text-sm">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Link Panel */}
      {showLink && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-5 mb-6">
          <h3 className="font-semibold text-purple-800 mb-3">Enlazar Google Sheet como Maestra</h3>
          <p className="text-sm text-purple-600 mb-4">Selecciona qué conexión y hoja actuará como tu Tabla Maestra. Los datos se leerán y escribirán directamente allí.</p>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Conexión Google Sheets</label>
              <select value={masterConnId} onChange={e => loadMasterSheets(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm">
                <option value="">Seleccionar...</option>
                {connections.filter(c => c.connection_type === 'google_sheets').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hoja (Pestaña)</label>
              <select value={masterSheet} onChange={e => setMasterSheet(e.target.value)}
                disabled={!masterConnId} className="w-full border border-gray-300 rounded-lg p-2 text-sm">
                <option value="">Seleccionar...</option>
                {Object.keys(masterSheets).map(sh => <option key={sh} value={sh}>{sh}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleLink} disabled={linking || !masterSheet}
              className="bg-purple-600 text-white px-5 py-2 rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 text-sm">
              {linking ? 'Enlazando...' : 'Enlazar'}
            </button>
            <button onClick={() => setShowLink(false)} className="text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 text-sm">Cancelar</button>
          </div>
        </div>
      )}

      {/* Sync Panel */}
      {showSync && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-5 mb-6">
          <h3 className="font-semibold text-orange-800 mb-3">Sincronizar desde Tabla Origen a la Maestra</h3>
          <p className="text-sm text-orange-600 mb-4">Actualiza los datos directamente en tu Google Sheet maestro usando un campo llave (SKU).</p>
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Conexión Origen (Nuevos Datos)</label>
              <select value={syncConnId} onChange={e => loadSyncSheets(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm">
                <option value="">Seleccionar...</option>
                {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Hoja Origen</label>
              <select value={syncSheet} onChange={e => setSyncSheet(e.target.value)}
                disabled={!syncConnId} className="w-full border border-gray-300 rounded-lg p-2 text-sm">
                <option value="">Seleccionar...</option>
                {Object.keys(syncSheets).map(sh => <option key={sh} value={sh}>{sh}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Campo Llave en Origen</label>
              <select value={syncSkuColSource} onChange={e => setSyncSkuColSource(e.target.value)}
                disabled={!syncSheet} className="w-full border border-gray-300 rounded-lg p-2 text-sm">
                <option value="">Seleccionar columna llave...</option>
                {syncSourceCols.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Campo Llave en Maestra</label>
              <select value={syncSkuColMaster} onChange={e => setSyncSkuColMaster(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm">
                <option value="">Seleccionar...</option>
                {columns.map(col => <option key={col} value={col}>{col}</option>)}
              </select>
            </div>
          </div>
          {/* Field mappings */}
          <div className="mb-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium text-gray-700">Asignación de Columnas (Mapeo de Info) <span className="text-gray-400">(Origen → Maestra)</span></label>
              <button onClick={() => setSyncMappings([...syncMappings, { src: '', dst: '' }])} className="text-orange-600 text-sm font-medium hover:underline">+ Añadir Campo</button>
            </div>
            {syncMappings.map((m, i) => (
              <div key={i} className="flex gap-3 items-center mb-2">
                <select value={m.src} onChange={e => { const u = [...syncMappings]; u[i].src = e.target.value; setSyncMappings(u); }}
                  className="flex-1 border border-gray-300 rounded-lg p-2 text-sm">
                  <option value="">Campo origen (nuevo dato)...</option>
                  {syncSourceCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <span className="text-gray-400">→</span>
                <select value={m.dst} onChange={e => { const u = [...syncMappings]; u[i].dst = e.target.value; setSyncMappings(u); }}
                  className="flex-1 border border-gray-300 rounded-lg p-2 text-sm">
                  <option value="">Campo maestra (a actualizar)...</option>
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {syncMappings.length > 1 && (
                  <button onClick={() => setSyncMappings(syncMappings.filter((_, idx) => idx !== i))} className="text-red-400 hover:text-red-600">
                    Eliminar
                  </button>
                )}
              </div>
            ))}
          </div>
          {/* Botón de Vista Previa */}
          {!syncPreview && (
            <div className="flex gap-2 mt-4">
              <button onClick={handlePreviewSync} disabled={syncing || !syncSkuColSource || !syncSkuColMaster}
                className="bg-orange-600 text-white px-5 py-2 rounded-lg font-medium hover:bg-orange-700 disabled:opacity-50 text-sm">
                {syncing ? 'Calculando...' : '🔍 Ver Vista Previa'}
              </button>
              <button onClick={() => { setShowSync(false); setSyncPreview(null); }} className="text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 text-sm">Cancelar</button>
            </div>
          )}

          {/* Resultados del Preview */}
          {syncPreview && (
            <div className="mt-5 border-t border-orange-200 pt-5">
              <h4 className="font-semibold text-gray-800 mb-3">📋 Resultado del Análisis</h4>
              
              {/* Stats Cards */}
              <div className="grid grid-cols-4 gap-3 mb-4">
                <div className="bg-white p-3 rounded-lg border border-gray-200 text-center">
                  <p className="text-xs text-gray-500">Total Origen</p>
                  <p className="text-xl font-bold text-gray-800">{syncPreview.total_origen}</p>
                </div>
                <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 text-center">
                  <p className="text-xs text-blue-600">📊 Actualizarán</p>
                  <p className="text-xl font-bold text-blue-700">{syncPreview.rows_updated}</p>
                </div>
                <div className="bg-green-50 p-3 rounded-lg border border-green-200 text-center">
                  <p className="text-xs text-green-600">➕ Nuevos</p>
                  <p className="text-xl font-bold text-green-700">{syncPreview.rows_added}</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 text-center">
                  <p className="text-xs text-gray-500">Sin Cambio</p>
                  <p className="text-xl font-bold text-gray-600">{syncPreview.rows_unchanged}</p>
                </div>
              </div>

              {/* Detalle de productos nuevos */}
              {syncPreview.detail_added?.length > 0 && (
                <details className="mb-3">
                  <summary className="cursor-pointer text-sm font-medium text-green-700 hover:text-green-900">
                    ➕ {syncPreview.rows_added} producto(s) nuevo(s) — ver detalle
                  </summary>
                  <div className="mt-2 bg-green-50 rounded-lg p-3 max-h-40 overflow-y-auto">
                    {syncPreview.detail_added.map((item, i) => (
                      <div key={i} className="text-sm text-green-800 py-1 border-b border-green-100 last:border-0">
                        <span className="font-medium">{item.sku}</span>
                        <span className="text-green-600 ml-2">
                          {Object.entries(item.datos || {}).map(([k, v]) => `${k}: ${v}`).join(' • ')}
                        </span>
                      </div>
                    ))}
                    {syncPreview.rows_added > 50 && <p className="text-xs text-green-500 mt-1">...y {syncPreview.rows_added - 50} más</p>}
                  </div>
                </details>
              )}

              {/* Detalle de productos actualizados */}
              {syncPreview.detail_updated?.length > 0 && (
                <details className="mb-3">
                  <summary className="cursor-pointer text-sm font-medium text-blue-700 hover:text-blue-900">
                    📊 {syncPreview.rows_updated} producto(s) con cambios — ver detalle
                  </summary>
                  <div className="mt-2 bg-blue-50 rounded-lg p-3 max-h-40 overflow-y-auto">
                    {syncPreview.detail_updated.map((item, i) => (
                      <div key={i} className="text-sm text-blue-800 py-1 border-b border-blue-100 last:border-0">
                        <span className="font-medium">{item.sku}</span>
                        <span className="text-blue-600 ml-2">
                          {Object.entries(item.cambios || {}).map(([k, v]) => `${k}: "${v.antes}" → "${v['después']}"`).join(' • ')}
                        </span>
                      </div>
                    ))}
                    {syncPreview.rows_updated > 50 && <p className="text-xs text-blue-500 mt-1">...y {syncPreview.rows_updated - 50} más</p>}
                  </div>
                </details>
              )}

              {/* Detalle sin cambios */}
              {syncPreview.detail_unchanged?.length > 0 && (
                <details className="mb-3">
                  <summary className="cursor-pointer text-sm font-medium text-gray-500 hover:text-gray-700">
                    Sin cambio: {syncPreview.rows_unchanged} producto(s) ya están actualizados
                  </summary>
                  <div className="mt-2 bg-gray-50 rounded-lg p-3 max-h-32 overflow-y-auto">
                    <p className="text-sm text-gray-600">{syncPreview.detail_unchanged.join(', ')}</p>
                    {syncPreview.rows_unchanged > 50 && <p className="text-xs text-gray-400 mt-1">...y {syncPreview.rows_unchanged - 50} más</p>}
                  </div>
                </details>
              )}

              {/* Botones de acción */}
              <div className="flex gap-2 mt-4">
                {(syncPreview.rows_updated > 0 || syncPreview.rows_added > 0) ? (
                  <button onClick={handleConfirmSync} disabled={syncing}
                    className="bg-green-600 text-white px-5 py-2 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 text-sm">
                    {syncing ? 'Escribiendo en Google Sheets...' : `✅ Confirmar y Sincronizar (${syncPreview.rows_updated + syncPreview.rows_added} cambios)`}
                  </button>
                ) : (
                  <div className="bg-gray-100 text-gray-600 px-5 py-2 rounded-lg text-sm font-medium">
                    ✓ No hay cambios que aplicar. Todo está actualizado.
                  </div>
                )}
                <button onClick={() => { setSyncPreview(null); }} className="text-orange-600 px-4 py-2 rounded-lg hover:bg-orange-50 text-sm">← Modificar Mapeo</button>
                <button onClick={() => { setShowSync(false); setSyncPreview(null); }} className="text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 text-sm">Cancelar</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!activeMasterConnId ? (
        <div className="text-center py-20 text-gray-400">
          <Link2 className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <p className="text-xl font-medium mb-2">Sin Tabla Maestra</p>
          <p className="text-sm mb-6">Enlaza un Google Sheet para usarlo como la tabla maestra de este proyecto.</p>
          <button onClick={() => setShowLink(true)}
            className="bg-purple-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-purple-700 transition">
            <Link2 className="w-5 h-5 inline mr-2" /> Enlazar Google Sheet
          </button>
        </div>
      ) : (
        /* Data Preview */
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
            <div>
              <h3 className="font-semibold text-gray-800">Vista Previa de la Maestra</h3>
              <p className="text-xs text-gray-500 mt-1">Los datos se leen en tiempo real desde Google Sheets. Para editarlos, abre tu Sheet.</p>
            </div>
            {connections.find(c => c.id === activeMasterConnId)?.google_sheet_url && (
              <a href={connections.find(c => c.id === activeMasterConnId).google_sheet_url} target="_blank" rel="noreferrer"
                className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-sm font-medium">
                Abrir Sheet <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-white shadow-sm z-10">
                <tr className="bg-gray-50 border-b border-gray-200">
                  {columns.map((col, idx) => (
                    <th key={idx} className="p-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row._id} className="hover:bg-blue-50/30 transition border-b border-gray-100">
                    {columns.map((col, idx) => (
                      <td key={idx} className="p-2 text-sm text-gray-700">
                        {row[col] || ''}
                      </td>
                    ))}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={columns.length || 1} className="p-8 text-center text-gray-400">
                      La hoja está vacía. Agrega datos en Google Sheets o usa la sincronización.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
