// Toda la lógica de horarios trabaja en hora de Lima.
// Los instantes se guardan como texto 'AAAA-MM-DD HH:MM', que ordena bien con comparaciones de cadena.
const TZ = 'America/Lima';

const formato = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function textoLima(date = new Date()) {
  const p = Object.fromEntries(formato.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export const hoyLima = (date = new Date()) => textoLima(date).slice(0, 10);

export function minutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function aHora(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function sumarMin(texto, mins) {
  const [f, h] = texto.split(' ');
  const [y, mo, d] = f.split('-').map(Number);
  const [hh, mm] = h.split(':').map(Number);
  const iso = new Date(Date.UTC(y, mo - 1, d, hh, mm + mins)).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export function sumarDias(fecha, dias) {
  return sumarMin(`${fecha} 12:00`, dias * 1440).slice(0, 10);
}

// 0 = domingo ... 6 = sábado
export function diaSemana(fecha) {
  return new Date(`${fecha}T12:00:00Z`).getUTCDay();
}
