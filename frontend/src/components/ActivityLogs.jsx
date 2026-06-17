import { useState, useEffect } from 'react';
import { Terminal, CheckCircle2, XCircle, Clock, Search, AlertTriangle, Info } from 'lucide-react';

export default function ActivityLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState(null);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/logs/');
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status) => {
    switch(status) {
      case 'success': return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'error': return <XCircle className="w-5 h-5 text-red-500" />;
      case 'warning': return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case 'info': return <Info className="w-5 h-5 text-blue-500" />;
      default: return <Clock className="w-5 h-5 text-gray-500" />;
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold text-gray-800 flex items-center gap-3">
            <Terminal className="w-8 h-8 text-indigo-600" />
            Registro de Actividad
          </h2>
          <p className="text-gray-500 mt-2">Monitorea el estado de los procesos y detecta errores rápidamente.</p>
        </div>
        <button 
          onClick={fetchLogs}
          className="px-4 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-sm font-medium flex items-center gap-2"
        >
          <Clock className="w-4 h-4" />
          Actualizar
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-sm font-semibold text-gray-600">
                <th className="p-4">Estado</th>
                <th className="p-4">Evento</th>
                <th className="p-4">Mensaje</th>
                <th className="p-4">Filas</th>
                <th className="p-4">Fecha</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {loading ? (
                <tr><td colSpan="6" className="text-center p-8 text-gray-500">Cargando logs...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan="6" className="text-center p-8 text-gray-500">No hay registros de actividad aún.</td></tr>
              ) : (
                logs.map(log => (
                  <tr key={log.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="p-4">{getStatusIcon(log.status)}</td>
                    <td className="p-4">
                      <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-mono">
                        {log.event_type}
                      </span>
                    </td>
                    <td className="p-4 max-w-md truncate text-gray-700 font-medium">
                      {log.message}
                    </td>
                    <td className="p-4 text-gray-500">{log.rows_affected}</td>
                    <td className="p-4 text-gray-500">{new Date(log.created_at).toLocaleString()}</td>
                    <td className="p-4">
                      {log.technical_detail && (
                        <button 
                          onClick={() => setSelectedLog(log)}
                          className="text-indigo-600 hover:text-indigo-800 text-xs font-medium"
                        >
                          Ver detalle
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Detalles */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-gray-200 flex justify-between items-start">
              <div>
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  {getStatusIcon(selectedLog.status)}
                  Detalle del Evento
                </h3>
                <p className="text-sm text-gray-500 mt-1">{new Date(selectedLog.created_at).toLocaleString()}</p>
              </div>
              <button onClick={() => setSelectedLog(null)} className="text-gray-400 hover:text-gray-600">
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto bg-gray-50 flex-1">
              <div className="mb-6">
                <h4 className="text-sm font-semibold text-gray-600 mb-2 uppercase tracking-wider">Mensaje</h4>
                <p className="text-gray-800 font-medium bg-white p-3 rounded-lg border border-gray-200">
                  {selectedLog.message}
                </p>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-gray-600 mb-2 uppercase tracking-wider">Detalle Técnico</h4>
                <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-xs whitespace-pre-wrap break-all font-mono">
                  {selectedLog.technical_detail}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
