import { useState, useEffect } from 'react';
import { Download, Plus, Trash2, ChevronRight, Table2, Send, FileDown } from 'lucide-react';

const API = 'http://localhost:8000';

export default function Exports() {
  const [formats, setFormats] = useState([]);
  const [projects, setProjects] = useState([]);
  const [connections, setConnections] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [pushStatus, setPushStatus] = useState({}); // { [fmt.id]: 'success'|'error'|'loading' }

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');
  const [sourceConnId, setSourceConnId] = useState('');
  const [sourceSheet, setSourceSheet] = useState('');
  const [masterSheets, setMasterSheets] = useState({});
  // Tipo de salida
  const [outputType, setOutputType] = useState('csv_download'); // 'csv_download' | 'google_sheets'
  const [outputUrl, setOutputUrl] = useState('');      // URL de Google Sheet destino
  const [outputSheet, setOutputSheet] = useState('');   // Nombre de hoja destino
  // Mapeo de columnas
  const [colMappings, setColMappings] = useState([{ master_col: '', csv_col: '' }]);

  useEffect(() => {
    fetch(`${API}/api/exports/`).then(r => r.json()).then(setFormats).catch(console.error);
    fetch(`${API}/api/projects/`).then(r => r.json()).then(setProjects).catch(console.error);
    fetch(`${API}/api/connections/`).then(r => r.json()).then(setConnections).catch(console.error);
  }, []);

  useEffect(() => {
    if (!sourceConnId) return;
    fetch(`${API}/api/connections/${sourceConnId}/metadata`)
      .then(r => r.json())
      .then(data => setMasterSheets(data.sheets || {}))
      .catch(console.error);
  }, [sourceConnId]);

  const addColMapping = () => setColMappings([...colMappings, { master_col: '', csv_col: '' }]);
  const removeColMapping = (i) => setColMappings(colMappings.filter((_, idx) => idx !== i));
  const updateColMapping = (i, field, val) => {
    const updated = [...colMappings];
    updated[i][field] = val;
    setColMappings(updated);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    const mapping = {};
    colMappings.forEach(({ master_col, csv_col }) => {
      if (master_col && csv_col) mapping[master_col] = csv_col;
    });

    const payload = {
      name,
      description,
      project_id: parseInt(projectId),
      source_connection_id: parseInt(sourceConnId),
      source_sheet_name: sourceSheet,
      columns_mapping: mapping,
      output_type: outputType,
      output_spreadsheet_id: outputType === 'google_sheets' ? outputUrl : null,
      output_sheet_name: outputType === 'google_sheets' ? outputSheet : null,
    };

    const res = await fetch(`${API}/api/exports/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const newFmt = await res.json();
      setFormats([...formats, newFmt]);
      setShowForm(false);
      resetForm();
    } else {
      alert('Error al crear formato de salida.');
    }
  };

  const resetForm = () => {
    setName(''); setDescription(''); setProjectId('');
    setSourceConnId(''); setSourceSheet('');
    setOutputType('csv_download'); setOutputUrl(''); setOutputSheet('');
    setColMappings([{ master_col: '', csv_col: '' }]);
  };

  const handleDownloadCsv = (fmt) => {
    window.open(`${API}/api/exports/${fmt.id}/download`, '_blank');
  };

  const handlePushToSheets = async (fmt) => {
    setPushStatus(s => ({ ...s, [fmt.id]: 'loading' }));
    try {
      const res = await fetch(`${API}/api/exports/${fmt.id}/push`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setPushStatus(s => ({ ...s, [fmt.id]: 'success' }));
        alert(`✅ ${data.message}\nFilas escritas: ${data.rows_written}`);
      } else {
        setPushStatus(s => ({ ...s, [fmt.id]: 'error' }));
        alert('Error: ' + data.detail);
      }
    } catch (err) {
      setPushStatus(s => ({ ...s, [fmt.id]: 'error' }));
    }
    setTimeout(() => setPushStatus(s => ({ ...s, [fmt.id]: null })), 3000);
  };

  const masterCols = sourceSheet && masterSheets[sourceSheet] ? masterSheets[sourceSheet] : [];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8 flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Download className="w-6 h-6 text-blue-600" />
            Formatos de Salida
          </h1>
          <p className="text-gray-600 mt-1">
            Exporta tu Tabla Master hacia un CSV descargable o directamente a otro Google Sheet.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2 rounded-lg font-medium hover:bg-blue-700 transition"
        >
          <Plus className="w-4 h-4" />
          Nuevo Formato
        </button>
      </div>

      {/* Diagrama de flujo */}
      <div className="flex flex-wrap items-center gap-3 bg-gradient-to-r from-blue-50 to-green-50 border border-blue-100 rounded-xl p-4 mb-8 text-sm text-gray-600">
        <div className="bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg font-medium">Tablas Origen</div>
        <ChevronRight className="w-4 h-4 text-gray-400" />
        <div className="bg-purple-100 text-purple-700 px-3 py-1.5 rounded-lg font-medium">Tabla Master</div>
        <ChevronRight className="w-4 h-4 text-gray-400" />
        <div className="flex flex-col gap-1">
          <div className="bg-green-100 text-green-700 px-3 py-1 rounded-lg font-medium flex items-center gap-1">
            <FileDown className="w-3 h-3" /> CSV Descargable
          </div>
          <div className="bg-orange-100 text-orange-700 px-3 py-1 rounded-lg font-medium flex items-center gap-1">
            <Send className="w-3 h-3" /> → Google Sheet tuyo
          </div>
        </div>
      </div>

      {/* Formulario */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <h2 className="text-lg font-semibold mb-5 text-gray-800 flex items-center gap-2">
            <Table2 className="w-5 h-5 text-blue-500" />
            Definir nuevo formato de salida
          </h2>
          <form onSubmit={handleCreate} className="space-y-5">

            {/* Nombre y descripción */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del formato</label>
                <input value={name} onChange={e => setName(e.target.value)} required
                  placeholder="Ej: Página Web, Visor, Effi Inventario"
                  className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descripción (opcional)</label>
                <input value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="Para qué se usa este formato"
                  className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
            </div>

            {/* Proyecto + Tabla Master */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Proyecto</label>
                <select value={projectId} onChange={e => setProjectId(e.target.value)} required
                  className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none">
                  <option value="">Seleccionar...</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tabla Master (conexión origen)</label>
                <select value={sourceConnId} onChange={e => setSourceConnId(e.target.value)} required
                  className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none">
                  <option value="">Seleccionar conexión...</option>
                  {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hoja de la Master</label>
                <select value={sourceSheet} onChange={e => setSourceSheet(e.target.value)} required
                  disabled={!sourceConnId}
                  className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-50">
                  <option value="">Seleccionar hoja...</option>
                  {Object.keys(masterSheets).map(sh => <option key={sh} value={sh}>{sh}</option>)}
                </select>
              </div>
            </div>

            {/* ─── Tipo de salida ─── */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">¿Cómo quieres exportar?</label>
              <div className="flex gap-3">
                <button type="button"
                  onClick={() => setOutputType('csv_download')}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-medium transition
                    ${outputType === 'csv_download'
                      ? 'border-green-500 bg-green-50 text-green-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  <FileDown className="w-5 h-5" />
                  Descargar CSV
                </button>
                <button type="button"
                  onClick={() => setOutputType('google_sheets')}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-medium transition
                    ${outputType === 'google_sheets'
                      ? 'border-orange-500 bg-orange-50 text-orange-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  <Send className="w-5 h-5" />
                  Enviar a Google Sheet
                </button>
              </div>
            </div>

            {/* Campos extra si elige Google Sheets */}
            {outputType === 'google_sheets' && (
              <div className="grid grid-cols-2 gap-4 bg-orange-50 border border-orange-200 rounded-xl p-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">URL del Google Sheet destino</label>
                  <input value={outputUrl} onChange={e => setOutputUrl(e.target.value)} required={outputType === 'google_sheets'}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-orange-400 outline-none" />
                  <p className="text-xs text-gray-500 mt-1">Pega el link del Google Sheet donde quieres escribir los datos.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de la hoja destino</label>
                  <input value={outputSheet} onChange={e => setOutputSheet(e.target.value)} required={outputType === 'google_sheets'}
                    placeholder="Ej: Hoja1, Catalogo Web, Inventario"
                    className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-orange-400 outline-none" />
                  <p className="text-xs text-gray-500 mt-1">Nombre exacto de la pestaña del Sheet.</p>
                </div>
              </div>
            )}

            {/* Mapeo de columnas */}
            <div>
              <div className="flex justify-between items-center mb-3">
                <label className="block text-sm font-medium text-gray-700">
                  Mapeo de columnas
                  <span className="text-gray-400 font-normal ml-1">(Tabla Master → Nombre en la salida)</span>
                </label>
                <button type="button" onClick={addColMapping}
                  className="text-blue-600 text-sm font-medium hover:underline">
                  + Añadir columna
                </button>
              </div>

              <div className="space-y-2">
                {colMappings.map((cm, i) => (
                  <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-lg p-3 border border-gray-100">
                    <div className="flex-1">
                      <label className="text-xs text-gray-500 mb-1 block">Columna en Tabla Master</label>
                      <select value={cm.master_col} onChange={e => updateColMapping(i, 'master_col', e.target.value)}
                        className="w-full border border-gray-300 rounded p-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                        <option value="">Seleccionar...</option>
                        {masterCols.map(col => <option key={col} value={col}>{col}</option>)}
                      </select>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400 mt-4 flex-shrink-0" />
                    <div className="flex-1">
                      <label className="text-xs text-gray-500 mb-1 block">Nombre en la salida</label>
                      <input value={cm.csv_col} onChange={e => updateColMapping(i, 'csv_col', e.target.value)}
                        placeholder="Ej: title, inventory_count, precio"
                        className="w-full border border-gray-300 rounded p-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    {colMappings.length > 1 && (
                      <button type="button" onClick={() => removeColMapping(i)}
                        className="mt-4 text-red-400 hover:text-red-600 flex-shrink-0">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit"
                className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 transition">
                Guardar Formato
              </button>
              <button type="button" onClick={() => { setShowForm(false); resetForm(); }}
                className="text-gray-500 px-6 py-2 rounded-lg hover:bg-gray-100 transition">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Lista de formatos */}
      {formats.length === 0 && !showForm ? (
        <div className="text-center py-16 text-gray-400">
          <Download className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No tienes formatos de salida aún</p>
          <p className="text-sm">Crea un formato para exportar tus datos en CSV o enviarlos a un Google Sheet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {formats.map(fmt => {
            const isSheets = fmt.output_type === 'google_sheets';
            const status = pushStatus[fmt.id];
            return (
              <div key={fmt.id}
                className={`bg-white rounded-xl border-2 shadow-sm p-5 transition group
                  ${isSheets ? 'border-orange-200 hover:border-orange-400' : 'border-gray-200 hover:border-green-300'}`}>

                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-800 text-lg">{fmt.name}</h3>
                    {fmt.description && <p className="text-sm text-gray-500">{fmt.description}</p>}
                  </div>
                  <span className={`text-xs font-medium px-2 py-1 rounded-full border flex items-center gap-1
                    ${isSheets ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                    {isSheets ? <><Send className="w-3 h-3" /> Google Sheet</> : <><FileDown className="w-3 h-3" /> CSV</>}
                  </span>
                </div>

                {/* Columnas mapeadas */}
                <div className="mb-4">
                  <p className="text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Columnas exportadas:</p>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(fmt.columns_mapping).map(([src, dst]) => (
                      <span key={src} className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs">
                        {src} <span className="text-gray-400">→</span> <span className="text-blue-600 font-medium">{dst}</span>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Botón según tipo */}
                {isSheets ? (
                  <button
                    onClick={() => handlePushToSheets(fmt)}
                    disabled={status === 'loading'}
                    className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg font-medium transition
                      ${status === 'loading' ? 'bg-gray-200 text-gray-400 cursor-wait'
                        : status === 'success' ? 'bg-green-600 text-white'
                        : 'bg-orange-600 text-white hover:bg-orange-700'}`}>
                    <Send className="w-4 h-4" />
                    {status === 'loading' ? 'Enviando...' : status === 'success' ? '✅ Enviado' : 'Enviar a Google Sheet'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleDownloadCsv(fmt)}
                    className="w-full flex items-center justify-center gap-2 bg-green-600 text-white py-2 rounded-lg font-medium hover:bg-green-700 transition">
                    <Download className="w-4 h-4" />
                    Descargar CSV
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
