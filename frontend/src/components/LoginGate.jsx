import { useState, useEffect, useCallback } from 'react';
import { Database, Lock, AlertTriangle } from 'lucide-react';
import { getClave, setClave, borrarClave, instalarClaveEnFetch } from '../utils/auth';

const API = import.meta.env.VITE_API_URL || '';

/**
 * Pantalla de ingreso. Hasta que la clave no sea correcta, no se monta nada de
 * la app: así nadie con el link ve la Maestra ni puede disparar envíos a Shopify.
 */
export default function LoginGate({ children }) {
  const [estado, setEstado] = useState('verificando'); // verificando | ingresar | listo | sin-config
  const [clave, setClaveInput] = useState('');
  const [error, setError] = useState(null);
  const [detalle, setDetalle] = useState('');

  const verificar = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/auth/check`);
      if (res.ok) { setEstado('listo'); return true; }
      if (res.status === 503) {
        const d = await res.json().catch(() => ({}));
        setDetalle(d.detail || '');
        setEstado('sin-config');
        return false;
      }
      setEstado('ingresar');
      return false;
    } catch {
      setError('No se pudo conectar con el servidor.');
      setEstado('ingresar');
      return false;
    }
  }, []);

  useEffect(() => {
    instalarClaveEnFetch(() => { setEstado('ingresar'); setError('La sesión venció. Escribí la clave otra vez.'); });
    if (!getClave()) { setEstado('ingresar'); return; }
    verificar();
  }, [verificar]);

  const entrar = async (e) => {
    e.preventDefault();
    if (!clave.trim()) return;
    setError(null);
    setEstado('verificando');
    setClave(clave.trim());
    const ok = await verificar();
    if (!ok) {
      borrarClave();
      setError('Clave incorrecta.');
    }
    setClaveInput('');
  };

  if (estado === 'listo') return children;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <h1 className="text-xl font-bold text-indigo-600 flex items-center gap-2 mb-1">
          <Database className="w-6 h-6" /> Tablas K
        </h1>

        {estado === 'sin-config' ? (
          <div className="mt-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-500" />
            <div>
              <p className="font-semibold mb-1">Falta ponerle clave a la app</p>
              <p className="text-xs">{detalle}</p>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-5">Escribí la clave para entrar.</p>
            <form onSubmit={entrar} className="space-y-3">
              <div className="relative">
                <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="clave" type="password" autoFocus autoComplete="current-password"
                  value={clave} onChange={e => setClaveInput(e.target.value)}
                  placeholder="Clave" aria-label="Clave de acceso"
                  className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <button type="submit" disabled={estado === 'verificando' || !clave.trim()}
                className="w-full bg-indigo-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
                {estado === 'verificando' ? 'Verificando…' : 'Entrar'}
              </button>
            </form>
            {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
