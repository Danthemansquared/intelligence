// Registro de fuentes. Cada entrada documenta referencia, unidad, frecuencia,
// acceso, términos y limitaciones (detalle en docs/FUENTES.md) y expone fetch().
//
// kind: 'price' (se grafica y compara) | 'context' (indicador de contexto)
// role: 'principal' | 'secundaria' | 'contexto'
// comparable: false si la fuente NO publica la misma referencia que AMEXGAS
// maxLagBusinessDays: rezago normal de publicación; por encima → alerta de antigüedad
// cls: color fijo de la serie en las gráficas (c1…c4)
// enabled: false → no se consulta (p. ej. términos de uso pendientes de revisión)
import { fredFetcher } from './fred.js';
import { eiaFetcher } from './eia.js';
import { yahooFetcher, tradingEconomicsFetcher } from './web.js';

export const PRICE_PRODUCTS = ['propano', 'butano', 'wti', 'brent'];

const ALL_SOURCES = [
  {
    id: 'eia_propano',
    kind: 'price',
    role: 'principal',
    cls: 'c1',
    name: 'EIA — Mont Belvieu, TX Propane Spot Price FOB (EER_EPLLPA_PF4_Y44MB_DPG)',
    shortName: 'EIA',
    url: 'https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=EER_EPLLPA_PF4_Y44MB_DPG&f=D',
    products: ['propano'],
    displayPriority: { propano: 1 },
    // label: texto corto para el usuario; reference: descripción técnica (sólo en «Calidad de datos»).
    label: { propano: 'Precio diario de Mont Belvieu' },
    reference: { propano: 'Propano spot FOB Mont Belvieu (LSEG/Refinitiv)', default: 'Spot FOB' },
    conversionNote: { propano: 'USD/gal × 100 → cUSD/gal' },
    location: 'Mont Belvieu, Texas',
    unit: 'USD/gal (se guarda también en cUSD/gal)',
    frequency: 'Precio diario publicado una vez por semana (normalmente miércoles); rezago de hasta ~8 días hábiles',
    history: 'Diaria desde 1992-07-09',
    access: 'Tabla HTML pública sin llave; respaldo automático vía FRED (DPROPANEMBTX, CSV)',
    terms: 'Datos públicos del gobierno de EE. UU.; uso libre citando a EIA.',
    limitations: 'Publicación semanal: el último dato puede tener una semana. EIA no indica si es TET o non-TET. No publica butano.',
    comparable: true,
    maxLagBusinessDays: 8,
    fetch: eiaFetcher({ propano: { series: 'EER_EPLLPA_PF4_Y44MB_DPG', freq: 'D', unit: 'USD/gal', fred: 'DPROPANEMBTX' } }),
  },
  {
    id: 'te_propano',
    enabled: false,
    publicSite: false, // Términos de uso de la página pública no verificados: habilitar sólo tras revisarlos.
    kind: 'price',
    role: 'secundaria',
    cls: 'c2',
    name: 'Trading Economics — Propane (PNL:COM)',
    shortName: 'Trading Economics',
    url: 'https://tradingeconomics.com/commodity/propane',
    products: ['propano'],
    displayPriority: { propano: 2 },
    label: { propano: 'Cotización diaria de Mont Belvieu' },
    reference: { propano: 'Propano Mont Belvieu, cotización OTC/CFD de Trading Economics', default: 'OTC/CFD' },
    conversionNote: { propano: 'USD/gal × 100 → cUSD/gal' },
    location: 'Mont Belvieu, Texas',
    unit: 'USD/gal con 2 decimales (resolución 1 cUSD/gal)',
    frequency: 'Diaria, sin rezago',
    history: 'Sólo el dato del día (el historial requiere la API de pago); se acumula desde que se habilita',
    access: 'Página web pública (resumen de texto)',
    terms: 'API de pago (≈ USD 199/mes, plan Standard). Términos sobre extracción de la página pública NO verificados.',
    limitations: 'Metodología OTC/CFD no documentada; redondeo a 0.01 USD/gal; no publica butano; la página puede cambiar sin aviso.',
    comparable: true,
    maxLagBusinessDays: 2,
    fetch: tradingEconomicsFetcher(),
  },
  {
    id: 'eia_crudo',
    kind: 'price',
    role: 'principal',
    cls: 'c1',
    name: 'EIA — Precios spot de crudo: WTI Cushing (RWTC) y Brent Europa (RBRTE)',
    shortName: 'EIA',
    url: 'https://www.eia.gov/dnav/pet/pet_pri_spt_s1_d.htm',
    products: ['wti', 'brent'],
    displayPriority: { wti: 1, brent: 1 },
    label: { wti: 'Precio del barril en Cushing, Oklahoma', brent: 'Precio del barril en el Mar del Norte' },
    reference: { wti: 'WTI Cushing, OK, spot FOB', brent: 'Brent Europa, spot FOB', default: 'Spot FOB' },
    location: 'Cushing, Oklahoma (WTI) · Mar del Norte (Brent)',
    unit: 'USD/bbl',
    frequency: 'Precio diario publicado una vez por semana; rezago de hasta ~8 días hábiles',
    history: 'WTI desde 1986, Brent desde 1987',
    access: 'Tabla HTML pública sin llave; respaldo vía FRED (DCOILWTICO, DCOILBRENTEU)',
    terms: 'Datos públicos del gobierno de EE. UU.; uso libre citando a EIA.',
    limitations: 'Precio físico spot de cierre; no refleja el día en curso. El Brent spot físico puede diferir mucho del futuro.',
    maxLagBusinessDays: 8,
    fetch: eiaFetcher({
      wti: { series: 'RWTC', freq: 'D', unit: 'USD/bbl', fred: 'DCOILWTICO' },
      brent: { series: 'RBRTE', freq: 'D', unit: 'USD/bbl', fred: 'DCOILBRENTEU' },
    }),
  },
  {
    id: 'yahoo_futuros',
    publicSite: false, // términos de Yahoo: sólo uso personal; no se publica en el sitio público
    kind: 'price',
    role: 'secundaria',
    cls: 'c3',
    name: 'Yahoo Finance — Futuros de primer mes: WTI NYMEX (CL=F) y Brent Last Day Financial NYMEX (BZ=F)',
    shortName: 'Mercado de futuros',
    url: 'https://finance.yahoo.com/quote/CL=F/',
    products: ['wti', 'brent'],
    displayPriority: { wti: 2, brent: 2 },
    label: { wti: 'Cierre del mercado de futuros', brent: 'Cierre del mercado de futuros' },
    reference: { wti: 'Futuro WTI NYMEX, primer mes (cierre)', brent: 'Futuro Brent NYMEX Last Day Financial, primer mes (cierre)', default: 'Futuro primer mes' },
    location: 'NYMEX (CME Group)',
    unit: 'USD/bbl',
    frequency: 'Diaria, cierre del día hábil',
    history: '2 años por consulta (más disponible)',
    access: 'API JSON no oficial (query1.finance.yahoo.com)',
    terms: 'Uso personal según términos de Yahoo; sin garantía ni acuerdo de servicio. Revisar antes de uso empresarial.',
    limitations: 'Futuro, no spot: cambia de contrato al vencimiento (saltos en la serie). La barra del día en curso se descarta hasta el cierre.',
    maxLagBusinessDays: 2,
    fetch: yahooFetcher({ wti: { symbol: 'CL=F', unit: 'USD/bbl' }, brent: { symbol: 'BZ=F', unit: 'USD/bbl' } }),
  },
  {
    id: 'fred_ppi_butano',
    kind: 'index',
    role: 'secundaria',
    cls: 'c2',
    name: 'BLS vía FRED — Producer Price Index by Commodity: Butane (WPU05320105)',
    shortName: 'Índice de precios EE. UU.',
    url: 'https://fred.stlouisfed.org/series/WPU05320105',
    products: ['ppi_butano'],
    relatesTo: ['butano'],
    label: { ppi_butano: 'Precio del butano en EE. UU.' },
    reference: { ppi_butano: 'Índice de precios al productor de butano en EE. UU. (no estacionalizado)', default: 'PPI' },
    location: 'Estados Unidos (precios de productores; no específico de Mont Belvieu)',
    unit: 'Índice 1982=100',
    frequency: 'Mensual; se publica a mediados del mes siguiente (sep-2026 publicado el 15-oct-2026). Los últimos 4 meses son preliminares y se revisan',
    history: 'Mensual desde 1977-06',
    access: 'CSV público sin llave (fredgraph.csv)',
    terms: 'Datos públicos del BLS redistribuidos por FRED; uso libre citando la fuente.',
    limitations: 'Es un índice, no un precio: no se puede restar de AMEXGAS en cUSD/gal. Mensual, con ~6 semanas de rezago. Precio de referencia del BLS: martes de la semana que contiene el día 13.',
    maxLagBusinessDays: 60,
    fetch: fredFetcher({ ppi_butano: { series: 'WPU05320105', unit: 'Índice 1982=100' } }, { historyFrom: '1977-01-01' }),
  },
  {
    id: 'eia_semanal',
    kind: 'context',
    role: 'contexto',
    name: 'EIA — Weekly Petroleum Status Report: inventarios y exportaciones de propano/propileno de EE. UU.',
    shortName: 'EIA',
    url: 'https://www.eia.gov/petroleum/supply/weekly/',
    products: ['inv_propano_eeuu', 'exp_propano_eeuu'],
    relatesTo: ['propano', 'butano'],
    contextLabel: { inv_propano_eeuu: 'Los inventarios de propano/propileno de EE. UU.', exp_propano_eeuu: 'Las exportaciones de propano/propileno de EE. UU.' },
    reference: { default: 'WPRSTUS1 (inventarios) · W_EPLLPZ_EEX_NUS-Z00_MBBLD (exportaciones)' },
    location: 'Estados Unidos',
    unit: 'MMbbl (inventarios) · mil b/d (exportaciones)',
    frequency: 'Semanal (miércoles), semana que termina el viernes previo',
    history: 'Inventarios desde 2015 en esta tabla; exportaciones desde 2010',
    access: 'Tabla HTML pública sin llave',
    terms: 'Datos públicos del gobierno de EE. UU.',
    limitations: 'Las exportaciones semanales son estimaciones y se revisan con los datos mensuales.',
    maxLagBusinessDays: 10,
    fetch: eiaFetcher({
      inv_propano_eeuu: { series: 'WPRSTUS1', freq: 'W', unit: 'MMbbl', scale: 0.001 },
      exp_propano_eeuu: { series: 'W_EPLLPZ_EEX_NUS-Z00_MBBLD', freq: 'W', unit: 'mil b/d' },
    }),
  },
];

// En el sitio público (PUBLIC_SITE=1) se excluyen fuentes cuyos términos no permiten redistribución.
export const SOURCES = process.env.PUBLIC_SITE === '1' ? ALL_SOURCES.filter((s) => s.publicSite !== false) : ALL_SOURCES;

export function sourceById(id) {
  return SOURCES.find((s) => s.id === id);
}
