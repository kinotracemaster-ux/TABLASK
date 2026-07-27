import { useState, useEffect } from 'react';
import { X, AlertTriangle, CheckCircle2, Store, Database, Loader2 } from 'lucide-react';
import { extractError } from '../utils/errors';

const API = import.meta.env.VITE_API_URL || '';

// Elige de una lista de columnas la primera que "suene" a alguno de los candidatos
// (case-insensitive). Sirve para prellenar SKU/Stock/Precio sin obligar a tocar nada.
function guessColumn(cols, candidates) {
  const low = cols.map(c => (c || '').toLowerCase().trim());
  for (const cand of candidates) {
    const i = low.indexOf(cand.toLowerCase());
    if (i >= 0) return cols[i];
  }
  for (const cand of candidates) {
    const i = low.findIndex(c => c.includes(cand.toLowerCase()));
    if (i >= 0) return cols[i];
  }
  return '';
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

const selCls = "w-full border border-gray-300 rounded-md p-1.5 text-sm bg-white";

/**
 * Modal "Crear flujo de stock (BASE-SYS)".
 * Arma de un tiro, con las convenciones ya puestas, el flujo preestablecido:
 *   BASE-SYS → Maestra (agotando faltantes) → hojas hijas + canales Shopify.
 * Todo lo que crea queda como filas normales, editables/borrables desde Flujos.
 */
export default function StockFlowTemplateModal({ connections, onClose, onDone }) {
  // Fuente BASE-SYS
  const [srcConnId, setSrcConnId] = useState('');
  const [srcSheets, setSrcSheets] = useState({});      // {hoja: [columnas]}
  const [srcSheet, setSrcSheet] = useState('');
  const [srcSku, setSrcSku] = useState('SKU');
  const [srcStock, setSrcStock] = useState('Stock');
  const [srcPrice, setSrcPrice] = useState('');
  const [loadingSrc, setLoadingSrc] = useState(false);

  // Maestra
  const [masterCols, setMasterCols] = useState([]);
  const [mSku, setMSku] = useState('SKU');
  const [mStock, setMStock] = useState('Stock');
  const [mPrice, setMPrice] = useState('Precio base');

  // Precio base opcional
  const [includePrice, setIncludePrice] = useState(false);

  // Hojas de stock (una conexión Google Sheets, varias pestañas)
  const [childConnId, setChildConnId] = useState('');
  const [childSheets, setChildSheets] = useState({});
  const [childSelected, setChildSelected] = useState([]);
  const [childSku, setChildSku] = useState('SKU');
  const [childStock, setChildStock] = useState('Stock');
  const [loadingChild, setLoadingChild] = useState(false);

  // Canales Shopify
  const [shopifySel, setShopifySel] = useState([]);

  const [activate, setActivate] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const shopifyConns = connections.filter(c => c.connection_type === 'shopify');
  const sheetConns = connections.filter(c => c.connection_type === 'google_sheets');

  // Columnas de la Maestra: prellenar convenciones si existen.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/api/master-columns`);
        const cols = res.ok ? await res.json() : [];
        if (Array.isArray(cols) && cols.length) {
          setMasterCols(cols);
          setMSku(guessColumn(cols, ['sku', 'codigo', 'código']) || cols[0]);
          setMStock(guessColumn(cols, ['stock', 'inventario', 'cantidad']) || '');
          setMPrice(guessColumn(cols, ['precio base', 'precio_base', 'precio']) || '');
        }
      } catch { /* tolerante: quedan los defaults */ }
    })();
  }, []);

  // Metadata de la fuente BASE-SYS al elegir conexión.
  useEffect(() => {
    if (!srcConnId) { setSrcSheets({}); setSrcSheet(''); return; }
    setLoadingSrc(true);
    (async () => {
      try {
        const res = await fetch(`${API}/api/connections/${srcConnId}/metadata`);
        const meta = res.ok ? await res.json() : {};
        const sheets = meta.sheets || {};
        setSrcSheets(sheets);
        const first = Object.keys(sheets)[0] || '';
        setSrcSheet(first);
      } catch { setSrcSheets({}); setSrcSheet(''); }
      setLoadingSrc(false);
    })();
  }, [srcConnId]);

  // Al cambiar de hoja fuente, adivinar columnas SKU/Stock/Precio.
  useEffect(() => {
    const cols = srcSheets[srcSheet] || [];
    if (!cols.length) return;
    setSrcSku(guessColumn(cols, ['sku', 'codigo', 'código']) || cols[0]);
    setSrcStock(guessColumn(cols, ['stock', 'inventario', 'cantidad']) || '');
    setSrcPrice(guessColumn(cols, ['precio', 'price']) || '');
  }, [srcSheet, srcSheets]);

  // Metadata de la conexión de hojas hijas.
  useEffect(() => {
    if (!childConnId) { setChildSheets({}); setChildSelected([]); return; }
    setLoadingChild(true);
    (async () => {
      try {
        const res = await fetch(`${API}/api/connections/${childConnId}/metadata`);
        const meta = res.ok ? await res.json() : {};
        setChildSheets(meta.sheets || {});
        setChildSelected([]);
      } catch { setChildSheets({}); }
      setLoadingChild(false);
    })();
  }, [childConnId]);

  const toggleChildSheet = (name) => {
    setChildSelected(prev => prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name]);
  };
  const toggleShopify = (id) => {
    setShopifySel(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  const srcCols = srcSheets[srcSheet] || [];

  const submit = async () => {
    setError('');
    if (!srcConnId || !srcSheet) { setError('Elegí la conexión y la hoja de BASE-SYS.'); return; }
    if (!srcSku || !srcStock || !mSku || !mStock) { setError('Faltan columnas de SKU o Stock.'); return; }

    const sheet_targets = childConnId && childSelected.length ? [{
      connection_id: Number(childConnId),
      sheets: childSelected,
      sku_column: childSku || 'SKU',
      stock_column: childStock || 'Stock',
    }] : [];
    const shopify_targets = shopifySel.map(id => ({ connection_id: Number(id) }));

    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/flow-templates/base-sys-stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_connection_id: Number(srcConnId),
          source_sheet_name: srcSheet,
          sku_column_source: srcSku,
          stock_column_source: srcStock,
          price_column_source: includePrice ? (srcPrice || null) : null,
          master_sku_column: mSku,
          master_stock_column: mStock,
          master_price_column: includePrice ? (mPrice || null) : null,
          sheet_targets,
          shopify_targets,
          activate,
        }),
      });
      if (!res.ok) { setError(await extractError(res, 'No se pudo armar el flujo.')); setSubmitting(false); return; }
      setResult(await res.json());
    } catch {
      setError('No se pudo conectar con el servidor.');
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-1">
          <h3 className="text-lg font-semibold text-gray-800">Crear flujo de stock (BASE-SYS)</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Arma de una sola vez el flujo: BASE-SYS lleva el stock a la Maestra
          (agotando los faltantes) y de ahí baja a las hojas y canales que elijas.
          Después podés editarlo o borrarlo como cualquier flujo.
        </p>

        {result ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-green-600" />
              <span>
                Flujo creado: proceso BASE-SYS → Maestra,
                {' '}{result.field_subscription_ids.length} hoja(s) de stock y
                {' '}{result.shopify_subscription_ids.length} canal(es) Shopify.
              </span>
            </div>
            {result.warnings?.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800">
                <div className="flex items-center gap-1.5 font-semibold mb-1"><AlertTriangle className="w-4 h-4" /> Avisos</div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
            <button onClick={onDone} className="w-full bg-indigo-600 text-white rounded-lg py-2 font-medium hover:bg-indigo-700 transition">
              Listo
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Fuente BASE-SYS */}
            <section className="space-y-2">
              <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><Database className="w-4 h-4 text-indigo-500" /> Fuente BASE-SYS</h4>
              <Field label="Conexión">
                <select value={srcConnId} onChange={e => setSrcConnId(e.target.value)} className={selCls}>
                  <option value="">Elegí la conexión...</option>
                  {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              {loadingSrc ? (
                <p className="text-xs text-gray-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Leyendo hojas...</p>
              ) : srcConnId && (
                <>
                  <Field label="Hoja / pestaña">
                    <select value={srcSheet} onChange={e => setSrcSheet(e.target.value)} className={selCls}>
                      {Object.keys(srcSheets).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Columna SKU">
                      <ColSelect cols={srcCols} value={srcSku} onChange={setSrcSku} />
                    </Field>
                    <Field label="Columna Stock">
                      <ColSelect cols={srcCols} value={srcStock} onChange={setSrcStock} />
                    </Field>
                  </div>
                </>
              )}
            </section>

            {/* Maestra */}
            <section className="space-y-2">
              <h4 className="text-sm font-semibold text-gray-700">En la Maestra</h4>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Columna SKU">
                  <ColSelect cols={masterCols} value={mSku} onChange={setMSku} />
                </Field>
                <Field label="Columna Stock">
                  <ColSelect cols={masterCols} value={mStock} onChange={setMStock} />
                </Field>
              </div>
            </section>

            {/* Precio base opcional */}
            <label className="flex items-start gap-2 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-3 cursor-pointer">
              <input type="checkbox" checked={includePrice} onChange={e => setIncludePrice(e.target.checked)} className="mt-0.5" />
              <span>
                Traer también el <b>precio base</b> desde BASE-SYS.
                {includePrice && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <ColSelect cols={srcCols} value={srcPrice} onChange={setSrcPrice} placeholder="Precio en fuente" />
                    <ColSelect cols={masterCols} value={mPrice} onChange={setMPrice} placeholder="Precio en Maestra" />
                  </div>
                )}
              </span>
            </label>

            {/* Hojas de stock */}
            <section className="space-y-2">
              <h4 className="text-sm font-semibold text-gray-700">Hojas de stock (opcional)</h4>
              <select value={childConnId} onChange={e => setChildConnId(e.target.value)} className={selCls}>
                <option value="">Sin hojas hijas</option>
                {sheetConns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {loadingChild && <p className="text-xs text-gray-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Leyendo hojas...</p>}
              {childConnId && !loadingChild && (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.keys(childSheets).map(s => (
                      <button key={s} type="button" onClick={() => toggleChildSheet(s)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition ${childSelected.includes(s)
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'}`}>
                        {s}
                      </button>
                    ))}
                  </div>
                  {childSelected.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="SKU en la hoja"><input value={childSku} onChange={e => setChildSku(e.target.value)} className={selCls} /></Field>
                      <Field label="Stock en la hoja"><input value={childStock} onChange={e => setChildStock(e.target.value)} className={selCls} /></Field>
                    </div>
                  )}
                </>
              )}
            </section>

            {/* Canales Shopify */}
            {shopifyConns.length > 0 && (
              <section className="space-y-2">
                <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><Store className="w-4 h-4 text-emerald-500" /> Canales Shopify (opcional)</h4>
                <div className="space-y-1.5">
                  {shopifyConns.map(c => (
                    <label key={c.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input type="checkbox" checked={shopifySel.includes(c.id)} onChange={() => toggleShopify(c.id)} />
                      {c.name}
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400">Solo actualiza stock de variantes existentes; nunca crea productos.</p>
              </section>
            )}

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={activate} onChange={e => setActivate(e.target.checked)} />
              Crear el flujo activo (destildá para dejarlo en pausa)
            </label>

            {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 whitespace-pre-line">{error}</div>}

            <div className="flex gap-2 pt-1">
              <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50 transition">Cancelar</button>
              <button onClick={submit} disabled={submitting}
                className="flex-1 bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-60 flex items-center justify-center gap-2">
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />} Crear flujo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Select de columna: si hay lista la ofrece; si no, deja escribir a mano.
function ColSelect({ cols, value, onChange, placeholder }) {
  if (cols && cols.length) {
    return (
      <select value={value} onChange={e => onChange(e.target.value)} className={selCls}>
        <option value="">{placeholder || 'Columna...'}</option>
        {cols.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    );
  }
  return <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={selCls} />;
}
