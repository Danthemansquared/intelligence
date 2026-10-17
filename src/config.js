// Configuración centralizada. Orden de precedencia:
//   variables de entorno > config/settings.json > valores por defecto.
// Los secretos (p. ej. EIA_API_KEY) sólo se leen de variables de entorno o de
// config/settings.json, que está excluido de git.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
  host: '127.0.0.1',
  port: 3100,
  // local: un solo usuario en esta computadora. proxy: identidad entregada por un
  // proxy de autenticación corporativo (p. ej. Microsoft Entra ID / Easy Auth).
  authMode: 'local',
  localUser: 'usuario-local',
  localRole: 'validador',
  identityHeader: 'x-ms-client-principal-name',
  trustedProxies: ['127.0.0.1', '::1', '::ffff:127.0.0.1'],
  // Entorno A (privado) habilitado sólo en local por defecto.
  privateMode: true,
  // Roles autorizados a ver la diferencia contra AMEXGAS y las métricas de precisión.
  privateRoles: ['validador'],
  tolerance: { greenP: 0.9, yellowP: 0.99, windowMonths: 24, minN: 120 },
  fetch: { timeoutMs: 30000, retries: 3, backoffMs: 2000 },
  eiaApiKey: null,
};

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function bool(v) {
  return v === undefined ? undefined : ['1', 'true', 'si', 'sí', 'yes'].includes(String(v).toLowerCase());
}

function load() {
  const file = readJson(path.join(ROOT, 'config', 'settings.json'));
  const s = { ...DEFAULTS, ...file, tolerance: { ...DEFAULTS.tolerance, ...(file.tolerance || {}) }, fetch: { ...DEFAULTS.fetch, ...(file.fetch || {}) } };
  const env = process.env;
  if (env.HOST) s.host = env.HOST;
  if (env.PORT) s.port = Number(env.PORT);
  if (env.AUTH_MODE) s.authMode = env.AUTH_MODE;
  if (bool(env.PRIVATE_MODE) !== undefined) s.privateMode = bool(env.PRIVATE_MODE);
  if (env.EIA_API_KEY) s.eiaApiKey = env.EIA_API_KEY;
  if (env.LOCAL_ROLE) s.localRole = env.LOCAL_ROLE;
  return s;
}

export const settings = load();

/** Roles por usuario (modo proxy). config/roles.json: { "correo@empresa.com": "validador", "*": "lector" } */
export function rolesMap() {
  return readJson(path.join(ROOT, 'config', 'roles.json'));
}

/** Para pruebas: reemplaza valores en caliente. */
export function overrideSettings(patch) {
  Object.assign(settings, patch);
}
