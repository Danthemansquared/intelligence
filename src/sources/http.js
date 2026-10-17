// Cliente HTTP mínimo con timeout. Los reintentos los gestiona el orquestador.
import { settings } from '../config.js';

const UA = 'MontBelvieuDashboard/0.1 (uso interno; contacto en config)';

export async function httpGet(url, { timeoutMs = settings.fetch.timeoutMs, headers = {}, as = 'text' } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*', ...headers }, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} en ${new URL(url).host}`);
      err.status = res.status;
      err.retryable = res.status >= 500 || res.status === 429;
      throw err;
    }
    return as === 'json' ? await res.json() : as === 'buffer' ? Buffer.from(await res.arrayBuffer()) : await res.text();
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error(`Tiempo de espera agotado (${timeoutMs} ms) en ${new URL(url).host}`);
      err.retryable = true;
      throw err;
    }
    if (e.retryable === undefined) e.retryable = true; // errores de red
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/** Parser CSV simple (sin comillas anidadas complejas; suficiente para FRED/EIA). */
export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  return { header, rows: lines.slice(1).map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))) };
}

/** Huella estable del formato de una respuesta (nombres de columnas/campos), para detectar cambios de estructura. */
export function signature(parts) {
  return parts.join('|');
}
