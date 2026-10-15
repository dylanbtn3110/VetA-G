import { OCUPA_HORARIO } from './constants.js';
import { aHora, diaSemana, minutos, sumarMin, textoLima } from './time.js';
import { fail } from './http.js';

// Horario por día de la semana (0 = domingo). Valores en minutos desde medianoche.
export const HORARIO = {
  0: [10 * 60, 13 * 60],
  1: [9 * 60, 19 * 60],
  2: [9 * 60, 19 * 60],
  3: [9 * 60, 19 * 60],
  4: [9 * 60, 19 * 60],
  5: [9 * 60, 19 * 60],
  6: [9 * 60, 14 * 60],
};

export const PASO_MIN = 15;

export function veterinarios(db) {
  return db.prepare("SELECT id FROM usuarios WHERE rol = 'veterinario' ORDER BY id").all().map((r) => r.id);
}

export function vetLibre(db, vetId, inicio, fin, excluirCitaId = 0) {
  const { n } = db
    .prepare(
      `SELECT COUNT(*) AS n FROM citas
       WHERE veterinario_id = ? AND id <> ? AND ${OCUPA_HORARIO} AND inicio < ? AND fin > ?`,
    )
    .get(vetId, excluirCitaId, fin, inicio);
  return n === 0;
}

// Devuelve el veterinario que puede atender en ese horario, o null.
export function pickVet(db, inicio, fin, vetId = null, excluirCitaId = 0) {
  const candidatos = vetId ? [vetId] : veterinarios(db);
  return candidatos.find((v) => vetLibre(db, v, inicio, fin, excluirCitaId)) ?? null;
}

// Urgencias: no se bloquean por agenda. Se asigna al veterinario con menos citas en ese rango.
export function emergencyVet(db, inicio, fin) {
  const fila = db
    .prepare(
      `SELECT u.id, (
         SELECT COUNT(*) FROM citas c
         WHERE c.veterinario_id = u.id AND ${OCUPA_HORARIO} AND c.inicio < ? AND c.fin > ?
       ) AS carga
       FROM usuarios u WHERE u.rol = 'veterinario'
       ORDER BY carga, u.id LIMIT 1`,
    )
    .get(fin, inicio);
  if (!fila) fail(503, 'No hay veterinarios registrados para atender urgencias');
  return fila.id;
}

export function horarioValido(fecha, hora, duracion) {
  const h = HORARIO[diaSemana(fecha)];
  const t = minutos(hora);
  if (!h || t < h[0] || t + duracion > h[1] || (t - h[0]) % PASO_MIN !== 0) {
    fail(409, 'Fuera del horario de atención');
  }
}

export function slots(db, { fecha, duracion, vetId = null, ahora = textoLima() }) {
  const h = HORARIO[diaSemana(fecha)];
  if (!h) return { cerrado: true, slots: [] };
  const vets = vetId ? [vetId] : veterinarios(db);
  const lista = [];
  for (let t = h[0]; t + duracion <= h[1]; t += PASO_MIN) {
    const hh = aHora(t);
    const inicio = `${fecha} ${hh}`;
    const fin = sumarMin(inicio, duracion);
    const yaPaso = inicio <= ahora;
    const disponible = !yaPaso && vets.some((v) => vetLibre(db, v, inicio, fin));
    lista.push({ hora: hh, disponible });
  }
  return { cerrado: false, slots: lista };
}
