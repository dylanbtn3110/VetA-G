import { insertar } from './crud.js';

export function notificar(db, usuarioId, tipo, mensaje, citaId = null) {
  return insertar(db, 'notificaciones', { usuario_id: usuarioId, tipo, mensaje, cita_id: citaId });
}

export function notificarVeterinarios(db, tipo, mensaje, citaId = null) {
  const vets = db.prepare("SELECT id FROM usuarios WHERE rol = 'veterinario'").all();
  for (const v of vets) notificar(db, v.id, tipo, mensaje, citaId);
}
