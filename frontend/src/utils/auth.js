// Clave de acceso de la app (ver backend/auth.py).
//
// La clave se guarda en el navegador y viaja en el header X-TablasK-Key. En vez
// de tocar los ~100 `fetch` que hay repartidos por los componentes, se parcha
// `window.fetch` una sola vez: cualquier llamada a /api/ sale con la clave y,
// si el servidor la rechaza, se borra y se vuelve a pedir.

const GUARDADA = 'tablask_clave';

export const getClave = () => {
  try { return localStorage.getItem(GUARDADA) || ''; } catch { return ''; }
};

export const setClave = (valor) => {
  try { localStorage.setItem(GUARDADA, valor); } catch { /* modo privado */ }
};

export const borrarClave = () => {
  try { localStorage.removeItem(GUARDADA); } catch { /* modo privado */ }
};

let yaInstalado = false;

/** Parcha fetch una sola vez. `onRechazo` se llama cuando el server devuelve 401. */
export function instalarClaveEnFetch(onRechazo) {
  if (yaInstalado) return;
  yaInstalado = true;
  const fetchOriginal = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!url.includes('/api/')) return fetchOriginal(input, init);

    const headers = new Headers(
      init.headers || (typeof input !== 'string' && input ? input.headers : undefined)
    );
    const clave = getClave();
    if (clave) headers.set('X-TablasK-Key', clave);

    const res = await fetchOriginal(input, { ...init, headers });
    if (res.status === 401) {
      borrarClave();
      if (onRechazo) onRechazo();
    }
    return res;
  };
}
