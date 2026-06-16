import React, { useState, useEffect } from 'react';
import { Network, Key, Trash2, Plus, AlertCircle, Copy, Check } from 'lucide-react';
import { apiCall } from '../utils/api';

export default function ConnectedApps() {
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newAppName, setNewAppName] = useState("");
  const [copiedKey, setCopiedKey] = useState(null);

  useEffect(() => {
    fetchApps();
  }, []);

  const fetchApps = async () => {
    try {
      const data = await apiCall('/api/intake/apps');
      setApps(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateApp = async (e) => {
    e.preventDefault();
    try {
      const newApp = await apiCall('/api/intake/apps', {
        method: 'POST',
        body: JSON.stringify({ name: newAppName })
      });
      setApps([...apps, newApp]);
      setIsModalOpen(false);
      setNewAppName("");
    } catch (err) {
      alert("Error al crear app: " + err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("¿Seguro que quieres eliminar esta App? Perderá acceso inmediatamente.")) return;
    try {
      await apiCall(`/api/intake/apps/${id}`, { method: 'DELETE' });
      setApps(apps.filter(a => a.id !== id));
    } catch (err) {
      alert("Error eliminando: " + err.message);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(text);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando...</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Network className="w-6 h-6 text-indigo-600" />
            Apps Conectadas (Webhooks)
          </h1>
          <p className="text-gray-500 mt-1 text-sm">Gestiona aplicaciones externas (Shopify, ERPs) que inyectan datos vía API.</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 flex items-center gap-2 shadow-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Nueva App
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md flex items-start gap-3 mb-6">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Instrucciones */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-8 shadow-sm">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2 mb-3">
          <AlertCircle className="w-4 h-4 text-indigo-500" />
          ¿Cómo funciona la integración?
        </h3>
        <p className="text-gray-600 text-sm mb-3">
          Envía una petición POST con tu payload JSON a:
        </p>
        <code className="bg-gray-100 px-3 py-2 rounded text-sm text-pink-600 border border-gray-200 block mb-3">
          POST {window.location.origin}/api/intake/push
        </code>
        <p className="text-gray-600 text-sm">
          Debes incluir tu API Key en los headers: <code className="bg-gray-100 px-1 py-0.5 rounded text-indigo-600">X-API-Key: tu_api_key_aqui</code>
        </p>
      </div>

      <div className="space-y-4">
        {apps.map((app) => (
          <div key={app.id} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  {app.name}
                  {app.is_active ? 
                    <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-semibold rounded-full">Activa</span> :
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-semibold rounded-full">Inactiva</span>
                  }
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  Creada el {new Date(app.created_at).toLocaleDateString()}
                </p>
              </div>
              <button 
                onClick={() => handleDelete(app.id)}
                className="text-gray-400 hover:text-red-600 p-2 rounded-full hover:bg-red-50 transition-colors"
                title="Eliminar app"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            
            <div className="mt-4 pt-4 border-t border-gray-100">
              <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
                <Key className="w-3 h-3" /> API Key
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 font-mono break-all">
                  {app.api_key}
                </code>
                <button
                  onClick={() => copyToClipboard(app.api_key)}
                  className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors"
                  title="Copiar al portapapeles"
                >
                  {copiedKey === app.api_key ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        ))}
        {apps.length === 0 && !loading && (
          <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300">
            <Network className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No hay aplicaciones conectadas</p>
            <p className="text-gray-400 text-sm mt-1">Crea una app para generar un API Key y recibir webhooks.</p>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h2 className="text-lg font-bold text-gray-800">Nueva App</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600">&times;</button>
            </div>
            <form onSubmit={handleCreateApp} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de la App</label>
                <input
                  type="text"
                  required
                  value={newAppName}
                  onChange={e => setNewAppName(e.target.value)}
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="ej. Shopify Tienda Principal"
                />
              </div>
              <div className="flex gap-3 justify-end pt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium">
                  Cancelar
                </button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium shadow-sm">
                  Crear y Generar Token
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
