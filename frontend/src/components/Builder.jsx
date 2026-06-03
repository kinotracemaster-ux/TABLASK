import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Settings2, ArrowRight } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';
export default function Builder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [connections, setConnections] = useState([]);
  
  // Builder state
  const [targetConnectionId, setTargetConnectionId] = useState('');
  const [targetSheet, setTargetSheet] = useState('');
  
  const [sourceConnectionId, setSourceConnectionId] = useState('');
  const [sourceSheet, setSourceSheet] = useState('');
  
  const [targetMetadata, setTargetMetadata] = useState(null);
  const [sourceMetadata, setSourceMetadata] = useState(null);

  const [mappings, setMappings] = useState([{ source_field: '', target_field: '', is_key: true }]);

  useEffect(() => {
    fetch(`${API}/api/connections/`)
      .then(res => res.json())
      .then(data => setConnections(data));
  }, []);

  const loadMetadata = async (connId, setter) => {
    const conn = connections.find(c => c.id == connId);
    if(conn) {
      const res = await fetch(`${API}/api/connections/${conn.id}/metadata`);
      const data = await res.json();
      setter(data);
    }
  };

  useEffect(() => {
    if(targetConnectionId) loadMetadata(targetConnectionId, setTargetMetadata);
  }, [targetConnectionId]);

  useEffect(() => {
    if(sourceConnectionId) loadMetadata(sourceConnectionId, setSourceMetadata);
  }, [sourceConnectionId]);

  const addMapping = () => setMappings([...mappings, { source_field: '', target_field: '', is_key: false }]);

  const updateMapping = (index, field, value) => {
    const newMappings = [...mappings];
    newMappings[index][field] = value;
    setMappings(newMappings);
  };

  const handlePreview = () => {
    // Save to local storage or state management to pass to preview
    const payload = {
      project_id: parseInt(id),
      target_connection_id: parseInt(targetConnectionId),
      target_sheet_name: targetSheet,
      target_key: "SKU",
      source_connections: {
        [sourceSheet]: parseInt(sourceConnectionId)
      },
      mappings: mappings.map(m => ({
        source_table: sourceSheet,
        source_field: m.source_field,
        target_field: m.target_field,
        is_key: m.is_key
      }))
    };
    
    localStorage.setItem(`sync_payload_${id}`, JSON.stringify(payload));
    navigate(`/preview/${id}`);
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Settings2 className="w-6 h-6 text-blue-600" />
            Constructor de Actualización
          </h1>
          <p className="text-gray-600">Configura el mapeo de columnas entre origen y destino.</p>
        </div>
        <button onClick={handlePreview} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 flex items-center gap-2">
          Ver Vista Previa <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        {/* Origen */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h2 className="text-lg font-semibold mb-4 text-blue-800">1. Origen de Datos</h2>
          <select className="w-full border border-gray-300 rounded-lg p-2 mb-4" value={sourceConnectionId} onChange={e => setSourceConnectionId(e.target.value)}>
            <option value="">Selecciona Conexión...</option>
            {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {sourceMetadata && (
            <select className="w-full border border-gray-300 rounded-lg p-2" value={sourceSheet} onChange={e => setSourceSheet(e.target.value)}>
              <option value="">Selecciona Hoja...</option>
              {Object.keys(sourceMetadata.sheets).map(sheet => <option key={sheet} value={sheet}>{sheet}</option>)}
            </select>
          )}
        </div>

        {/* Destino */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h2 className="text-lg font-semibold mb-4 text-green-800">2. Tabla Destino</h2>
          <select className="w-full border border-gray-300 rounded-lg p-2 mb-4" value={targetConnectionId} onChange={e => setTargetConnectionId(e.target.value)}>
            <option value="">Selecciona Conexión...</option>
            {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {targetMetadata && (
            <select className="w-full border border-gray-300 rounded-lg p-2" value={targetSheet} onChange={e => setTargetSheet(e.target.value)}>
              <option value="">Selecciona Hoja...</option>
              {Object.keys(targetMetadata.sheets).map(sheet => <option key={sheet} value={sheet}>{sheet}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Mappings */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
        <h2 className="text-lg font-semibold mb-4">3. Asignación de Columnas (Mapeo de Info)</h2>
        
        <div className="space-y-4">
          {mappings.map((mapping, idx) => (
            <div key={idx} className="flex gap-4 items-center p-4 bg-gray-50 rounded-lg border border-gray-100">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-1">Campo Origen</label>
                <select className="w-full border border-gray-300 rounded p-2" value={mapping.source_field} onChange={e => updateMapping(idx, 'source_field', e.target.value)}>
                  <option value="">Seleccionar...</option>
                  {sourceSheet && sourceMetadata?.sheets[sourceSheet]?.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <ArrowRight className="w-5 h-5 text-gray-400 mt-4" />
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-1">Campo Destino</label>
                <select className="w-full border border-gray-300 rounded p-2" value={mapping.target_field} onChange={e => updateMapping(idx, 'target_field', e.target.value)}>
                  <option value="">Seleccionar...</option>
                  {targetSheet && targetMetadata?.sheets[targetSheet]?.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div className="mt-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={mapping.is_key} onChange={e => updateMapping(idx, 'is_key', e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500" />
                  <span className="text-sm font-medium">Es Clave (SKU)</span>
                </label>
              </div>
            </div>
          ))}
        </div>
        <button onClick={addMapping} className="mt-4 text-blue-600 font-medium hover:underline">+ Añadir campo a actualizar</button>
      </div>
    </div>
  );
}
