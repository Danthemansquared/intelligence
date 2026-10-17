// El cifrado de Node (build) debe poder descifrarse con Web Crypto (navegador).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveKey, encrypt, decrypt, meta, saltOf } from '../scripts/site-crypto.js';

const enc = new TextEncoder();

test('Node cifra y Web Crypto descifra con la misma derivación de llave', async () => {
  const iterations = 1000; // reducido para la prueba
  const key = deriveKey('Usuario', 'clave-de-prueba', iterations);
  const blob = encrypt(key, Buffer.from('{"ok":true}'));
  assert.equal(decrypt(key, blob).toString(), '{"ok":true}');

  // Misma lógica que web/app.js (deriveSiteKey / decryptBuf)
  const u = ' Usuario '.trim().toLowerCase();
  const salt = (await crypto.subtle.digest('SHA-256', enc.encode(`intelligence-site:${u}`))).slice(0, 16);
  assert.deepEqual(Buffer.from(salt), saltOf('Usuario'));
  const base = await crypto.subtle.importKey('raw', enc.encode(`${u}\nclave-de-prueba`), 'PBKDF2', false, ['deriveKey']);
  const wkey = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.subarray(0, 12) }, wkey, blob.subarray(12));
  assert.equal(new TextDecoder().decode(plain), '{"ok":true}');
});

test('Contraseña incorrecta no descifra; meta no publica la sal', () => {
  const key = deriveKey('u', 'buena', 1000);
  const bad = deriveKey('u', 'mala', 1000);
  const m = meta(key, 'u', 1000);
  assert.equal(m.salt, undefined);
  assert.throws(() => decrypt(bad, Buffer.from(m.check, 'base64')));
  assert.equal(decrypt(key, Buffer.from(m.check, 'base64')).toString(), 'intelligence-ok');
});
