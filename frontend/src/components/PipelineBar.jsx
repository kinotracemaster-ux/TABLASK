import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Database, ArrowRight, Settings2, Store, FileDown, Table2, RefreshCw, Globe, Zap, Pencil, Send, Eye } from 'lucide-react';

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

// Etiqueta amigable del tipo de fuente/destino (para que se entienda qué es cada caja).
function kindLabel(item) {
  if (item.kind === 'shopify' || item.type === 'shopify') return 'Tienda Shopify';
  if (item.kind === 'csv') return 'Descarga CSV';
  if (item.kind === 'api') return 'Canal API';
  if (item.kind === 'sheet') return 'Hoja hija';
  if (item.type === 'google_sheets') return 'Google Sheet';
  if (item.type === 'local_file') return 'Archivo subido';
  if (item.type === 'http_api') return 'API externa';
  return 'Fuente';
}

function KindIcon({ kind, type, className }) {
  if (kind === 'shopify' || type === 'shopify') return <Store className={className} />;
  if (kind === 'csv') return <FileDown className={className} />;
  if (kind === 'api') return <Globe className={className} />;
  if (kind === 'sheet') return <Table2 className={className} />;
  return <Settings2 className={className} />;
}

// Botón de acción chico dentro de un nodo (Correr / Editar / Enviar / Ver).
function NodeAction({ icon: Icon, label, tone, onClick }) {
  const tones = {
    green: 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200',
    indigo: 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border-indigo-200',
    sky: 'text-sky-700 bg-sky-50 hover:bg-sky-100 border-sky-200',
    gray: 'text-gray-600 bg-gray-50 hover:bg-gray-100 border-gray-200',
  };
  return (
    <button onClick={onClick} title={label}
      className={`flex items-center gap-1 text-[11px] font-semibold border rounded-md px-1.5 py-0.5 transition ${tones[tone] || tones.gray}`}>
      <Icon className="w-3 h-3" /> {label}
    </button>
  );
}

