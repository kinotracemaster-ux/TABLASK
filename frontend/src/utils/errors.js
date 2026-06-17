export function formatError(errData, defaultMsg = 'Ocurrió un problema. Intenta nuevamente.') {
  if (!errData) return defaultMsg;
  
  // Si es un error genérico del servidor
  if (errData.detail === 'Internal Server Error' || errData.message === 'Internal Server Error') {
    return 'Fallo interno en el servidor. Revisa que los datos ingresados sean correctos.';
  }

  // Si es un string simple
  if (typeof errData.detail === 'string') {
    return errData.detail;
  }
  
  // Si es una lista (típicamente validaciones de FastAPI)
  if (Array.isArray(errData.detail)) {
    return "Revisa los campos:\n" + errData.detail.map(err => {
      const field = err.loc ? err.loc[err.loc.length - 1] : '';
      return `- ${field}: ${err.msg}`;
    }).join('\n');
  }

  return errData.message || defaultMsg;
}

export async function extractError(res, defaultMsg) {
  try {
    const data = await res.json();
    return formatError(data, defaultMsg);
  } catch (e) {
    return 'No se pudo conectar con el servidor.';
  }
}
