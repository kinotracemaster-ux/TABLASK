import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Upload, FolderOpen, Bell, RefreshCw, CheckCircle2, Store, Plus } from 'lucide-react';
import { extractError } from '../utils/errors';

const API = import.meta.env.VITE_API_URL || '';

/**
 * Administración de la pantalla "Actualizar": a qué Fuente va el archivo
 * subido, qué carpeta de Drive se vigila y si el aviso por Telegram anda.
 */
export default function ActualizarConfig() {
  const [cfg, setCfg] = useState(null);
  const [carpeta, setCarpeta] = useState('');
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    const r = await fetch(`${API}/api/actualizar/config`);
    if (r.ok) {
      const d = await r.json();
      setCfg(d);
      setCarpeta(d.drive_folder_id || '');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const call = async (kind, url, opts, okText) => {
    setBusy(kind); setMsg(null);
    try {
      const r = await fetch(url, opts);
      if (!r.ok) setMsg({ error: true, text: await extractError(r, 'No se pudo completar.') });
      else {
        const d = await r.json().catch(() => ({}));
        setMsg({ error: false, text: typeof okText === 'function' ? okText(d) : okText });
      }
      await load();
    } catch { setMsg({ error: true, text: 'No se pudo conectar con el servidor.' }); }
    setBusy(null);
  };

  const guardar = (body, okText = 'Guardado.') =>
    call('save', `${API}/api/actualizar/config`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, okText);

  if (!cfg) return <div className="p-8 text-sm text-gray-500">Cargando…</div>;

  const card = 'bg-white rounded-xl border p-5 space-y-3';
  return (
    <div className="p-8 max-w-3xl space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Pantalla Actualizar</h2>
        <p className="text-sm text-gray-500">
          Lo que el equipo usa todos los días: subir el archivo del SYS, revisar y aprobar.{' '}
          <Link to="/" className="text-indigo-600 hover:underline">Abrir la pantalla →</Link>
        </p>
      </div>

      <div className={card}>
        <h3 className="font-semibold text-gray-800 flex items-center gap-2"><Upload className="w-4 h-4 text-indigo-500" /> Fuente que recibe el archivo</h3>
        <p className="text-xs text-gray-500">El archivo subido (o bajado del Drive) reemplaza el de esta Fuente. Por defecto se usa la del SYS de Poedagar.</p>
        {cfg.candidatas.length === 0 ? (
          <p className="text-sm text-gray-600">Todavía no hay: se crea sola con el primer archivo que subas (SYS POEDAGAR → Maestra).</p>
        ) : (
          <select value={cfg.upload_connection_id || ''} disabled={!!busy}
            onChange={e => e.target.value && guardar({ upload_connection_id: Number(e.target.value) })}
            className="border rounded-lg px-3 py-2 text-sm w-full">
            <option value="">{`Automática: ${cfg.actual?.name || cfg.candidatas[0].name}`}</option>
            {cfg.candidatas.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      <div className={card}>
        <h3 className="font-semibold text-gray-800 flex items-center gap-2"><Store className="w-4 h-4 text-indigo-500" /> Tiendas que se actualizan</h3>
        <p className="text-xs text-gray-500">Por defecto, la web de Poedagar. Marcá otra si también querés actualizarla con el mismo archivo.
          El multiplicador va sobre el precio del SYS: la web de Poedagar es × 2,8 (130.000 → 364.000).</p>
        {cfg.tiendas.length === 0 ? (
          <p className="text-sm text-gray-600">Ninguna todavía: el destino de Poedagar (precio del SYS × 2,8) se crea solo con el primer archivo si hay una sola tienda conectada.</p>
        ) : (
          <div className="space-y-1.5">
            {cfg.tiendas.map(t => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={t.elegida} disabled={!!busy}
                  onChange={() => {
                    const ids = cfg.tiendas.filter(x => (x.id === t.id ? !x.elegida : x.elegida)).map(x => x.id);
                    if (ids.length) guardar({ tiendas: ids });
                  }} />
                {t.name}
                <span className="text-xs text-gray-500 ml-2">precio del SYS ×</span>
                <input type="number" step="0.1" min="0.1" defaultValue={t.multiplicador} disabled={!!busy}
                  onBlur={e => {
                    const v = parseFloat(e.target.value);
                    if (v && v !== t.multiplicador) guardar({ multiplicadores: { [t.id]: v } }, `Multiplicador de ${t.name}: × ${v}.`);
                  }}
                  className="w-20 border rounded px-2 py-0.5 text-sm" />
              </label>
            ))}
          </div>
        )}
        <Link to="/admin/nueva-fuente"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-700 border border-indigo-200 rounded-lg px-3 py-1.5 hover:bg-indigo-50">
          <Plus className="w-4 h-4" /> Actualizar otra tienda
        </Link>
      </div>

      <div className={card}>
        <h3 className="font-semibold text-gray-800 flex items-center gap-2"><FolderOpen className="w-4 h-4 text-indigo-500" /> Carpeta de Drive</h3>
        <p className="text-xs text-gray-500">
          Cada 5 minutos se mira esta carpeta; si aparece un archivo más nuevo, se arma la revisión sola. La carpeta tiene que estar
          compartida con el correo de la cuenta de servicio de Google (la misma de la Maestra).
        </p>
        <div className="flex gap-2">
          <input value={carpeta} onChange={e => setCarpeta(e.target.value)} placeholder="Link o id de la carpeta"
            className="flex-1 border rounded-lg px-3 py-2 text-sm" />
          <button onClick={() => guardar({ drive_folder: carpeta })} disabled={!!busy}
            className="text-sm font-medium bg-indigo-600 text-white rounded-lg px-4 hover:bg-indigo-700 disabled:opacity-50">Guardar</button>
        </div>
        {cfg.drive_folder_id && (
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>Último procesado: {cfg.drive_ultimo?.name || 'ninguno todavía'}</span>
            <button onClick={() => call('drive', `${API}/api/actualizar/drive/revisar`, { method: 'POST' },
              d => (d.ran ? `Revisión armada con '${d.file}'.` : d.reason))} disabled={!!busy}
              className="flex items-center gap-1 text-indigo-700 font-medium hover:underline disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${busy === 'drive' ? 'animate-spin' : ''}`} /> Revisar la carpeta ahora
            </button>
          </div>
        )}
      </div>

      <div className={card}>
        <h3 className="font-semibold text-gray-800 flex items-center gap-2"><Bell className="w-4 h-4 text-indigo-500" /> Aviso al celular (Telegram)</h3>
        {cfg.telegram ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-green-700 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Configurado</span>
            <button onClick={() => call('aviso', `${API}/api/actualizar/aviso/prueba`, { method: 'POST' }, 'Mensaje de prueba enviado.')}
              disabled={!!busy} className="text-indigo-700 font-medium hover:underline text-xs disabled:opacity-50">Mandar prueba</button>
          </div>
        ) : (
          <p className="text-xs text-gray-500">
            Sin configurar (opcional). En Railway agregá <code>TELEGRAM_BOT_TOKEN</code> y <code>TELEGRAM_CHAT_ID</code>, y{' '}
            <code>TABLASK_PUBLIC_URL</code> para que el mensaje traiga el link.
          </p>
        )}
        {cfg.telegram && !cfg.public_url && (
          <p className="text-xs text-amber-700">Falta <code>TABLASK_PUBLIC_URL</code>: el aviso llega sin link.</p>
        )}
      </div>

      {msg && <p className={`text-sm ${msg.error ? 'text-red-700' : 'text-green-700'}`}>{msg.text}</p>}
    </div>
  );
}
