const API = import.meta.env.VITE_API_URL || '';

export async function apiCall(path, options = {}) {
  const { headers: customHeaders, ...rest } = options;

  const res = await fetch(`${API}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...customHeaders,
    },
    ...rest,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}
