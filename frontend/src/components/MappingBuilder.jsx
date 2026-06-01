import React, { useState } from 'react';

// Simulamos los datos que nos enviaría el Backend (get_sheet_metadata)
const mockData = {
  origen: ["Código", "Nombre", "Marca", "Precio"],
  destino: ["ID_Producto", "Nombre_Final", "Costo", "Stock"]
};

export default function MappingBuilder() {
  const [mappings, setMappings] = useState([{ source: '', target: '', isKey: false }]);

  const addMapping = () => {
    setMappings([...mappings, { source: '', target: '', isKey: false }]);
  };

  const updateMapping = (index, field, value) => {
    const newMappings = [...mappings];
    newMappings[index][field] = value;
    setMappings(newMappings);
  };

  const handleSave = () => {
    console.log("Configuración a guardar en la BD:", mappings);
    // Aquí haríamos un POST al backend (FastAPI)
  };

  return (
    <div className="p-6 max-w-2xl mx-auto bg-white rounded-xl shadow-md space-y-4">
      <h2 className="text-2xl font-bold">Constructor de Actualización</h2>
      <p className="text-gray-500">Mapea las columnas de origen con tu tabla destino.</p>

      {mappings.map((mapping, index) => (
        <div key={index} className="flex items-center space-x-4 border-b pb-2">
          {/* Columna Origen */}
          <select 
            className="border p-2 rounded w-1/3"
            value={mapping.source}
            onChange={(e) => updateMapping(index, 'source', e.target.value)}
          >
            <option value="">Columna Origen...</option>
            {mockData.origen.map(col => <option key={col} value={col}>{col}</option>)}
          </select>

          <span>➡️</span>

          {/* Columna Destino */}
          <select 
            className="border p-2 rounded w-1/3"
            value={mapping.target}
            onChange={(e) => updateMapping(index, 'target', e.target.value)}
          >
            <option value="">Columna Destino...</option>
            {mockData.destino.map(col => <option key={col} value={col}>{col}</option>)}
          </select>

          {/* Selector de Llave Principal */}
          <label className="flex items-center space-x-2">
            <input 
              type="checkbox" 
              checked={mapping.isKey}
              onChange={(e) => updateMapping(index, 'isKey', e.target.checked)}
            />
            <span className="text-sm">Es Clave</span>
          </label>
        </div>
      ))}

      <div className="flex justify-between mt-4">
        <button onClick={addMapping} className="text-blue-500 font-semibold">+ Agregar Campo</button>
        <button onClick={handleSave} className="bg-green-500 text-white px-4 py-2 rounded">Guardar Configuración</button>
      </div>
    </div>
  );
}
