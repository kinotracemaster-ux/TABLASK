import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Table2, Upload, RefreshCw, Plus, Trash2, Pencil, Check, X, Columns3, ArrowDownToLine } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';

export default function MasterTable() {
  const { projectId } = useParams();
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [connections, setConnections] = useState([]);
  const [importConnId, setImportConnId] = useState('');
  const [importSheets, setImportSheets] = useState({});
  const [importSheet, setImportSheet] = useState('');
  const [importSkuCol, setImportSkuCol] = useState('');
  const [importing, setImporting] = useState(false);

  // Sync state
  const [showSync, setShowSync] = useState(false);
  const [syncConnId, setSyncConnId] = useState('');
  const [syncSheets, setSyncSheets] = useState({});
  const [syncSheet, setSyncSheet] = useState('');
  const [syncSkuCol, setSyncSkuCol] = useState('');
  const [syncMappings, setSyncMappings] = useState([{ src: '', dst: '' }]);
  const [syncing, setSyncing] = useState(false);

  // Edit state
  const [editingCell, setEditingCell] = useState(null); // { rowId, col }
  const [editValue, setEditValue] = useState('');

  // Add column
  const [showAddCol, setShowAddCol] = useState(false);
  const [newColName, setNewColName] = useState('');

  // Add row
  const [showAddRow, setShowAddRow] = useState(false);
  const [newRowSku, setNewRowSku] = useState('');

  useEffect(() => {
    loadMaster();
    fetch(`${API}/api/connections/`).then(r => r.json()).then(setConnections).catch(console.error);
  }, [projectId]);

  const loadMaster = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/master/${projectId}`);
      const data = await res.json();
      setColumns(data.columns || []);
      setRows(data.rows || []);
      setTotalRows(data.total_rows || 0);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  // --- Import ---
  const loadImportSheets = async (connId) => {
    setImportConnId(connId);
    if (!connId) return;
    const res = await fetch(`${API}/api/connections/${connId}/metadata`);
    const data = await res.json();
    setImportSheets(data.sheets || {});
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const res = await fetch(`${API}/api/master/${projectId}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_id: parseInt(importConnId), sheet_name: importSheet, sku_column: importSkuCol })
      });
      const data = await res.json();
      if (res.ok) {
        alert(`✅ ${data.message}`);
        setShowImport(false);
        loadMaster();
      } else {
        alert('Error: ' + data.detail);
      }
    } catch (err) { console.error(err); }
    setImporting(false);
  };

  // --- Sync ---
  const loadSyncSheets = async (connId) => {
    setSyncConnId(connId);
    if (!connId) return;
    const res = await fetch(`${API}/api/connections/${connId}/metadata`);
    const data = await res.json();
    setSyncSheets(data.sheets || {});
  };

  const handleSync = async () => {
    setSyncing(true);
    const fieldMappings = {};
    syncMappings.forEach(m => { if (m.src && m.dst) fieldMappings[m.src] = m.dst; });
    try {
      const res = await fetch(`${API}/api/master/${projectId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connection_id: parseInt(syncConnId),
          sheet_name: syncSheet,
          sku_column: syncSkuCol,
          field_mappings: fieldMappings,
          add_new_rows: true
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert(`✅ ${data.message}`);
        setShowSync(false);
        loadMaster();
      } else {
        alert('Error: ' + data.detail);
      }
    } catch (err) { console.error(err); }
    setSyncing(false);
  };

  // --- Cell Edit ---
  const startEdit = (rowId, col, currentValue) => {
    setEditingCell({ rowId, col });
    setEditValue(currentValue || '');
  };

  const saveEdit = async () => {
    if (!editingCell) return;
    const { rowId, col } = editingCell;

    const payload = col === 'SKU'
      ? { sku: editValue }
      : { data: { [col]: editValue } };

    try {
      await fetch(`${API}/api/master/${projectId}/rows/${rowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      loadMaster();
    } catch (err) { console.error(err); }
    setEditingCell(null);
  };

  const cancelEdit = () => setEditingCell(null);

  // --- Add Column ---
  const handleAddColumn = async () => {
    if (!newColName.trim()) return;
    await fetch(`${API}/api/master/${projectId}/columns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newColName.trim() })
    });
    setNewColName('');
    setShowAddCol(false);
    loadMaster();
  };

  // --- Delete Column ---
  const handleDeleteColumn = async (colId, colName) => {
    if (!confirm(`¿Eliminar columna "${colName}"? Esto borrará los datos de esa columna en todas las filas.`)) return;
    await fetch(`${API}/api/master/${projectId}/columns/${colId}`, { method: 'DELETE' });
    loadMaster();
  };

  // --- Add Row ---
  const handleAddRow = async () => {
    if (!newRowSku.trim()) return;
    const data = {};
    columns.forEach(c => data[c.name] = '');
    await fetch(`${API}/api/master/${projectId}/rows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku: newRowSku.trim(), data })
    });
    setNewRowSku('');
    setShowAddRow(false);
    loadMaster();
  };

  // --- Delete Row ---
  const handleDeleteRow = async (rowId, sku) => {
    if (!confirm(`¿Eliminar fila con SKU "${sku}"?`)) return;
    await fetch(`${API}/api/master/${projectId}/rows/${rowId}`, { method: 'DELETE' });
    loadMaster();
  };

  const allCols = ['SKU', ...columns.map(c => c.name)];
  const syncSourceCols = syncSheet && syncSheets[syncSheet] ? syncSheets[syncSheet] : [];
  const masterColNames = columns.map(c => c.name);

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
            Tabla Maestra
          </h1>
          <p className="text-gray-500 text-sm mt-1">{totalRows} filas · {columns.length} columnas + SKU</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowImport(!showImport)}
            className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-purple-700 transition text-sm">
            <Upload className="w-4 h-4" /> Importar Base
          </button>
          <button onClick={() => setShowSync(!showSync)}
            className="flex items-center gap-2 bg-orange-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-orange-700 transition text-sm">
            <ArrowDownToLine className="w-4 h-4" /> Sincronizar desde Origen
          </button>
          <button onClick={() => setShowAddCol(!showAddCol)}
            className="flex items-center gap-2 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-50 transition text-sm">
            <Columns3 className="w-4 h-4" /> + Columna
          </button>
          <button onClick={() => setShowAddRow(!showAddRow)}
            className="flex items-center gap-2 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-50 transition text-sm">
            <Plus className="w-4 h-4" /> + Fila
          </button>
          <button onClick={loadMaster}
            className="flex items-center gap-2 border border-gray-300 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-50 transition text-sm">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Import Panel */}
      {showImport && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-5 mb-6">
          <h3 className="font-semibold text-purple-800 mb-3">Importar Base Inicial</h3>
          <p className="text-sm text-purple-600 mb-4">Esto reemplazará toda la Maestra actual con los datos de la conexión seleccionada.</p>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Conexión</label>
              <select value={importConnId} onChange={e => loadImportSheets(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm">
                <option value="">Seleccionar...</option>
                {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hoja</label>
              <select value={importSheet} onChange={e => setImportSheet(e.target.value)}
                disabled={!importConnId} className="w-full border border-gray-300 rounded-lg p-2 text-sm">
                <option value="">Seleccionar...</option>
                {Object.keys(importSheets).map(sh => <option key={sh} value={sh}>{sh}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Columna SKU (Llave)</label>
              <select value={importSkuCol} onChange={e => setImportSkuCol(e.target.value)}
                disabled={!importSheet} className="w-full border border-gray-300 rounded-lg p-2 text-sm">
                <option value="">Seleccionar...</option>
                {(importSheets[importSheet] || []).map(col => <option key={col} value={col}>{col}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleImport} disabled={importing || !importSkuCol}
              className="bg-purple-600 text-white px-5 py-2 rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 text-sm">
              {importing ? 'Importando...' : 'Importar'}
            </button>
            <button onClick={() => setShowImport(false)} className="text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 text-sm">Cancelar</button>
          </div>
        </div>
      )}

      {/* Sync Panel */}
      {showSync && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-5 mb-6">
          <h3 className="font-semibold text-orange-800 mb-3">Sincronizar desde Tabla Origen</h3>
          <p className="text-sm text-orange-600 mb-4">Actualiza campos específicos de la Maestra usando el SKU como enlace.</p>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Conexión Origen</label>
              <select value={syncConnId} onChange={e => loadSyncSheets(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm">
                <option value="">Seleccionar...</option>
                {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hoja</label>
              <select value={syncSheet} onChange={e => setSyncSheet(e.target.value)}
                disabled={!syncConnId} className="w-full border border-gray-300 rounded-lg p-2 text-sm">
                <option value="">Seleccionar...</option>
                {Object.keys(syncSheets).map(sh => <option key={sh} value={sh}>{sh}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Columna SKU en Origen</label>
              <select value={syncSkuCol} onChange={e => setSyncSkuCol(e.target.value)}
                disabled={!syncSheet} className="w-full border border-gray-300 rounded-lg p-2 text-sm">
                <option value="">Seleccionar...</option>
                {syncSourceCols.map(col => <option key={col} value={col}>{col}</option>)}
              </select>
            </div>
          </div>
          {/* Field mappings */}
          <div className="mb-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium text-gray-700">Mapeo de campos <span className="text-gray-400">(Origen → Maestra)</span></label>
              <button onClick={() => setSyncMappings([...syncMappings, { src: '', dst: '' }])} className="text-orange-600 text-sm font-medium hover:underline">+ Añadir</button>
            </div>
            {syncMappings.map((m, i) => (
              <div key={i} className="flex gap-3 items-center mb-2">
                <select value={m.src} onChange={e => { const u = [...syncMappings]; u[i].src = e.target.value; setSyncMappings(u); }}
                  className="flex-1 border border-gray-300 rounded-lg p-2 text-sm">
                  <option value="">Campo origen...</option>
                  {syncSourceCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <span className="text-gray-400">→</span>
                <select value={m.dst} onChange={e => { const u = [...syncMappings]; u[i].dst = e.target.value; setSyncMappings(u); }}
                  className="flex-1 border border-gray-300 rounded-lg p-2 text-sm">
                  <option value="">Campo maestra...</option>
                  {masterColNames.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {syncMappings.length > 1 && (
                  <button onClick={() => setSyncMappings(syncMappings.filter((_, idx) => idx !== i))} className="text-red-400 hover:text-red-600">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={handleSync} disabled={syncing || !syncSkuCol}
              className="bg-orange-600 text-white px-5 py-2 rounded-lg font-medium hover:bg-orange-700 disabled:opacity-50 text-sm">
              {syncing ? 'Sincronizando...' : 'Sincronizar'}
            </button>
            <button onClick={() => setShowSync(false)} className="text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 text-sm">Cancelar</button>
          </div>
        </div>
      )}

      {/* Add Column */}
      {showAddCol && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de la nueva columna</label>
            <input value={newColName} onChange={e => setNewColName(e.target.value)} placeholder="Ej: Precio, Stock, Bodega"
              className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
          </div>
          <button onClick={handleAddColumn} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">Agregar</button>
          <button onClick={() => setShowAddCol(false)} className="text-gray-500 px-3 py-2 rounded-lg hover:bg-gray-100 text-sm">Cancelar</button>
        </div>
      )}

      {/* Add Row */}
      {showAddRow && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">SKU de la nueva fila</label>
            <input value={newRowSku} onChange={e => setNewRowSku(e.target.value)} placeholder="Ej: P001, ABC-123"
              className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
          </div>
          <button onClick={handleAddRow} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700">Agregar</button>
          <button onClick={() => setShowAddRow(false)} className="text-gray-500 px-3 py-2 rounded-lg hover:bg-gray-100 text-sm">Cancelar</button>
        </div>
      )}

      {/* Empty State */}
      {rows.length === 0 && !showImport ? (
        <div className="text-center py-20 text-gray-400">
          <Table2 className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <p className="text-xl font-medium mb-2">Tabla Maestra vacía</p>
          <p className="text-sm mb-6">Importa tu primera base de datos para empezar.</p>
          <button onClick={() => setShowImport(true)}
            className="bg-purple-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-purple-700 transition">
            <Upload className="w-5 h-5 inline mr-2" /> Importar Base Inicial
          </button>
        </div>
      ) : rows.length > 0 && (
        /* Data Table */
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="p-3 text-xs font-semibold text-purple-700 uppercase tracking-wide sticky left-0 bg-gray-50 z-10 border-r border-gray-200">SKU</th>
                  {columns.map(col => (
                    <th key={col.id} className="p-3 text-xs font-semibold text-gray-600 uppercase tracking-wide group">
                      <div className="flex items-center gap-1">
                        <span>{col.name}</span>
                        <button onClick={() => handleDeleteColumn(col.id, col.name)}
                          className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </th>
                  ))}
                  <th className="p-3 text-xs font-semibold text-gray-400 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row._id} className="hover:bg-blue-50/30 transition border-b border-gray-100">
                    {/* SKU cell */}
                    <td className="p-2 text-sm font-medium text-purple-700 sticky left-0 bg-white z-10 border-r border-gray-100">
                      {editingCell?.rowId === row._id && editingCell?.col === 'SKU' ? (
                        <div className="flex items-center gap-1">
                          <input value={editValue} onChange={e => setEditValue(e.target.value)} autoFocus
                            onKeyDown={e => e.key === 'Enter' ? saveEdit() : e.key === 'Escape' && cancelEdit()}
                            className="border border-blue-400 rounded px-2 py-1 text-sm w-full" />
                          <button onClick={saveEdit} className="text-green-600"><Check className="w-4 h-4" /></button>
                          <button onClick={cancelEdit} className="text-red-400"><X className="w-4 h-4" /></button>
                        </div>
                      ) : (
                        <span onDoubleClick={() => startEdit(row._id, 'SKU', row.SKU)} className="cursor-pointer">{row.SKU}</span>
                      )}
                    </td>
                    {/* Data cells */}
                    {columns.map(col => (
                      <td key={col.id} className="p-2 text-sm text-gray-700">
                        {editingCell?.rowId === row._id && editingCell?.col === col.name ? (
                          <div className="flex items-center gap-1">
                            <input value={editValue} onChange={e => setEditValue(e.target.value)} autoFocus
                              onKeyDown={e => e.key === 'Enter' ? saveEdit() : e.key === 'Escape' && cancelEdit()}
                              className="border border-blue-400 rounded px-2 py-1 text-sm w-full" />
                            <button onClick={saveEdit} className="text-green-600"><Check className="w-4 h-4" /></button>
                            <button onClick={cancelEdit} className="text-red-400"><X className="w-4 h-4" /></button>
                          </div>
                        ) : (
                          <span onDoubleClick={() => startEdit(row._id, col.name, row[col.name])}
                            className="cursor-pointer block min-h-[24px] px-1 rounded hover:bg-blue-50">
                            {row[col.name] || ''}
                          </span>
                        )}
                      </td>
                    ))}
                    {/* Delete row */}
                    <td className="p-2">
                      <button onClick={() => handleDeleteRow(row._id, row.SKU)}
                        className="text-red-300 hover:text-red-600 transition">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3 bg-gray-50 border-t border-gray-200 text-sm text-gray-500 text-center">
            {totalRows} filas en total · Haz doble clic en cualquier celda para editarla
          </div>
        </div>
      )}
    </div>
  );
}
