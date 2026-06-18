import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import Connections from './components/Connections';
import Processes from './components/Processes';
import Exports from './components/Exports';
import MasterTable from './components/MasterTable';
import ActivityLogs from './components/ActivityLogs';
import StagingQueue from './components/StagingQueue';
import ConnectedApps from './components/ConnectedApps';
import { Database, Link2, Settings2, Download, Table2, Terminal, ShieldAlert, Network, MoreHorizontal, ChevronDown, ChevronUp } from 'lucide-react';

function Sidebar() {
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (path) => location.pathname === path;
  const linkClass = (path, hoverColor = 'hover:bg-indigo-50 hover:text-indigo-600') =>
    `flex items-center gap-2 p-2 rounded-lg text-sm font-medium transition ${
      isActive(path) ? 'bg-indigo-50 text-indigo-600' : `text-gray-700 ${hoverColor}`
    }`;

  const moreActive = ['/staging', '/logs', '/intake'].includes(location.pathname);

  return (
    <aside className="w-60 bg-indigo-700 border-r border-indigo-800 flex flex-col flex-shrink-0">
      <div className="p-4 border-b border-indigo-600">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Database className="w-6 h-6" />
          Tablas K
        </h1>
        <p className="text-xs text-indigo-300 mt-1">⚡ PREVIEW — Sincronización de datos</p>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        <Link to="/" className={linkClass('/', 'hover:bg-purple-50 hover:text-purple-600')}>
          <Table2 className="w-5 h-5" /> Tabla Maestra
        </Link>

        <div className="border-t border-gray-100 my-2"></div>

        <Link to="/connections" className={linkClass('/connections')}>
          <Link2 className="w-5 h-5" /> Conexiones
        </Link>
        <Link to="/processes" className={linkClass('/processes')}>
          <Settings2 className="w-5 h-5" /> Procesos
        </Link>
        <Link to="/exports" className={linkClass('/exports')}>
          <Download className="w-5 h-5" /> Distribución
        </Link>

        <div className="border-t border-gray-100 my-2"></div>

        <button onClick={() => setMoreOpen(!moreOpen)}
          className={`w-full flex items-center gap-2 p-2 rounded-lg text-sm font-medium transition ${
            moreActive ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}>
          <MoreHorizontal className="w-5 h-5" />
          Más
          {moreOpen ? <ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
        </button>

        {moreOpen && (
          <div className="pl-4 space-y-1">
            <Link to="/staging" className={linkClass('/staging', 'hover:bg-yellow-50 hover:text-yellow-600')}>
              <ShieldAlert className="w-4 h-4" /> Staging
            </Link>
            <Link to="/logs" className={linkClass('/logs')}>
              <Terminal className="w-4 h-4" /> Logs
            </Link>
            <Link to="/intake" className={linkClass('/intake', 'hover:bg-pink-50 hover:text-pink-600')}>
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
            <Route path="/processes" element={<Processes />} />
            <Route path="/staging" element={<StagingQueue />} />
            <Route path="/connections" element={<Connections />} />
            <Route path="/intake" element={<ConnectedApps />} />
            <Route path="/exports" element={<Exports />} />
            <Route path="/logs" element={<ActivityLogs />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
