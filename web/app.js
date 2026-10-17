// Interfaz del dashboard. Toda la aritmética de diferencias, variaciones y
// estadísticas viene calculada del servidor (src/core/metrics.js); aquí sólo
// se redondea y se presenta.
import { lineChart, fmtDate } from './charts.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }));
const signed = (v, d = 1) => (v == null ? '—' : v > 0 ? `+${num(v, d)}` : v < 0 ? `−${num(Math.abs(v), d)}` : num(0, d));
const pct = (v, d = 1) => (v == null ? '—' : `${signed(v, d)}%`);
const share = (v) => (v == null ? '—' : `${num(v * 100, 0)}%`);
const dir = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
const LIGHT_TEXT = { verde: 'Dentro de lo normal', amarillo: 'Revisar', rojo: 'Fuera de margen', sin_tolerancia: 'Sin tolerancia' };
const PRODUCT = { propano: 'Propano', butano: 'Butano', wti: 'WTI', brent: 'Brent', ppi_butano: 'Butano (EE. UU.)', inv_propano_eeuu: 'Inventarios propano EE. UU.', exp_propano_eeuu: 'Exportaciones propano EE. UU.' };
const FRESH = { al_dia: ['verde', 'Al día'], atrasada: ['amarillo', 'Atrasada'], detenida: ['rojo', 'Detenida'], sin_datos: ['gris', 'Sin datos'] };

// Modo estático (sitio público en GitHub Pages): los datos vienen de archivos JSON
// generados por scripts/build-static.js en lugar de la API del servidor.
const STATIC = document.querySelector('meta[name="app-mode"]')?.content === 'static';
const staticCache = new Map();

// ─── Acceso con contraseña del sitio público ───
// Los datos publicados están cifrados (AES-256-GCM); la llave se deriva en el navegador
// del usuario y la contraseña (PBKDF2-SHA256), igual que en scripts/site-crypto.js.
const site = { meta: null, key: null };
const enc = new TextEncoder();
const KEY_STORE = 'intelligence.key';
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveSiteKey(user, password) {
  const u = user.trim().toLowerCase();
  const salt = (await crypto.subtle.digest('SHA-256', enc.encode(`intelligence-site:${u}`))).slice(0, 16);
  const base = await crypto.subtle.importKey('raw', enc.encode(`${u}\n${password}`), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: site.meta.iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
}

async function decryptBuf(key, buf) {
  const a = new Uint8Array(buf);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: a.slice(0, 12) }, key, a.slice(12));
}

async function keyWorks(key) {
  try { return new TextDecoder().decode(await decryptBuf(key, unb64(site.meta.check))) === 'intelligence-ok'; } catch { return false; }
}

/** Muestra la pantalla de acceso y resuelve cuando la llave es correcta. */
async function unlock() {
  site.meta = await (await fetch('data/meta.json', { cache: 'no-cache' })).json();
  if (!site.meta.protected) return;
  try {
    const saved = localStorage.getItem(KEY_STORE);
    if (saved) {
      const key = await crypto.subtle.importKey('raw', unb64(saved), 'AES-GCM', true, ['decrypt']);
      if (await keyWorks(key)) { site.key = key; document.body.classList.remove('locked'); showSignOut(); return; }
      localStorage.removeItem(KEY_STORE);
    }
  } catch { /* almacenamiento no disponible: se pide contraseña */ }
  const gate = $('#gate');
  gate.hidden = false;
  $('#gate-user').focus();
  await new Promise((resolve) => {
    $('#gate-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#gate-submit');
      btn.disabled = true; btn.textContent = 'Verificando…';
      $('#gate-error').hidden = true;
      const key = await deriveSiteKey($('#gate-user').value, $('#gate-pass').value);
      if (await keyWorks(key)) {
        site.key = key;
        if ($('#gate-remember').checked) {
          try { localStorage.setItem(KEY_STORE, b64(await crypto.subtle.exportKey('raw', key))); } catch { /* sin almacenamiento */ }
        }
        gate.hidden = true;
        document.body.classList.remove('locked');
        showSignOut();
        resolve();
      } else {
        $('#gate-error').hidden = false;
        $('#gate-pass').select();
      }
      btn.disabled = false; btn.textContent = 'Entrar';
    });
  });
}

function showSignOut() {
  const b = $('#sign-out');
  if (!b) return;
  b.hidden = false;
  b.addEventListener('click', () => { try { localStorage.removeItem(KEY_STORE); } catch { /* nada */ } location.reload(); });
}

