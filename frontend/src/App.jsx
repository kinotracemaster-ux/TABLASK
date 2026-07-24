import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import MasterTable from './components/MasterTable';
import ActivityLogs from './components/ActivityLogs';
import ConnectedApps from './components/ConnectedApps';
import SourceWizard from './components/SourceWizard';
import Flujos from './components/Flujos';
import ShopifyMasterSync from './components/ShopifyMasterSync';
import NewRecordsTray from './components/NewRecordsTray';
import { Database, Table2, Terminal, Network, MoreHorizontal, ChevronDown, ChevronUp, Sparkles, ListChecks, Store, Inbox } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';

// Detecta si estamos en un entorno de PREVIEW (no producción).
// Railway nombra los previews como "...-pr-<n>.up.railway.app".
const IS_PREVIEW = typeof window !== 'undefined' && /-pr-\d+\./.test(window.location.hostname);

function Sidebar() {
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [trayCount, setTrayCount] = useState(0);

  // Badge de la Bandeja de Nuevos: sondea el conteo de pendientes. Se refresca al
  // cambiar de ruta (tras aprobar/rechazar) y cada 60s por si entran automáticos.
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`${API}/api/tray/count`)
      .then(r => r.ok ? r.json() : { pending_count: 0 })
      .then(d => { if (alive) setTrayCount(d.pending_count || 0); })
      .catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [location.pathname]);

  const isActive = (path) => location.pathname === path;

  // En producción: sidebar blanco. En preview: sidebar morado (legible) para diferenciar.
  const linkClass = (path) =>
    `flex items-center gap-2 p-2 rounded-lg text-sm font-medium transition ${
      isActive(path)
        ? (IS_PREVIEW ? 'bg-white/15 text-white' : 'bg-indigo-50 text-indigo-600')
        : (IS_PREVIEW ? 'text-indigo-100 hover:bg-white/10 hover:text-white' : 'text-gray-700 hover:bg-indigo-50 hover:text-indigo-600')
    }`;

  const moreActive = ['/logs', '/intake'].includes(location.pathname);

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
        <Link to="/nueva-fuente"
          className="flex items-center gap-2 p-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition mb-1">
          <Sparkles className="w-5 h-5" /> + Nueva Fuente
        </Link>

        <Link to="/" className={linkClass('/')}>
          <Table2 className="w-5 h-5" /> Tabla Maestra
        </Link>
        <Link to="/flujos" className={linkClass('/flujos')}>
          <ListChecks className="w-5 h-5" /> Mis Flujos
        </Link>
        <Link to="/bandeja" className={linkClass('/bandeja')}>
          <Inbox className="w-5 h-5" /> Bandeja de Nuevos
          {trayCount > 0 && (
            <span className="ml-auto text-[11px] font-bold bg-amber-400 text-amber-900 px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
              {trayCount}
            </span>
          )}
        </Link>
        <Link to="/shopify-sync" className={linkClass('/shopify-sync')}>
          <Store className="w-5 h-5" /> Shopify → Maestra
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
            <Link to="/logs" className={linkClass('/logs')}>
              <Terminal className="w-4 h-4" /> Logs
            </Link>
            <Link to="/intake" className={linkClass('/intake')}>
              <Network className="w-4 h-4" /> Webhooks
            </Link>
          </div>
        )}
      </nav>
    </aside>
  );
}

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50 flex">
        <Sidebar />
        <main className="flex-1 overflow-auto bg-gray-50/50">
          <Routes>
            <Route path="/" element={<MasterTable />} />
            <Route path="/nueva-fuente" element={<SourceWizard />} />
            <Route path="/flujos" element={<Flujos />} />
            <Route path="/bandeja" element={<NewRecordsTray />} />
            <Route path="/shopify-sync" element={<ShopifyMasterSync />} />
            <Route path="/intake" element={<ConnectedApps />} />
            <Route path="/logs" element={<ActivityLogs />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
