import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Connections from './components/Connections';
import Processes from './components/Processes';
import Exports from './components/Exports';
import MasterTable from './components/MasterTable';
import ActivityLogs from './components/ActivityLogs';
import StagingQueue from './components/StagingQueue';
import ConnectedApps from './components/ConnectedApps';
import { Database, Link2, Settings2, Download, Table2, Terminal, ShieldAlert, Network } from 'lucide-react';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50 flex">
        {/* Sidebar */}
        <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <h1 className="text-xl font-bold text-indigo-600 flex items-center gap-2">
              <Database className="w-6 h-6" />
              Tablas K
            </h1>
          </div>
          <nav className="flex-1 p-4 space-y-2">
            <Link to="/" className="flex items-center gap-2 p-2 text-gray-700 hover:bg-purple-50 hover:text-purple-600 rounded-lg font-medium">
              <Table2 className="w-5 h-5" />
              Tabla Maestra
            </Link>
            <div className="border-t border-gray-100 my-2"></div>
            <p className="text-xs text-gray-400 uppercase tracking-wider px-2 mb-1 mt-2">Flujo de datos</p>
            <Link to="/processes" className="flex items-center gap-2 p-2 text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 rounded-lg">
              <Settings2 className="w-5 h-5" />
              1. Importar (Procesos)
            </Link>
            <Link to="/staging" className="flex items-center gap-2 p-2 text-gray-700 hover:bg-yellow-50 hover:text-yellow-600 rounded-lg">
              <ShieldAlert className="w-5 h-5" />
              2. Staging (Aprobación)
            </Link>
            <Link to="/exports" className="flex items-center gap-2 p-2 text-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-lg">
              <Download className="w-5 h-5" />
              3. Distribuir (Salidas)
            </Link>
            <div className="border-t border-gray-100 my-2"></div>
            <Link to="/connections" className="flex items-center gap-2 p-2 text-gray-700 hover:bg-gray-100 rounded-lg mt-2">
              <Link2 className="w-5 h-5" />
              Fuentes Externas
            </Link>
            <Link to="/intake" className="flex items-center gap-2 p-2 text-gray-700 hover:bg-pink-50 hover:text-pink-600 rounded-lg">
              <Network className="w-5 h-5" />
              Ingesta API (Webhooks)
            </Link>
            <Link to="/logs" className="flex items-center gap-2 p-2 text-gray-700 hover:bg-gray-100 rounded-lg">
              <Terminal className="w-5 h-5" />
              Logs de Actividad
            </Link>
          </nav>
        </aside>

        {/* Main Content */}
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
