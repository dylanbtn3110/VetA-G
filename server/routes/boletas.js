import { esVet, requerirUsuario } from '../lib/auth.js';
import { insertar } from '../lib/crud.js';
import { fail, HttpError } from '../lib/http.js';
import { soles, unitario, valorSinIgv } from '../lib/money.js';
import { DOC_TIPOS, TIPOS_SUNAT, UMBRAL_IDENTIFICACION_MIL } from '../lib/constants.js';
import { hoyLima, sumarDias } from '../lib/time.js';
import * as v from '../lib/validate.js';
import { idParam } from './cuentas.js';

const SIN_DOCUMENTO = '00000000';

const numeroComprobante = (b) => `${b.serie}-${String(b.numero).padStart(8, '0')}`;
// Para el envío a SUNAT los montos van como número con 3 decimales.
const num3 = (mil) => Number(unitario(mil));

function resolverCliente(db, b) {
  if (b.cliente_id) {
    const u = db.prepare("SELECT * FROM usuarios WHERE id = ? AND rol = 'cliente'").get(v.entero(b.cliente_id, 'cliente_id', { min: 1 }));
    if (!u) fail(404, 'Cliente no encontrado');
    const tipo = u.doc_tipo && u.doc_numero ? u.doc_tipo : '0';
    return { id: u.id, tipo, numero: tipo === '0' ? SIN_DOCUMENTO : u.doc_numero, nombre: u.nombre };
  }
  const tipo = v.opcion(b.cliente_doc_tipo, 'tipo de documento', DOC_TIPOS, { opcional: true }) ?? '0';
  const numero = v.texto(b.cliente_doc_numero, 'número de documento', { max: 20, opcional: true });
  if (tipo === '1' && !/^\d{8}$/.test(numero ?? '')) fail(400, 'El DNI debe tener 8 dígitos');
  if (tipo === '6' && !/^\d{11}$/.test(numero ?? '')) fail(400, 'El RUC debe tener 11 dígitos');
  if (tipo !== '0' && !numero) fail(400, 'Falta el número de documento');
  const nombre = v.texto(b.cliente_nombre, 'nombre del cliente', { max: 150, opcional: true }) ?? 'CLIENTE VARIOS';
  return { id: null, tipo, numero: tipo === '0' ? SIN_DOCUMENTO : numero, nombre };
}

// Un ítem puede venir de un servicio, de un producto del inventario o escrito a mano.
function resolverItem(db, it, i) {
  const n = `ítem ${i + 1}`;
  if (typeof it !== 'object' || it === null) fail(400, `El ${n} no es válido`);
  const cantidad = v.entero(it.cantidad ?? 1, `cantidad del ${n}`, { min: 1, max: 999 });
  let linea;
  if (it.servicio_id) {
    const s = db.prepare('SELECT * FROM servicios WHERE id = ?').get(v.entero(it.servicio_id, 'servicio_id', { min: 1 }));
    if (!s) fail(404, `Servicio del ${n} no encontrado`);
    linea = { descripcion: s.nombre, tipo_sunat: s.tipo_sunat, unidad: 'UNIDAD', precio_final_mil: s.precio_mil, inventario_id: null };
  } else if (it.inventario_id) {
    const p = db.prepare('SELECT * FROM inventario WHERE id = ?').get(v.entero(it.inventario_id, 'inventario_id', { min: 1 }));
    if (!p) fail(404, `Producto del ${n} no encontrado`);
    linea = { descripcion: p.nombre, tipo_sunat: p.tipo_sunat, unidad: p.unidad, precio_final_mil: p.precio_mil, inventario_id: p.id };
  } else {
    linea = {
      descripcion: v.texto(it.descripcion, `descripción del ${n}`, { max: 250 }),
      tipo_sunat: v.opcion(it.tipo ?? 'Servicio', `tipo del ${n}`, TIPOS_SUNAT),
      unidad: 'UNIDAD',
      precio_final_mil: null,
      inventario_id: null,
    };
  }
  if (it.descripcion && (it.servicio_id || it.inventario_id)) linea.descripcion = v.texto(it.descripcion, `descripción del ${n}`, { max: 250 });
  if (it.precio !== undefined && it.precio !== null && it.precio !== '') linea.precio_final_mil = v.soles(it.precio, `precio del ${n}`);
  if (!(linea.precio_final_mil > 0)) fail(400, `El precio del ${n} debe ser mayor a 0`);

  // Regla SUNAT: valor unitario sin IGV con 3 decimales; IGV = precio final - valor.
  const valorUnit = valorSinIgv(linea.precio_final_mil);
  const valorVenta = valorUnit * cantidad;
  const total = linea.precio_final_mil * cantidad;
  return {
    ...linea,
    cantidad,
    valor_unitario_mil: valorUnit,
    valor_venta_mil: valorVenta,
    igv_mil: total - valorVenta,
    total_mil: total,
  };
}

