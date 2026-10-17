// Genera el sitio PÚBLICO estático (Entorno B) en dist/: interfaz + datos en JSON.
// Nunca abre la base privada: exige PRIVATE_MODE=0 y PUBLIC_SITE=1.
//
// Uso: PRIVATE_MODE=0 PUBLIC_SITE=1 node scripts/build-static.js
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, settings } from '../src/config.js';
import { routes } from '../src/server/public-api.js';
import { PRICE_PRODUCTS, SOURCES } from '../src/sources/index.js';
import { addMonths, todayHouston } from '../src/core/dates.js';
import { deriveKey, encrypt, meta } from './site-crypto.js';

if (settings.privateMode || process.env.PUBLIC_SITE !== '1') {
  console.error('El sitio público se genera sólo con PRIVATE_MODE=0 y PUBLIC_SITE=1.');
  process.exit(1);
}
const { SITE_USER, SITE_PASSWORD } = process.env;
const PROTECTED = Boolean(SITE_USER && SITE_PASSWORD);
if (!PROTECTED && process.env.ALLOW_UNPROTECTED !== '1') {
  console.error('Falta SITE_USER / SITE_PASSWORD: no se publica un sitio sin contraseña (ALLOW_UNPROTECTED=1 sólo para pruebas locales).');
  process.exit(1);
}

const OUT = path.join(ROOT, 'dist');
const DATA = path.join(OUT, 'data');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });

// 1. Interfaz
for (const f of fs.readdirSync(path.join(ROOT, 'web'))) fs.copyFileSync(path.join(ROOT, 'web', f), path.join(OUT, f));
let html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
// GitHub Pages no permite cabeceras: la política de contenido va en una etiqueta meta.
html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'">
  <meta name="app-mode" content="static">
  <meta name="robots" content="noindex, nofollow">`)
  .replace('<title>Mont Belvieu · Precios</title>', '<title>Intelligence</title>')
  .replace(/<meta name="description"[^>]*>/, '')
  .replace('href="/api/export?format=xlsx"', 'href="data/precios-digitales.xlsx" data-file="precios-digitales.xlsx"')
  .replace('href="/api/export?format=csv"', 'href="data/precios-digitales.csv" data-file="precios-digitales.csv"');
// Con contraseña, nada del tablero se muestra hasta desbloquear.
if (PROTECTED) html = html.replace('<body>', '<body class="locked">');
fs.writeFileSync(path.join(OUT, 'index.html'), html);

// 2. Datos (mismas respuestas que la API pública)
const write = (name, obj) => fs.writeFileSync(path.join(DATA, name), JSON.stringify(obj));
write('overview.json', await routes['/api/overview']({}));
write('sources.json', await routes['/api/sources']({}));
write('quality.json', await routes['/api/quality']({}));
write('market.json', await routes['/api/market']({}));
const from = addMonths(todayHouston(), -61);
const indexProducts = SOURCES.filter((s) => s.kind === 'index').flatMap((s) => s.products);
for (const product of [...PRICE_PRODUCTS, ...indexProducts]) write(`series-${product}.json`, await routes['/api/series']({ product, from }));
for (const format of ['csv', 'xlsx']) {
  const f = await routes['/api/export']({ format });
  fs.writeFileSync(path.join(DATA, `precios-digitales.${format}`), f.body);
}
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

// 3. Cifrado: cada archivo de datos se reemplaza por su versión .bin cifrada.
if (PROTECTED) {
  const key = deriveKey(SITE_USER, SITE_PASSWORD);
  for (const f of fs.readdirSync(DATA)) {
    const file = path.join(DATA, f);
    fs.writeFileSync(`${file}.bin`, encrypt(key, fs.readFileSync(file)));
    fs.rmSync(file);
  }
  fs.writeFileSync(path.join(DATA, 'meta.json'), JSON.stringify(meta(key, SITE_USER)));
} else {
  fs.writeFileSync(path.join(DATA, 'meta.json'), JSON.stringify({ protected: false }));
}

const size = fs.readdirSync(DATA).reduce((a, f) => a + fs.statSync(path.join(DATA, f)).size, 0);
console.log(`Sitio público generado en dist/ (${(size / 1024).toFixed(0)} KB de datos, ${PROTECTED ? 'cifrados con contraseña' : 'SIN contraseña'}).`);