async function getJson(url) {
  if (staticCache.has(url)) return staticCache.get(url);
  let data;
  if (STATIC && site.meta?.protected) {
    const r = await fetch(`${url}.bin`);
    if (!r.ok) throw new Error(`Error ${r.status}`);
    data = JSON.parse(new TextDecoder().decode(await decryptBuf(site.key, await r.arrayBuffer())));
  } else {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`);
    data = await r.json();
  }
  if (STATIC) staticCache.set(url, data);
  return data;
}

// Exportaciones cifradas: se descifran en el navegador y se descargan como archivo.
document.addEventListener('click', async (e) => {
  const a = e.target.closest?.('a[data-file]');
  if (!a || !(STATIC && site.meta?.protected)) return;
  e.preventDefault();
  const r = await fetch(`data/${a.dataset.file}.bin`);
  const blob = new Blob([await decryptBuf(site.key, await r.arrayBuffer())]);
  const url = URL.createObjectURL(blob);
  const tmp = Object.assign(document.createElement('a'), { href: url, download: a.dataset.file });
  document.body.appendChild(tmp); tmp.click(); tmp.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function api(path) {
  if (!STATIC) return getJson(path);
  const u = new URL(path, 'http://x');
  if (u.pathname === '/api/me') return { user: null, role: 'lector', canSeePrivate: false, authMode: 'publico' };
  if (u.pathname === '/api/series') {
    const d = await getJson(`data/series-${u.searchParams.get('product')}.json`);
    const from = u.searchParams.get('from') ?? '';
    return { ...d, from, sources: d.sources.map((s) => ({ ...s, rows: s.rows.filter((r) => r[0] >= from) })) };
  }
  if (u.pathname.startsWith('/api/private/')) throw new Error('No disponible en el sitio público');
  return getJson(`data/${u.pathname.replace('/api/', '')}.json`);
}

const state = { me: null, overview: null, sources: [], priv: null, stats: null, glpProduct: 'propano', glpRange: 12, crudeRange: 12, precProduct: 'propano', precSource: null, diffRange: 12 };
const RANGES = [[1, '1M'], [3, '3M'], [12, '1A'], [60, '5A']];

function monthsAgo(n) {
  const d = new Date(); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 10);
}

/**
 * Control segmentado al estilo iOS: un "pulgar" se desliza bajo la opción elegida.
 * Si las opciones no cambian, se reutiliza el control para que el pulgar se anime.
 */
function segmented(container, options, current, onChange) {
  const key = JSON.stringify(options);
  container._onChange = onChange;
  if (container.dataset.key !== key) {
    container.dataset.key = key;
    container.innerHTML = '';
    container.setAttribute('role', 'radiogroup');
    if (!options.length) return;
    const thumb = document.createElement('span');
    thumb.className = 'thumb';
    thumb.setAttribute('aria-hidden', 'true');
    container.appendChild(thumb);
    for (const [value, label] of options) {
      const b = document.createElement('button');
      b.type = 'button'; b.role = 'radio'; b.textContent = label; b.dataset.value = JSON.stringify(value);
      b.addEventListener('click', () => {
        if (JSON.stringify(container._current) === b.dataset.value) return;
        container._current = value;
        moveThumb(container);
        container._onChange(value);
      });
      container.appendChild(b);
    }
  }
  container._current = current;
  moveThumb(container);
}

function moveThumb(container) {
  const thumb = container.querySelector('.thumb');
  let sel = null;
  for (const b of container.querySelectorAll('button')) {
    const on = b.dataset.value === JSON.stringify(container._current);
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on) sel = b;
  }
  if (!thumb || !sel) return;
  const place = () => { thumb.style.width = `${sel.offsetWidth}px`; thumb.style.transform = `translateX(${sel.offsetLeft}px)`; };
  if (!thumb.style.width) { thumb.style.transition = 'none'; place(); thumb.offsetWidth; thumb.style.transition = ''; } else place();
}

// Flechas izquierda/derecha dentro de un control segmentado (patrón de radio de WAI-ARIA).
document.addEventListener('keydown', (e) => {
  const b = e.target.closest?.('.segmented button');
  if (!b || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const all = [...b.parentElement.querySelectorAll('button')];
  const next = all[(all.indexOf(b) + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
  next.focus(); next.click(); e.preventDefault();
});

const srcMeta = (id) => state.sources.find((s) => s.id === id)
  || (state.priv?.sourceNames?.[id] ? { id, shortName: state.priv.sourceNames[id], cls: 'c2', virtual: true } : {});
/** Sujeto de una oración: "EIA está…", "La estimación está…". */
const subj = (id) => (srcMeta(id).virtual ? `La ${srcMeta(id).shortName.toLowerCase()}` : srcMeta(id).shortName);
const lightPill = (light, text) => `<span class="light ${esc(light)}">${esc(text ?? LIGHT_TEXT[light] ?? '')}</span>`;
const arrowOf = (x) => `<span class="arrow" aria-hidden="true">${x > 0 ? '▲' : x < 0 ? '▼' : '●'}</span>`;

// ───────────────────────────── Resumen ─────────────────────────────

function primary(product) {
  const list = state.overview.products[product]?.sources ?? [];
  return list.find((s) => s.variations) ?? list[0];
}

/** Mini tendencia (estilo widget de Bolsa): línea, área tenue y punto final. */
function sparkline(rows, cls, label) {
  if (!rows || rows.length < 3) return '';
  const W = 132, H = 48, p = 3;
  const vs = rows.map((r) => r[1]);
  const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const x = (i) => p + (i / (rows.length - 1)) * (W - 2 * p);
  const y = (v) => p + (1 - (v - lo) / span) * (H - 2 * p);
  const line = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[1]).toFixed(1)}`).join('');
  const area = `${line}L${x(rows.length - 1).toFixed(1)},${H}L${x(0).toFixed(1)},${H}Z`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">
    <path class="area fl-${cls}" d="${area}"/><path class="line st-${cls}" d="${line}"/>
    <circle class="fl-${cls}" r="3" cx="${x(rows.length - 1).toFixed(1)}" cy="${y(vs.at(-1)).toFixed(1)}"/></svg>`;
}

function changes(v, d = 2) {
  if (!v) return '';
  // Neutros: para un comprador de GLP una subida no es "buena". Flecha + signo, sin verde/rojo.
  const c = (k, label) => v[k] ? `<div class="change"><span>${label}</span><b>${arrowOf(v[k].abs)}${signed(v[k].abs, d)}</b><small>${pct(v[k].pct)}</small></div>` : '';
  return `<div class="changes">${c('daily', 'Día')}${c('weekly', 'Semana')}${c('monthly', 'Mes')}</div>`;
}

function diffBlock(product) {
  if (!state.priv) return '';
  const rows = state.priv.products[product] ?? [];
  const p = primary(product);
  const entry = rows.find((r) => r.current.sourceId === p?.sourceId) ?? rows[0];
  if (!entry) return '';
  const c = entry.current;
  const head = `<div class="diff-label"><span>Diferencia vs. AMEXGAS</span>${c.status === 'ok' ? lightPill(c.light) : ''}</div>`;
  if (c.status === 'ok') {
    const sense = c.direction === 'arriba' ? 'por encima de AMEXGAS' : c.direction === 'abajo' ? 'por debajo de AMEXGAS' : 'igual a AMEXGAS';
    return `<div class="diff">${head}
      <div class="diff-value">${signed(c.signed, 2)}<span class="unit">cUSD/gal</span></div>
      <div class="diff-sense">${esc(subj(c.sourceId))} está ${num(c.abs, 2)} cUSD/gal ${sense} el ${fmtDate(c.quoteDate)}.</div>
      <div class="stats"><div><span>${srcMeta(c.sourceId).virtual ? 'Estimado' : 'Precio digital'}</span><b>${num(c.digital, 2)}</b></div><div><span>Precio AMEXGAS</span><b>${num(c.official, 2)}</b></div><div><span>Diferencia %</span><b>${pct(c.pct, 2)}</b></div></div></div>`;
  }
  const lc = entry.lastComparable;
  const last = lc && lc.status === 'ok'
    ? `<div class="diff-why">Última comparación válida (${fmtDate(lc.quoteDate)}): <b>${signed(lc.signed, 2)} cUSD/gal</b> ${lightPill(lc.light)}</div>` : '';
  const title = c.status === 'sin_referencia' ? 'Sin referencia oficial disponible' : c.status === 'no_comparable' ? 'No comparable' : 'Sin dato digital';
  const why = c.status === 'sin_referencia'
    ? `No hay precio AMEXGAS para el ${fmtDate(c.date)}. El último dato oficial cargado es del ${c.lastOfficialDate ? fmtDate(c.lastOfficialDate) : '—'}; no se reutiliza para otra fecha.`
    : c.reason;
  return `<div class="diff">${head}<div class="diff-empty">${title}</div><div class="diff-why">${esc(why)}</div>${last}</div>`;
}

const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthLabel = (d) => `${MONTHS_LONG[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

/** Estimación privada (índice × factor calibrado) para el último mes del índice, si existe. */
function privateIndexEstimate(product) {
  const ixs = state.stats?.indices?.[product];
  if (!ixs?.length) return '';
  const r = ixs[0];
  const v = r.variants.find((x) => x.align === r.best);
  const e = r.beyondOfficial.at(-1);
  if (!e || !v?.estimate?.n) return '';
  return `<div class="estimate"><div class="stats one"><div><span>Estimación calibrada · promedio de ${monthLabel(`${e.month}-01`)} (privado)</span><b>${num(e.estimate, 1)} cUSD/gal</b></div></div>
    <div class="diff-why">Error histórico del método: ±${num(v.tolerance.green ?? v.estimate.p90Abs, 1)} cUSD/gal en 9 de cada 10 meses. Es una aproximación, no un precio publicado.</div></div>`;
}

function cardHead(title, sub, fresh) {
  const [fl, ft] = fresh ? FRESH[fresh.status] : ['verde'];
  return `<div class="card-head"><div><h3 class="card-title">${title}</h3><div class="card-sub">${sub}</div></div>${fl !== 'verde' ? lightPill(fl, ft) : ''}</div>`;
}

/** Butano con estimación diaria (vista privada): precio estimado, margen y diferencia vs. AMEXGAS. */
function estimateCard(product, e, ix) {
  const v = e.variations;
  const stale = e.gapBusinessDays > 5 && e.lastOfficialDate
    ? ` El último dato AMEXGAS cargado es del ${fmtDate(e.lastOfficialDate)}, por eso el margen es más amplio.` : '';
  const trend = ix?.mom ? `<div class="context-line"><span>Precio del butano en EE. UU. · ${monthLabel(ix.date)}</span><b>${arrowOf(ix.mom.pct)}${pct(ix.mom.pct)}</b><small>vs. mes previo · ${pct(ix.yoy?.pct)} en un año</small></div>` : '';
  return `<article class="card product-card">
    ${cardHead(PRODUCT[product], 'Mont Belvieu · estimado')}
    <div class="price-row"><div><div class="price"><span class="num">${num(e.value, 2)}</span><span class="unit">cUSD/gal</span></div>
    <div class="src">Estimado para el ${fmtDate(e.date)} con el precio del propano · margen habitual ±${num(e.error.p90, 1)} cUSD/gal</div></div>${sparkline(e.spark, 'c2', 'Tendencia de 3 meses del butano estimado')}</div>
    ${changes(v)}
    ${diffBlock(product)}
    <p class="footnote">Cálculo: propano del día × relación butano/propano de AMEXGAS de los últimos 20 días. En 9 de cada 10 días históricos el error fue de ${num(e.error.p90, 1)} cUSD/gal o menos.${stale}</p>
    ${trend}
  </article>`;
}

/** Butano sin datos oficiales (vista general): tendencia de precios en EE. UU. */
function trendCard(product, ix) {
  const m = ix.mom, y = ix.yoy;
  const verb = (x) => (x > 0 ? 'se encareció' : x < 0 ? 'se abarató' : 'se mantuvo');
  const insight = m
    ? `El butano ${verb(m.pct)} en ${MONTHS_LONG[Number(ix.date.slice(5, 7)) - 1]}${y ? ` y está ${num(Math.abs(y.pct), 0)}% ${y.pct >= 0 ? 'por arriba' : 'por debajo'} de hace un año` : ''}.`
    : '';
  return `<article class="card product-card">
    ${cardHead(PRODUCT[product], 'Tendencia del precio en EE. UU.', ix.freshness)}
    <div class="price-row"><div><div class="price"><span class="num">${m ? `${arrowOf(m.pct)}${num(Math.abs(m.pct), 1)}%` : '—'}</span><span class="unit">en ${monthLabel(ix.date)}</span></div>
    <div class="src">${esc(insight)}</div></div>${sparkline(ix.spark, 'c2', 'Tendencia del precio del butano en EE. UU.')}</div>
    ${y ? `<div class="changes"><div class="change"><span>vs. hace un año</span><b>${arrowOf(y.pct)}${pct(y.pct)}</b></div></div>` : ''}
    <p class="footnote">Índice mensual de precios del butano en EE. UU. (BLS). Mont Belvieu no publica un precio diario gratuito de butano.</p>
  </article>`;
}

function productCard(product) {
  const p = primary(product);
  const ix = state.overview.products[product]?.indices?.[0];
  const est = state.priv?.estimates?.[product];
  if (!p?.variations && est) return estimateCard(product, est, ix);
  if (!p?.variations && ix) return trendCard(product, ix);
  if (!p?.variations) {
    return `<article class="card product-card">${cardHead(PRODUCT[product], 'Mont Belvieu')}
      <div class="diff-empty">Sin precio digital disponible</div><div class="diff-why">${esc(p ? `${p.shortName}: aún no hay datos.` : 'No existe una fuente pública gratuita y automatizable del butano normal de Mont Belvieu: EIA, FRED y Trading Economics no lo publican, y OPIS/Argus/CME requieren licencia.')}</div>${diffBlock(product)}</article>`;
  }
  const v = p.variations;
  return `<article class="card product-card">
    ${cardHead(PRODUCT[product], 'Mont Belvieu', p.freshness)}
    <div class="price-row"><div><div class="price"><span class="num">${num(v.value, 2)}</span><span class="unit">cUSD/gal</span></div>
    <div class="src">Cotización del ${fmtDate(v.date)} · fuente: ${esc(p.shortName)}</div></div>${sparkline(p.spark, srcMeta(p.sourceId).cls || 'c1', `Tendencia de 3 meses del ${PRODUCT[product].toLowerCase()}`)}</div>
    ${changes(v)}
    ${diffBlock(product)}
  </article>`;
}

function crudeCard(product) {
  const p = primary(product);
  if (!p?.variations) return `<article class="card crude-card">${cardHead(PRODUCT[product], 'Sin datos')}</article>`;
  const v = p.variations;
  return `<article class="card crude-card product-card">
    ${cardHead(PRODUCT[product], `${esc(p.label ?? '')}`, p.freshness)}
    <div class="price-row"><div><div class="price"><span class="num">${num(v.value, 2)}</span><span class="unit">USD/bbl</span></div><div class="src">${fmtDate(v.date)} · fuente: ${esc(p.shortName)}</div></div>${sparkline(p.spark, product === 'wti' ? 'c1' : 'c2', `Tendencia de 3 meses del ${PRODUCT[product]}`)}</div>
    ${changes(v)}</article>`;
}

function headline() {
  const parts = [];
  for (const product of ['propano', 'butano']) {
    const p = primary(product);
    const w = p?.variations?.weekly;
    if (w) parts.push(`${PRODUCT[product]} ${w.abs > 0 ? 'sube' : w.abs < 0 ? 'baja' : 'sin cambio'} <strong>${num(Math.abs(w.abs), 1)} cUSD/gal</strong> en la semana`);
  }
  const wti = primary('wti')?.variations?.weekly;
  if (wti) parts.push(`WTI <strong>${pct(wti.pct)}</strong>`);
  const today = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  const day = today.charAt(0).toUpperCase() + today.slice(1);
  return parts.length ? `${day}. ${parts.join(' · ')}.` : 'Aún no hay datos digitales cargados. Ejecute la actualización.';
}

function renderSummary() {
  $('#resumen-lede').innerHTML = headline();
  $('#product-cards').innerHTML = productCard('propano') + productCard('butano');
  $('#crude-cards').innerHTML = crudeCard('wti') + crudeCard('brent');
  for (const id of ['#product-cards', '#crude-cards']) { $(id).classList.add('fade-in'); $(id).removeAttribute('aria-busy'); }
  const al = state.overview.alerts;
  const TYPE = { antiguedad: 'Antigüedad', falla: 'Falla', estructura: 'Formato' };
  $('#alerts').innerHTML = al.length
    ? `<div class="card fade-in"><h3>Requiere atención</h3><ul class="list">${al.map((a) => `<li>${lightPill(a.level, TYPE[a.type] ?? 'Datos')}<span>${esc(a.text)}</span></li>`).join('')}</ul></div>`
    : '';
  const lu = state.overview.lastUpdate;
  $('#last-update').textContent = lu ? `Actualizado ${new Date(lu).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Sin actualizaciones registradas';
}

// ───────────────────────────── Gráficas de precio ─────────────────────────────

async function priceChart(product, months, chartEl, legendEl, unit) {
  const data = await api(`/api/series?product=${product}&from=${monthsAgo(months)}`);
  const series = data.sources.map((s) => ({ name: s.name, cls: srcMeta(s.sourceId).cls || 'c1', rows: s.rows }));
  lineChart(chartEl, { series, unit, decimals: unit === 'USD/bbl' ? 2 : 1, ariaLabel: `Precio de ${PRODUCT[product]}` });
  const shown = series.filter((s) => s.rows.length);
  legendEl.innerHTML = shown.length > 1 ? shown.map((s) => `<span><i class="bg-${s.cls}"></i>${esc(s.name)}</span>`).join('') : '';
  return series;
}

async function renderGlp() {
  segmented($('#glp-product'), [['propano', 'Propano'], ['butano', 'Butano']], state.glpProduct, (v) => { state.glpProduct = v; renderGlp(); });
  segmented($('#glp-range'), RANGES, state.glpRange, (v) => { state.glpRange = v; renderGlp(); });
  const ix = state.overview.products[state.glpProduct]?.indices?.[0];
  const hasPrice = (state.overview.products[state.glpProduct]?.sources ?? []).some((x) => x.variations);
  const est = state.priv?.estimates?.[state.glpProduct];
  if (!hasPrice && est) {
    const d = await api(`/api/private/series?product=${state.glpProduct}&from=${monthsAgo(state.glpRange)}`);
    const rows = d.sources[0]?.rows ?? [];
    lineChart($('#glp-chart'), { series: [{ name: 'Butano estimado', cls: 'c2', rows }], unit: 'cUSD/gal', decimals: 1, ariaLabel: 'Butano estimado' });
    $('#glp-legend').innerHTML = '';
    const a = rows[0], b = rows.at(-1);
    $('#glp-lede').textContent = a && b ? `Butano estimado: ${b[1] >= a[1] ? 'subió' : 'bajó'} ${num(Math.abs(b[1] - a[1]), 1)} cUSD/gal (${pct((b[1] / a[1] - 1) * 100)}) desde el ${fmtDate(a[0])}. Margen habitual de la estimación: ±${num(est.error.p90, 1)} cUSD/gal.` : '';
    return;
  }
  if (!hasPrice && ix) {
    const d = await api(`/api/series?product=${ix.product}&from=${monthsAgo(Math.max(state.glpRange, 24))}`);
    const rows = d.sources[0]?.rows ?? [];
    const base = rows[0]?.[1];
    // Se expresa como cambio % desde el inicio del periodo: un índice 1982=100 no le dice nada a un lector.
    lineChart($('#glp-chart'), { series: [{ name: 'Precio del butano en EE. UU.', cls: 'c2', rows: rows.map(([d2, v]) => [d2, (v / base - 1) * 100]) }], unit: `% vs. ${rows[0] ? monthLabel(rows[0][0]) : ''}`, decimals: 0, signed: true, zero: true, maxGapDays: 45, ariaLabel: 'Tendencia del precio del butano en EE. UU.' });
    $('#glp-legend').innerHTML = '';
    const a = rows[0], b = rows.at(-1);
    $('#glp-lede').textContent = a && b ? `El precio del butano en EE. UU. ${b[1] >= a[1] ? 'subió' : 'bajó'} ${num(Math.abs((b[1] / a[1] - 1) * 100), 0)}% entre ${monthLabel(a[0])} y ${monthLabel(b[0])} (índice mensual del BLS).` : '';
    return;
  }
  const series = await priceChart(state.glpProduct, state.glpRange, $('#glp-chart'), $('#glp-legend'), 'cUSD/gal');
  const s = series.find((x) => x.rows.length > 1);
  if (s) {
    const a = s.rows[0], b = s.rows.at(-1);
    const ch = b[1] - a[1];
    const hi = s.rows.reduce((m, r) => (r[1] > m[1] ? r : m));
    const lo = s.rows.reduce((m, r) => (r[1] < m[1] ? r : m));
    $('#glp-lede').textContent = `${PRODUCT[state.glpProduct]} ${ch >= 0 ? 'subió' : 'bajó'} ${num(Math.abs(ch), 1)} cUSD/gal (${pct((ch / a[1]) * 100)}) desde el ${fmtDate(a[0])}. Máximo ${num(hi[1], 1)} (${fmtDate(hi[0])}), mínimo ${num(lo[1], 1)} (${fmtDate(lo[0])}). Fuente: ${s.name}.`;
  } else $('#glp-lede').textContent = 'Sin datos digitales para este producto en el periodo.';
}

async function renderCrude() {
  segmented($('#crude-range'), RANGES, state.crudeRange, (v) => { state.crudeRange = v; renderCrude(); });
  // WTI y Brent comparten unidad (USD/bbl): una sola escala es válida.
  const [w, b] = await Promise.all(['wti', 'brent'].map((p) => api(`/api/series?product=${p}&from=${monthsAgo(state.crudeRange)}`)));
  const pick = (d, label) => { const s = d.sources.find((x) => x.rows.length) ?? d.sources[0]; return s ? { name: `${label} · ${s.name}`, cls: label === 'WTI' ? 'c1' : 'c2', rows: s.rows } : null; };
  const series = [pick(w, 'WTI'), pick(b, 'Brent')].filter(Boolean);
  lineChart($('#crude-chart'), { series, unit: 'USD/bbl', decimals: 2, ariaLabel: 'Precio del crudo' });
  $('#crude-legend').innerHTML = series.filter((s) => s.rows.length).map((s) => `<span><i class="bg-${s.cls}"></i>${esc(s.name)}</span>`).join('');
  const wv = primary('wti')?.variations, bv = primary('brent')?.variations;
  if (wv && bv) {
    $('#crude-lede').textContent = `WTI en ${num(wv.value, 2)} USD/bbl y Brent en ${num(bv.value, 2)} USD/bbl. En el mes, WTI ${pct(wv.monthly?.pct)} y Brent ${pct(bv.monthly?.pct)}. Diferencial Brent–WTI: ${num(bv.value - wv.value, 2)} USD/bbl${bv.date !== wv.date ? ' (fechas distintas)' : ''}.`;
  }
}

// ───────────────────────────── Precisión (privado) ─────────────────────────────

function sourcesWithStats(product) {
  return state.stats?.products[product] ?? [];
}

function precHeadline(s, product) {
  const o = s.overall;
  if (!o?.n) return `${s.name} no tiene observaciones comparables con AMEXGAS para ${PRODUCT[product].toLowerCase()}.`;
  const side = o.bias > 0 ? 'por encima' : 'por debajo';
  return `${subj(s.sourceId) || s.name} está en promedio ${num(Math.abs(o.bias), 1)} cUSD/gal ${side} de AMEXGAS en ${PRODUCT[product].toLowerCase()}; en 9 de cada 10 días la diferencia fue de ${num(s.tolerance.green ?? o.p90Abs, 1)} cUSD/gal o menos.`;
}

function kpi(label, value, unit, note) {
  return `<div class="card kpi"><div class="k-label">${label}</div><div class="k-value">${value}${unit ? ` <small>${unit}</small>` : ''}</div><div class="k-note">${note}</div></div>`;
}

async function renderPrecision() {
  const product = state.precProduct;
  const list = sourcesWithStats(product);
  segmented($('#prec-product'), [['propano', 'Propano'], ['butano', 'Butano']], product, (v) => { state.precProduct = v; state.precSource = null; $('#day-date').value = ''; renderPrecision(); });
  $('#prec-index').innerHTML = indexEvaluation(product);
  $('#prec-daily').hidden = !list.length;
  if (!list.length) {
    $('#prec-source').innerHTML = '';
    $('#prec-kpis').innerHTML = '';
    $('#prec-lede').textContent = state.stats.indices?.[product]?.length
      ? `No hay precio digital diario de ${PRODUCT[product].toLowerCase()}. Se evalúa el índice mensual disponible como aproximación.`
      : `No hay fuentes digitales de ${PRODUCT[product].toLowerCase()} configuradas para comparar.`;
    return;
  }
  if (!list.some((s) => s.sourceId === state.precSource)) {
    state.precSource = state.stats.recommendation[product]?.primary ?? list[0].sourceId;
  }
  segmented($('#prec-source'), list.map((s) => [s.sourceId, srcMeta(s.sourceId).shortName || s.name]), state.precSource, (v) => { state.precSource = v; $('#day-date').value = ''; renderPrecision(); });
  const s = list.find((x) => x.sourceId === state.precSource);
  const o = s.overall;
  $('#prec-lede').textContent = precHeadline(s, product);

  const tol = s.tolerance;
  $('#prec-kpis').innerHTML = o?.n ? [
    kpi('Diferencia típica (mediana)', num(o.medianAbs, 2), 'cUSD/gal', 'La mitad de los días la diferencia fue menor.'),
    kpi('Sesgo promedio', signed(o.bias, 2), 'cUSD/gal', o.bias > 0 ? 'Tiende a estar por encima de AMEXGAS.' : 'Tiende a estar por debajo de AMEXGAS.'),
    kpi('Días dentro de ±1 cUSD/gal', share(o.within['1']), '', `±2: ${share(o.within['2'])} · ±5: ${share(o.within['5'])}`),
    kpi('Acierto de dirección', share(o.directionHit), '', `Correlación de cambios diarios: ${num(o.corrChanges, 2)}`),
  ].join('') : '';

  // Tabla comparativa
  const rec = state.stats.recommendation[product];
  $('#prec-table').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Fuente</th><th class="n">Días</th><th class="n">Cobertura</th><th class="n">MAE</th><th class="n">Sesgo</th><th class="n">P90</th><th class="n">P95</th><th class="n">±1</th><th class="n">±2</th><th class="n">MAPE</th><th class="n">Corr.</th></tr></thead><tbody>${
    list.map((x) => { const q = x.overall; return `<tr><td>${esc(srcMeta(x.sourceId).shortName || x.name)}${x.sourceId === rec.primary ? ' <span class="light verde">Principal</span>' : x.sourceId === rec.backup ? ' <span class="light gris">Respaldo</span>' : ''}${x.comparable ? '' : `<div class="small muted">${esc(x.comparableNote)}</div>`}</td>
      <td class="n">${q.n ?? 0}</td><td class="n">${share(q.coverage)}</td><td class="n">${num(q.mae, 2)}</td><td class="n">${signed(q.bias, 2)}</td><td class="n">${num(q.p90Abs, 2)}</td><td class="n">${num(q.p95Abs, 2)}</td><td class="n">${share(q.within?.['1'])}</td><td class="n">${share(q.within?.['2'])}</td><td class="n">${q.mape == null ? '—' : `${num(q.mape, 2)}%`}</td><td class="n">${num(q.corrLevels, 3)}</td></tr>`; }).join('')
  }</tbody></table></div><p class="footnote">Valores en cUSD/gal salvo porcentajes. Periodo completo con datos de ambas fuentes${o?.from ? ` (${fmtDate(o.from)} – ${fmtDate(o.to)})` : ''}. ${rec.note ? esc(rec.note) : ''}</p>`;

  // Tolerancia
  $('#tolerance').innerHTML = tol.status === 'insuficiente'
    ? `<p>Historial insuficiente (${tol.n} días comparables) para proponer una tolerancia.</p>`
    : `<div class="stats"><div><span>${lightPill('verde', 'Verde')}</span><b>≤ ${num(tol.green, 2)}</b> <span>cUSD/gal</span></div><div><span>${lightPill('amarillo', 'Amarillo')}</span><b>${num(tol.green, 2)} – ${num(tol.yellow, 2)}</b> <span>cUSD/gal</span></div><div><span>${lightPill('rojo', 'Rojo')}</span><b>&gt; ${num(tol.yellow, 2)}</b> <span>cUSD/gal</span></div></div>
      <p class="small">Verde = percentil ${tol.greenP * 100} del error absoluto; amarillo hasta el percentil ${tol.yellowP * 100}; rojo por encima o cuando la comparación no es válida. Base: ${tol.n} días comparables de los últimos ${tol.windowMonths} meses (${fmtDate(tol.from)} – ${fmtDate(tol.to)}).</p>
      <p class="small"><b>${tol.status === 'validada' ? 'Tolerancia con historial suficiente.' : 'Tolerancia preliminar: historial menor al mínimo recomendado.'}</b> ${s.regimes.volatile.n ? `En días de mercado volátil (cambio diario oficial &gt; ${num(s.regimes.threshold, 1)} cUSD/gal) el P90 sube a ${num(s.regimes.volatile.p90Abs, 2)} vs ${num(s.regimes.calm.p90Abs, 2)} en días tranquilos.` : ''}</p>`;

  // Por año
  const yearTable = (ys) => `<div class="table-wrap"><table><thead><tr><th>Año</th><th class="n">Días</th><th class="n">MAE</th><th class="n">Sesgo</th><th class="n">P90</th><th class="n">Corr. cambios diarios</th></tr></thead><tbody>${
    ys.map((y) => `<tr><td>${y.year}</td><td class="n">${y.n}</td><td class="n">${num(y.mae, 2)}</td><td class="n">${signed(y.bias, 2)}</td><td class="n">${num(y.p90Abs, 2)}</td><td class="n">${num(y.corrChanges, 2)}</td></tr>`).join('')
  }</tbody></table></div>`;
  const years = [...s.byYear].reverse();
  $('#by-year').innerHTML = yearTable(years.slice(0, 6)) + (years.length > 6 ? `<details class="more"><summary>Ver ${years.length - 6} años anteriores</summary>${yearTable(years.slice(6))}</details>` : '');

  // Puntos débiles + desfase
  const best = [...s.lags].filter((l) => l.n).sort((a, b) => a.mae - b.mae)[0];
  $('#weak-spots').innerHTML = `<p class="small">${best && best.lag !== 0
    ? `<b>Posible desfase de fechas:</b> el error es menor si se compara el dato digital con el oficial de ${best.lag > 0 ? 'un día hábil antes' : 'un día hábil después'} (MAE ${num(best.mae, 2)} vs ${num(s.lags.find((l) => l.lag === 0)?.mae, 2)}). Revise la fecha de cotización que reporta la fuente.`
    : 'Las fechas de cotización están alineadas: comparar el mismo día da el menor error.'}</p>
    <div class="table-wrap"><table><thead><tr><th>Meses con mayor diferencia</th><th class="n">Días</th><th class="n">MAE</th><th class="n">Sesgo</th></tr></thead><tbody>${
      s.worstMonths.map((m) => `<tr><td>${m.month}</td><td class="n">${m.n}</td><td class="n">${num(m.mae, 2)}</td><td class="n">${signed(m.bias, 2)}</td></tr>`).join('')}</tbody></table></div>`;

  await renderDiffChart();
  await renderDay();
}

function indexEvaluation(product) {
  const ixs = state.stats?.indices?.[product] ?? [];
  return ixs.map((r) => {
    const ALIGN = { promedio: 'Promedio mensual AMEXGAS', dia_bls: 'AMEXGAS del día en que el BLS toma sus precios' };
    const best = r.variants.find((v) => v.align === r.best);
    const e = best.estimate, t = best.tolerance, c = best.changes;
    const head = e.n
      ? `${esc(r.name)} sigue la dirección de AMEXGAS en ${share(c.directionHit)} de los meses; una estimación calibrada se desvía en promedio ${num(e.mae, 1)} cUSD/gal (comparada contra: ${ALIGN[r.best].toLowerCase()}).`
      : `${esc(r.name)}: historial insuficiente para evaluar.`;
    return `<div class="card"><h3>${head}</h3>
      <div class="table-wrap"><table><thead><tr><th>Comparado contra</th><th class="n">Meses</th><th class="n">Corr. cambios mensuales</th><th class="n">Acierto de dirección</th><th class="n">MAE estimación</th><th class="n">Sesgo</th><th class="n">P90</th><th class="n">P95</th></tr></thead><tbody>${
        r.variants.map((v) => `<tr><td>${ALIGN[v.align]}${v.align === r.best ? ' <span class="light verde">Mejor ajuste</span>' : ''}</td><td class="n">${v.estimate.n ?? 0}</td><td class="n">${num(v.changes.corr, 2)}</td><td class="n">${share(v.changes.directionHit)}</td><td class="n">${num(v.estimate.mae, 2)}</td><td class="n">${signed(v.estimate.bias, 2)}</td><td class="n">${num(v.estimate.p90Abs, 2)}</td><td class="n">${num(v.estimate.p95Abs, 2)}</td></tr>`).join('')
      }</tbody></table></div>
      <p class="small"><b>Método:</b> estimación = índice del mes × mediana de (AMEXGAS ÷ índice) de los 12 meses anteriores; se evalúa fuera de muestra (el factor nunca usa el mes que se estima). Sin interpolar: los meses sin referencia se omiten. ${t.status !== 'insuficiente' ? `Tolerancia sugerida para esta aproximación: verde ≤ ${num(t.green, 1)}, amarillo ≤ ${num(t.yellow, 1)} cUSD/gal (últimos ${t.n} meses, ${t.status}).` : ''}</p>
      ${r.beyondOfficial.length ? `<p class="small"><b>Meses sin dato oficial:</b> ${r.beyondOfficial.map((b) => `${monthLabel(`${b.month}-01`)} ≈ ${num(b.estimate, 1)} cUSD/gal`).join(' · ')} (último mes oficial: ${r.lastOfficialMonth}).</p>` : ''}
      <p class="footnote">Valores en cUSD/gal sobre promedios mensuales. Un índice no permite calcular la diferencia diaria vs. AMEXGAS.</p></div>`;
  }).join('');
}

async function renderDiffChart() {
  segmented($('#diff-range'), RANGES.concat([[300, 'Todo']]), state.diffRange, (v) => { state.diffRange = v; renderDiffChart(); });
  const h = await api(`/api/private/history?product=${state.precProduct}&source=${state.precSource}&from=${monthsAgo(state.diffRange)}`);
  const s = sourcesWithStats(state.precProduct).find((x) => x.sourceId === state.precSource);
  const tol = s?.tolerance;
  $('#diff-title').textContent = `Diferencia diaria: ${srcMeta(state.precSource).shortName} menos AMEXGAS`;
  const byDate = new Map(h.rows.map((r) => [r.date, r]));
  lineChart($('#diff-chart'), {
    series: [{ name: 'Diferencia', cls: 'c1', rows: h.rows.map((r) => [r.date, r.signed]) }],
    unit: 'cUSD/gal', decimals: 2, zero: true, signed: true, band: tol?.green != null ? [-tol.green, tol.green] : null,
    ariaLabel: 'Diferencia diaria contra AMEXGAS',
    emptyText: 'Sin días comparables en el periodo',
    tooltipExtra: (d) => { const r = byDate.get(d); return r ? `<div class="t-row"><span>Digital</span><b>${num(r.digital, 2)}</b></div><div class="t-row"><span>AMEXGAS</span><b>${num(r.official, 2)}</b></div><div class="t-row"><span>Semáforo</span><b>${LIGHT_TEXT[r.light] ?? '—'}</b></div>` : ''; },
  });
}

async function renderDay() {
  const input = $('#day-date');
  input.max = new Date().toISOString().slice(0, 10);
  // Por defecto: el día más reciente con dato digital Y oficial.
  if (!input.value) {
    const lc = (state.priv?.products[state.precProduct] ?? []).find((x) => x.current.sourceId === state.precSource)?.lastComparable;
    if (lc?.quoteDate) input.value = lc.quoteDate;
  }
  const date = input.value;
  const r = await api(`/api/private/summary${date ? `?date=${date}` : ''}`);
  const entry = (r.products[state.precProduct] ?? []).find((x) => x.current.sourceId === state.precSource);
  const c = entry?.current;
  if (!c) { $('#day-detail').innerHTML = ''; return; }
  const sense = c.direction === 'arriba' ? 'por encima de' : c.direction === 'abajo' ? 'por debajo de' : 'igual a';
  const name = srcMeta(c.sourceId).shortName;
  $('#day-title').textContent = c.status === 'ok'
    ? (c.direction === 'igual' ? `${subj(c.sourceId)} coincide con AMEXGAS` : `${subj(c.sourceId)} está ${num(c.abs, 2)} cUSD/gal ${sense} AMEXGAS`)
    : 'Diferencia vs. AMEXGAS por día';
  const title = { sin_referencia: 'Sin referencia oficial disponible', no_comparable: 'No comparable', sin_dato_digital: 'Sin dato digital para esa fecha' }[c.status];
  $('#day-detail').innerHTML = c.status === 'ok'
    ? `<div class="stats"><div><span>Fecha de cotización</span><b>${fmtDate(c.quoteDate)}</b></div><div><span>Precio digital (${esc(name)})</span><b>${num(c.digital, 2)} cUSD/gal</b></div><div><span>Precio AMEXGAS</span><b>${num(c.official, 2)} cUSD/gal</b></div>
       <div><span>Diferencia vs. AMEXGAS</span><b>${signed(c.signed, 2)} cUSD/gal</b></div><div><span>Diferencia absoluta</span><b>${num(c.abs, 2)} cUSD/gal</b></div><div><span>Diferencia porcentual</span><b>${pct(c.pct, 2)}</b></div></div><p>${lightPill(c.light)}</p>`
    : `<div class="diff-empty">${title}</div><div class="diff-why">${esc(c.status === 'sin_referencia'
      ? `No hay precio AMEXGAS para el ${fmtDate(c.date)}${c.lastOfficialDate ? `; el último dato oficial cargado es del ${fmtDate(c.lastOfficialDate)}` : ''}. No se reutiliza un precio de otra fecha.`
      : c.status === 'sin_dato_digital' ? `${name} no publicó precio para esa fecha (fin de semana, festivo o dato faltante).` : c.reason)}</div>`;
}

// ───────────────────────────── Mercado ─────────────────────────────

async function renderMarket() {
  const m = await api('/api/market');
  const LV = { fuera_de_lo_habitual: ['rojo', 'Fuera de lo habitual'], relevante: ['amarillo', 'Movimiento relevante'], normal: ['verde', 'Dentro de lo habitual'], sin_historial: ['gris', 'Sin historial'], sin_datos: ['gris', 'Sin datos'] };
  $('#market-items').innerHTML = m.items.map((it) => {
    const [l, t] = LV[it.level] ?? ['gris', ''];
    return `<article class="card story"><div class="tag">${lightPill(l, t)}</div><h3>${esc(it.headline)}</h3>${it.body.map((p) => `<p>${esc(p)}</p>`).join('')}${it.watch ? `<p class="watch">${esc(it.watch)}</p>` : ''}
      ${it.sources.length ? `<ul>${it.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a> · ${esc(s.name)}, ${fmtDate(s.date)}</li>`).join('')}</ul>` : ''}</article>`;
  }).join('');
  const notes = m.notes;
  $('#market-context').innerHTML = `<h3>Indicadores y hechos recientes</h3>${
    m.context.length ? `<div class="table-wrap"><table><thead><tr><th>Indicador</th><th>Fecha</th><th class="n">Valor</th><th class="n">Cambio semanal</th><th>Fuente</th></tr></thead><tbody>${m.context.map((c) => `<tr><td>${esc(c.label)}</td><td>${fmtDate(c.date)}</td><td class="n">${num(c.value, 1)} ${esc(c.unit)}</td><td class="n ${dir(c.change)}">${signed(c.change, 1)}</td><td><a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.source)}</a></td></tr>`).join('')}</tbody></table></div>` : ''
  }${notes.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Hecho</th><th>Factor</th><th>Fuente</th></tr></thead><tbody>${notes.map((n) => `<tr><td class="n">${fmtDate(n.event_date)}</td><td><b>${esc(n.title)}</b><div class="small muted">${esc(n.summary)}</div></td><td>${esc(n.factor)}</td><td><a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.source_name)}</a></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Sin notas de mercado registradas en las últimas semanas. Agregue hechos verificados con <code>npm run add-notes</code>.</p>'}`;
}

// ───────────────────────────── Calidad ─────────────────────────────

async function renderQuality() {
  const q = await api('/api/quality');
  const ROLE = { principal: 'Referencia principal', secundaria: 'Secundaria', contexto: 'Contexto' };
  const RUN = { ok: ['verde', 'Datos nuevos'], sin_cambios: ['gris', 'Sin datos nuevos'], error: ['rojo', 'Error'], omitida: ['amarillo', 'Omitida'], en_curso: ['gris', 'En curso'] };
  const bad = q.filter((s) => s.enabled && (s.lastRun?.status === 'error' || s.perProduct.some((p) => ['atrasada', 'detenida'].includes(p.freshness.status)))).length;
  const on = q.filter((s) => s.enabled).length;
  $('#quality-lede').textContent = `${bad ? `${bad} de ${on} fuentes activas requieren revisión.` : `Las ${on} fuentes activas operan con normalidad.`} No existe hoy una fuente digital gratuita y automatizable para butano Mont Belvieu.`;
  // Lista agrupada (estilo Ajustes de iOS): lo esencial a la vista, el detalle bajo divulgación.
  $('#quality-table').innerHTML = `<ul class="sources">${q.map((s) => {
    const run = !s.enabled ? ['amarillo', 'Deshabilitada'] : RUN[s.lastRun?.status] ?? ['gris', 'Nunca consultada'];
    const when = s.lastRun?.finished_at ? new Date(s.lastRun.finished_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '';
    return `<li>
      <div class="src-head"><div><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" class="src-name">${esc(s.shortName)}</a><span class="src-role">${ROLE[s.role] ?? esc(s.role)}</span></div>
        <div class="src-run">${lightPill(run[0], run[1])}${when ? `<span>${when}</span>` : ''}</div></div>
      <div class="src-products">${s.perProduct.map((p) => { const [l, t] = FRESH[p.freshness.status]; return `<div><b>${esc(PRODUCT[p.product] ?? p.product)}</b><span>${p.lastDate ? `último dato ${fmtDate(p.lastDate)}` : 'sin datos'}</span>${s.enabled ? lightPill(l, t) : ''}<span class="muted">${p.n.toLocaleString('es-MX')} obs.${p.first ? ` desde ${fmtDate(p.first)}` : ''}</span></div>`; }).join('')}</div>
      ${s.lastRun?.message && s.lastRun.status !== 'sin_cambios' ? `<p class="small">${esc(s.lastRun.message)}</p>` : ''}
      <details class="src-more"><summary>Frecuencia, acceso y limitaciones</summary><dl>
        <dt>Serie</dt><dd>${esc(s.name)}</dd><dt>Frecuencia</dt><dd>${esc(s.frequency)}</dd><dt>Acceso</dt><dd>${esc(s.access)}</dd>
        <dt>Limitaciones</dt><dd>${esc(s.limitations)}</dd><dt>Términos</dt><dd>${esc(s.terms)}</dd>${s.revisions ? `<dt>Revisiones</dt><dd>${s.revisions} valores corregidos por la fuente</dd>` : ''}</dl></details>
    </li>`;
  }).join('')}</ul>`;
}

// ───────────────────────────── Arranque ─────────────────────────────

/** Marca en la barra la sección visible (la última cuyo inicio ya pasó bajo la barra). */
function activeTabs() {
  const tabs = [...document.querySelectorAll('.tab')];
  const sections = [...document.querySelectorAll('main section')].filter((s) => !s.hidden);
  let raf = 0;
  const update = () => {
    raf = 0;
    const atBottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
    const current = atBottom ? sections.at(-1) : sections.filter((s) => s.getBoundingClientRect().top <= 140).at(-1) ?? sections[0];
    tabs.forEach((t) => {
      const on = t.getAttribute('href') === `#${current.id}`;
      t.classList.toggle('active', on);
      if (on) t.setAttribute('aria-current', 'location'); else t.removeAttribute('aria-current');
    });
  };
  addEventListener('scroll', () => { raf ||= requestAnimationFrame(update); }, { passive: true });
  update();
}

async function init() {
  if (STATIC) await unlock();
  try {
    [state.me, state.overview, state.sources] = await Promise.all([api('/api/me'), api('/api/overview'), api('/api/sources')]);
  } catch (e) {
    $('#resumen-lede').textContent = `No se pudo cargar el dashboard: ${e.message}`;
    return;
  }
  const badge = $('#role-badge');
  badge.hidden = false;
  if (state.me.canSeePrivate) {
    badge.textContent = 'Validación privada activa';
    badge.classList.add('private');
    document.querySelectorAll('[data-private]').forEach((n) => { n.hidden = false; });
    try {
      [state.priv, state.stats] = await Promise.all([api('/api/private/summary'), api('/api/private/stats')]);
    } catch (e) {
      console.warn('Sección privada no disponible');
    }
  } else badge.textContent = 'Vista general';
  renderSummary();
  const jobs = [renderGlp(), renderCrude(), renderMarket(), renderQuality()];
  if (state.stats) {
    $('#day-date').addEventListener('change', renderDay);
    jobs.push(renderPrecision());
  }
  await Promise.allSettled(jobs);
  activeTabs();
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { renderGlp(); renderCrude(); if (state.stats) renderDiffChart(); }, 200); });
}

init();
