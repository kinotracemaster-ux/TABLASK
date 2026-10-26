import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import MasterTable from './components/MasterTable';
import ActivityLogs from './components/ActivityLogs';
import ConnectedApps from './components/ConnectedApps';
import UpdateMaster from './components/UpdateMaster';
import Flujos from './components/Flujos';
import ShopifyMasterSync from './components/ShopifyMasterSync';
import LoginGate from './components/LoginGate';
import Actualizar from './components/Actualizar';
import ActualizarConfig from './components/ActualizarConfig';
import { Database, Table2, Terminal, Network, MoreHorizontal, ChevronDown, ChevronUp, RefreshCw, ListChecks, Store, Upload, ArrowLeft } from 'lucide-react';

// Detecta si estamos en un entorno de PREVIEW (no producción).
// Railway nombra los previews como "...-pr-<n>.up.railway.app".
const IS_PREVIEW = typeof window !== 'undefined' && /-pr-\d+\./.test(window.location.hostname);

function Sidebar() {
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (path) => location.pathname === path;

  // En producción: sidebar blanco. En preview: sidebar morado (legible) para diferenciar.
  const linkClass = (path) =>
    `flex items-center gap-2 p-2 rounded-lg text-sm font-medium transition ${
      isActive(path)
        ? (IS_PREVIEW ? 'bg-white/15 text-white' : 'bg-indigo-50 text-indigo-600')
        : (IS_PREVIEW ? 'text-indigo-100 hover:bg-white/10 hover:text-white' : 'text-gray-700 hover:bg-indigo-50 hover:text-indigo-600')
    }`;

  const moreActive = ['/admin/logs', '/admin/intake'].includes(location.pathname);

  return (
    <aside className={`w-60 flex flex-col flex-shrink-0 ${IS_PREVIEW ? 'bg-indigo-700' : 'bg-white border-r border-gray-200'}`}>
      <div className={`p-4 border-b ${IS_PREVIEW ? 'border-indigo-600' : 'border-gray-200'}`}>
        <h1 className={`text-xl font-bold flex items-center gap-2 ${IS_PREVIEW ? 'text-white' : 'text-indigo-600'}`}>
          <Database className="w-6 h-6" />
          Tablas K
        </h1>
        {IS_PREVIEW && (
          <span className="inline-block mt-2 text-[10px] font-bold tracking-wide bg-yellow-300 text-indigo-900 px-2 py-0.5 rounded">
            ⚡ PREVIEW
          </span>
        )}
      </div>
      <nav className="flex-1 p-3 space-y-1">
        <Link to="/" className={`flex items-center gap-2 p-2 mb-2 rounded-lg text-xs font-medium ${IS_PREVIEW ? 'text-indigo-100 hover:text-white' : 'text-gray-500 hover:text-indigo-600'}`}>
          <ArrowLeft className="w-4 h-4" /> Volver a Actualizar
        </Link>
        <Link to="/admin/nueva-fuente"
          className="flex items-center gap-2 p-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition mb-1">
          <RefreshCw className="w-5 h-5" /> Actualizar Maestra
        </Link>

        <Link to="/admin" className={linkClass('/admin')}>
          <Table2 className="w-5 h-5" /> Tabla Maestra
        </Link>
        <Link to="/admin/flujos" className={linkClass('/admin/flujos')}>
          <ListChecks className="w-5 h-5" /> Mis Flujos
        </Link>
        <Link to="/admin/shopify-sync" className={linkClass('/admin/shopify-sync')}>
          <Store className="w-5 h-5" /> Shopify → Maestra
        </Link>
        <Link to="/admin/actualizar" className={linkClass('/admin/actualizar')}>
          <Upload className="w-5 h-5" /> Pantalla Actualizar
        </Link>

        <div className={`border-t my-2 ${IS_PREVIEW ? 'border-indigo-600' : 'border-gray-100'}`}></div>

        <button onClick={() => setMoreOpen(!moreOpen)}
          className={`w-full flex items-center gap-2 p-2 rounded-lg text-sm font-medium transition ${
            IS_PREVIEW
              ? (moreActive ? 'text-white bg-white/10' : 'text-indigo-200 hover:text-white hover:bg-white/10')
              : (moreActive ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50')
          }`}>
          <MoreHorizontal className="w-5 h-5" />
          Avanzado
          {moreOpen ? <ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
        </button>

        {moreOpen && (
          <div className="pl-4 space-y-1">
            <Link to="/admin/logs" className={linkClass('/admin/logs')}>
              <Terminal className="w-4 h-4" /> Logs
            </Link>
            <Link to="/admin/intake" className={linkClass('/admin/intake')}>
              <Network className="w-4 h-4" /> Webhooks
            </Link>
          </div>
        )}
      </nav>
    </aside>
  );
}

/** Administración: todo lo que no es "subir el archivo y aprobar". */
function Admin() {
  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-gray-50/50">
        <Routes>
          <Route index element={<MasterTable />} />
          <Route path="nueva-fuente" element={<UpdateMaster />} />
          <Route path="flujos" element={<Flujos />} />
          <Route path="shopify-sync" element={<ShopifyMasterSync />} />
          <Route path="actualizar" element={<ActualizarConfig />} />
          <Route path="intake" element={<ConnectedApps />} />
          <Route path="logs" element={<ActivityLogs />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <LoginGate>
    <Router>
      <Routes>
        <Route path="/" element={<Actualizar />} />
        <Route path="/admin/*" element={<Admin />} />
        {/* Links viejos (marcadores) siguen funcionando. */}
        <Route path="/nueva-fuente" element={<Navigate to="/admin/nueva-fuente" replace />} />
        <Route path="/flujos" element={<Navigate to="/admin/flujos" replace />} />
        <Route path="/shopify-sync" element={<Navigate to="/admin/shopify-sync" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
    </LoginGate>
  );
}

export default App;
