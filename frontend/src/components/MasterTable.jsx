import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Table2, Link2, Zap, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import { extractError } from '../utils/errors';
import PipelineBar from './PipelineBar';

const API = import.meta.env.VITE_API_URL || '';

export default function MasterTable() {
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
  const [masterSheetColumns, setMasterSheetColumns] = useState([]);
  const [masterSkuColumn, setMasterSkuColumn] = useState('');
  const [linking, setLinking] = useState(false);

  // Active master info
  const [activeMasterConnId, setActiveMasterConnId] = useState(null);
  const [activeMasterSheet, setActiveMasterSheet] = useState(null);
  const [activeMasterSkuColumn, setActiveMasterSkuColumn] = useState('');

  // Reflejo (sincronización manual maestra → hijas)
  const [reflectLoading, setReflectLoading] = useState(false);
  const [reflectResult, setReflectResult] = useState(null);

  // Processes list for the "Entradas" tab
  const [processes, setProcesses] = useState([]);

  useEffect(() => {
    loadConnections();
    loadMasterData();
    loadProcesses();
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
      {/* Header: una sola acción primaria; lo secundario, discreto */}
      <div className="mb-6 flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Tabla Maestra</h1>
          {activeMasterConnId ? (
            <p className="text-gray-500 text-sm mt-1">
              Hoja "{activeMasterSheet}" · {totalRows} filas
              {activeMasterSkuColumn && <span className="text-gray-400"> · llave: {activeMasterSkuColumn}</span>}
            </p>
          ) : (
            <p className="text-gray-500 text-sm mt-1">Ninguna tabla maestra enlazada</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {activeMasterConnId && (
            <button onClick={handleSyncReflection} disabled={reflectLoading}
              title="Detecta ediciones manuales en la Maestra y las refleja en las hojas hijas suscritas"
              className="flex items-center gap-2 border border-gray-300 text-gray-600 px-4 py-2.5 rounded-xl font-medium hover:bg-gray-50 transition text-sm disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${reflectLoading ? 'animate-spin' : ''}`} />
              {reflectLoading ? 'Sincronizando...' : 'Sincronizar reflejo'}
            </button>
          )}

          {activeMasterConnId && processes.length > 0 && (
            <Link to="/flujos"
              title="Corré cada flujo por separado desde Mis Flujos"
              className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-semibold hover:bg-indigo-700 transition text-sm">
              <Zap className="w-4 h-4" /> Correr flujos
            </Link>
          )}

          {!activeMasterConnId && (
            <button onClick={() => setShowLink(!showLink)}
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl font-medium hover:bg-indigo-700 transition text-sm">
              <Link2 className="w-4 h-4" /> Enlazar Tabla Maestra
            </button>
          )}
        </div>
      </div>

      {/* Pipeline visual: [Fuentes] → [MAESTRA] → [Destinos] con semáforos */}
      <PipelineBar />

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

      {/* Link Panel */}
      {showLink && !activeMasterConnId && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 mb-6">
          <h3 className="font-semibold text-indigo-800 mb-3">Enlazar Tabla Maestra</h3>
          <p className="text-sm text-indigo-600 mb-4">Esta tabla será la base de datos central. Aquí se guardará todo.</p>
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
              className="bg-indigo-600 text-white px-5 py-2 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 text-sm">
              {linking ? 'Enlazando...' : 'Enlazar'}
            </button>
            <button onClick={() => setShowLink(false)} className="text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 text-sm">Cancelar</button>
          </div>
        </div>
      )}

      {/* Datos de la Maestra (la gestión de Fuentes/Destinos vive en Mis Flujos) */}
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
                    <tr key={i} className="border-b hover:bg-gray-50">
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

      {/* Acción destructiva y rara: al final, discreta */}
      {activeMasterConnId && (
        <div className="mt-6 text-center">
          <button onClick={handleUnlink}
            className="text-xs text-gray-400 hover:text-red-600 hover:underline transition">
            Desvincular Tabla Maestra
          </button>
        </div>
      )}

    </div>
  );
}