function vistaBoleta(db, id) {
  const b = db.prepare('SELECT * FROM boletas WHERE id = ?').get(id);
  if (!b) return null;
  const items = db.prepare('SELECT * FROM boleta_items WHERE boleta_id = ? ORDER BY id').all(id);
  return {
    id: b.id,
    comprobante: numeroComprobante(b),
    serie: b.serie,
    numero: b.numero,
    fecha_emision: b.fecha_emision,
    cliente_id: b.cliente_id,
    cliente: { doc_tipo: b.cliente_doc_tipo, doc_numero: b.cliente_doc_numero, nombre: b.cliente_nombre },
    moneda: b.moneda,
    estado: b.estado,
    envio_sunat: b.envio_sunat,
    motivo_anulacion: b.motivo_anulacion,
    op_gravadas: soles(b.op_gravadas_mil),
    igv: soles(b.igv_mil),
    total: soles(b.total_mil),
    total_mil: b.total_mil,
    items: items.map((it) => ({
      descripcion: it.descripcion,
      tipo_sunat: it.tipo_sunat,
      cantidad: it.cantidad,
      unidad: it.unidad,
      precio_unitario: soles(it.precio_final_mil),
      valor_unitario: unitario(it.valor_unitario_mil),
      valor_venta: unitario(it.valor_venta_mil),
      igv: unitario(it.igv_mil),
      total: soles(it.total_mil),
      inventario_id: it.inventario_id,
    })),
  };
}

// Estructura lista para entregar a un OSE/PSE o a una librería de facturación electrónica.
// No se envía a SUNAT desde aquí: eso exige certificado digital y un proveedor autorizado.
function payloadSunat(config, db, id) {
  const b = db.prepare('SELECT * FROM boletas WHERE id = ?').get(id);
  const items = db.prepare('SELECT * FROM boleta_items WHERE boleta_id = ? ORDER BY id').all(id);
  return {
    tipoComprobante: '03',
    serie: b.serie,
    correlativo: b.numero,
    comprobante: numeroComprobante(b),
    fechaEmision: b.fecha_emision,
    moneda: b.moneda,
    emisor: { ruc: config.ruc, razonSocial: config.razonSocial },
    cliente: { tipoDocumento: b.cliente_doc_tipo, numeroDocumento: b.cliente_doc_numero, nombre: b.cliente_nombre },
    items: items.map((it, i) => ({
      orden: i + 1,
      codigo: it.inventario_id ? `INV-${it.inventario_id}` : null,
      descripcion: it.descripcion,
      tipo: it.tipo_sunat,
      unidadMedida: it.unidad,
      cantidad: it.cantidad,
      valorUnitario: num3(it.valor_unitario_mil),
      precioUnitarioConIgv: num3(it.precio_final_mil),
      valorVenta: num3(it.valor_venta_mil),
      igv: num3(it.igv_mil),
      total: num3(it.total_mil),
      tipoAfectacionIgv: '10',
      porcentajeIgv: 18,
      impuestoBolsasPlasticas: false,
    })),
    totales: {
      operacionesGravadas: num3(b.op_gravadas_mil),
      igv: num3(b.igv_mil),
      importeTotal: num3(b.total_mil),
    },
    estado: b.estado,
    envioSunat: b.envio_sunat,
  };
}

function boletaAccesible(db, u, id) {
  const b = db.prepare('SELECT id, cliente_id FROM boletas WHERE id = ?').get(id);
  if (!b || (!esVet(u) && b.cliente_id !== u.id)) fail(404, 'Boleta no encontrada');
  return b;
}

