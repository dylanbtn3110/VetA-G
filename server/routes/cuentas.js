import { randomBytes } from 'node:crypto';
import {
  crearSesion,
  crearUsuario,
  datosUsuario,
  esVet,
  mascotaAccesible,
  requerirUsuario,
  verificarClave,
} from '../lib/auth.js';
import { actualizar, insertar } from '../lib/crud.js';
import { fail } from '../lib/http.js';
import { soles } from '../lib/money.js';
import { CATEGORIAS_SERVICIO, DOC_TIPOS, SEXOS, TIPOS_SUNAT } from '../lib/constants.js';
import * as v from '../lib/validate.js';

export const idParam = (c) => v.entero(c.params.id, 'id', { min: 1 });

function validarClave(clave) {
  if (typeof clave !== 'string' || clave.length < 8 || clave.length > 200) {
    fail(400, 'La contraseña debe tener al menos 8 caracteres');
  }
  return clave;
}

function datosNuevoUsuario(db, b, rol) {
  const email = v.correo(b.email);
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) fail(409, 'Ya existe una cuenta con ese email');
  return {
    rol,
    nombre: v.texto(b.nombre, 'nombre', { max: 120 }),
    email,
    clave: validarClave(b.password),
    telefono: v.texto(b.telefono, 'teléfono', { max: 30, opcional: true }),
    docTipo: v.opcion(b.doc_tipo, 'tipo de documento', DOC_TIPOS, { opcional: true }) ?? '0',
    docNumero: v.texto(b.doc_numero, 'número de documento', { max: 20, opcional: true }),
    direccion: v.texto(b.direccion, 'dirección', { max: 200, opcional: true }),
  };
}

const vistaServicio = (s) => ({ ...s, precio: soles(s.precio_mil), activo: Boolean(s.activo) });

const VALIDAR_MASCOTA = {
  nombre: (x) => v.texto(x, 'nombre', { max: 80 }),
  especie: (x) => v.texto(x, 'especie', { max: 40 }),
  raza: (x) => v.texto(x, 'raza', { max: 60, opcional: true }),
  sexo: (x) => v.opcion(x, 'sexo', SEXOS, { opcional: true }),
  fecha_nacimiento: (x) => v.fecha(x, 'fecha de nacimiento', { opcional: true }),
  peso_kg: (x) => v.numero(x, 'peso', { min: 0, max: 200, opcional: true }),
  notas: (x) => v.texto(x, 'notas', { max: 1000, opcional: true }),
};

// En una edición (parcial) solo se validan y tocan los campos enviados.
function camposMascota(b, parcial) {
  const campos = {};
  for (const [k, validar] of Object.entries(VALIDAR_MASCOTA)) {
    if (!parcial || k in b) campos[k] = validar(b[k]);
  }
  return campos;
}

