import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { UploadCloud, Link2, ChevronRight, CheckCircle2, ArrowRight, Sparkles, Download, FileDown } from 'lucide-react';
import { extractError } from '../utils/errors';

const API = import.meta.env.VITE_API_URL || '';

const STEPS = [
  { key: 'origen', label: 'Traer datos' },
  { key: 'mapeo', label: 'Confirmar campos' },
  { key: 'destinos', label: 'Elegir destinos' },
];

export default function SourceWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState('origen');
  const [projectId, setProjectId] = useState(null);

  // --- Paso 1: Origen ---
  const [mode, setMode] = useState('connect'); // 'connect' | 'upload'
  const [sourceName, setSourceName] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [file, setFile] = useState(null);
  const [creatingSource, setCreatingSource] = useState(false);
  const [sourceConn, setSourceConn] = useState(null); // conexión creada

  // --- Paso 2: Mapeo ---
  const [sourceSheets, setSourceSheets] = useState({});
  const [sourceSheet, setSourceSheet] = useState('');
  const [masterCols, setMasterCols] = useState([]);
  const [masterSkuCol, setMasterSkuCol] = useState('');
  const [skuColSource, setSkuColSource] = useState('');
  const [fieldMappings, setFieldMappings] = useState([{ src: '', dst: '' }]);
  const [processName, setProcessName] = useState('');
  const [loadingMap, setLoadingMap] = useState(false);
  const [savingProcess, setSavingProcess] = useState(false);
  const [createdProcess, setCreatedProcess] = useState(null);

  // --- Paso 3: Destinos ---
  const [destinations, setDestinations] = useState([]); // suscripciones + csv exports ya existentes
  const [destType, setDestType] = useState('sheet'); // 'sheet' | 'csv'
  const [destName, setDestName] = useState('');
  const [destConnId, setDestConnId] = useState('');
  const [connections, setConnections] = useState([]);
  const [destSheets, setDestSheets] = useState({});
  const [destSheet, setDestSheet] = useState('');
  const [destSkuCol, setDestSkuCol] = useState('');
  const [destMappings, setDestMappings] = useState([{ src: '', dst: '' }]);
  const [savingDest, setSavingDest] = useState(false);
  const [masterConnId, setMasterConnId] = useState(null); // conexión real de la Maestra global (para el CSV)
  const [masterSheetNameRef, setMasterSheetNameRef] = useState(null);

  const sourceCols = sourceSheet && sourceSheets[sourceSheet] ? sourceSheets[sourceSheet] : [];
  const destCols = destType === 'sheet' && destSheet && destSheets[destSheet] ? destSheets[destSheet] : [];

  useEffect(() => {
    (async () => {
      try {
        const [projsRes, masterRes] = await Promise.all([
          fetch(`${API}/api/projects/`),
          fetch(`${API}/api/master`)
        ]);
        const projs = await projsRes.json();
        if (projs.length > 0) setProjectId(projs[0].id);
        const masterData = await masterRes.json();
        setMasterConnId(masterData.master_connection_id || null);
        setMasterSheetNameRef(masterData.master_sheet_name || null);
      } catch (err) { console.error(err); }
    })();
  }, []);

  const loadDestinations = async (pid) => {
    try {
      const [subsRes, expRes, connsRes] = await Promise.all([
        fetch(`${API}/api/subscriptions/?project_id=${pid}`),
        fetch(`${API}/api/exports/?project_id=${pid}`),
        fetch(`${API}/api/connections/`)
      ]);
      const subs = await subsRes.json();
      const exps = await expRes.json();
      setConnections(await connsRes.json());
      setDestinations([
        ...subs.map(s => ({ id: `sub-${s.id}`, name: s.name, kind: 'Google Sheet' })),
        ...exps.map(e => ({ id: `exp-${e.id}`, name: e.name, kind: 'CSV' })),
      ]);
    } catch (err) { console.error(err); }
  };

  // ── Paso 1: crear la conexión origen (conectar o subir) ──
  const handleCreateSource = async (e) => {
    e.preventDefault();
    setCreatingSource(true);
    try {
      let conn;
      if (mode === 'upload') {
        if (!file) { alert('Elegí un archivo primero.'); setCreatingSource(false); return; }
        const form = new FormData();
        form.append('name', sourceName || file.name);
        form.append('file', file);
        const res = await fetch(`${API}/api/connections/upload`, { method: 'POST', body: form });
        if (!res.ok) throw new Error(await extractError(res));
        conn = await res.json();
      } else {
        const res = await fetch(`${API}/api/connections/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: sourceName || 'Nueva fuente', connection_type: 'google_sheets', google_sheet_url: sheetUrl })
        });
        if (!res.ok) throw new Error(await extractError(res));
        conn = await res.json();
      }
      setSourceConn(conn);
      setProcessName(`Traer ${conn.name} → Maestra`);
      await loadMappingData(conn.id);
      setStep('mapeo');
    } catch (err) {
      alert(err.message || 'No se pudo crear la fuente.');
    }
    setCreatingSource(false);
  };

  // ── Paso 2: cargar hojas/columnas y auto-mapear ──
  const loadMappingData = async (connId) => {
    setLoadingMap(true);
    try {
      const [metaRes, masterColsRes, masterRes] = await Promise.all([
        fetch(`${API}/api/connections/${connId}/metadata`),
        fetch(`${API}/api/master-columns`),
        fetch(`${API}/api/master`)
      ]);
      const meta = await metaRes.json();
      if (!metaRes.ok) throw new Error(meta.detail || 'No se pudo leer el archivo/hoja.');
      const sheets = meta.sheets || {};
      setSourceSheets(sheets);
      const firstSheet = Object.keys(sheets)[0] || '';
      setSourceSheet(firstSheet);

      const mColsData = await masterColsRes.json();
      const mCols = masterColsRes.ok && Array.isArray(mColsData) ? mColsData : [];
      setMasterCols(mCols);
      if (!masterColsRes.ok) alert('No se pudieron leer las columnas de la Tabla Maestra. Revisá que esté enlazada y accesible.');
      const masterInfo = await masterRes.json();
      setMasterSkuCol(masterRes.ok ? (masterInfo.master_sku_column || '') : '');

      if (firstSheet && sheets[firstSheet]) {
        await autoDetect(connId, firstSheet, sheets[firstSheet], mCols);
      }
    } catch (err) {
      alert(err.message);
    }
    setLoadingMap(false);
  };

  const autoDetect = async (connId, sheetName, headers, mCols) => {
    try {
      const [skuRes, mapRes] = await Promise.all([
        fetch(`${API}/api/intelligence/suggest-sku?connection_id=${connId}&sheet_name=${encodeURIComponent(sheetName)}`),
        fetch(`${API}/api/intelligence/auto-map`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_headers: headers, target_headers: mCols })
        })
      ]);
      const skuData = await skuRes.json();
      const mapData = await mapRes.json();
      const suggestedSku = skuData.suggested_sku || headers[0] || '';
      setSkuColSource(suggestedSku);

      const mapped = Object.entries(mapData.mapping || {})
        .filter(([src]) => src !== suggestedSku)
        .map(([src, dst]) => ({ src, dst }));
      setFieldMappings(mapped.length > 0 ? mapped : [{ src: '', dst: '' }]);
    } catch (err) { console.error('Auto-detect falló', err); }
  };

  const handleSheetChange = async (sheetName) => {
    setSourceSheet(sheetName);
    const headers = sourceSheets[sheetName] || [];
    await autoDetect(sourceConn.id, sheetName, headers, masterCols);
  };

  const handleSaveProcess = async (e) => {
    e.preventDefault();
    const mappings = {};
    fieldMappings.forEach(({ src, dst }) => { if (src && dst) mappings[src] = dst; });
    if (!skuColSource || !masterSkuCol) {
      alert('Falta confirmar la columna SKU (origen y maestra).');
      return;
    }
    if (Object.keys(mappings).length === 0) {
      alert('Agregá al menos un campo (nombre, precio o stock).');
      return;
    }
    setSavingProcess(true);
    try {
      const res = await fetch(`${API}/api/processes/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: processName || `Traer ${sourceConn.name} → Maestra`,
          source_connection_id: sourceConn.id,
          source_sheet_name: sourceSheet,
          sku_column_source: skuColSource,
          sku_column_master: masterSkuCol,
          field_mappings: mappings,
          add_new_rows: true,
          is_active: true
        })
      });
      if (!res.ok) throw new Error(await extractError(res));
      const data = await res.json();
      setCreatedProcess(data);
      if (projectId) await loadDestinations(projectId);
      setStep('destinos');
    } catch (err) {
      alert(err.message || 'No se pudo guardar.');
    }
    setSavingProcess(false);
  };

  // ── Paso 3: destinos ──
  const loadDestSheets = async (connId) => {
    setDestConnId(connId);
    setDestSheet('');
    if (!connId) return;
    try {
      const res = await fetch(`${API}/api/connections/${connId}/metadata`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Fallo');
      setDestSheets(data.sheets || {});
    } catch (err) {
      alert(err.message);
      setDestSheets({});
    }
  };

  const handleAutoMapDest = async () => {
    if (masterCols.length === 0 || destCols.length === 0) return;
    try {
      const res = await fetch(`${API}/api/intelligence/auto-map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_headers: masterCols, target_headers: destCols })
      });
      const data = await res.json();
      const newMappings = Object.entries(data.mapping || {})
        .filter(([, dst]) => dst !== destSkuCol)
        .map(([src, dst]) => ({ src, dst }));
      if (newMappings.length > 0) setDestMappings(newMappings);
    } catch (err) { console.error(err); }
  };

  const handleCreateDestination = async (e) => {
    e.preventDefault();
    const mappings = {};
    destMappings.forEach(({ src, dst }) => { if (src && dst) mappings[src] = dst; });
    if (Object.keys(mappings).length === 0) {
      alert('Agregá al menos un campo a enviar.');
      return;
    }
    setSavingDest(true);
    try {
      let res;
      if (destType === 'csv') {
        if (!masterConnId) {
          alert('No hay una Tabla Maestra enlazada todavía.');
          setSavingDest(false);
          return;
        }
        res = await fetch(`${API}/api/exports/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: destName || 'Nueva exportación CSV',
            project_id: projectId,
            source_connection_id: masterConnId,
            source_sheet_name: masterSheetNameRef,
            columns_mapping: mappings,
            output_type: 'csv_download'
          })
        });
      } else {
        if (!destConnId || !destSheet || !destSkuCol) {
          alert('Elegí conexión, pestaña y columna llave del destino.');
          setSavingDest(false);
          return;
        }
        res = await fetch(`${API}/api/subscriptions/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: projectId,
            target_connection_id: parseInt(destConnId),
            target_sheet_name: destSheet,
            sku_column_target: destSkuCol,
            field_mappings: mappings,
            is_active: true,
            name: destName || 'Nueva Suscripción'
          })
        });
      }
      if (!res.ok) throw new Error(await extractError(res));
      setDestName(''); setDestConnId(''); setDestSheet(''); setDestSkuCol('');
      setDestMappings([{ src: '', dst: '' }]);
      await loadDestinations(projectId);
    } catch (err) {
      alert(err.message || 'No se pudo crear el destino.');
    }
    setSavingDest(false);
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-indigo-600" /> Nueva Fuente
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Traé tus datos, confirmá los campos y elegí a dónde se distribuyen. Sin pasos de más.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-6">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
              step === s.key ? 'bg-indigo-600 text-white' :
              STEPS.findIndex(x => x.key === step) > i ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-400'
            }`}>
              {STEPS.findIndex(x => x.key === step) > i ? <CheckCircle2 className="w-4 h-4" /> : <span>{i + 1}</span>}
              {s.label}
            </div>
            {i < STEPS.length - 1 && <ChevronRight className="w-4 h-4 text-gray-300" />}
          </div>
        ))}
      </div>

      {/* Paso 1: Origen */}
      {step === 'origen' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex gap-2 mb-5">
            <button type="button" onClick={() => setMode('connect')}
              className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg text-sm font-medium border transition ${mode === 'connect' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              <Link2 className="w-4 h-4" /> Conectar Google Sheet
            </button>
            <button type="button" onClick={() => setMode('upload')}
              className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg text-sm font-medium border transition ${mode === 'upload' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              <UploadCloud className="w-4 h-4" /> Subir archivo (CSV/Excel)
            </button>
          </div>

          <form onSubmit={handleCreateSource} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre (referencia)</label>
              <input value={sourceName} onChange={e => setSourceName(e.target.value)}
                placeholder="Ej: Proveedor X, Base semanal"
                className="w-full border border-gray-300 rounded-lg p-2 text-sm max-w-md" />
            </div>

            {mode === 'connect' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL del Google Sheet</label>
                <input key="sheetUrl" value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} required
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Archivo (.csv, .xls, .xlsx)</label>
                <input key="fileInput" type="file" accept=".csv,.xls,.xlsx" onChange={e => setFile(e.target.files?.[0] || null)} required
                  className="w-full text-sm" />
              </div>
            )}

            <button type="submit" disabled={creatingSource}
              className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 text-sm">
              {creatingSource ? 'Conectando...' : <>Siguiente <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>
        </div>
      )}

      {/* Paso 2: Mapeo */}
      {step === 'mapeo' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          {loadingMap ? (
            <p className="text-gray-500 text-sm">Leyendo columnas y sugiriendo el mapeo...</p>
          ) : (
            <form onSubmit={handleSaveProcess} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del proceso</label>
                <input value={processName} onChange={e => setProcessName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm max-w-md" />
              </div>

              {Object.keys(sourceSheets).length > 1 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pestaña / hoja</label>
                  <select value={sourceSheet} onChange={e => handleSheetChange(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm max-w-sm bg-white">
                    {Object.keys(sourceSheets).map(sh => <option key={sh} value={sh}>{sh}</option>)}
                  </select>
                </div>
              )}

              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-indigo-800 mb-1">🔑 Columna SKU en el origen</label>
                    <select value={skuColSource} onChange={e => setSkuColSource(e.target.value)}
                      className="w-full border border-indigo-200 rounded-lg p-2 text-sm bg-white">
                      <option value="">Seleccionar...</option>
                      {sourceCols.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-indigo-800 mb-1">🔑 Columna SKU en la Maestra</label>
                    <select value={masterSkuCol} onChange={e => setMasterSkuCol(e.target.value)}
                      className="w-full border border-indigo-200 rounded-lg p-2 text-sm bg-white">
                      <option value="">Seleccionar...</option>
                      {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                <div className="flex justify-between items-center mb-2">
                  <div>
                    <label className="block text-sm font-medium text-indigo-800">Campos (nombre, precio, stock...)</label>
                    <p className="text-xs text-indigo-600">Ya vienen auto-sugeridos; ajustá si hace falta.</p>
                  </div>
                </div>
                {fieldMappings.map((m, i) => (
                  <div key={i} className="flex gap-2 items-center mb-2">
                    <select value={m.src} onChange={e => {
                      const n = [...fieldMappings]; n[i].src = e.target.value; setFieldMappings(n);
                    }} className="flex-1 border border-indigo-200 rounded-md p-1.5 text-sm bg-white">
                      <option value="">[Origen] Columna...</option>
                      {sourceCols.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <ChevronRight className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                    <select value={m.dst} onChange={e => {
                      const n = [...fieldMappings]; n[i].dst = e.target.value; setFieldMappings(n);
                    }} className="flex-1 border border-indigo-200 rounded-md p-1.5 text-sm bg-white">
                      <option value="">[Maestra] Columna...</option>
                      {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {fieldMappings.length > 1 && (
                      <button type="button" onClick={() => setFieldMappings(fieldMappings.filter((_, idx) => idx !== i))}
                        className="text-red-400 hover:text-red-600 text-sm">✕</button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => setFieldMappings([...fieldMappings, { src: '', dst: '' }])}
                  className="text-indigo-600 text-sm font-medium hover:underline mt-1">+ Añadir campo</button>
              </div>

              <div className="flex gap-2">
                <button type="submit" disabled={savingProcess}
                  className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 text-sm">
                  {savingProcess ? 'Guardando...' : <>Siguiente <ArrowRight className="w-4 h-4" /></>}
                </button>
                <button type="button" onClick={() => setStep('origen')}
                  className="text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 text-sm font-medium">Volver</button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Paso 3: Destinos */}
      {step === 'destinos' && (
        <div className="space-y-5">
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
            <div>
              <p className="font-semibold text-green-800">Fuente lista y activa.</p>
              <p className="text-sm text-green-700">Ya la va a tomar "⚡ Correr Procesos" en la próxima corrida. Ahora, opcionalmente, elegí a dónde se distribuyen los datos enriquecidos.</p>
            </div>
          </div>

          {destinations.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-sm font-semibold text-gray-700 mb-2">Destinos ya configurados</p>
              <div className="flex flex-wrap gap-2">
                {destinations.map(d => (
                  <span key={d.id} className="text-xs bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full">
                    {d.kind === 'CSV' ? <FileDown className="w-3 h-3 inline mr-1" /> : <Download className="w-3 h-3 inline mr-1" />}
                    {d.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Agregar un destino nuevo</h3>
            <div className="flex gap-2 mb-4">
              <button type="button" onClick={() => setDestType('sheet')}
                className={`flex-1 flex items-center justify-center gap-2 p-2.5 rounded-lg text-sm font-medium border transition ${destType === 'sheet' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                <Download className="w-4 h-4" /> Google Sheet
              </button>
              <button type="button" onClick={() => setDestType('csv')}
                className={`flex-1 flex items-center justify-center gap-2 p-2.5 rounded-lg text-sm font-medium border transition ${destType === 'csv' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                <FileDown className="w-4 h-4" /> Descarga CSV
              </button>
            </div>

            <form onSubmit={handleCreateDestination} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
                <input value={destName} onChange={e => setDestName(e.target.value)} required
                  placeholder={destType === 'csv' ? 'Ej: KYTE, Effi' : 'Ej: Catálogo, Shopi-Kino'}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm max-w-md" />
              </div>

              {destType === 'sheet' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Conexión Google Sheets</label>
                    <select value={destConnId} onChange={e => loadDestSheets(e.target.value)} required
                      className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                      <option value="">Seleccionar...</option>
                      {connections.filter(c => c.connection_type === 'google_sheets').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Pestaña destino</label>
                    <select value={destSheet} onChange={e => setDestSheet(e.target.value)} required disabled={!destConnId}
                      className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white">
                      <option value="">Seleccionar...</option>
                      {Object.keys(destSheets).map(sh => <option key={sh} value={sh}>{sh}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">🔑 Columna llave en destino (SKU)</label>
                    <select value={destSkuCol} onChange={e => setDestSkuCol(e.target.value)} required disabled={destCols.length === 0}
                      className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white max-w-sm">
                      <option value="">Seleccionar...</option>
                      {destCols.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
              )}

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-gray-700">Campos a enviar</label>
                  {destType === 'sheet' && (
                    <button type="button" onClick={handleAutoMapDest} className="bg-gray-100 text-gray-700 px-3 py-1 rounded-md text-xs font-semibold hover:bg-gray-200">
                      ✨ Auto-Mapear
                    </button>
                  )}
                </div>
                {destMappings.map((m, i) => (
                  <div key={i} className="flex gap-2 items-center mb-2">
                    <select value={m.src} onChange={e => {
                      const n = [...destMappings]; n[i].src = e.target.value; setDestMappings(n);
                    }} className="flex-1 border border-gray-300 rounded-md p-1.5 text-sm bg-white">
                      <option value="">[Maestra] Columna...</option>
                      {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                    {destType === 'csv' ? (
                      <input value={m.dst} onChange={e => {
                        const n = [...destMappings]; n[i].dst = e.target.value; setDestMappings(n);
                      }} placeholder="Nombre de columna en el CSV..."
                        className="flex-1 border border-gray-300 rounded-md p-1.5 text-sm bg-white" />
                    ) : (
                      <select value={m.dst} onChange={e => {
                        const n = [...destMappings]; n[i].dst = e.target.value; setDestMappings(n);
                      }} className="flex-1 border border-gray-300 rounded-md p-1.5 text-sm bg-white">
                        <option value="">[Destino] Columna...</option>
                        {destCols.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    )}
                    {destMappings.length > 1 && (
                      <button type="button" onClick={() => setDestMappings(destMappings.filter((_, idx) => idx !== i))}
                        className="text-red-400 hover:text-red-600 text-sm">✕</button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => setDestMappings([...destMappings, { src: '', dst: '' }])}
                  className="text-gray-600 text-sm font-medium hover:underline mt-1">+ Añadir campo</button>
              </div>

              <button type="submit" disabled={savingDest}
                className="bg-green-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 text-sm">
                {savingDest ? 'Guardando...' : 'Guardar destino'}
              </button>
            </form>
          </div>

          <button onClick={() => navigate('/')}
            className="flex items-center gap-2 bg-gray-800 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-gray-900 text-sm">
            Terminar e ir a la Tabla Maestra <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
