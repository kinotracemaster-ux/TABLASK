import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Database, ArrowRight, Settings2, Store, FileDown, Table2, RefreshCw } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';

// Semáforo → clases de color. 'green' sincronizado, 'amber' pendiente, 'red' error, 'paused' gris.
const DOT = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-400',
  red: 'bg-red-500',
  paused: 'bg-gray-300',
};
const RING = {
  green: 'border-emerald-200',
  amber: 'border-amber-200',
  red: 'border-red-300',
  paused: 'border-gray-200',
};

function timeAgo(iso) {
  if (!iso) return 'nunca';
  const then = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return 'hace segundos';
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}

function KindIcon({ kind, type, className }) {
  if (kind === 'shopify') return <Store className={className} />;
  if (kind === 'csv') return <FileDown className={className} />;
  if (kind === 'sheet') return <Table2 className={className} />;
  if (type === 'shopify') return <Store className={className} />;
  return <Settings2 className={className} />;
}

function Node({ item }) {
  const status = item.status || 'amber';
  return (
    <div className={`flex items-center gap-2 bg-white border ${RING[status]} rounded-lg px-3 py-2 min-w-[140px]`}
      title={item.message || ''}>
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${DOT[status]}`} />
      <KindIcon kind={item.kind} type={item.type} className="w-4 h-4 text-gray-400 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
        <p className="text-[11px] text-gray-400 truncate">
          {status === 'paused' ? 'Pausado'
            : item.last_run ? timeAgo(item.last_run)
            : status === 'amber' ? 'Pendiente' : 'Listo'}
        </p>
      </div>
    </div>
  );
}

function Column({ title, icon: Icon, items, empty, cta }) {
  return (
    <div className="flex-1 min-w-[160px]">
      <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
        <Icon className="w-3.5 h-3.5" /> {title} {items.length > 0 && <span className="text-gray-400">({items.length})</span>}
      </div>
      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="text-xs text-gray-400 bg-gray-50 border border-dashed border-gray-200 rounded-lg px-3 py-2">
            {empty} {cta}
          </div>
        ) : items.map(it => <Node key={it.id} item={it} />)}
      </div>
    </div>
  );
}

export default function PipelineBar() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await fetch(`${API}/api/pipeline`);
      if (res.ok) setData(await res.json());
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  if (loading) return null;
  if (!data || !data.master?.linked) return null; // sin Maestra enlazada no hay pipeline

  const master = data.master;

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-gradient-to-b from-gray-50 to-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700">Tu pipeline de un vistazo</h2>
        <button onClick={load} title="Actualizar estado"
          className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-stretch gap-3 overflow-x-auto pb-1">
        {/* Fuentes */}
        <Column title="Fuentes" icon={Settings2} items={data.sources}
          empty="Sin fuentes." cta={<Link to="/nueva-fuente" className="text-indigo-600 font-medium hover:underline">Crear</Link>} />

        <div className="flex items-center text-gray-300 px-1"><ArrowRight className="w-5 h-5" /></div>

        {/* Maestra */}
        <div className="flex-1 min-w-[160px]">
          <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <Database className="w-3.5 h-3.5" /> Maestra
          </div>
          <div className="bg-white border-2 border-purple-200 rounded-lg px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-500 flex-shrink-0" />
              <p className="text-sm font-semibold text-gray-800 truncate">{master.sheet_name || 'Maestra'}</p>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {master.total_rows != null ? `${master.total_rows} filas` : 'enlazada'}
              {master.sku_column && <span className="text-indigo-400"> · 🔑 {master.sku_column}</span>}
            </p>
          </div>
        </div>

        <div className="flex items-center text-gray-300 px-1"><ArrowRight className="w-5 h-5" /></div>

        {/* Destinos */}
        <Column title="Destinos" icon={Store} items={data.destinations}
          empty="Sin destinos." cta={<Link to="/nueva-fuente" className="text-indigo-600 font-medium hover:underline">Agregar</Link>} />
      </div>

      <div className="mt-3 flex items-center gap-4 text-[11px] text-gray-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> sincronizado</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> pendiente</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> error</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300" /> pausado</span>
        <Link to="/flujos" className="ml-auto text-indigo-600 font-medium hover:underline">Operar flujos →</Link>
      </div>
    </div>
  );
}
