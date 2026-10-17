// Identificación y permisos.
//
// authMode "local": sólo acepta conexiones desde esta misma computadora
//   (127.0.0.1 / ::1). El usuario recibe settings.localRole.
// authMode "proxy": la aplicación queda detrás de un proxy de autenticación
//   corporativo (p. ej. Microsoft Entra ID mediante Azure App Service
//   "Easy Auth", oauth2-proxy o un gateway interno). Sólo se confía en el
//   encabezado de identidad si la conexión viene de un proxy de confianza.
//   El rol sale de config/roles.json; sin rol → acceso denegado.
//
// Roles: "lector" (indicadores digitales) y "validador" (además, diferencia vs.
// AMEXGAS y métricas de precisión). El acceso privado requiere además que el
// entorno tenga privateMode habilitado.

import { settings, rolesMap } from '../config.js';

export const ROLES = ['lector', 'validador'];

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function identify(req, cfg = settings, roles = null) {
  const ip = req.socket?.remoteAddress;
  if (cfg.authMode === 'local') {
    if (!LOOPBACK.has(ip)) return { error: 403, reason: 'El modo local sólo acepta conexiones desde esta computadora.' };
    return { user: cfg.localUser, role: cfg.localRole };
  }
  if (cfg.authMode === 'proxy') {
    if (!cfg.trustedProxies.includes(ip)) return { error: 403, reason: 'Conexión no proveniente del proxy de autenticación.' };
    const user = String(req.headers[cfg.identityHeader.toLowerCase()] || '').trim().toLowerCase();
    if (!user) return { error: 401, reason: 'Sin identidad autenticada.' };
    const map = roles ?? rolesMap();
    const role = map[user] ?? map['*'];
    if (!ROLES.includes(role)) return { error: 403, reason: 'Usuario sin rol asignado.' };
    return { user, role };
  }
  return { error: 500, reason: 'authMode desconocido.' };
}

export function canSeePrivate(identity, cfg = settings) {
  return Boolean(cfg.privateMode && identity?.role && cfg.privateRoles.includes(identity.role));
}
