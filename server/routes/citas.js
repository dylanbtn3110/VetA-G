import { esVet, mascotaAccesible, requerirUsuario } from '../lib/auth.js';
import { actualizar, insertar } from '../lib/crud.js';
import { fail } from '../lib/http.js';
import { ESTADOS_CITA } from '../lib/constants.js';
import { notificar, notificarVeterinarios } from '../lib/notify.js';
import { emergencyVet, horarioValido, pickVet, slots } from '../lib/scheduling.js';
import { hoyLima, sumarDias, sumarMin, textoLima } from '../lib/time.js';
import * as v from '../lib/validate.js';
import { idParam } from './cuentas.js';

const SELECT_CITA = `
  SELECT c.*, m.nombre AS mascota, m.especie, u.nombre AS cliente, u.telefono AS cliente_telefono,
         vt.nombre AS veterinario, s.nombre AS servicio, s.categoria, s.duracion_min
  FROM citas c
  JOIN mascotas m ON m.id = c.mascota_id
  JOIN usuarios u ON u.id = c.cliente_id
  JOIN usuarios vt ON vt.id = c.veterinario_id
  JOIN servicios s ON s.id = c.servicio_id`;

export const cargarCita = (db, id) => db.prepare(`${SELECT_CITA} WHERE c.id = ?`).get(id);

export function listarCitas(db, filtros, params, limite = 500) {
  return db.prepare(`${SELECT_CITA} WHERE ${filtros.join(' AND ')} ORDER BY c.inicio LIMIT ${limite}`).all(...params);
}

function citaAccesible(db, u, id) {
  const cita = cargarCita(db, id);
  if (!cita || (!esVet(u) && cita.cliente_id !== u.id)) fail(404, 'Cita no encontrada');
  return cita;
}

function servicioActivo(db, id) {
  const s = db.prepare('SELECT * FROM servicios WHERE id = ? AND activo = 1').get(id);
  if (!s) fail(404, 'Servicio no disponible');
  return s;
}

function validarVet(db, id) {
  if (!db.prepare("SELECT 1 FROM usuarios WHERE id = ? AND rol = 'veterinario'").get(id)) fail(400, 'Veterinario no válido');
  return id;
}

const ESTADO_LEGIBLE = {
  pendiente: 'pendiente de confirmar',
  confirmada: 'confirmada',
  en_camino: 'en camino',
  en_atencion: 'en atención',
  atendida: 'atendida',
  cancelada: 'cancelada',
  no_asistio: 'marcada como no asistió',
  urgente: 'urgente',
};

// Crea notificaciones para las citas que empiezan en la próxima hora. Se llama cada minuto.
export function enviarRecordatorios(db, ahora = new Date()) {
  const desde = textoLima(ahora);
  const hasta = sumarMin(desde, 60);
  const filas = db
    .prepare(
      `SELECT c.id, c.cliente_id, c.inicio, m.nombre AS mascota
       FROM citas c JOIN mascotas m ON m.id = c.mascota_id
       WHERE c.recordatorio_enviado = 0 AND c.estado IN ('pendiente', 'confirmada')
         AND c.inicio >= ? AND c.inicio <= ?`,
    )
    .all(desde, hasta);
  for (const f of filas) {
    notificar(db, f.cliente_id, 'recordatorio', `Recordatorio: ${f.mascota} tiene cita a las ${f.inicio.slice(11)}`, f.id);
    db.prepare('UPDATE citas SET recordatorio_enviado = 1 WHERE id = ?').run(f.id);
  }
  return filas.length;
}

