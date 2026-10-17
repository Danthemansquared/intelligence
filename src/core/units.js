// Normalización de unidades. Toda conversión pasa por aquí para que no haya
// lógica duplicada. La unidad canónica para GLP es cUSD/gal (centavos de dólar
// por galón estadounidense); el crudo se mantiene en USD/bbl.

export const LITERS_PER_GALLON = 3.785411784; // galón estadounidense (exacto)
export const GALLONS_PER_BARREL = 42;

// Densidad de líquido a 60 °F, GPA Standard 2145 (g/cm³ = kg/L).
export const DENSITY_KG_PER_L = {
  propano: 0.5070,
  butano: 0.5840, // n-butano
};

export const UNITS = {
  'cUSD/gal': { label: 'cUSD/gal', kind: 'volume' },
  'USD/gal': { label: 'USD/gal', kind: 'volume' },
  'USD/bbl': { label: 'USD/bbl', kind: 'volume' },
  'USD/t': { label: 'USD/t', kind: 'mass' },
  'USD/kg': { label: 'USD/kg', kind: 'mass' },
};

export function kgPerGallon(product) {
  const d = DENSITY_KG_PER_L[product];
  if (!d) throw new Error(`Sin densidad definida para el producto "${product}"`);
  return d * LITERS_PER_GALLON;
}

/**
 * Convierte un precio a cUSD/gal. Devuelve { value, factor, method } para que
 * el registro conserve cómo se obtuvo el dato normalizado.
 */
export function toCentsPerGallon(value, unit, product) {
  if (!Number.isFinite(value)) throw new Error('Valor no numérico');
  switch (unit) {
    case 'cUSD/gal':
      return { value, method: 'sin conversión' };
    case 'USD/gal':
      return { value: value * 100, method: 'USD/gal × 100' };
    case 'USD/bbl':
      return { value: (value * 100) / GALLONS_PER_BARREL, method: 'USD/bbl × 100 ÷ 42 gal/bbl' };
    case 'USD/t': {
      const kg = kgPerGallon(product);
      return { value: (value / 1000) * kg * 100, method: `USD/t ÷ 1000 × ${kg.toFixed(4)} kg/gal × 100 (densidad GPA 2145)` };
    }
    case 'USD/kg': {
      const kg = kgPerGallon(product);
      return { value: value * kg * 100, method: `USD/kg × ${kg.toFixed(4)} kg/gal × 100 (densidad GPA 2145)` };
    }
    default:
      throw new Error(`Unidad no reconocida: "${unit}"`);
  }
}

/** Normaliza según el tipo de producto: GLP → cUSD/gal, crudo → USD/bbl. */
export function normalize(value, unit, product) {
  if (product === 'propano' || product === 'butano') {
    const r = toCentsPerGallon(value, unit, product);
    return { value: r.value, unit: 'cUSD/gal', method: r.method };
  }
  if (product === 'wti' || product === 'brent') {
    if (unit !== 'USD/bbl') throw new Error(`El crudo debe venir en USD/bbl, se recibió "${unit}"`);
    return { value, unit: 'USD/bbl', method: 'sin conversión' };
  }
  // Indicadores de contexto (inventarios, exportaciones): se guardan tal cual.
  return { value, unit, method: 'sin conversión' };
}

/** Rangos plausibles por producto en su unidad normalizada, para detectar errores de unidad o de parseo. */
export const PLAUSIBLE_RANGE = {
  propano: [5, 500], // cUSD/gal
  butano: [5, 600],
  wti: [-50, 300], // USD/bbl (WTI cerró en −37 USD/bbl el 2020-04-20)
  brent: [5, 300],
};

export function isPlausible(product, normalizedValue) {
  const r = PLAUSIBLE_RANGE[product];
  if (!r) return Number.isFinite(normalizedValue);
  return Number.isFinite(normalizedValue) && normalizedValue >= r[0] && normalizedValue <= r[1];
}
