// Cifrado de los datos del sitio público con usuario y contraseña.
// GitHub Pages no tiene servidor: sin cifrado, cualquier archivo publicado se
// podría descargar directamente. Aquí cada archivo de datos se cifra con
// AES-256-GCM y una llave derivada con PBKDF2-SHA256; el navegador la deriva
// de lo que escribe el usuario (Web Crypto) y descifra en memoria.
//
// Formato de cada archivo .bin: iv (12 bytes) || texto cifrado || etiqueta GCM (16 bytes).
import crypto from 'node:crypto';

export const ITERATIONS = 600_000;

/** Secreto normalizado: el usuario no distingue mayúsculas; la contraseña sí. */
export function secretOf(user, password) {
  return `${String(user).trim().toLowerCase()}\n${password}`;
}

/** Sal estable por usuario (no secreta) para que "Recordar en este dispositivo" sobreviva a cada publicación. */
export function saltOf(user) {
  return crypto.createHash('sha256').update(`intelligence-site:${String(user).trim().toLowerCase()}`).digest().subarray(0, 16);
}

export function deriveKey(user, password, iterations = ITERATIONS) {
  return crypto.pbkdf2Sync(secretOf(user, password), saltOf(user), iterations, 32, 'sha256');
}

export function encrypt(key, data) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  return Buffer.concat([iv, c.update(data), c.final(), c.getAuthTag()]);
}

export function decrypt(key, buf) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]);
}

/** Metadatos públicos que necesita el navegador para derivar la llave y comprobarla. */
export function meta(key, user, iterations = ITERATIONS) {
  return {
    // La sal se recalcula en el navegador a partir del usuario escrito; no se publica.
    protected: true, kdf: 'PBKDF2-SHA256', cipher: 'AES-256-GCM', iterations,
    check: encrypt(key, Buffer.from('intelligence-ok')).toString('base64'),
  };
}
