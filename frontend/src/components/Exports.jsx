import { useState, useEffect } from 'react';
import { Download, Plus, Trash2, ChevronRight, Settings2, Power, Eye, RefreshCw, FileDown } from 'lucide-react';
import { extractError } from '../utils/errors';

const API = import.meta.env.VITE_API_URL || '';

export default function Exports() {
  const [subscriptions, setSubscriptions] = useState([]);
  const [csvExports, setCsvExports] = useState([]);
  const [connections, setConnections] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  // Master Table Info
  const [masterCols, setMasterCols] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [masterConnId, setMasterConnId] = useState(null);
  const [masterSheetName, setMasterSheetName] = useState(null);

  // Tipo de destino del formulario: 'sheet' (suscripción a Google Sheets) o 'csv' (descarga manual)
  const [destType, setDestType] = useState('sheet');

  // Form state
  const [name, setName] = useState('');
  const [targetConnId, setTargetConnId] = useState('');
  const [targetSheets, setTargetSheets] = useState({});
  const [targetSheet, setTargetSheet] = useState('');
  const [skuColTarget, setSkuColTarget] = useState('');
  const [colMappings, setColMappings] = useState([{ src: '', dst: '' }]);

  // Modo múltiple: aplicar el mismo mapeo a varias pestañas a la vez
  const [multiMode, setMultiMode] = useState(false);
  const [selectedSheets, setSelectedSheets] = useState([]);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const projsRes = await fetch(`${API}/api/projects/`);
      const projs = await projsRes.json();
      let pid = null;
      if (projs.length > 0) {
        pid = projs[0].id;
        setProjectId(pid);
        setMasterConnId(projs[0].master_connection_id);
        setMasterSheetName(projs[0].master_sheet_name);
      }

      if (pid) {
        const [subsRes, connsRes, colsRes, expRes] = await Promise.all([
          fetch(`${API}/api/subscriptions/?project_id=${pid}`),
          fetch(`${API}/api/connections/`),
          fetch(`${API}/api/master-columns`),
          fetch(`${API}/api/exports/?project_id=${pid}`)
        ]);
        setSubscriptions(await subsRes.json());
        setConnections(await connsRes.json());
        setMasterCols(await colsRes.json());
        setCsvExports(await expRes.json());
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const loadTargetSheets = async (connId) => {
    setTargetConnId(connId);
    if (!connId) return;
    try {
      const res = await fetch(`${API}/api/connections/${connId}/metadata`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Fallo');
      setTargetSheets(data.sheets || {});
    } catch (err) {
      alert(err.message);
      setTargetSheets({});
    }
  };

  // En modo múltiple la pestaña de referencia (para columnas/llave) es la primera seleccionada
  const refSheet = multiMode ? (selectedSheets[0] || '') : targetSheet;
  const targetCols = refSheet && targetSheets[refSheet] ? targetSheets[refSheet] : [];

  const toggleSheet = (sheet) => {
    setSelectedSheets(prev =>
      prev.includes(sheet) ? prev.filter(s => s !== sheet) : [...prev, sheet]
    );
  };

  const handleAutoMap = async () => {
    if (masterCols.length === 0 || targetCols.length === 0) return;
    try {
      const res = await fetch(`${API}/api/intelligence/auto-map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_headers: masterCols, target_headers: targetCols })
      });
      const data = await res.json();
      if (res.ok && data.mapping) {
        const newMappings = [];
        for (const [src, dst] of Object.entries(data.mapping)) {
          if (dst !== skuColTarget) {
            newMappings.push({ src, dst });
          }
        }
        if (newMappings.length > 0) {
          setColMappings(newMappings);
        } else {
          alert("No se encontraron mapeos automáticos obvios.");
        }
      }
    } catch (err) { console.error("Auto-map failed", err); }
  };

  const autoDetectSku = async () => {
    if (!targetConnId || !targetSheet) return;
    try {
      const res = await fetch(`${API}/api/intelligence/suggest-sku?connection_id=${targetConnId}&sheet_name=${targetSheet}`);
      const data = await res.json();
      if (res.ok && data.suggested_sku) {
        setSkuColTarget(data.suggested_sku);
      }
    } catch (err) { console.error("Auto-detect failed", err); }
  };

  useEffect(() => {
    if (targetConnId && targetSheet) {
      autoDetectSku();
    }
  }, [targetConnId, targetSheet]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!projectId) return alert("Falta configurar proyecto/maestra");

    const mappings = {};
    colMappings.forEach(({ src, dst }) => {
      if (src && dst) mappings[src] = dst;
    });

    if (Object.keys(mappings).length === 0) {
      alert("Debes agregar al menos una columna mapeada.");
      return;
    }

    if (destType === 'csv') {
      if (!masterConnId || !masterSheetName) {
        alert("No hay una Tabla Maestra enlazada todavía.");
        return;
      }
      const res = await fetch(`${API}/api/exports/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || "Nueva Exportación CSV",
          project_id: projectId,
          source_connection_id: masterConnId,
          source_sheet_name: masterSheetName,
          columns_mapping: mappings,
          output_type: 'csv_download'
        })
      });
      if (res.ok) {
        setShowForm(false);
        resetForm();
        loadAll();
      } else {
        alert(await extractError(res));
      }
      return;
    }

    let res;
    if (multiMode) {
      if (selectedSheets.length === 0) {
        alert("Selecciona al menos una pestaña destino.");
        return;
      }
      res = await fetch(`${API}/api/subscriptions/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          target_connection_id: parseInt(targetConnId),
          target_sheets: selectedSheets,
          sku_column_target: skuColTarget,
          field_mappings: mappings,
          is_active: true,
          name_prefix: name || "Suscripción"
        })
      });
    } else {
      res = await fetch(`${API}/api/subscriptions/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          target_connection_id: parseInt(targetConnId),
          target_sheet_name: targetSheet,
          sku_column_target: skuColTarget,
          field_mappings: mappings,
          is_active: true,
          name: name || "Nueva Suscripción"
        })
      });
    }

    if (res.ok) {
      setShowForm(false);
      resetForm();
      loadAll();
    } else {
      const err = await extractError(res);
      alert(err);
    }
  };

  const resetForm = () => {
    setName('');
    setDestType('sheet');
    setTargetConnId(''); setTargetSheet(''); setSkuColTarget('');
    setColMappings([{ src: '', dst: '' }]);
    setTargetSheets({});
    setMultiMode(false); setSelectedSheets([]);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("¿Eliminar esta suscripción?")) return;
    await fetch(`${API}/api/subscriptions/${id}`, { method: 'DELETE' });
    loadAll();
  };

  const handleDeleteCsv = async (id) => {
    if (!window.confirm("¿Eliminar esta exportación CSV?")) return;
    await fetch(`${API}/api/exports/${id}`, { method: 'DELETE' });
    loadAll();
  };

  const toggleActive = async (sub) => {
    const res = await fetch(`${API}/api/subscriptions/${sub.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sub, is_active: !sub.is_active })
    });
    if (res.ok) loadAll();
  };

  const connName = (id) => connections.find(c => c.id === id)?.name || `Conexión ${id}`;

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando...</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Download className="w-6 h-6 text-green-600" />
            Distribución (Suscripciones)
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Hojas hijas suscritas a cambios en la Tabla Maestra. Se actualizan solas.
          </p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-green-600 text-white px-4 py-2.5 rounded-xl font-medium hover:bg-green-700 transition text-sm">
          <Plus className="w-4 h-4" /> Nueva Distribución
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-1 text-green-800">Nuevo Destino</h2>
          <p className="text-sm text-gray-500 mb-4">Elige a dónde enviar los datos y qué columnas de la maestra recibirá.</p>

          <div className="flex gap-2 mb-5">
            <button type="button" onClick={() => setDestType('sheet')}
              className={`flex-1 flex items-center justify-center gap-2 p-2.5 rounded-lg text-sm font-medium border transition ${destType === 'sheet' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              <Download className="w-4 h-4" /> Google Sheets (suscripción, automático)
            </button>
            <button type="button" onClick={() => setDestType('csv')}
              className={`flex-1 flex items-center justify-center gap-2 p-2.5 rounded-lg text-sm font-medium border transition ${destType === 'csv' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              <FileDown className="w-4 h-4" /> Descarga CSV (subida manual)
            </button>
          </div>

          <form onSubmit={handleCreate} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre (referencia)</label>
              <input value={name} onChange={e => setName(e.target.value)} required
                placeholder={destType === 'csv' ? 'Ej: KYTE, Effi' : 'Ej: Tienda Shopify, Sistema Facturación'}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm max-w-md" />
            </div>

            <div className="bg-green-50 border border-green-200 p-4 rounded-xl">
              {destType === 'sheet' && (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-green-800">📍 HOJA DESTINO</h3>
                    <label className="flex items-center gap-2 text-xs text-green-700 cursor-pointer select-none">
                      <input type="checkbox" checked={multiMode}
                        onChange={e => { setMultiMode(e.target.checked); setSelectedSheets([]); }} />
                      Aplicar a varias pestañas a la vez
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Conexión Google Sheets</label>
                      <select value={targetConnId} onChange={e => loadTargetSheets(e.target.value)} required
                        className="w-full border border-green-200 rounded-lg p-2 text-sm bg-white">
                        <option value="">Seleccionar conexión...</option>
                        {connections.filter(c => c.connection_type === 'google_sheets').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    {!multiMode && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Pestaña Destino</label>
                        <select value={targetSheet} onChange={e => setTargetSheet(e.target.value)} required
                          disabled={!targetConnId} className="w-full border border-green-200 rounded-lg p-2 text-sm bg-white">
                          <option value="">Seleccionar pestaña...</option>
                          {Object.keys(targetSheets).map(sh => <option key={sh} value={sh}>{sh}</option>)}
                        </select>
                      </div>
                    )}
                  </div>

                  {multiMode && (
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Pestañas Destino ({selectedSheets.length} seleccionada{selectedSheets.length === 1 ? '' : 's'})
                      </label>
                      {Object.keys(targetSheets).length === 0 ? (
                        <p className="text-xs text-gray-400">Selecciona primero una conexión.</p>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-44 overflow-auto border border-green-200 rounded-lg p-3 bg-white">
                          {Object.keys(targetSheets).map(sh => (
                            <label key={sh} className="flex items-center gap-2 text-sm cursor-pointer">
                              <input type="checkbox" checked={selectedSheets.includes(sh)} onChange={() => toggleSheet(sh)} />
                              <span className="truncate">{sh}</span>
                            </label>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-green-600 mt-1">
                        Todas comparten el mismo mapeo y llave (la columna de referencia se toma de la 1ª seleccionada: <span className="font-semibold">{refSheet || '—'}</span>).
                      </p>
                    </div>
                  )}

                  <div className="mb-3">
                    <label className="block text-sm font-medium text-green-800 mb-1">🔑 Columna llave en Destino (SKU)</label>
                    <select value={skuColTarget} onChange={e => setSkuColTarget(e.target.value)} required
                      disabled={targetCols.length === 0}
                      className="w-full border border-green-200 rounded-lg p-2 text-sm bg-white max-w-sm">
                      <option value="">Seleccionar llave principal...</option>
                      {targetCols.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </>
              )}

              {destType === 'csv' && (
                <p className="text-xs text-green-700 mb-3">
                  El CSV se genera a partir de la Tabla Maestra completa (sin filtrar por hoja destino). Descárgalo cuando lo necesites y súbelo a mano a la plataforma.
                </p>
              )}

              <div>
                <div className="flex justify-between items-center mb-2 mt-1">
                  <div>
                    <label className="block text-sm font-medium text-green-800">Campos a {destType === 'csv' ? 'Exportar' : 'Suscribir'}</label>
                    <p className="text-xs text-green-600">
                      {destType === 'csv' ? 'Columna de la maestra (izq) → nombre de columna en el CSV (der)' : 'De la maestra (izq) hacia la hoja hija (der)'}
                    </p>
                  </div>
                  {destType === 'sheet' && (
                    <button type="button" onClick={handleAutoMap} className="bg-green-200 text-green-800 px-3 py-1 rounded-md text-xs font-semibold hover:bg-green-300">
                      ✨ Auto-Mapear
                    </button>
                  )}
                </div>

                {colMappings.map((m, i) => (
                  <div key={i} className="flex gap-2 items-center mb-2">
                    <select value={m.src} onChange={e => {
                      const n = [...colMappings]; n[i].src = e.target.value; setColMappings(n);
                    }} className="flex-1 border border-green-200 rounded-md p-1.5 text-sm bg-white">
                      <option value="">[Maestra] Columna origen...</option>
                      {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <ChevronRight className="w-4 h-4 text-green-400 flex-shrink-0" />
                    {destType === 'csv' ? (
                      <input value={m.dst} onChange={e => {
                        const n = [...colMappings]; n[i].dst = e.target.value; setColMappings(n);
                      }} placeholder="Nombre de columna en el CSV..."
                        className="flex-1 border border-green-200 rounded-md p-1.5 text-sm bg-white" />
                    ) : (
                      <select value={m.dst} onChange={e => {
                        const n = [...colMappings]; n[i].dst = e.target.value; setColMappings(n);
                      }} className="flex-1 border border-green-200 rounded-md p-1.5 text-sm bg-white">
                        <option value="">[Hija] Columna destino...</option>
                        {targetCols.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    )}
                    {colMappings.length > 1 && (
                      <button type="button" onClick={() => setColMappings(colMappings.filter((_, idx) => idx !== i))}
                        className="text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => setColMappings([...colMappings, { src: '', dst: '' }])}
                  className="text-green-600 text-sm font-medium hover:underline mt-1">+ Añadir campo</button>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button type="submit"
                disabled={destType === 'sheet' && (!targetConnId || (multiMode ? selectedSheets.length === 0 : !targetSheet))}
                className="bg-green-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-green-700 transition disabled:opacity-50">
                {destType === 'csv' ? 'Guardar Exportación CSV' : (multiMode ? `Guardar ${selectedSheets.length || ''} Suscripción(es)` : 'Guardar Suscripción')}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 transition font-medium">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {subscriptions.length === 0 && csvExports.length === 0 && !showForm ? (
        <div className="text-center py-16 text-gray-400">
          <Download className="w-14 h-14 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium mb-1">Sin Distribución Configurada</p>
          <p className="text-sm mb-4">La Tabla Maestra no está distribuyendo datos a ninguna hoja hija ni exportando CSV.</p>
          <button onClick={() => setShowForm(true)}
            className="bg-green-600 text-white px-6 py-2.5 rounded-xl font-medium hover:bg-green-700">
            <Plus className="w-4 h-4 inline mr-1" /> Crear Distribución
          </button>
        </div>
      ) : subscriptions.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {subscriptions.map(sub => (
            <div key={sub.id} className={`bg-white rounded-xl shadow-sm border p-5 ${!sub.is_active ? 'opacity-60 grayscale' : 'border-gray-200'}`}>
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-semibold text-gray-800 text-lg flex items-center gap-2">
                    {sub.name}
                    {!sub.is_active && <span className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full uppercase">Pausada</span>}
                  </h3>
                  <p className="text-sm text-gray-500">{connName(sub.target_connection_id)} / "{sub.target_sheet_name}"</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => toggleActive(sub)} className={`p-1.5 rounded-lg transition ${sub.is_active ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`} title={sub.is_active ? "Pausar" : "Activar"}>
                    <Power className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(sub.id)} className="text-red-400 hover:bg-red-50 p-1.5 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              
              <div className="bg-gray-50 rounded-lg p-3 text-sm border">
                <p className="text-xs text-gray-500 mb-1">LLAVE: <span className="font-semibold text-gray-700">{sub.sku_column_target}</span></p>
                <div className="text-xs space-y-1">
                  {Object.entries(sub.field_mappings).map(([src, dst]) => (
                    <div key={src} className="flex justify-between border-b border-gray-100 last:border-0 pb-1 last:pb-0">
                      <span className="text-gray-500 truncate w-1/2 pr-2">{src}</span>
                      <ChevronRight className="w-3 h-3 text-gray-300" />
                      <span className="text-gray-800 font-medium truncate w-1/2 pl-2 text-right">{dst}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {csvExports.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <FileDown className="w-5 h-5 text-green-600" /> Exportaciones CSV (subida manual)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {csvExports.map(exp => (
              <div key={exp.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="font-semibold text-gray-800 text-lg">{exp.name}</h3>
                  <div className="flex gap-1">
                    <a href={`${API}/api/exports/${exp.id}/download`}
                      className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 transition" title="Descargar CSV">
                      <Download className="w-4 h-4" />
                    </a>
                    <button onClick={() => handleDeleteCsv(exp.id)} className="text-red-400 hover:bg-red-50 p-1.5 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-sm border">
                  <div className="text-xs space-y-1">
                    {Object.entries(exp.columns_mapping).map(([src, dst]) => (
                      <div key={src} className="flex justify-between border-b border-gray-100 last:border-0 pb-1 last:pb-0">
                        <span className="text-gray-500 truncate w-1/2 pr-2">{src}</span>
                        <ChevronRight className="w-3 h-3 text-gray-300" />
                        <span className="text-gray-800 font-medium truncate w-1/2 pl-2 text-right">{dst}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
