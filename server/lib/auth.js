import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { fail } from './http.js';
import { insertar } from './crud.js';

const DURACION_SESION_MS = 30 * 24 * 3600 * 1000;

export function hashClave(clave) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(clave, salt, 64).toString('hex')}`;
}

export function verificarClave(clave, guardada) {
  const [, salt, hash] = guardada.split('$');
  const esperado = Buffer.from(hash, 'hex');
  const real = scryptSync(clave, salt, esperado.length);
  return timingSafeEqual(real, esperado);
}

export function crearUsuario(db, { rol, nombre, email, clave, telefono = null, docTipo = null, docNumero = null, direccion = null }) {
  return insertar(db, 'usuarios', {
    rol,
    nombre,
    email,
    telefono,
    doc_tipo: docTipo,
    doc_numero: docNumero,
    direccion,
    password_hash: hashClave(clave),
  });
}

export function datosUsuario(db, id) {
  return db
    .prepare('SELECT id, rol, nombre, email, telefono, doc_tipo, doc_numero, direccion FROM usuarios WHERE id = ?')
    .get(id);
}

export function crearSesion(db, usuarioId) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sesiones (token, usuario_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    usuarioId,
    new Date(Date.now() + DURACION_SESION_MS).toISOString(),
  );
  return token;
}

export function usuarioActual(c) {
  if (c.user !== undefined) return c.user;
  const cabecera = c.req.headers.authorization ?? '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7).trim() : '';
  c.user = token
    ? c.db
        .prepare(
          `SELECT u.id, u.rol, u.nombre, u.email, u.telefono, u.doc_tipo, u.doc_numero, u.direccion
           FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
           WHERE s.token = ? AND s.expires_at > ?`,
        )
        .get(token, new Date().toISOString()) ?? null
    : null;
  return c.user;
}

export function requerirUsuario(c, roles) {
  const u = usuarioActual(c);
  if (!u) fail(401, 'Inicia sesión para continuar');
  if (roles && !roles.includes(u.rol)) fail(403, 'No tienes permiso para esta acción');
  return u;
}

export const esVet = (u) => u.rol === 'veterinario';

export function mascotaAccesible(db, u, id) {
  const mascota = db.prepare('SELECT * FROM mascotas WHERE id = ?').get(id);
  if (!mascota || (!esVet(u) && mascota.cliente_id !== u.id)) fail(404, 'Mascota no encontrada');
  return mascota;
}
