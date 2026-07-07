import { useState, useEffect } from 'react';
import { Table2, Link2, Zap, CheckCircle2, XCircle, Settings2, Download, Eye, Trash2, ShieldAlert, Play, RefreshCw } from 'lucide-react';
import { extractError } from '../utils/errors';

const API = import.meta.env.VITE_API_URL || '';

export default function MasterTable() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('datos');

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
  const [masterSheetColumns, setMasterSheetColumns] = useState([]);
  const [masterSkuColumn, setMasterSkuColumn] = useState('');
  const [linking, setLinking] = useState(false);

  // Active master info
  const [activeMasterConnId, setActiveMasterConnId] = useState(null);
  const [activeMasterSheet, setActiveMasterSheet] = useState(null);
  const [activeMasterSkuColumn, setActiveMasterSkuColumn] = useState('');

  // Run all state
  const [runAllLoading, setRunAllLoading] = useState(false);
  const [runAllResult, setRunAllResult] = useState(null);

  // Reflejo (sincronización manual maestra → hijas)
  const [reflectLoading, setReflectLoading] = useState(false);
  const [reflectResult, setReflectResult] = useState(null);

  // Preview state (PASO 3)
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  
  // Alerta de 0 Matches
  const [lowMatchAcknowledged, setLowMatchAcknowledged] = useState(false);

  // Processes & Exports lists for tabs
  const [processes, setProcesses] = useState([]);
  const [exports, setExports] = useState([]);

  useEffect(() => {
    loadConnections();
    loadMasterData();
    loadProcesses();
    loadExports();
  }, []);

  const loadConnections = async () => {
    try {
      const res = await fetch(`${API}/api/connections/`);
      setConnections(await res.json());
    } catch (err) { console.error(err); }
  };

  const loadProcesses = async () => {
    try {
      const res = await fetch(`${API}/api/processes/`);
      setProcesses(await res.json());
    } catch (err) { console.error(err); }
  };

  const loadExports = async () => {
    try {
      const res = await fetch(`${API}/api/exports/`);
      setExports(await res.json());
    } catch (err) { console.error(err); }
  };

  const connName = (id) => {
    const c = connections.find(c => c.id === id);
    return c ? c.name : `Conexión #${id}`;
  };

  const loadMasterData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/master`);
      const data = await res.json();
      if (res.ok) {
        setColumns(data.columns || []);
        setRows(data.rows || []);
        setTotalRows(data.total_rows || 0);
        setActiveMasterConnId(data.master_connection_id);
        setActiveMasterSheet(data.master_sheet_name);
        setActiveMasterSkuColumn(data.master_sku_column || '');
      } else {
        setColumns([]); setRows([]); setTotalRows(0);
        setActiveMasterConnId(null); setActiveMasterSheet(null);
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  // --- Link Master ---
  const loadMasterSheets = async (connId) => {
    setMasterConnId(connId);
    setMasterSheet('');
    setMasterSheetColumns([]);
    setMasterSkuColumn('');
    if (!connId) return;
    try {
      const res = await fetch(`${API}/api/connections/${connId}/metadata`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Fallo cargando hojas');
      setMasterSheets(data.sheets || {});
    } catch (err) {
      alert(err.message);
      setMasterSheets({});
    }
  };

  const handleSelectMasterSheet = (sheetName) => {
    setMasterSheet(sheetName);
    setMasterSkuColumn('');
    if (sheetName && masterSheets[sheetName]) {
      setMasterSheetColumns(masterSheets[sheetName]);
    } else {
      setMasterSheetColumns([]);
    }
  };

  const handleLink = async () => {
    setLinking(true);
    try {
      const res = await fetch(`${API}/api/master/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          master_connection_id: parseInt(masterConnId),
          master_sheet_name: masterSheet,
          master_sku_column: masterSkuColumn
        })
      });
      if (res.ok) {
        setShowLink(false);
        loadMasterData();
      } else {
        const errMsg = await extractError(res);
        alert(errMsg);
      }
    } catch (err) { alert(err.message); }
    setLinking(false);
  };

  const handleUnlink = async () => {
    if (!window.confirm("¿Seguro que quieres desvincular la Tabla Maestra? (No se borrarán los datos del Google Sheet)")) return;
    await fetch(`${API}/api/master/unlink`, { method: 'POST' });
    loadMasterData();
  };

  // --- PASO 3: Stage → Confirm → Run Bulk ---
  const handlePreviewAll = async () => {
    setPreviewLoading(true);
    setPreviewData(null);
    setRunAllResult(null);
    setLowMatchAcknowledged(false);
    try {
      const activeProcesses = processes.filter(p => p.is_active);
      const previews = await Promise.all(
        activeProcesses.map(async (proc) => {
          try {
            const res = await fetch(`${API}/api/processes/${proc.id}/stage`, { method: 'POST' });
            const data = await res.json();
            if (res.ok) return { name: proc.name, ...data.diff, batch_id: data.batch_id, ok: true };
            return { name: proc.name, ok: false, error: data.detail || 'Error' };
          } catch (err) {
            return { name: proc.name, ok: false, error: err.message };
          }
        })
      );

      const totalUpdated = previews.filter(p => p.ok).reduce((s, p) => s + (p.rows_to_update || 0), 0);
      const totalAdded = previews.filter(p => p.ok).reduce((s, p) => s + (p.rows_to_add || 0), 0);
      const totalOrigin = previews.filter(p => p.ok).reduce((s, p) => s + (p.total_origen || 0), 0);
      const processesOk = previews.filter(p => p.ok).length;
      const errors = previews.filter(p => !p.ok);
      const batchIds = previews.filter(p => p.ok).map(p => p.batch_id);
      
      const matchPercentage = totalOrigin > 0 ? (totalUpdated / totalOrigin) : 1;

      setPreviewData({
        previews,
        totalUpdated,
        totalAdded,
        totalOrigin,
        matchPercentage,
        batchIds,
        processesOk,
        exportsCount: exports.length,
        errors
      });
    } catch (err) {
      setPreviewData({ error: err.message });
    }
    setPreviewLoading(false);
  };

  const handleConfirmRunAll = async () => {
    if (!previewData?.batchIds || previewData.batchIds.length === 0) return;
    
    setPreviewData(null);
    setRunAllLoading(true);
    setRunAllResult(null);
    try {
      const res = await fetch(`${API}/api/staging/execute-bulk`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_ids: previewData.batchIds })
      });
      const data = await res.json();
      setRunAllResult(data);
      if (res.ok) { loadMasterData(); loadProcesses(); }
    } catch (err) {
      setRunAllResult({ message: 'Fallo de conexión: ' + err.message, errors: [{ process: 'Red', error: err.message }] });
    }
    setRunAllLoading(false);
  };

  // Reflejo: propaga ediciones manuales de la maestra a las hojas hijas
  const handleSyncReflection = async () => {
    setReflectLoading(true);
    setReflectResult(null);
    try {
      const res = await fetch(`${API}/api/master/sync-reflection`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setReflectResult({ ok: true, ...data });
      } else {
        setReflectResult({ ok: false, message: data.detail || 'Error al sincronizar' });
      }
    } catch (err) {
      setReflectResult({ ok: false, message: 'Fallo de conexión: ' + err.message });
    }
    setReflectLoading(false);
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando Tabla Maestra...</div>;

  return (
    <div className="p-8 max-w-full mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Table2 className="w-6 h-6 text-purple-600" />
            Tabla Maestra
          </h1>
          {activeMasterConnId ? (
            <p className="text-gray-500 text-sm mt-1">
              Enlazada a Google Sheet • Hoja "{activeMasterSheet}" • {totalRows} filas
              {activeMasterSkuColumn && <span className="ml-2 text-indigo-500 font-medium">🔑 {activeMasterSkuColumn}</span>}
            </p>
          ) : (
            <p className="text-gray-500 text-sm mt-1">Ninguna tabla maestra enlazada</p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {activeMasterConnId && (
            <button onClick={handlePreviewAll} disabled={previewLoading || runAllLoading || processes.length === 0}
              className="flex items-center gap-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white px-5 py-2.5 rounded-xl font-semibold hover:from-green-700 hover:to-emerald-700 transition shadow-sm text-sm disabled:opacity-50">
              <Zap className={`w-4 h-4 ${previewLoading ? 'animate-pulse' : ''}`} />
              {previewLoading ? 'Calculando...' : runAllLoading ? 'Ejecutando...' : '⚡ Correr Procesos'}
            </button>
          )}

          {activeMasterConnId && (
            <button onClick={handleSyncReflection} disabled={reflectLoading}
              title="Detecta ediciones manuales en la maestra y las refleja en las hojas hijas suscritas"
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl font-medium hover:bg-indigo-700 transition text-sm disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${reflectLoading ? 'animate-spin' : ''}`} />
              {reflectLoading ? 'Sincronizando...' : 'Sincronizar reflejo'}
            </button>
          )}

          {!activeMasterConnId ? (
            <button onClick={() => setShowLink(!showLink)}
              className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2.5 rounded-xl font-medium hover:bg-purple-700 transition text-sm">
              <Link2 className="w-4 h-4" /> Enlazar Tabla Maestra
            </button>
          ) : (
            <button onClick={handleUnlink}
              className="flex items-center gap-2 bg-red-500 text-white px-4 py-2.5 rounded-xl font-medium hover:bg-red-600 transition text-sm">
              <Link2 className="w-4 h-4" /> Desvincular Tabla
            </button>
          )}
        </div>
      </div>

      {/* Resultado del reflejo (maestra → hijas) */}
      {reflectResult && (
        <div className={`mb-6 rounded-xl border p-4 flex items-start gap-3 text-sm ${
          reflectResult.ok ? 'border-indigo-200 bg-indigo-50 text-indigo-800' : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          {reflectResult.ok ? <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" /> : <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />}
          <div className="flex-1">
            <p className="font-medium">{reflectResult.message}</p>
            {reflectResult.ok && reflectResult.status === 'synced' && (
              <p className="text-xs mt-1 opacity-80">
                {reflectResult.changes} campo(s) modificado(s) · {reflectResult.new_rows} fila(s) nueva(s) · {reflectResult.active_subscriptions} suscripción(es) activa(s)
              </p>
            )}
          </div>
          <button onClick={() => setReflectResult(null)} className="text-xs opacity-60 hover:opacity-100 font-medium">Cerrar</button>
        </div>
      )}

      {/* Preview Confirmation (PASO 3) */}
      {previewData && !previewData.error && (
        <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50 p-5 shadow-sm">
          <h3 className="font-semibold text-indigo-800 mb-3">Vista previa de ejecución</h3>
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div className="bg-white p-3 rounded-lg text-center border">
              <p className="text-xs text-gray-500">Filas nuevas</p>
              <p className="text-xl font-bold text-emerald-700">{previewData.totalAdded}</p>
            </div>
            <div className="bg-white p-3 rounded-lg text-center border">
              <p className="text-xs text-gray-500">Actualizaciones</p>
              <p className="text-xl font-bold text-blue-700">{previewData.totalUpdated}</p>
            </div>
            <div className="bg-white p-3 rounded-lg text-center border">
              <p className="text-xs text-gray-500">Procesos</p>
              <p className="text-xl font-bold text-indigo-700">{previewData.processesOk}</p>
            </div>
            <div className="bg-white p-3 rounded-lg text-center border">
              <p className="text-xs text-gray-500">Salidas</p>
              <p className="text-xl font-bold text-green-700">{previewData.exportsCount}</p>
            </div>
          </div>
          {previewData.errors.length > 0 && (
            <div className="mb-3 space-y-1">
              {previewData.errors.map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-red-700 bg-red-50 rounded p-2">
                  <XCircle className="w-4 h-4 flex-shrink-0" /> <span className="font-medium">{e.name}:</span> {e.error}
                </div>
              ))}
            </div>
          )}
          {/* Warning de baja coincidencia */}
          {previewData.matchPercentage < 0.1 && previewData.totalAdded > 0 && (
            <div className="mb-4 p-4 bg-orange-50 border border-orange-200 rounded-lg">
              <div className="flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-bold text-orange-800">Advertencia: Baja Coincidencia de SKUs</h4>
                  <p className="text-sm text-orange-700 mt-1">
                    Menos del 10% de los productos del origen existen en la Tabla Maestra. 
                    Se van a agregar <strong className="font-bold">{previewData.totalAdded} filas completamente nuevas</strong>, 
                    lo cual podría indicar un formato incorrecto en la columna SKU.
                  </p>
                  <label className="flex items-center gap-2 mt-3 cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="rounded border-orange-300 text-orange-600 focus:ring-orange-500 w-4 h-4"
                      checked={lowMatchAcknowledged}
                      onChange={(e) => setLowMatchAcknowledged(e.target.checked)}
                    />
                    <span className="text-sm font-medium text-orange-900">
                      Entiendo que se agregarán como productos nuevos y el formato del SKU es correcto
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => setPreviewData(null)}
              className="text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100 text-sm font-medium">
              Cancelar
            </button>
            <button 
              onClick={handleConfirmRunAll} 
              disabled={runAllLoading || (previewData.matchPercentage < 0.1 && previewData.totalAdded > 0 && !lowMatchAcknowledged)}
              className="bg-green-600 text-white px-5 py-2 rounded-lg font-semibold hover:bg-green-700 text-sm disabled:opacity-50 flex items-center gap-2">
              <Zap className="w-4 h-4" />
              {runAllLoading ? 'Ejecutando...' : 'Confirmar y Ejecutar'}
            </button>
          </div>
        </div>
      )}

      {/* Run All Result */}
      {runAllResult && (
        <div className={`mb-6 rounded-xl border p-5 shadow-sm ${runAllResult.errors?.length > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'}`}>
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
                  <XCircle className="w-4 h-4 flex-shrink-0" /> <span className="font-medium flex-shrink-0">{e.process}:</span> <span className="break-words whitespace-normal min-w-0">{e.error}</span>
                </div>
              ))}
            </div>
          )}
          <button onClick={() => setRunAllResult(null)} className="text-xs text-gray-400 mt-2 hover:text-gray-600 font-medium">Cerrar resumen</button>
        </div>
      )}

      {/* Link Panel */}
      {showLink && !activeMasterConnId && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-5 mb-6">
          <h3 className="font-semibold text-purple-800 mb-3">Enlazar Tabla Maestra</h3>
          <p className="text-sm text-purple-600 mb-4">Esta tabla será la base de datos central. Aquí se guardará todo.</p>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Conexión a Google Sheets</label>
              <select value={masterConnId} onChange={e => loadMasterSheets(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm">
                <option value="">Seleccionar conexión...</option>
                {connections.filter(c => c.connection_type === 'google_sheets').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hoja (Pestaña)</label>
              <select value={masterSheet} onChange={e => handleSelectMasterSheet(e.target.value)}
                disabled={!masterConnId} className="w-full border border-gray-300 rounded-lg p-2 text-sm">
                <option value="">Seleccionar hoja...</option>
                {Object.keys(masterSheets).map(sh => <option key={sh} value={sh}>{sh}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">🔑 Columna llave (SKU)</label>
              <select value={masterSkuColumn} onChange={e => setMasterSkuColumn(e.target.value)}
                disabled={!masterSheet} className="w-full border border-gray-300 rounded-lg p-2 text-sm">
                <option value="">Seleccionar columna llave...</option>
                {masterSheetColumns.map(col => <option key={col} value={col}>{col}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleLink} disabled={linking || !masterConnId || !masterSheet || !masterSkuColumn}
              className="bg-purple-600 text-white px-5 py-2 rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 text-sm">
              {linking ? 'Enlazando...' : 'Enlazar'}
            </button>
            <button onClick={() => setShowLink(false)} className="text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 text-sm">Cancelar</button>
          </div>
        </div>
      )}

      {/* Tabs */}
      {activeMasterConnId && (
        <div className="flex gap-1 mb-4 border-b border-gray-200">
          {[
            { key: 'datos', label: 'Datos', icon: Table2 },
            { key: 'entradas', label: 'Entradas', icon: Settings2, count: processes.length },
          ].map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${
                activeTab === tab.key
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}>
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {tab.count !== undefined && (
                <span className="bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded-full">{tab.count}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'datos' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {totalRows === 0 ? (
            <div className="p-12 text-center">
              <Table2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <h3 className="text-lg font-medium text-gray-700">La tabla está vacía</h3>
              <p className="text-gray-500 mt-1 text-sm">
                {!activeMasterConnId ? 'Enlaza una tabla maestra para comenzar.' : 'El Google Sheet no tiene datos.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 bg-gray-100 w-12 text-center border-r font-medium text-gray-400">#</th>
                    {columns.map((c, i) => (
                      <th key={i} className="px-4 py-3 whitespace-nowrap">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((row, i) => (
                    <tr key={i} className="border-b hover:bg-purple-50/30">
                      <td className="px-4 py-2 bg-gray-50 border-r text-center text-gray-400 text-xs">{i + 1}</td>
                      {columns.map((_, colIndex) => (
                        <td key={colIndex} className="px-4 py-2 truncate max-w-xs" title={row[colIndex] || ''}>
                          {row[colIndex] || <span className="text-gray-300">-</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalRows > 100 && (
            <div className="bg-gray-50 p-3 text-center border-t text-sm text-gray-500">
              Mostrando las primeras 100 filas de {totalRows}.
            </div>
          )}
        </div>
      )}

      {/* Entradas Tab */}
      {activeTab === 'entradas' && (
        <div className="space-y-3">
          {processes.length === 0 ? (
            <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
              <Settings2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="font-medium">No hay procesos configurados</p>
              <p className="text-sm mt-1">Usá "+ Nueva Fuente" en el menú lateral para crear uno.</p>
            </div>
          ) : (
            processes.map(proc => (
              <div key={proc.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                    <Settings2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-800">{proc.name}</h3>
                    <p className="text-xs text-gray-500">
                      <span className="font-medium text-gray-600">Origen:</span> {connName(proc.source_connection_id)} / "{proc.source_sheet_name}"
                      <span className="mx-2">→</span>
                      <span className="font-medium text-indigo-600">Destino:</span> {proc.target_connection_id ? `${connName(proc.target_connection_id)} / "${proc.target_sheet_name}"` : `Tabla Maestra / "${activeMasterSheet}"`}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      🔑 {proc.sku_column_source} → {proc.sku_column_master} • {Object.keys(proc.field_mappings || {}).length} campo(s)
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className={`text-xs px-2 py-1 rounded-full ${proc.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {proc.is_active ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

    </div>
  );
}
