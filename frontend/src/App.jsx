import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Connections from './components/Connections';
import Projects from './components/Projects';
import Builder from './components/Builder';
import PreviewSync from './components/PreviewSync';
import Exports from './components/Exports';
import MasterTable from './components/MasterTable';
import { Database, Link2, LayoutDashboard, History, Download, Table2 } from 'lucide-react';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50 flex">
        {/* Sidebar */}
        <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <h1 className="text-xl font-bold text-blue-600 flex items-center gap-2">
              <Database className="w-6 h-6" />
              Tablas K
            </h1>
          </div>
          <nav className="flex-1 p-4 space-y-2">
            <Link to="/projects" className="flex items-center gap-2 p-2 text-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-lg">
              <LayoutDashboard className="w-5 h-5" />
              Mis Proyectos
            </Link>
            <Link to="/connections" className="flex items-center gap-2 p-2 text-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-lg">
              <Link2 className="w-5 h-5" />
              Conexiones
            </Link>
            <Link to="/history" className="flex items-center gap-2 p-2 text-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-lg">
              <History className="w-5 h-5" />
              Historial
            </Link>
            <Link to="/exports" className="flex items-center gap-2 p-2 text-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-lg">
              <Download className="w-5 h-5" />
              Formatos de Salida
            </Link>
            <div className="border-t border-gray-100 my-2"></div>
            <p className="text-xs text-gray-400 uppercase tracking-wider px-2 mb-1">Base de datos</p>
            <Link to="/master/1" className="flex items-center gap-2 p-2 text-gray-700 hover:bg-purple-50 hover:text-purple-600 rounded-lg">
              <Table2 className="w-5 h-5" />
              Tabla Maestra
            </Link>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Projects />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/connections" element={<Connections />} />
            <Route path="/builder/:id" element={<Builder />} />
            <Route path="/preview/:id" element={<PreviewSync />} />
            <Route path="/exports" element={<Exports />} />
            <Route path="/master/:projectId" element={<MasterTable />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
