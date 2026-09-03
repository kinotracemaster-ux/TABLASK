import { useState } from 'react';
import { ChevronDown, ChevronUp, XCircle } from 'lucide-react';

const DETAIL_LIMIT = 50;

/**
 * Vista previa detallada de un push a Shopify (SKU / campo / antes → después,
 * más "no cruzan", conflictos y variantes secundarias ignoradas) — el mismo
 * detalle en ShopifyPushModal.jsx (destino ya guardado, "Mis Flujos") y en la
 * tarjeta Shopify de "Actualizar Maestra" (antes de guardar destino), para no
 * duplicar la tabla en los dos lugares.
 *
 * props: preview = summary de push_updates con dry_run=true.
 */
export function ShopifyPushPreviewDetails({ preview }) {
  const [showChanges, setShowChanges] = useState(true);
  const [showNotFound, setShowNotFound] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);
  const [showIgnoredSecondary, setShowIgnoredSecondary] = useState(false);

  if (!preview) return null;

  const changes = preview.changes || [];
  const notFound = preview.not_found || [];
  const conflicts = preview.conflicts || [];
  const ignoredSecondary = preview.ignored_secondary || [];
  const changesTotal = preview.changes_total ?? changes.length;
  const conflictsTotal = preview.conflicts_total ?? conflicts.length;
  const ignoredSecondaryTotal = preview.ignored_secondary_total ?? ignoredSecondary.length;

  return (
    <>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white p-3 rounded-lg text-center border">
          <p className="text-xs text-gray-500">Se actualizarán</p>
          <p className="text-xl font-bold text-green-700">{preview.matched}</p>
        </div>
        <div className="bg-white p-3 rounded-lg text-center border">
          <p className="text-xs text-gray-500">Origen (Maestra)</p>
          <p className="text-xl font-bold text-gray-700">{preview.total}</p>
        </div>
        <div className="bg-white p-3 rounded-lg text-center border">
          <p className="text-xs text-gray-500">No existen en la tienda</p>
          <p className="text-xl font-bold text-amber-700">{preview.not_found_count}</p>
        </div>
      </div>

      {preview.not_found_count > 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3">
          {preview.not_found_count} SKU(s) de la Maestra no existen en esta tienda — NO se crean productos, se ignoran.
        </p>
      )}

      {conflictsTotal > 0 && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2 mb-3">
          {conflictsTotal} cambio(s) de Nombre/Categoría NO se van a enviar: son variantes (ej. distintos
          colores) del MISMO producto en Shopify pidiendo valores distintos — mandar cualquiera de los dos
          pisaría el nombre que debería quedar para la otra variante. Unificá el nombre/categoría en la
          Maestra para esas variantes, o cambialo a mano en Shopify.
        </p>
      )}

      {ignoredSecondaryTotal > 0 && (
        <p className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg p-2 mb-3">
          {ignoredSecondaryTotal} variante(s) secundaria(s) (ej. otros colores del mismo modelo) piden un
          Nombre/Categoría distinto — se va a aplicar el de la variante principal (SKU terminado en "-1")
          y esas propuestas se ignoran, no bloquean el envío.
        </p>
      )}

      <div className="flex gap-2 flex-wrap mb-2">
        {changes.length > 0 && (
          <button type="button" onClick={() => setShowChanges(v => !v)}
            className="flex items-center gap-1 text-xs font-medium text-indigo-700 bg-white border border-indigo-200 rounded-lg px-3 py-1.5 hover:bg-indigo-50">
            {showChanges ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            Ver los {changesTotal} cambio(s)
          </button>
        )}
        {notFound.length > 0 && (
          <button type="button" onClick={() => setShowNotFound(v => !v)}
            className="flex items-center gap-1 text-xs font-medium text-amber-700 bg-white border border-amber-200 rounded-lg px-3 py-1.5 hover:bg-amber-50">
            {showNotFound ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            Ver los {preview.not_found_count} sin cruzar
          </button>
        )}
        {conflicts.length > 0 && (
          <button type="button" onClick={() => setShowConflicts(v => !v)}
            className="flex items-center gap-1 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-50">
            {showConflicts ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            Ver los {conflictsTotal} en conflicto
          </button>
        )}
        {ignoredSecondary.length > 0 && (
          <button type="button" onClick={() => setShowIgnoredSecondary(v => !v)}
            className="flex items-center gap-1 text-xs font-medium text-indigo-700 bg-white border border-indigo-200 rounded-lg px-3 py-1.5 hover:bg-indigo-50">
            {showIgnoredSecondary ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            Ver los {ignoredSecondaryTotal} de variantes secundarias
          </button>
        )}
      </div>

      {changes.length === 0 && preview.matched > 0 && (
        <p className="text-xs text-gray-400 mb-3">Los {preview.matched} SKU(s) que cruzan ya tienen estos valores en Shopify — no hay cambios reales para enviar.</p>
      )}

      {showChanges && changes.length > 0 && (
        <div className="mb-4 bg-white border rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-gray-50 text-gray-500 uppercase sticky top-0">
                <tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Campo</th><th className="px-3 py-2">Antes → Después</th></tr>
              </thead>
              <tbody>
                {changes.slice(0, DETAIL_LIMIT).map((c, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-1.5 font-medium text-gray-700 whitespace-nowrap">{c.sku}</td>
                    <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{c.field}</td>
                    <td className="px-3 py-1.5 text-gray-600"><span className="text-gray-400">{c.before}</span> → <span className="font-medium text-green-700">{c.after}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {changesTotal > DETAIL_LIMIT && (
            <div className="bg-gray-50 text-center text-xs text-gray-500 p-2 border-t">Mostrando {DETAIL_LIMIT} de {changesTotal}.</div>
          )}
        </div>
      )}

      {showConflicts && conflicts.length > 0 && (
        <div className="mb-4 bg-white border rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-48 overflow-y-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-gray-50 text-gray-500 uppercase sticky top-0">
                <tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Campo</th><th className="px-3 py-2">Valor pedido (no se envía)</th></tr>
              </thead>
              <tbody>
                {conflicts.slice(0, DETAIL_LIMIT).map((c, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-1.5 font-medium text-gray-700 whitespace-nowrap">{c.sku}</td>
                    <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{c.field}</td>
                    <td className="px-3 py-1.5 text-red-700">{c.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {conflictsTotal > DETAIL_LIMIT && (
            <div className="bg-gray-50 text-center text-xs text-gray-500 p-2 border-t">Mostrando {DETAIL_LIMIT} de {conflictsTotal}.</div>
          )}
        </div>
      )}

      {showIgnoredSecondary && ignoredSecondary.length > 0 && (
        <div className="mb-4 bg-white border rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-48 overflow-y-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-gray-50 text-gray-500 uppercase sticky top-0">
                <tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Campo</th><th className="px-3 py-2">Pedía (ignorado)</th><th className="px-3 py-2">Se aplica (variante principal)</th></tr>
              </thead>
              <tbody>
                {ignoredSecondary.slice(0, DETAIL_LIMIT).map((c, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-1.5 font-medium text-gray-700 whitespace-nowrap">{c.sku}</td>
                    <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{c.field}</td>
                    <td className="px-3 py-1.5 text-gray-400">{c.value}</td>
                    <td className="px-3 py-1.5 font-medium text-indigo-700">{c.applied}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ignoredSecondaryTotal > DETAIL_LIMIT && (
            <div className="bg-gray-50 text-center text-xs text-gray-500 p-2 border-t">Mostrando {DETAIL_LIMIT} de {ignoredSecondaryTotal}.</div>
          )}
        </div>
      )}

      {showNotFound && notFound.length > 0 && (
        <div className="mb-4 bg-white border rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-48 overflow-y-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-gray-50 text-gray-500 uppercase sticky top-0">
                <tr><th className="px-3 py-2">SKU (Maestra, no está en la tienda)</th></tr>
              </thead>
              <tbody>
                {notFound.slice(0, DETAIL_LIMIT).map((sku, i) => (
                  <tr key={i} className="border-t"><td className="px-3 py-1.5 font-mono text-gray-700">{sku}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.not_found_count > DETAIL_LIMIT && (
            <div className="bg-gray-50 text-center text-xs text-gray-500 p-2 border-t">Mostrando {DETAIL_LIMIT} de {preview.not_found_count}.</div>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Resumen del resultado tras un envío real (no dry_run): contadores por
 * campo + avisos de conflicto/variantes secundarias + errores.
 */
export function ShopifyPushResultSummary({ result }) {
  if (!result) return null;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="bg-white p-2 rounded-lg text-center border">
          <p className="text-xs text-gray-500">Precios</p>
          <p className="text-lg font-bold text-blue-700">{result.price_updated || 0}</p>
        </div>
        <div className="bg-white p-2 rounded-lg text-center border">
          <p className="text-xs text-gray-500">Stock</p>
          <p className="text-lg font-bold text-emerald-700">{result.stock_updated || 0}</p>
        </div>
        {result.compare_price_updated > 0 && (
          <div className="bg-white p-2 rounded-lg text-center border">
            <p className="text-xs text-gray-500">Precio comparativo</p>
            <p className="text-lg font-bold text-purple-700">{result.compare_price_updated}</p>
          </div>
        )}
        {result.barcode_updated > 0 && (
          <div className="bg-white p-2 rounded-lg text-center border">
            <p className="text-xs text-gray-500">Códigos de barras</p>
            <p className="text-lg font-bold text-gray-700">{result.barcode_updated}</p>
          </div>
        )}
        {result.title_updated > 0 && (
          <div className="bg-white p-2 rounded-lg text-center border">
            <p className="text-xs text-gray-500">Nombres</p>
            <p className="text-lg font-bold text-indigo-700">{result.title_updated}</p>
          </div>
        )}
        {result.product_type_updated > 0 && (
          <div className="bg-white p-2 rounded-lg text-center border">
            <p className="text-xs text-gray-500">Categorías</p>
            <p className="text-lg font-bold text-amber-700">{result.product_type_updated}</p>
          </div>
        )}
      </div>
      {result.conflicts_total > 0 && (
        <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
          {result.conflicts_total} producto(s) con Nombre/Categoría en conflicto entre variantes (ej.
          colores distintos pidiendo nombres distintos) NO se actualizaron — corregilo a mano en Shopify o
          unificá el valor en la Maestra para esas variantes.
        </p>
      )}
      {result.ignored_secondary_total > 0 && (
        <p className="mt-2 text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg p-2">
          {result.ignored_secondary_total} variante(s) secundaria(s) (ej. otros colores del mismo modelo)
          pedían un Nombre/Categoría distinto — se aplicó el de la variante principal (SKU terminado en
          "-1") y esas propuestas se ignoraron.
        </p>
      )}
      {result.errors?.length > 0 && (
        <div className="mt-2 space-y-1">
          {result.errors.map((e, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-red-700 bg-red-50 rounded p-2">
              <XCircle className="w-4 h-4 flex-shrink-0" /> {e}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
