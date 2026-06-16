import { useState, useEffect } from 'react';
import { Database, CheckCircle2, XCircle, AlertTriangle, Search, Filter } from 'lucide-react';

export default function StagingQueue() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPendingBatches();
  }, []);

  const fetchPendingBatches = async () => {
    try {
      const res = await fetch('/api/staging/pending');
      if (res.ok) {
        const data = await res.json();
        setBatches(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (batchId) => {
    try {
      const res = await fetch(`/api/staging/${batchId}/approve`, { method: 'POST' });
      if (res.ok) {
        setBatches(batches.filter(b => b.id !== batchId));
      } else {
        const err = await res.json();
        alert(`Error: ${err.detail}`);
      }
    } catch (e) {
      console.error(e);
      alert("Error al aprobar");
    }
  };

  const handleReject = async (batchId) => {
    try {
      const res = await fetch(`/api/staging/${batchId}/reject`, { method: 'POST' });
      if (res.ok) {
        setBatches(batches.filter(b => b.id !== batchId));
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold text-gray-800 flex items-center gap-3">
            <Database className="w-8 h-8 text-indigo-600" />
            Cola de Aprobación (Staging)
          </h2>
          <p className="text-gray-500 mt-2">Revisa y aprueba los datos antes de que entren a la Tabla Maestra.</p>
        </div>
        <button 
          onClick={fetchPendingBatches}
          className="px-4 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-sm font-medium"
        >
          Actualizar
        </button>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="text-center p-8 text-gray-500 bg-white rounded-xl shadow-sm border border-gray-200">
            Cargando lotes pendientes...
          </div>
        ) : batches.length === 0 ? (
          <div className="text-center p-12 text-gray-500 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col items-center">
            <CheckCircle2 className="w-12 h-12 text-green-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-800">Todo al día</h3>
            <p>No hay datos en cuarentena esperando revisión.</p>
          </div>
        ) : (
          batches.map(batch => {
            const diff = JSON.parse(batch.diff_result);
            return (
              <div key={batch.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-6 border-b border-gray-200 flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                      Lote #{batch.id} (Proceso {batch.process_id})
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Recibido: {new Date(batch.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleReject(batch.id)}
                      className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium border border-red-200 flex items-center gap-2"
                    >
                      <XCircle className="w-4 h-4" />
                      Rechazar
                    </button>
                    <button 
                      onClick={() => handleApprove(batch.id)}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium flex items-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Aprobar y Escribir
                    </button>
                  </div>
                </div>
                
                <div className="p-6 bg-gray-50 grid grid-cols-3 gap-6">
                  <div className="bg-white p-4 rounded-lg border border-gray-200 text-center">
                    <span className="block text-2xl font-bold text-blue-600">{diff.rows_to_update || 0}</span>
                    <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">Actualizaciones</span>
                  </div>
                  <div className="bg-white p-4 rounded-lg border border-gray-200 text-center">
                    <span className="block text-2xl font-bold text-green-600">{diff.rows_to_add || 0}</span>
                    <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">Nuevos</span>
                  </div>
                  <div className="bg-white p-4 rounded-lg border border-gray-200 text-center">
                    <span className="block text-2xl font-bold text-gray-400">{diff.rows_unchanged || 0}</span>
                    <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">Sin cambios</span>
                  </div>
                </div>
                
                {diff.warnings && diff.warnings.length > 0 && (
                  <div className="p-4 bg-yellow-50 border-t border-yellow-100">
                    <h4 className="text-sm font-bold text-yellow-800 flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4" />
                      Advertencias detectadas
                    </h4>
                    <ul className="text-sm text-yellow-700 list-disc list-inside">
                      {diff.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
