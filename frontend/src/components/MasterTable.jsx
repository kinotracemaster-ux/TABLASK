import { useState, useEffect } from 'react';
import { Table2, Link2, ExternalLink, Zap, CheckCircle2, XCircle } from 'lucide-react';

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
  const [linking, setLinking] = useState(false);

  // Active master info
  const [activeMasterConnId, setActiveMasterConnId] = useState(null);
  const [activeMasterSheet, setActiveMasterSheet] = useState(null);

  // Run all state
  const [runAllLoading, setRunAllLoading] = useState(false);
  const [runAllResult, setRunAllResult] = useState(null);

  useEffect(() => {
    loadConnections();
    loadMasterData();
  }, []);

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
      const res = await fetch(`${API}/api/master`);
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
      const res = await fetch(`${API}/api/master/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          master_connection_id: parseInt(masterConnId),
          master_sheet_name: masterSheet
        })
      });
      if (res.ok) {
        setShowLink(false);
        loadMasterData();
      } else {
        const err = await res.json();
        alert('Error: ' + err.detail);
      }
    } catch (err) { alert('Error: ' + err.message); }
    setLinking(false);
  };

  const handleUnlink = async () => {
    if (!window.confirm("¿Seguro que quieres desvincular la Tabla Maestra? (No se borrarán los datos del Google Sheet)")) return;
    await fetch(`${API}/api/master/unlink`, { method: 'POST' });
    loadMasterData();
  };

  const handleRunAll = async () => {
    setRunAllLoading(true);
    setRunAllResult(null);
    try {
      const res = await fetch(`${API}/api/run-all`, { method: 'POST' });
      const data = await res.json();
      setRunAllResult(data);
      if (res.ok) loadMasterData();
    } catch (err) {
      setRunAllResult({ message: 'Error de conexión: ' + err.message, errors: [{ process: 'Red', error: err.message }] });
    }
    setRunAllLoading(false);
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando Tabla Maestra...</div>;

  return (
    <div className="p-8 max-w-full mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Table2 className="w-6 h-6 text-purple-600" />
            Tabla Maestra (Base de Datos)
          </h1>
          {activeMasterConnId ? (
            <p className="text-gray-500 text-sm mt-1">
              Enlazada a Google Sheet • Hoja "{activeMasterSheet}" • {totalRows} filas
            </p>
          ) : (
            <p className="text-gray-500 text-sm mt-1">Ninguna tabla maestra enlazada</p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {activeMasterConnId && (
            <button onClick={handleRunAll} disabled={runAllLoading}
              className="flex items-center gap-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white px-5 py-2.5 rounded-xl font-semibold hover:from-green-700 hover:to-emerald-700 transition shadow-sm text-sm">
              <Zap className={`w-4 h-4 ${runAllLoading ? 'animate-pulse' : ''}`} />
              {runAllLoading ? 'Ejecutando todo...' : '⚡ Correr Procesos'}
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
                  <XCircle className="w-4 h-4 flex-shrink-0" /> <span className="font-medium flex-shrink-0">{e.process}:</span> <span className="truncate">{e.error}</span>
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
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Conexión a Google Sheets</label>
              <select value={masterConnId} onChange={e => loadMasterSheets(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm">
                <option value="">Seleccionar conexión...</option>
                {connections.filter(c => c.connection_type === 'google_sheets').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Hoja (Pestaña)</label>
              <select value={masterSheet} onChange={e => setMasterSheet(e.target.value)}
                disabled={!masterConnId} className="w-full border border-gray-300 rounded-lg p-2 text-sm">
                <option value="">Seleccionar hoja...</option>
                {Object.keys(masterSheets).map(sh => <option key={sh} value={sh}>{sh}</option>)}
              </select>
            </div>
            <button onClick={handleLink} disabled={linking || !masterConnId || !masterSheet}
              className="bg-purple-600 text-white px-5 py-2 rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 text-sm">
              {linking ? 'Enlazando...' : 'Enlazar'}
            </button>
            <button onClick={() => setShowLink(false)} className="text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 text-sm">Cancelar</button>
          </div>
        </div>
      )}

      {/* Table Viewer */}
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
            Mostrando las primeras 100 filas de {totalRows}. <a href="#" className="text-purple-600 hover:underline">Ver todo en Google Sheets</a>
          </div>
        )}
      </div>
    </div>
  );
}
