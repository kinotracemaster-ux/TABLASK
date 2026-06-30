import { useState, useEffect } from 'react';
import { Link2, Plus, Server, CheckCircle2 } from 'lucide-react';
import { extractError } from '../utils/errors';

const API = import.meta.env.VITE_API_URL || '';
export default function Connections() {
  const [connections, setConnections] = useState([]);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');

  const [type, setType] = useState('google_sheets'); // 'google_sheets' | 'local_file' | 'http_api'
  const [file, setFile] = useState(null);
  
  // HTTP state
  const [httpMethod, setHttpMethod] = useState('GET');
  const [httpHeaders, setHttpHeaders] = useState('{\n  "Authorization": "Bearer TOKEN"\n}');

  // Shopify state
  const [shopDomain, setShopDomain] = useState('');
  const [shopClientId, setShopClientId] = useState('');
  const [shopClientSecret, setShopClientSecret] = useState('');
  const [testing, setTesting] = useState(null); // id de la conexión que se está probando

  // Fetch connections on load
  useEffect(() => {
    fetch(`${API}/api/connections/`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setConnections(data);
        else console.error("Fallo from API:", data);
      })
      .catch(err => console.error("Fallo fetching connections", err));
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if(!name) return;

    try {
      if (type === 'google_sheets') {
        if (!url) return;
        const res = await fetch(`${API}/api/connections/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, google_sheet_url: url })
        });
        if(res.ok) {
          const newConn = await res.json();
          setConnections([...connections, newConn]);
          setUrl('');
          setName('');
        } else {
          const errMsg = await extractError(res, 'Verifique la URL o el backend');
          alert(errMsg);
        }
      } else if (type === 'http_api') {
        if (!url) return;
        const res = await fetch(`${API}/api/connections/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            name, 
            connection_type: 'http_api',
            http_url: url,
            http_method: httpMethod,
            http_headers: httpHeaders
          })
        });
        if(res.ok) {
          const newConn = await res.json();
          setConnections([...connections, newConn]);
          setUrl('');
          setName('');
        } else {
          alert("Fallo al agregar conexión HTTP.");
        }
      } else if (type === 'shopify') {
        if (!shopDomain || !shopClientId || !shopClientSecret) {
          alert('Completa dominio, Client ID y Client Secret de Shopify.');
          return;
        }
        const res = await fetch(`${API}/api/connections/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            connection_type: 'shopify',
            shopify_domain: shopDomain,
            shopify_client_id: shopClientId,
            shopify_client_secret: shopClientSecret
          })
        });
        if (res.ok) {
          const newConn = await res.json();
          setConnections([...connections, newConn]);
          setShopDomain(''); setShopClientId(''); setShopClientSecret(''); setName('');
        } else {
          const errMsg = await extractError(res, 'Fallo al agregar la tienda Shopify.');
          alert(errMsg);
        }
      } else {
        if (!file) return;
        const formData = new FormData();
        formData.append('name', name);
        formData.append('file', file);
        
        const res = await fetch(`${API}/api/connections/upload`, {
          method: 'POST',
          body: formData
        });
        
        if(res.ok) {
          const newConn = await res.json();
          setConnections([...connections, newConn]);
          setFile(null);
          setName('');
        } else {
          alert("Fallo al subir archivo.");
        }
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleTest = async (connId) => {
    setTesting(connId);
    try {
      const res = await fetch(`${API}/api/connections/${connId}/test`, { method: 'POST' });
      const data = await res.json();
      alert(data.success ? `✅ ${data.message}` : `❌ ${data.message}`);
    } catch (err) {
      alert('❌ Error probando la conexión.');
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Link2 className="w-6 h-6 text-blue-600" />
          Mis Conexiones
        </h1>
        <p className="text-gray-600">Añade hojas de cálculo de Google o archivos locales (CSV/Excel).</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-8 overflow-hidden">
        <div className="flex border-b border-gray-200">
          <button 
            type="button"
            className={`flex-1 py-3 font-medium text-sm transition ${type === 'google_sheets' ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
            onClick={() => setType('google_sheets')}
          >
            Google Sheets (URL)
          </button>
          <button 
            type="button"
            className={`flex-1 py-3 font-medium text-sm transition ${type === 'local_file' ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
            onClick={() => setType('local_file')}
          >
            Subir Archivo (.csv, .xlsx)
          </button>
          <button
            type="button"
            className={`flex-1 py-3 font-medium text-sm transition ${type === 'http_api' ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
            onClick={() => setType('http_api')}
          >
            API Externa (HTTP)
          </button>
          <button
            type="button"
            className={`flex-1 py-3 font-medium text-sm transition ${type === 'shopify' ? 'bg-green-50 text-green-700 border-b-2 border-green-600' : 'text-gray-500 hover:bg-gray-50'}`}
            onClick={() => setType('shopify')}
          >
            Shopify
          </button>
        </div>
        
        <form onSubmit={handleAdd} className="p-6 flex gap-4 items-end">
          <div className="flex-[1]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre referencial</label>
            <input 
              type="text" 
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={type === 'google_sheets' ? "Ej: Base Maestra 2024" : "Ej: Base Local de Precios"} 
              className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" 
            />
          </div>
          
          <div className="flex-[2] flex flex-col gap-3">
            {type === 'google_sheets' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL de Google Sheets</label>
                <input 
                  type="url" 
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..." 
                  className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                />
              </div>
            )}
            
            {type === 'local_file' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Seleccionar Archivo</label>
                <input 
                  type="file" 
                  accept=".csv, .xls, .xlsx"
                  onChange={e => setFile(e.target.files[0])}
                  className="w-full border border-gray-300 rounded-lg p-1.5 focus:ring-2 focus:ring-blue-500 outline-none" 
                />
              </div>
            )}

            {type === 'http_api' && (
              <>
                <div className="flex gap-2">
                  <div className="w-24">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Método</label>
                    <select value={httpMethod} onChange={e => setHttpMethod(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none">
                      <option>GET</option>
                      <option>POST</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">URL Endpoint</label>
                    <input 
                      type="url" 
                      value={url}
                      onChange={e => setUrl(e.target.value)}
                      placeholder="https://api.proveedor.com/v1/productos" 
                      className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Headers (JSON Opcional)</label>
                  <textarea
                    value={httpHeaders}
                    onChange={e => setHttpHeaders(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg p-2 font-mono text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    rows="2"
                  ></textarea>
                </div>
              </>
            )}

            {type === 'shopify' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Dominio de la tienda</label>
                  <input
                    type="text"
                    value={shopDomain}
                    onChange={e => setShopDomain(e.target.value)}
                    placeholder="mi-tienda.myshopify.com"
                    className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-green-500 outline-none"
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
                    <input
                      type="text"
                      value={shopClientId}
                      onChange={e => setShopClientId(e.target.value)}
                      placeholder="Client ID de la app (Dev Dashboard)"
                      className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-green-500 outline-none"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Client Secret</label>
                    <input
                      type="password"
                      value={shopClientSecret}
                      onChange={e => setShopClientSecret(e.target.value)}
                      placeholder="Client Secret (no se mostrará luego)"
                      className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-green-500 outline-none"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  Usa el <b>client credentials grant</b> (tiendas propias). El token de 24h se obtiene automáticamente. El secret se guarda en el servidor y no se vuelve a mostrar.
                </p>
              </>
            )}
          </div>
          
          <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 transition h-[42px] self-end">
            {type === 'local_file' ? 'Subir' : 'Conectar'}
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {connections.map(conn => (
          <div key={conn.id} className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 flex items-start justify-between">
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-800">{conn.name}</h3>
              <p className="text-sm text-gray-500 truncate w-48" title={conn.connection_type === 'shopify' ? conn.shopify_domain : conn.google_sheet_url}>
                {conn.connection_type === 'shopify' ? conn.shopify_domain : conn.google_sheet_url}
              </p>
              {(conn.connection_type === 'shopify' || conn.connection_type === 'http_api') && (
                <button
                  type="button"
                  onClick={() => handleTest(conn.id)}
                  disabled={testing === conn.id}
                  className="mt-2 text-xs px-3 py-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  {testing === conn.id ? 'Probando…' : 'Probar conexión'}
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 text-green-600 text-sm font-medium shrink-0">
              <CheckCircle2 className="w-4 h-4" />
              {conn.connection_type === 'local_file' ? 'Archivo Local' :
               conn.connection_type === 'http_api' ? 'API Externa' :
               conn.connection_type === 'shopify' ? 'Shopify' : 'Conectado'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
