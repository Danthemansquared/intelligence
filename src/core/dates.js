// Utilidades de fechas. Todas las fechas de cotización son strings ISO
// "YYYY-MM-DD" sin zona horaria (días de operación en Mont Belvieu, hora de
// Houston). Las marcas de tiempo de consulta/publicación son ISO completas.

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s) {
  if (typeof s !== 'string' || !ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function toDate(s) {
  return new Date(`${s}T00:00:00Z`);
}

export function fmt(d) {
  return d.toISOString().slice(0, 10);
}

export function addDays(s, n) {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

export function addMonths(s, n) {
  const d = toDate(s);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return fmt(d);
}

export function isWeekend(s) {
  const w = toDate(s).getUTCDay();
  return w === 0 || w === 6;
}

/** Días hábiles (lun–vie) estrictamente posteriores a `from` y hasta `to` inclusive. */
export function businessDaysBetween(from, to) {
  if (to <= from) return 0;
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (!isWeekend(d)) n++;
  return n;
}

/** Fecha de hoy en Houston (America/Chicago), que es el calendario de Mont Belvieu. */
export function todayHouston(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts; // en-CA → YYYY-MM-DD
}

/** Convierte un número de serie de Excel (sistema 1900) a fecha ISO. */
export function excelSerialToIso(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return fmt(new Date(ms));
}