export function registrar(r) {
  r.add('GET', '/api/boletas', (c) => {
    const u = requerirUsuario(c);
    const hasta = v.fecha(c.query.get('hasta') || hoyLima(), 'hasta');
    const desde = v.fecha(c.query.get('desde') || sumarDias(hasta, -30), 'desde');
    const filtros = ['fecha_emision BETWEEN ? AND ?'];
    const params = [desde, hasta];
    if (!esVet(u)) {
      filtros.push('cliente_id = ?');
      params.push(u.id);
    }
    const ids = c.db.prepare(`SELECT id FROM boletas WHERE ${filtros.join(' AND ')} ORDER BY id DESC LIMIT 500`).all(...params);
    return ids.map((f) => vistaBoleta(c.db, f.id));
  });

  r.add('GET', '/api/boletas/:id', (c) => {
    const b = boletaAccesible(c.db, requerirUsuario(c), idParam(c));
    return vistaBoleta(c.db, b.id);
  });

  r.add('GET', '/api/boletas/:id/payload', (c) => {
    requerirUsuario(c, ['veterinario']);
    const id = idParam(c);
    if (!c.db.prepare('SELECT 1 FROM boletas WHERE id = ?').get(id)) fail(404, 'Boleta no encontrada');
    return payloadSunat(c.config, c.db, id);
  });

  r.add('POST', '/api/boletas', async (c) => {
    const u = requerirUsuario(c, ['veterinario']);
    const b = await c.json();
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 50) fail(400, 'Agrega entre 1 y 50 ítems');
    const cliente = resolverCliente(c.db, b);
    const lineas = b.items.map((it, i) => resolverItem(c.db, it, i));
    const suma = (k) => lineas.reduce((acc, l) => acc + l[k], 0);
    const total = suma('total_mil');
    if (total >= UMBRAL_IDENTIFICACION_MIL && cliente.tipo === '0') {
      fail(400, `Para boletas desde S/ ${soles(UMBRAL_IDENTIFICACION_MIL)} registra el documento del cliente`);
    }

    // Stock pedido por producto (puede repetirse en varias líneas).
    const pedido = new Map();
    for (const l of lineas) if (l.inventario_id) pedido.set(l.inventario_id, (pedido.get(l.inventario_id) ?? 0) + l.cantidad);

    const serie = c.config.serieBoleta;
    let boletaId;
    c.db.exec('BEGIN IMMEDIATE');
    try {
      for (const [itemId, cantidad] of pedido) {
        const p = c.db.prepare('SELECT nombre, stock FROM inventario WHERE id = ?').get(itemId);
        if (p.stock < cantidad) throw new HttpError(409, `Stock insuficiente de ${p.nombre}: hay ${p.stock}`);
      }
      const { ultimo_numero: numero } = c.db
        .prepare(
          `INSERT INTO series_comprobante (serie, ultimo_numero) VALUES (?, 1)
           ON CONFLICT (serie) DO UPDATE SET ultimo_numero = ultimo_numero + 1
           RETURNING ultimo_numero`,
        )
        .get(serie);
      boletaId = insertar(c.db, 'boletas', {
        serie,
        numero,
        fecha_emision: hoyLima(),
        cliente_id: cliente.id,
        cliente_doc_tipo: cliente.tipo,
        cliente_doc_numero: cliente.numero,
        cliente_nombre: cliente.nombre,
        op_gravadas_mil: suma('valor_venta_mil'),
        igv_mil: suma('igv_mil'),
        total_mil: total,
        emitido_por: u.id,
      });
      const comprobante = numeroComprobante({ serie, numero });
      for (const l of lineas) insertar(c.db, 'boleta_items', { boleta_id: boletaId, ...l });
      for (const [itemId, cantidad] of pedido) {
        c.db.prepare('UPDATE inventario SET stock = stock - ? WHERE id = ?').run(cantidad, itemId);
        insertar(c.db, 'inventario_movimientos', { item_id: itemId, delta: -cantidad, motivo: `Venta ${comprobante}`, usuario_id: u.id });
      }
      c.db.exec('COMMIT');
    } catch (e) {
      c.db.exec('ROLLBACK');
      throw e;
    }
    c.send(201, vistaBoleta(c.db, boletaId));
  });

  // Anula la boleta en el sistema y devuelve al inventario lo vendido.
  // La comunicación de baja a SUNAT se hace aparte, cuando exista la integración.
  r.add('POST', '/api/boletas/:id/anular', async (c) => {
    const u = requerirUsuario(c, ['veterinario']);
    const id = idParam(c);
    const b = c.db.prepare('SELECT * FROM boletas WHERE id = ?').get(id);
    if (!b) fail(404, 'Boleta no encontrada');
    if (b.estado === 'anulada') fail(409, 'La boleta ya está anulada');
    const motivo = v.texto((await c.json()).motivo, 'motivo', { max: 200 });
    const comprobante = numeroComprobante(b);
    c.db.exec('BEGIN IMMEDIATE');
    try {
      c.db.prepare("UPDATE boletas SET estado = 'anulada', motivo_anulacion = ? WHERE id = ?").run(motivo, id);
      const vendidos = c.db
        .prepare('SELECT inventario_id, SUM(cantidad) AS cantidad FROM boleta_items WHERE boleta_id = ? AND inventario_id IS NOT NULL GROUP BY inventario_id')
        .all(id);
      for (const it of vendidos) {
        c.db.prepare('UPDATE inventario SET stock = stock + ? WHERE id = ?').run(it.cantidad, it.inventario_id);
        insertar(c.db, 'inventario_movimientos', { item_id: it.inventario_id, delta: it.cantidad, motivo: `Anulación ${comprobante}`, usuario_id: u.id });
      }
      c.db.exec('COMMIT');
    } catch (e) {
      c.db.exec('ROLLBACK');
      throw e;
    }
    return vistaBoleta(c.db, id);
  });
}
