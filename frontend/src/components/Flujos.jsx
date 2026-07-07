import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Settings2, Download, Link2, Power, Trash2, FileDown, Plus, CheckCircle2 } from 'lucide-react';
import { extractError } from '../utils/errors';

const API = import.meta.env.VITE_API_URL || '';

export default function Flujos() {
  const [loading, setLoading] = useState(true);
  const [processes, setProcesses] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [exports, setExports] = useState([]);
  const [connections, setConnections] = useState([]);
  const [testing, setTesting] = useState(null);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const projsRes = await fetch(`${API}/api/projects/`);
      const projs = await projsRes.json();
      const pid = projs[0]?.id;

      const [procsRes, connsRes, subsRes, expRes] = await Promise.all([
        fetch(`${API}/api/processes/`),
        fetch(`${API}/api/connections/`),
        pid ? fetch(`${API}/api/subscriptions/?project_id=${pid}`) : Promise.resolve(null),
        pid ? fetch(`${API}/api/exports/?project_id=${pid}`) : Promise.resolve(null),
      ]);
      setProcesses(await procsRes.json());
      setConnections(await connsRes.json());
      setSubscriptions(subsRes ? await subsRes.json() : []);
      setExports(expRes ? await expRes.json() : []);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const connName = (id) => connections.find(c => c.id === id)?.name || `Conexión ${id}`;

  // --- Fuentes (Procesos) ---
  const toggleProcess = async (proc) => {
    const res = await fetch(`${API}/api/processes/${proc.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...proc, is_active: !proc.is_active })
    });
    if (res.ok) loadAll();
    else alert(await extractError(res));
  };

  const deleteProcess = async (id) => {
    if (!window.confirm('¿Eliminar esta fuente?')) return;
    const res = await fetch(`${API}/api/processes/${id}`, { method: 'DELETE' });
    if (res.ok) loadAll();
    else alert(await extractError(res));
  };

  // --- Destinos (Suscripciones) ---
  const toggleSub = async (sub) => {
    const res = await fetch(`${API}/api/subscriptions/${sub.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sub, is_active: !sub.is_active })
    });
    if (res.ok) loadAll();
    else alert(await extractError(res));
  };

  const deleteSub = async (id) => {
    if (!window.confirm('¿Eliminar este destino?')) return;
    await fetch(`${API}/api/subscriptions/${id}`, { method: 'DELETE' });
    loadAll();
  };

  const deleteExport = async (id) => {
    if (!window.confirm('¿Eliminar esta exportación CSV?')) return;
    await fetch(`${API}/api/exports/${id}`, { method: 'DELETE' });
    loadAll();
  };

  // --- Conexiones (limpieza) ---
  const deleteConnection = async (id) => {
    if (!window.confirm('¿Eliminar esta conexión?')) return;
    const res = await fetch(`${API}/api/connections/${id}`, { method: 'DELETE' });
    if (res.ok) loadAll();
    else alert(await extractError(res));
  };

  const testConnection = async (id) => {
    setTesting(id);
    try {
      const res = await fetch(`${API}/api/connections/${id}/test`, { method: 'POST' });
      const data = await res.json();
      alert(data.success ? `✅ ${data.message}` : `❌ ${data.message}`);
    } catch (err) {
      alert('❌ Error probando la conexión.');
    }
    setTesting(null);
  };

  const kindLabel = (type) => ({
    google_sheets: 'Google Sheet', local_file: 'Archivo subido', http_api: 'API externa', shopify: 'Shopify'
  }[type] || type);

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando...</div>;

  const nothing = processes.length === 0 && subscriptions.length === 0 && exports.length === 0 && connections.length === 0;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Mis Flujos</h1>
          <p className="text-gray-500 text-sm mt-1">Todo lo que ya conectaste: fuentes, destinos y conexiones. Pausá o borrá lo que no uses.</p>
        </div>
        <Link to="/nueva-fuente"
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl font-medium hover:bg-indigo-700 transition text-sm">
          <Plus className="w-4 h-4" /> Nueva Fuente
        </Link>
      </div>

      {nothing && (
        <div className="text-center py-16 text-gray-400">
          <CheckCircle2 className="w-14 h-14 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium mb-1">Todavía no hay nada configurado</p>
          <p className="text-sm">Arrancá desde "+ Nueva Fuente".</p>
        </div>
      )}

      {processes.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
            <Settings2 className="w-4 h-4" /> Fuentes ({processes.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {processes.map(proc => (
              <div key={proc.id} className={`bg-white rounded-xl shadow-sm border p-4 ${!proc.is_active ? 'opacity-60 grayscale' : 'border-gray-200'}`}>
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-semibold text-gray-800">{proc.name}</h3>
                  <div className="flex gap-1">
                    <button onClick={() => toggleProcess(proc)} title={proc.is_active ? 'Pausar' : 'Activar'}
                      className={`p-1.5 rounded-lg transition ${proc.is_active ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}>
                      <Power className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteProcess(proc.id)} className="text-red-400 hover:bg-red-50 p-1.5 rounded-lg">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-500">{connName(proc.source_connection_id)} / "{proc.source_sheet_name}"</p>
                <p className="text-xs text-gray-400 mt-1">Llave: {proc.sku_column_source} ↔ {proc.sku_column_master} · {Object.keys(proc.field_mappings || {}).length} campo(s)</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {(subscriptions.length > 0 || exports.length > 0) && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
            <Download className="w-4 h-4" /> Destinos ({subscriptions.length + exports.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {subscriptions.map(sub => (
              <div key={`sub-${sub.id}`} className={`bg-white rounded-xl shadow-sm border p-4 ${!sub.is_active ? 'opacity-60 grayscale' : 'border-gray-200'}`}>
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-semibold text-gray-800">{sub.name}</h3>
                  <div className="flex gap-1">
                    <button onClick={() => toggleSub(sub)} title={sub.is_active ? 'Pausar' : 'Activar'}
                      className={`p-1.5 rounded-lg transition ${sub.is_active ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}>
                      <Power className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteSub(sub.id)} className="text-red-400 hover:bg-red-50 p-1.5 rounded-lg">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-500">Google Sheet · {connName(sub.target_connection_id)} / "{sub.target_sheet_name}"</p>
                <p className="text-xs text-gray-400 mt-1">{Object.keys(sub.field_mappings || {}).length} campo(s)</p>
              </div>
            ))}
            {exports.map(exp => (
              <div key={`exp-${exp.id}`} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-semibold text-gray-800">{exp.name}</h3>
                  <div className="flex gap-1">
                    <a href={`${API}/api/exports/${exp.id}/download`} title="Descargar CSV"
                      className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 transition">
                      <FileDown className="w-4 h-4" />
                    </a>
                    <button onClick={() => deleteExport(exp.id)} className="text-red-400 hover:bg-red-50 p-1.5 rounded-lg">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-500">Descarga CSV</p>
                <p className="text-xs text-gray-400 mt-1">{Object.keys(exp.columns_mapping || {}).length} campo(s)</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {connections.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
            <Link2 className="w-4 h-4" /> Conexiones ({connections.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {connections.map(conn => (
              <div key={conn.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-start justify-between">
                <div className="min-w-0">
                  <h3 className="font-semibold text-gray-800 truncate">{conn.name}</h3>
                  <p className="text-xs text-gray-500">{kindLabel(conn.connection_type)}</p>
                  {(conn.connection_type === 'shopify' || conn.connection_type === 'http_api') && (
                    <button onClick={() => testConnection(conn.id)} disabled={testing === conn.id}
                      className="mt-2 text-xs px-2.5 py-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                      {testing === conn.id ? 'Probando...' : 'Probar conexión'}
                    </button>
                  )}
                </div>
                <button onClick={() => deleteConnection(conn.id)} className="text-red-400 hover:bg-red-50 p-1.5 rounded-lg shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
