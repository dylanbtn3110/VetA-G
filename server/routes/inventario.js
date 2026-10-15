import { requerirUsuario } from '../lib/auth.js';
import { actualizar, insertar } from '../lib/crud.js';
import { fail } from '../lib/http.js';
import { soles } from '../lib/money.js';
import { TIPOS_SUNAT } from '../lib/constants.js';
import { hoyLima, sumarDias } from '../lib/time.js';
import * as v from '../lib/validate.js';
import { idParam } from './cuentas.js';

export const DIAS_AVISO_VENCIMIENTO = 30;

function estadoVencimiento(item, hoy) {
  if (!item.vence_el) return null;
  if (item.vence_el < hoy) return 'vencido';
  if (item.vence_el <= sumarDias(hoy, DIAS_AVISO_VENCIMIENTO)) return 'por_vencer';
  return 'vigente';
}

export function vistaItem(item, hoy = hoyLima()) {
  return {
    ...item,
    precio: soles(item.precio_mil),
    activo: Boolean(item.activo),
    estado_vencimiento: estadoVencimiento(item, hoy),
    bajo_stock: item.stock_minimo > 0 && item.stock <= item.stock_minimo,
  };
}

export function alertasInventario(db, hoy = hoyLima()) {
  const limite = sumarDias(hoy, DIAS_AVISO_VENCIMIENTO);
  const base = 'SELECT * FROM inventario WHERE activo = 1';
  const lista = (sql, ...p) => db.prepare(sql).all(...p).map((i) => vistaItem(i, hoy));
  return {
    vencidos: lista(`${base} AND stock > 0 AND vence_el IS NOT NULL AND vence_el < ? ORDER BY vence_el`, hoy),
    por_vencer: lista(`${base} AND stock > 0 AND vence_el BETWEEN ? AND ? ORDER BY vence_el`, hoy, limite),
    bajo_stock: lista(`${base} AND stock_minimo > 0 AND stock <= stock_minimo ORDER BY stock`),
  };
}

const VALIDAR_ITEM = {
  nombre: (x) => v.texto(x, 'nombre', { max: 120 }),
  categoria: (x) => v.texto(x, 'categoría', { max: 60, opcional: true }) ?? 'general',
  tipo_sunat: (x) => v.opcion(x, 'tipo SUNAT', TIPOS_SUNAT, { opcional: true }) ?? 'Bien',
  unidad: (x) => v.texto(x, 'unidad', { max: 20, opcional: true }) ?? 'UNIDAD',
  stock_minimo: (x) => v.entero(x, 'stock mínimo', { opcional: true }) ?? 0,
  precio_mil: (x) => v.soles(x, 'precio', { opcional: true }) ?? 0,
  lote: (x) => v.texto(x, 'lote', { max: 40, opcional: true }),
  vence_el: (x) => v.fecha(x, 'fecha de vencimiento', { opcional: true }),
  ubicacion: (x) => v.texto(x, 'ubicación', { max: 60, opcional: true }),
};

// El cuerpo usa "precio" en soles; internamente se guarda precio_mil.
const claveCuerpo = (k) => (k === 'precio_mil' ? 'precio' : k);

function camposItem(b, parcial) {
  const campos = {};
  for (const [k, validar] of Object.entries(VALIDAR_ITEM)) {
    if (!parcial || claveCuerpo(k) in b) campos[k] = validar(b[claveCuerpo(k)]);
  }
  return campos;
}

function cargarItem(db, id) {
  const item = db.prepare('SELECT * FROM inventario WHERE id = ?').get(id);
  if (!item) fail(404, 'Producto no encontrado');
  return item;
}

export function registrar(r) {
  r.add('GET', '/api/inventario', (c) => {
    requerirUsuario(c, ['veterinario']);
    const q = (c.query.get('q') ?? '').trim();
    const filas = c.db
      .prepare(
        `SELECT * FROM inventario
         WHERE (? = '' OR nombre LIKE ? OR categoria LIKE ? OR lote LIKE ?)
         ORDER BY activo DESC, nombre LIMIT 1000`,
      )
      .all(q, `%${q}%`, `%${q}%`, `%${q}%`);
    const hoy = hoyLima();
    return filas.map((i) => vistaItem(i, hoy));
  });

  r.add('GET', '/api/inventario/alertas', (c) => {
    requerirUsuario(c, ['veterinario']);
    return alertasInventario(c.db);
  });

  r.add('POST', '/api/inventario', async (c) => {
    const u = requerirUsuario(c, ['veterinario']);
    const b = await c.json();
    const stock = v.entero(b.stock, 'stock', { opcional: true }) ?? 0;
    const id = insertar(c.db, 'inventario', { ...camposItem(b, false), stock });
    if (stock > 0) insertar(c.db, 'inventario_movimientos', { item_id: id, delta: stock, motivo: 'Stock inicial', usuario_id: u.id });
    c.send(201, vistaItem(cargarItem(c.db, id)));
  });

  r.add('PATCH', '/api/inventario/:id', async (c) => {
    requerirUsuario(c, ['veterinario']);
    const item = cargarItem(c.db, idParam(c));
    const b = await c.json();
    if ('stock' in b) fail(400, 'El stock se cambia registrando un movimiento');
    actualizar(c.db, 'inventario', item.id, {
      ...camposItem(b, true),
      activo: 'activo' in b ? (b.activo ? 1 : 0) : undefined,
    });
    return vistaItem(cargarItem(c.db, item.id));
  });

  // Entrada (+) o salida (-) de stock con su motivo, para auditoría.
  r.add('POST', '/api/inventario/:id/movimientos', async (c) => {
    const u = requerirUsuario(c, ['veterinario']);
    const item = cargarItem(c.db, idParam(c));
    const b = await c.json();
    const delta = v.entero(b.delta, 'cantidad', { min: -1_000_000, max: 1_000_000 });
    if (delta === 0) fail(400, 'La cantidad no puede ser 0');
    const motivo = v.texto(b.motivo, 'motivo', { max: 200 });
    if (item.stock + delta < 0) fail(409, `Stock insuficiente: hay ${item.stock}`);
    c.db.exec('BEGIN IMMEDIATE');
    try {
      c.db.prepare('UPDATE inventario SET stock = stock + ? WHERE id = ?').run(delta, item.id);
      insertar(c.db, 'inventario_movimientos', { item_id: item.id, delta, motivo, usuario_id: u.id });
      c.db.exec('COMMIT');
    } catch (e) {
      c.db.exec('ROLLBACK');
      throw e;
    }
    return vistaItem(cargarItem(c.db, item.id));
  });

  r.add('GET', '/api/inventario/:id/movimientos', (c) => {
    requerirUsuario(c, ['veterinario']);
    const item = cargarItem(c.db, idParam(c));
    return c.db
      .prepare(
        `SELECT im.*, u.nombre AS usuario FROM inventario_movimientos im
         LEFT JOIN usuarios u ON u.id = im.usuario_id
         WHERE im.item_id = ? ORDER BY im.id DESC LIMIT 200`,
      )
      .all(item.id);
  });
}