// Un nodo del pipeline con su semáforo, qué es y sus botones de acción.
function Node({ item, actions }) {
  const status = item.status || 'amber';
  return (
    <div className={`bg-white border ${RING[status]} rounded-lg px-3 py-2 min-w-[150px]`}
      title={item.message || ''}>
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${DOT[status]}`} />
        <KindIcon kind={item.kind} type={item.type} className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
          <p className="text-[11px] text-gray-400 truncate">
            {kindLabel(item)}
            {' · '}
            {status === 'paused' ? 'pausado'
              : item.last_run ? timeAgo(item.last_run)
              : status === 'amber' ? 'pendiente' : 'listo'}
          </p>
        </div>
      </div>
      {actions && actions.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {actions.map((a, i) => <NodeAction key={i} {...a} />)}
        </div>
      )}
    </div>
  );
}

function Column({ title, icon: Icon, items, empty, cta, actionsFor }) {
  return (
    <div className="flex-1 min-w-[170px]">
      <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
        <Icon className="w-3.5 h-3.5" /> {title} {items.length > 0 && <span className="text-gray-400">({items.length})</span>}
      </div>
      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="text-xs text-gray-400 bg-gray-50 border border-dashed border-gray-200 rounded-lg px-3 py-2">
            {empty} {cta}
          </div>
        ) : items.map(it => <Node key={it.id} item={it} actions={actionsFor ? actionsFor(it) : null} />)}
      </div>
    </div>
  );
}

export default function PipelineBar() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = async () => {
    try {
      const res = await fetch(`${API}/api/pipeline`);
      if (res.ok) setData(await res.json());
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Abre "Mis Flujos" pidiéndole que dispare una acción sobre un nodo (editar/correr/enviar).
  const go = (action, node) => navigate(`/flujos?action=${action}&node=${encodeURIComponent(node)}`);

  // Botones por FUENTE: correr (con vista previa) y editar el mapeo.
  const sourceActions = (src) => {
    const acts = [];
    if (src.is_active !== false && src.status !== 'paused') {
      acts.push({ icon: Zap, label: 'Correr', tone: 'green', onClick: () => go('run', src.id) });
    }
    acts.push({ icon: Pencil, label: 'Editar', tone: 'indigo', onClick: () => go('editFuente', src.id) });
    return acts;
  };

  // Botones por DESTINO, según el tipo.
  const destActions = (dst) => {
    if (dst.kind === 'shopify') return [
      { icon: Send, label: 'Enviar', tone: 'green', onClick: () => go('send', dst.id) },
      { icon: Pencil, label: 'Editar', tone: 'indigo', onClick: () => go('edit', dst.id) },
    ];
    if (dst.kind === 'api') return [
      { icon: Send, label: 'Enviar', tone: 'sky', onClick: () => go('send', dst.id) },
      { icon: Pencil, label: 'Editar', tone: 'indigo', onClick: () => go('edit', dst.id) },
    ];
    if (dst.kind === 'sheet') return [
      { icon: Pencil, label: 'Editar', tone: 'indigo', onClick: () => go('edit', dst.id) },
    ];
    if (dst.kind === 'csv') return [
      { icon: Eye, label: 'Ver', tone: 'gray', onClick: () => navigate('/flujos') },
    ];
    return [{ icon: Pencil, label: 'Editar', tone: 'indigo', onClick: () => go('edit', dst.id) }];
  };

  if (loading) return null;
  if (!data || !data.master?.linked) return null; // sin Maestra enlazada no hay pipeline

  const master = data.master;

  // Leyenda solo de los estados que realmente están presentes (menos ruido).
  const LEGEND = { green: 'sincronizado', amber: 'pendiente', red: 'error', paused: 'pausado' };
  const present = [...new Set([...data.sources, ...data.destinations].map(i => i.status || 'amber'))]
    .filter(s => LEGEND[s]);
  const allGreen = present.length === 1 && present[0] === 'green';

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      {/* Explicación corta del camino: que se entienda de un vistazo. */}
      <p className="text-xs text-gray-500 mb-3">
        Subís por una <span className="font-semibold text-gray-700">Fuente</span> →
        se ordena en la <span className="font-semibold text-indigo-600">Maestra</span> →
        sale a cada <span className="font-semibold text-gray-700">Destino</span>.
        Tocá un paso para <span className="font-medium">editarlo</span>, <span className="font-medium">correrlo</span> o <span className="font-medium">enviarlo</span>.
      </p>

      <div className="flex items-stretch gap-3 overflow-x-auto pb-1">
        {/* Fuentes */}
        <Column title="Fuentes" icon={Settings2} items={data.sources}
          empty="Sin fuentes." cta={<Link to="/nueva-fuente" className="text-indigo-600 font-medium hover:underline">Crear</Link>}
          actionsFor={sourceActions} />

        <div className="flex items-center text-gray-300 px-1"><ArrowRight className="w-5 h-5" /></div>

        {/* Maestra */}
        <div className="flex-1 min-w-[160px]">
          <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <Database className="w-3.5 h-3.5" /> Maestra
          </div>
          <div className="bg-indigo-50/50 border border-indigo-200 rounded-lg px-3 py-2.5">
            <p className="text-sm font-semibold text-gray-800 truncate">{master.sheet_name || 'Maestra'}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {master.total_rows != null ? `${master.total_rows} filas` : 'enlazada'}
              {master.sku_column && ` · llave: ${master.sku_column}`}
            </p>
            <button onClick={() => navigate('/')}
              className="flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-md px-1.5 py-0.5 transition mt-2">
              <Eye className="w-3 h-3" /> Ver Maestra
            </button>
          </div>
        </div>

        <div className="flex items-center text-gray-300 px-1"><ArrowRight className="w-5 h-5" /></div>

        {/* Destinos */}
        <Column title="Destinos" icon={Store} items={data.destinations}
          empty="Sin destinos." cta={<Link to="/nueva-fuente" className="text-indigo-600 font-medium hover:underline">Agregar</Link>}
          actionsFor={destActions} />
      </div>

      <div className="mt-3 flex items-center gap-4 text-[11px] text-gray-400">
        {allGreen ? (
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> todo sincronizado</span>
        ) : (
          present.map(s => (
            <span key={s} className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${DOT[s]}`} /> {LEGEND[s]}
            </span>
          ))
        )}
        <span className="ml-auto flex items-center gap-3">
          <button onClick={load} title="Actualizar estado"
            className="text-gray-400 hover:text-gray-600 flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> actualizar
          </button>
          <Link to="/flujos" className="text-indigo-600 font-medium hover:underline">Operar flujos →</Link>
        </span>
      </div>
    </div>
  );
}
