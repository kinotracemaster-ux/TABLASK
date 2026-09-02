import { useState } from 'react';

// Catálogo de campos que un destino Shopify puede recibir de la Maestra. El
// backend define exactamente estos 6 (ShopifySubscription); agregar uno acá
// no alcanza, hay que sumarlo primero en el modelo/conector.
export const SHOPIFY_FIELDS = [
  { key: 'price', label: 'Precio' },
  { key: 'stock', label: 'Stock' },
  { key: 'compare', label: 'Precio comparativo / oferta' },
  { key: 'barcode', label: 'Código de barras' },
  { key: 'title', label: 'Nombre del producto' },
  { key: 'product_type', label: 'Categoría' },
];

/**
 * Lista dinámica de mapeos "campo Shopify → columna Maestra" (mismo espíritu
 * que el mapeo de la tarjeta "Archivo"): en vez de una grilla fija con los 6
 * casilleros siempre visibles, el usuario agrega solo los campos que quiere
 * enviar con "+ Añadir campo" y elige la columna para cada uno.
 *
 * props:
 *   fields: [{ key, label, value, setValue }] — uno por cada SHOPIFY_FIELDS,
 *     en el mismo orden, con el valor actual (columna Maestra o '') y su setter.
 *   masterCols: columnas disponibles de la Maestra.
 *   disabled: si es true, deshabilita los selects (ej. todavía no se leyeron columnas).
 */
export default function ShopifyFieldMapper({ fields, masterCols, disabled = false }) {
  const [rows, setRows] = useState(() => {
    const init = fields.filter(f => f.value).map(f => f.key);
    return init.length > 0 ? init : [''];
  });

  const usedKeys = rows.filter(k => k);
  const fieldByKey = key => fields.find(f => f.key === key);

  const setRowKey = (index, newKey) => {
    const oldKey = rows[index];
    if (oldKey && fieldByKey(oldKey)) fieldByKey(oldKey).setValue('');
    setRows(rows.map((k, i) => (i === index ? newKey : k)));
  };

  const removeRow = (index) => {
    const key = rows[index];
    if (key && fieldByKey(key)) fieldByKey(key).setValue('');
    const next = rows.filter((_, i) => i !== index);
    setRows(next.length > 0 ? next : ['']);
  };

  const addRow = () => setRows([...rows, '']);

  const canAddMore = usedKeys.length < SHOPIFY_FIELDS.length;

  return (
    <div className="space-y-2">
      {rows.map((key, i) => {
        const field = key ? fieldByKey(key) : null;
        const availableFields = SHOPIFY_FIELDS.filter(f => f.key === key || !usedKeys.includes(f.key));
        return (
          <div key={i} className="flex gap-2 items-center">
            <select value={key} onChange={e => setRowKey(i, e.target.value)} disabled={disabled}
              className="flex-1 border border-gray-300 rounded-lg p-2 text-sm bg-white disabled:bg-gray-50">
              <option value="">Campo Shopify...</option>
              {availableFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <select value={field?.value || ''} onChange={e => field && field.setValue(e.target.value)}
              disabled={disabled || !field} className="flex-1 border border-gray-300 rounded-lg p-2 text-sm bg-white disabled:bg-gray-50">
              <option value="">Columna Maestra...</option>
              {masterCols.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button type="button" onClick={() => removeRow(i)} disabled={disabled} className="text-red-400 hover:text-red-600 text-sm px-1 disabled:opacity-40" title="Quitar campo">✕</button>
          </div>
        );
      })}
      {canAddMore && (
        <button type="button" onClick={addRow} disabled={disabled} className="text-indigo-600 text-sm font-medium hover:underline disabled:opacity-40 disabled:no-underline">
          + Añadir campo
        </button>
      )}
    </div>
  );
}
