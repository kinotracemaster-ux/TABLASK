import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Play, AlertCircle, ArrowLeft } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';
export default function PreviewSync() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    const savedPayload = localStorage.getItem(`sync_payload_${id}`);
    if(savedPayload) {
      const parsed = JSON.parse(savedPayload);
      setPayload(parsed);
      
      fetch(`${API}/api/sync/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: savedPayload
      })
      .then(res => res.json())
      .then(data => {
        setPreview(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
    } else {
      navigate(`/builder/${id}`);
    }
  }, [id]);

  const handleExecute = async () => {
    if(!payload) return;
    try {
      const res = await fetch(`${API}/api/sync/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if(res.ok) {
        alert("¡Actualización de datos realizada con éxito!");
        navigate('/projects');
      } else {
        alert("Error: " + data.detail);
      }
    } catch(err) {
      console.error(err);
    }
  };

  if(loading) {
    return <div className="p-8 text-center text-gray-500">Cargando vista previa...</div>;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-2">
            <ArrowLeft className="w-4 h-4" /> Volver al Constructor
          </button>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            Vista Previa del Cambio de Datos
          </h1>
          <p className="text-gray-600">Revisa los cambios antes de enviarlos a Google Sheets.</p>
        </div>
        <button onClick={handleExecute} className="bg-green-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-green-700 flex items-center gap-2">
          <Play className="w-5 h-5" /> Ejecutar Actualización
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-white p-4 rounded-xl border border-blue-200 shadow-sm text-center">
          <h3 className="text-gray-500 text-sm font-medium">Filas que Cambiarán</h3>
          <p className="text-3xl font-bold text-blue-600">{preview?.rows_changed || 0}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-green-200 shadow-sm text-center">
          <h3 className="text-gray-500 text-sm font-medium">Nuevas Filas</h3>
          <p className="text-3xl font-bold text-green-600">{preview?.rows_added || 0}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-red-200 shadow-sm text-center">
          <h3 className="text-gray-500 text-sm font-medium">Errores Detectados</h3>
          <p className="text-3xl font-bold text-red-600">{preview?.errors || 0}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 bg-gray-50 border-b border-gray-200 font-semibold flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-gray-500" />
          Muestra de Datos (Tabla Destino Resultante)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-100">
                {preview?.preview_data?.[0]?.map((header, i) => (
                  <th key={i} className="p-3 text-sm font-semibold text-gray-600 border-b border-gray-200">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview?.preview_data?.slice(1, 11).map((row, i) => (
                <tr key={i} className="hover:bg-gray-50 transition">
                  {row.map((cell, j) => (
                    <td key={j} className="p-3 text-sm text-gray-800 border-b border-gray-100">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {preview?.preview_data?.length > 11 && (
            <div className="p-3 text-center text-sm text-gray-500">Mostrando 10 filas de muestra...</div>
          )}
        </div>
      </div>
    </div>
  );
}