export function registrar(r) {
  // ---------- Autenticación ----------
  r.add('POST', '/api/auth/registro', async (c) => {
    const datos = datosNuevoUsuario(c.db, await c.json(), 'cliente');
    const id = crearUsuario(c.db, datos);
    c.send(201, { token: crearSesion(c.db, id), usuario: datosUsuario(c.db, id) });
  });

  r.add('POST', '/api/auth/login', async (c) => {
    const b = await c.json();
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    const fila = c.db.prepare('SELECT id, password_hash FROM usuarios WHERE email = ?').get(email);
    if (!fila || !verificarClave(String(b.password ?? ''), fila.password_hash)) {
      fail(401, 'Email o contraseña incorrectos');
    }
    return { token: crearSesion(c.db, fila.id), usuario: datosUsuario(c.db, fila.id) };
  });

  r.add('POST', '/api/auth/logout', (c) => {
    const cabecera = c.req.headers.authorization ?? '';
    if (cabecera.startsWith('Bearer ')) c.db.prepare('DELETE FROM sesiones WHERE token = ?').run(cabecera.slice(7).trim());
    return { ok: true };
  });

  r.add('GET', '/api/auth/yo', (c) => requerirUsuario(c));

  // ---------- Veterinarios ----------
  r.add('GET', '/api/veterinarios', (c) => {
    requerirUsuario(c);
    return c.db.prepare("SELECT id, nombre FROM usuarios WHERE rol = 'veterinario' ORDER BY nombre").all();
  });

  r.add('POST', '/api/veterinarios', async (c) => {
    requerirUsuario(c, ['veterinario']);
    const id = crearUsuario(c.db, datosNuevoUsuario(c.db, await c.json(), 'veterinario'));
    c.send(201, datosUsuario(c.db, id));
  });

  // ---------- Servicios (público para listar) ----------
  r.add('GET', '/api/servicios', (c) => {
    const todos = c.query.get('todos') === '1';
    if (todos) requerirUsuario(c, ['veterinario']);
    const filas = c.db
      .prepare(`SELECT * FROM servicios ${todos ? '' : 'WHERE activo = 1'} ORDER BY categoria, nombre`)
      .all();
    return filas.map(vistaServicio);
  });

  r.add('POST', '/api/servicios', async (c) => {
    requerirUsuario(c, ['veterinario']);
    const b = await c.json();
    const nombre = v.texto(b.nombre, 'nombre', { max: 80 });
    if (c.db.prepare('SELECT 1 FROM servicios WHERE nombre = ?').get(nombre)) fail(409, 'Ya existe un servicio con ese nombre');
    const id = insertar(c.db, 'servicios', {
      nombre,
      categoria: v.opcion(b.categoria, 'categoría', CATEGORIAS_SERVICIO),
      duracion_min: v.entero(b.duracion_min, 'duración', { min: 5, max: 480 }),
      precio_mil: v.soles(b.precio, 'precio'),
      tipo_sunat: v.opcion(b.tipo_sunat, 'tipo SUNAT', TIPOS_SUNAT, { opcional: true }) ?? 'Servicio',
    });
    c.send(201, vistaServicio(c.db.prepare('SELECT * FROM servicios WHERE id = ?').get(id)));
  });

  r.add('PATCH', '/api/servicios/:id', async (c) => {
    requerirUsuario(c, ['veterinario']);
    const id = idParam(c);
    if (!c.db.prepare('SELECT 1 FROM servicios WHERE id = ?').get(id)) fail(404, 'Servicio no encontrado');
    const b = await c.json();
    actualizar(c.db, 'servicios', id, {
      nombre: 'nombre' in b ? v.texto(b.nombre, 'nombre', { max: 80 }) : undefined,
      categoria: 'categoria' in b ? v.opcion(b.categoria, 'categoría', CATEGORIAS_SERVICIO) : undefined,
      duracion_min: 'duracion_min' in b ? v.entero(b.duracion_min, 'duración', { min: 5, max: 480 }) : undefined,
      precio_mil: 'precio' in b ? v.soles(b.precio, 'precio') : undefined,
      tipo_sunat: 'tipo_sunat' in b ? v.opcion(b.tipo_sunat, 'tipo SUNAT', TIPOS_SUNAT) : undefined,
      activo: 'activo' in b ? (b.activo ? 1 : 0) : undefined,
    });
    return vistaServicio(c.db.prepare('SELECT * FROM servicios WHERE id = ?').get(id));
  });

  // ---------- Mascotas ----------
  r.add('GET', '/api/mascotas', (c) => {
    const u = requerirUsuario(c);
    const base = `SELECT m.*, u.nombre AS cliente FROM mascotas m JOIN usuarios u ON u.id = m.cliente_id`;
    if (!esVet(u)) return c.db.prepare(`${base} WHERE m.cliente_id = ? ORDER BY m.nombre`).all(u.id);
    const clienteId = v.entero(c.query.get('cliente_id'), 'cliente_id', { min: 1, opcional: true });
    return clienteId
      ? c.db.prepare(`${base} WHERE m.cliente_id = ? ORDER BY m.nombre`).all(clienteId)
      : c.db.prepare(`${base} ORDER BY m.nombre LIMIT 500`).all();
  });

  r.add('POST', '/api/mascotas', async (c) => {
    const u = requerirUsuario(c);
    const b = await c.json();
    let clienteId = u.id;
    if (esVet(u)) {
      clienteId = v.entero(b.cliente_id, 'cliente_id', { min: 1 });
      if (!c.db.prepare("SELECT 1 FROM usuarios WHERE id = ? AND rol = 'cliente'").get(clienteId)) fail(404, 'Cliente no encontrado');
    }
    const id = insertar(c.db, 'mascotas', { cliente_id: clienteId, ...camposMascota(b, false) });
    c.send(201, c.db.prepare('SELECT * FROM mascotas WHERE id = ?').get(id));
  });

  r.add('GET', '/api/mascotas/:id', (c) => {
    const u = requerirUsuario(c);
    const m = mascotaAccesible(c.db, u, idParam(c));
    return { ...m, cliente: datosUsuario(c.db, m.cliente_id) };
  });

  r.add('PATCH', '/api/mascotas/:id', async (c) => {
    const u = requerirUsuario(c);
    const m = mascotaAccesible(c.db, u, idParam(c));
    actualizar(c.db, 'mascotas', m.id, camposMascota(await c.json(), true));
    return c.db.prepare('SELECT * FROM mascotas WHERE id = ?').get(m.id);
  });

  // ---------- Clientes (solo veterinario) ----------
  r.add('GET', '/api/clientes', (c) => {
    requerirUsuario(c, ['veterinario']);
    const q = (c.query.get('q') ?? '').trim();
    const like = `%${q}%`;
    return c.db
      .prepare(
        `SELECT u.id, u.nombre, u.email, u.telefono, u.doc_tipo, u.doc_numero,
           (SELECT COUNT(*) FROM mascotas m WHERE m.cliente_id = u.id) AS mascotas,
           (SELECT MAX(inicio) FROM citas c WHERE c.cliente_id = u.id) AS ultima_cita
         FROM usuarios u
         WHERE u.rol = 'cliente' AND (? = '' OR u.nombre LIKE ? OR u.email LIKE ? OR u.doc_numero LIKE ? OR u.telefono LIKE ?)
         ORDER BY u.nombre LIMIT 200`,
      )
      .all(q, like, like, like, like);
  });

  // Alta de un cliente que llega sin cuenta. Si no se da contraseña, se genera una aleatoria
  // y el cliente no podrá entrar al portal hasta que se le asigne otra.
  r.add('POST', '/api/clientes', async (c) => {
    requerirUsuario(c, ['veterinario']);
    const b = await c.json();
    if (!b.password) b.password = randomBytes(18).toString('base64url');
    const id = crearUsuario(c.db, datosNuevoUsuario(c.db, b, 'cliente'));
    c.send(201, datosUsuario(c.db, id));
  });

  r.add('GET', '/api/clientes/:id', (c) => {
    requerirUsuario(c, ['veterinario']);
    const cliente = datosUsuario(c.db, idParam(c));
    if (!cliente || cliente.rol !== 'cliente') fail(404, 'Cliente no encontrado');
    return {
      ...cliente,
      mascotas: c.db.prepare('SELECT * FROM mascotas WHERE cliente_id = ? ORDER BY nombre').all(cliente.id),
      citas: c.db
        .prepare(
          `SELECT c.id, c.inicio, c.estado, s.nombre AS servicio, m.nombre AS mascota
           FROM citas c JOIN servicios s ON s.id = c.servicio_id JOIN mascotas m ON m.id = c.mascota_id
           WHERE c.cliente_id = ? ORDER BY c.inicio DESC LIMIT 20`,
        )
        .all(cliente.id),
    };
  });
}
