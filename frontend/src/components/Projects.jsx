import { useState, useEffect } from 'react';
import { LayoutDashboard, Plus, FolderSync, ArrowRight, RefreshCw, CheckCircle2, AlertCircle, XCircle, FileDown, Send } from 'lucide-react';
import { Link } from 'react-router-dom';

const API = import.meta.env.VITE_API_URL || '';

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [connections, setConnections] = useState([]);
  const [name, setName] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const [runAllStatus, setRunAllStatus] = useState({}); // { [proj.id]: { loading, results, errors } }

  useEffect(() => {
    fetch(`${API}/api/projects/`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setProjects(data);
        else console.error("Error from API:", data);
      })
      .catch(err => console.error("Error fetching projects", err));
    fetch(`${API}/api/connections/`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setConnections(data);
      })
      .catch(console.error);
  }, []);

  const connName = (id) => connections.find(c => c.id === id)?.name || `Conexión ${id}`;

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name || !connectionId) return;
    const res = await fetch(`${API}/api/projects/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, connection_id: parseInt(connectionId) })
    });
    if (res.ok) {
      const newProj = await res.json();
      setProjects([...projects, newProj]);
      setName(''); setConnectionId('');
    }
  };

  const handleRunAll = async (proj) => {
    setRunAllStatus(s => ({ ...s, [proj.id]: { loading: true } }));
    try {
      const res = await fetch(`${API}/api/sync/run-all?project_id=${proj.id}`, { method: 'POST' });
      const data = await res.json();
      setRunAllStatus(s => ({
        ...s,
        [proj.id]: {
          loading: false,
          message: data.message,
          results: data.results || [],
          errors: data.errors || []
        }
      }));
    } catch (err) {
      setRunAllStatus(s => ({
        ...s,
        [proj.id]: { loading: false, message: 'Error al conectar con el servidor.', results: [], errors: [{ format: 'red', error: err.message }] }
      }));
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <LayoutDashboard className="w-6 h-6 text-blue-600" />
          Mis Proyectos
        </h1>
        <p className="text-gray-600">Agrupa tus configuraciones de actualización y ejecuta todo con un clic.</p>
      </div>

      {/* Formulario nuevo proyecto */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 mb-8">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Plus className="w-5 h-5 text-gray-500" />
          Nuevo Proyecto
        </h2>
        <form onSubmit={handleCreate} className="flex gap-4 items-end">
          <div className="flex-[2]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del proyecto</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Ej: Actualizar inventario mayo"
              className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Conexión principal</label>
            <select value={connectionId} onChange={e => setConnectionId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none">
              <option value="">Selecciona una...</option>
              {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 transition">
            Crear
          </button>
        </form>
      </div>

      {/* Lista de proyectos */}
      <div className="grid grid-cols-1 gap-5">
        {projects.map(proj => {
          const st = runAllStatus[proj.id];
          return (
            <div key={proj.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              {/* Header del proyecto */}
              <div className="p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                    <FolderSync className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg text-gray-800">{proj.name}</h3>
                    <p className="text-sm text-gray-500">Tabla Master: {connName(proj.connection_id)}</p>
                  </div>
                </div>

                {/* Botones de acción */}
                <div className="flex gap-2">
                  <Link to={`/builder/${proj.id}`}
                    className="flex items-center gap-2 text-gray-600 border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50 transition text-sm font-medium">
                    Configurar
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                  <button
                    onClick={() => handleRunAll(proj)}
                    disabled={st?.loading}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition
                      ${st?.loading ? 'bg-gray-100 text-gray-400 cursor-wait' : 'bg-green-600 text-white hover:bg-green-700'}`}>
                    <RefreshCw className={`w-4 h-4 ${st?.loading ? 'animate-spin' : ''}`} />
                    {st?.loading ? 'Actualizando...' : '⚡ Actualizar Todo'}
                  </button>
                </div>
              </div>

              {/* Panel de resultados del run-all */}
              {st && !st.loading && (
                <div className="border-t border-gray-100 bg-gray-50 p-4">
                  <p className="text-sm font-medium text-gray-700 mb-3">{st.message}</p>
                  
                  {/* Resultados exitosos */}
                  {st.results?.length > 0 && (
                    <div className="space-y-2 mb-2">
                      {st.results.map((r, i) => (
                        <div key={i} className="flex items-center gap-2 bg-white rounded-lg border border-green-100 p-2.5">
                          {r.type === 'google_sheets'
                            ? <Send className="w-4 h-4 text-orange-500 flex-shrink-0" />
                            : <FileDown className="w-4 h-4 text-green-600 flex-shrink-0" />}
                          <span className="text-sm font-medium text-gray-700 flex-1">{r.format}</span>
                          {r.type === 'google_sheets' ? (
                            <span className="text-xs text-green-600 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> {r.rows_written} filas escritas en Sheet
                            </span>
                          ) : (
                            <a href={`${API}${r.download_url}`} target="_blank" rel="noreferrer"
                              className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                              <FileDown className="w-3 h-3" /> Descargar CSV ({r.rows_ready} filas)
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Errores */}
                  {st.errors?.length > 0 && (
                    <div className="space-y-2">
                      {st.errors.map((e, i) => (
                        <div key={i} className="flex items-start gap-2 bg-red-50 rounded-lg border border-red-100 p-2.5">
                          <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                          <div>
                            <span className="text-sm font-medium text-red-700">{e.format}</span>
                            <p className="text-xs text-red-500">{e.error}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