export function registrar(r) {
  r.add('GET', '/api/disponibilidad', (c) => {
    requerirUsuario(c);
    const fecha = v.fecha(c.query.get('fecha'), 'fecha');
    const servicio = servicioActivo(c.db, v.entero(c.query.get('servicio_id'), 'servicio_id', { min: 1 }));
    const vetId = v.entero(c.query.get('veterinario_id'), 'veterinario_id', { min: 1, opcional: true });
    return { fecha, duracion_min: servicio.duracion_min, ...slots(c.db, { fecha, duracion: servicio.duracion_min, vetId }) };
  });

  r.add('GET', '/api/citas', (c) => {
    const u = requerirUsuario(c);
    const desde = v.fecha(c.query.get('desde') || hoyLima(), 'desde');
    const hasta = v.fecha(c.query.get('hasta') || sumarDias(desde, 30), 'hasta');
    const estado = v.opcion(c.query.get('estado'), 'estado', ESTADOS_CITA, { opcional: true });
    const mascotaId = v.entero(c.query.get('mascota_id'), 'mascota_id', { min: 1, opcional: true });
    const filtros = ['SUBSTR(c.inicio, 1, 10) BETWEEN ? AND ?'];
    const params = [desde, hasta];
    if (!esVet(u)) {
      filtros.push('c.cliente_id = ?');
      params.push(u.id);
    }
    if (estado) {
      filtros.push('c.estado = ?');
      params.push(estado);
    }
    if (mascotaId) {
      filtros.push('c.mascota_id = ?');
      params.push(mascotaId);
    }
    return listarCitas(c.db, filtros, params);
  });

  r.add('GET', '/api/citas/:id', (c) => citaAccesible(c.db, requerirUsuario(c), idParam(c)));

  r.add('POST', '/api/citas', async (c) => {
    const u = requerirUsuario(c);
    const b = await c.json();
    const mascota = mascotaAccesible(c.db, u, v.entero(b.mascota_id, 'mascota_id', { min: 1 }));
    const servicio = servicioActivo(c.db, v.entero(b.servicio_id, 'servicio_id', { min: 1 }));
    const fecha = v.fecha(b.fecha, 'fecha');
    const hora = v.hora(b.hora, 'hora');
    const motivo = v.texto(b.motivo, 'motivo', { max: 500, opcional: true });
    const vetPedido = v.entero(b.veterinario_id, 'veterinario_id', { min: 1, opcional: true });
    if (vetPedido) validarVet(c.db, vetPedido);

    horarioValido(fecha, hora, servicio.duracion_min);
    const inicio = `${fecha} ${hora}`;
    if (inicio <= textoLima()) fail(409, 'Ese horario ya pasó');
    const fin = sumarMin(inicio, servicio.duracion_min);
    const vet = pickVet(c.db, inicio, fin, vetPedido);
    if (!vet) fail(409, 'Ese horario ya no está disponible');

    const agendaVet = esVet(u);
    const id = insertar(c.db, 'citas', {
      mascota_id: mascota.id,
      cliente_id: mascota.cliente_id,
      veterinario_id: vet,
      servicio_id: servicio.id,
      inicio,
      fin,
      estado: agendaVet ? 'confirmada' : 'pendiente',
      motivo,
    });
    const cita = cargarCita(c.db, id);
    if (agendaVet) {
      notificar(c.db, mascota.cliente_id, 'cita', `Cita confirmada para ${mascota.nombre}: ${servicio.nombre}, ${inicio}`, id);
    } else {
      notificarVeterinarios(c.db, 'cita', `Nueva solicitud de ${cita.cliente} para ${mascota.nombre}: ${servicio.nombre}, ${inicio}`, id);
    }
    c.send(201, cita);
  });

  r.add('PATCH', '/api/citas/:id', async (c) => {
    const u = requerirUsuario(c);
    const cita = citaAccesible(c.db, u, idParam(c));
    const b = await c.json();
    const cambios = {};

    if (!esVet(u)) {
      if (Object.keys(b).some((k) => k !== 'estado') || b.estado !== 'cancelada') fail(403, 'Solo puedes cancelar tu cita');
      if (!['pendiente', 'confirmada', 'urgente'].includes(cita.estado)) fail(409, 'Esta cita ya no se puede cancelar');
      cambios.estado = 'cancelada';
    } else {
      if ('estado' in b) cambios.estado = v.opcion(b.estado, 'estado', ESTADOS_CITA);
      if ('motivo' in b) cambios.motivo = v.texto(b.motivo, 'motivo', { max: 500, opcional: true });
      if ('fecha' in b || 'hora' in b || 'veterinario_id' in b) {
        const fecha = v.fecha(b.fecha ?? cita.inicio.slice(0, 10), 'fecha');
        const hora = v.hora(b.hora ?? cita.inicio.slice(11, 16), 'hora');
        const vetId = b.veterinario_id ? validarVet(c.db, v.entero(b.veterinario_id, 'veterinario_id', { min: 1 })) : cita.veterinario_id;
        horarioValido(fecha, hora, cita.duracion_min);
        const inicio = `${fecha} ${hora}`;
        const fin = sumarMin(inicio, cita.duracion_min);
        if (!pickVet(c.db, inicio, fin, vetId, cita.id)) fail(409, 'Ese horario ya no está disponible');
        Object.assign(cambios, { inicio, fin, veterinario_id: vetId, recordatorio_enviado: 0 });
      }
    }
    if (!Object.keys(cambios).length) fail(400, 'No hay cambios para guardar');
    actualizar(c.db, 'citas', cita.id, cambios);
    const nueva = cargarCita(c.db, cita.id);

    if (esVet(u)) {
      const detalle = cambios.inicio ? `reprogramada para ${nueva.inicio}` : ESTADO_LEGIBLE[nueva.estado];
      notificar(c.db, nueva.cliente_id, 'cita', `Tu cita de ${nueva.mascota} (${nueva.servicio}) fue ${detalle}`, nueva.id);
    } else {
      notificar(c.db, nueva.veterinario_id, 'cita', `${nueva.cliente} canceló la cita de ${nueva.mascota} (${nueva.inicio})`, nueva.id);
    }
    return nueva;
  });

  // El cliente avisa que va en camino: el veterinario asignado recibe la notificación.
  r.add('POST', '/api/citas/:id/llegada', async (c) => {
    const u = requerirUsuario(c, ['cliente']);
    const cita = citaAccesible(c.db, u, idParam(c));
    if (!['pendiente', 'confirmada', 'urgente'].includes(cita.estado)) fail(409, 'Esta cita ya no admite aviso de llegada');
    if (!cita.es_emergencia && cita.inicio.slice(0, 10) !== hoyLima()) fail(409, 'Puedes avisar tu llegada el mismo día de la cita');
    const b = await c.json();
    const espera = v.entero(b.minutos, 'minutos', { min: 0, max: 240, opcional: true });
    actualizar(c.db, 'citas', cita.id, { estado: cita.estado === 'urgente' ? 'urgente' : 'en_camino', llegada_minutos: espera });
    const cuando = espera === null ? 'está en camino' : espera === 0 ? 'ya llegó' : `llega en ${espera} min`;
    const tipo = cita.es_emergencia ? 'urgencia' : 'llegada';
    notificar(c.db, cita.veterinario_id, tipo, `${cita.cliente} ${cuando} con ${cita.mascota} (cita ${cita.inicio.slice(11)})`, cita.id);
    return cargarCita(c.db, cita.id);
  });

  // Urgencia: entra de inmediato, sin bloquearse por la agenda, y avisa a todos los veterinarios.
  r.add('POST', '/api/emergencias', async (c) => {
    const u = requerirUsuario(c);
    const b = await c.json();
    const mascota = mascotaAccesible(c.db, u, v.entero(b.mascota_id, 'mascota_id', { min: 1 }));
    const motivo = v.texto(b.motivo, 'motivo', { max: 500 });
    const servicio = b.servicio_id
      ? servicioActivo(c.db, v.entero(b.servicio_id, 'servicio_id', { min: 1 }))
      : c.db.prepare("SELECT * FROM servicios WHERE categoria = 'emergencia' AND activo = 1 ORDER BY id LIMIT 1").get();
    if (!servicio) fail(503, 'No hay un servicio de urgencias configurado');
    const espera = v.entero(b.minutos, 'minutos', { min: 0, max: 240, opcional: true });

    const inicio = textoLima();
    const fin = sumarMin(inicio, servicio.duracion_min);
    const vet = emergencyVet(c.db, inicio, fin);
    const id = insertar(c.db, 'citas', {
      mascota_id: mascota.id,
      cliente_id: mascota.cliente_id,
      veterinario_id: vet,
      servicio_id: servicio.id,
      inicio,
      fin,
      estado: 'urgente',
      es_emergencia: 1,
      motivo,
      llegada_minutos: espera,
    });
    const llegada = espera === null ? '' : ` Llega en ${espera} min.`;
    notificarVeterinarios(c.db, 'urgencia', `URGENCIA: ${mascota.nombre} (${mascota.especie}): ${motivo}.${llegada}`, id);
    c.send(201, cargarCita(c.db, id));
  });
}
