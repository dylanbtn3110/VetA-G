import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { esVet, mascotaAccesible, requerirUsuario } from '../lib/auth.js';
import { insertar } from '../lib/crud.js';
import { fail } from '../lib/http.js';
import { soles } from '../lib/money.js';
import { notificar, notificarVeterinarios } from '../lib/notify.js';
import { MIME_ARCHIVOS, OCUPA_HORARIO } from '../lib/constants.js';
import { hoyLima, sumarDias, textoLima } from '../lib/time.js';
import * as v from '../lib/validate.js';
import { idParam } from './cuentas.js';
import { listarCitas } from './citas.js';
import { alertasInventario } from './inventario.js';

const nombreSeguro = (n) => n.replace(/[^\w.\- ]/g, '_').slice(0, 120) || 'archivo';

function decodificar(texto) {
  try {
    return decodeURIComponent(texto);
  } catch {
    return texto;
  }
}

const SELECT_HISTORIAL = `
  SELECT h.*, vt.nombre AS veterinario FROM historial h JOIN usuarios vt ON vt.id = h.veterinario_id`;

function citaDeMascota(db, citaId, mascotaId) {
  if (citaId && !db.prepare('SELECT 1 FROM citas WHERE id = ? AND mascota_id = ?').get(citaId, mascotaId)) {
    fail(400, 'La cita no corresponde a esta mascota');
  }
  return citaId;
}

// Límite simple para el formulario público: 5 solicitudes por IP cada 10 minutos.
const VENTANA_MS = 10 * 60 * 1000;
const MAX_SOLICITUDES = 5;
const envios = new Map();
function limitarSolicitudes(ip) {
  const ahora = Date.now();
  const recientes = (envios.get(ip) ?? []).filter((t) => ahora - t < VENTANA_MS);
  if (recientes.length >= MAX_SOLICITUDES) fail(429, 'Enviaste varias solicitudes seguidas; espera unos minutos o escríbenos por WhatsApp');
  recientes.push(ahora);
  envios.set(ip, recientes);
}

export function registrar(r) {
  // ---------- Solicitudes desde la página pública (sin cuenta) ----------
  r.add('POST', '/api/solicitudes', async (c) => {
    limitarSolicitudes(c.req.socket.remoteAddress ?? 'desconocida');
    const b = await c.json();
    const datos = {
      nombre: v.texto(b.tutor, 'nombre', { max: 120 }),
      telefono: v.texto(b.telefono, 'teléfono', { max: 30 }),
      mascota: v.texto(b.mascota, 'nombre de la mascota', { max: 80 }),
      motivo: v.texto(b.motivo, 'motivo', { max: 200 }),
      fecha_preferida: v.fecha(b.fecha, 'fecha preferida', { opcional: true }),
    };
    insertar(c.db, 'solicitudes', datos);
    const fecha = datos.fecha_preferida ? `, prefiere ${datos.fecha_preferida}` : '';
    notificarVeterinarios(c.db, 'web', `Solicitud web: ${datos.nombre} (${datos.telefono}) para ${datos.mascota}, ${datos.motivo}${fecha}`);
    c.send(201, { ok: true });
  });

  // ---------- Historial clínico ----------
  r.add('GET', '/api/mascotas/:id/historial', (c) => {
    const m = mascotaAccesible(c.db, requerirUsuario(c), idParam(c));
    return c.db.prepare(`${SELECT_HISTORIAL} WHERE h.mascota_id = ? ORDER BY h.fecha DESC, h.id DESC`).all(m.id);
  });

  r.add('POST', '/api/mascotas/:id/historial', async (c) => {
    const u = requerirUsuario(c, ['veterinario']);
    const m = mascotaAccesible(c.db, u, idParam(c));
    const b = await c.json();
    const citaId = citaDeMascota(c.db, v.entero(b.cita_id, 'cita_id', { min: 1, opcional: true }), m.id);
    const peso = v.numero(b.peso_kg, 'peso', { min: 0, max: 200, opcional: true });
    const id = insertar(c.db, 'historial', {
      mascota_id: m.id,
      cita_id: citaId,
      veterinario_id: u.id,
      fecha: v.fecha(b.fecha, 'fecha', { opcional: true }) ?? hoyLima(),
      peso_kg: peso,
      temperatura_c: v.numero(b.temperatura_c, 'temperatura', { min: 30, max: 45, opcional: true }),
      diagnostico: v.texto(b.diagnostico, 'diagnóstico', { max: 2000 }),
      tratamiento: v.texto(b.tratamiento, 'tratamiento', { max: 2000, opcional: true }),
      notas: v.texto(b.notas, 'notas', { max: 2000, opcional: true }),
      proximo_vencimiento: v.fecha(b.proximo_vencimiento, 'próximo control', { opcional: true }),
    });
    if (peso !== null) c.db.prepare('UPDATE mascotas SET peso_kg = ? WHERE id = ?').run(peso, m.id);
    if (citaId) c.db.prepare(`UPDATE citas SET estado = 'atendida' WHERE id = ? AND ${OCUPA_HORARIO}`).run(citaId);
    notificar(c.db, m.cliente_id, 'historial', `Se registró una atención de ${m.nombre} en su historial`, citaId);
    c.send(201, c.db.prepare(`${SELECT_HISTORIAL} WHERE h.id = ?`).get(id));
  });

  // ---------- Fotos y documentos ----------
  // El cuerpo es el archivo tal cual (no multipart). Nombre original en la cabecera X-Nombre-Archivo.
  r.add('POST', '/api/mascotas/:id/archivos', async (c) => {
    const u = requerirUsuario(c);
    const m = mascotaAccesible(c.db, u, idParam(c));
    const mime = (c.req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const ext = MIME_ARCHIVOS[mime];
    if (!ext) fail(415, 'Solo se permiten fotos JPG, PNG o WEBP, o documentos PDF');
    const citaId = citaDeMascota(c.db, v.entero(c.query.get('cita_id'), 'cita_id', { min: 1, opcional: true }), m.id);
    const datos = await c.raw(c.config.maxUploadBytes);
    if (!datos.length) fail(400, 'El archivo está vacío');
    const nombre = nombreSeguro(decodificar(String(c.req.headers['x-nombre-archivo'] ?? `archivo${ext}`)));
    const ruta = `${randomUUID()}${ext}`;
    await writeFile(join(c.config.uploadDir, ruta), datos);
    const id = insertar(c.db, 'archivos', {
      mascota_id: m.id,
      cita_id: citaId,
      subido_por: u.id,
      nombre_original: nombre,
      mime,
      tamano: datos.length,
      ruta,
    });
    c.send(201, c.db.prepare('SELECT id, mascota_id, cita_id, nombre_original, mime, tamano, created_at FROM archivos WHERE id = ?').get(id));
  });

  r.add('GET', '/api/mascotas/:id/archivos', (c) => {
    const m = mascotaAccesible(c.db, requerirUsuario(c), idParam(c));
    return c.db
      .prepare(
        `SELECT a.id, a.mascota_id, a.cita_id, a.nombre_original, a.mime, a.tamano, a.created_at, u.nombre AS subido_por
         FROM archivos a JOIN usuarios u ON u.id = a.subido_por
         WHERE a.mascota_id = ? ORDER BY a.id DESC`,
      )
      .all(m.id);
  });

  r.add('GET', '/api/archivos/:id', (c) => {
    const u = requerirUsuario(c);
    const a = c.db
      .prepare('SELECT a.*, m.cliente_id FROM archivos a JOIN mascotas m ON m.id = a.mascota_id WHERE a.id = ?')
      .get(idParam(c));
    if (!a || (!esVet(u) && a.cliente_id !== u.id)) fail(404, 'Archivo no encontrado');
    c.res.writeHead(200, {
      'Content-Type': a.mime,
      'Content-Length': a.tamano,
      'Content-Disposition': `inline; filename="${nombreSeguro(a.nombre_original)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    });
    createReadStream(join(c.config.uploadDir, a.ruta))
      .on('error', () => c.res.destroy())
      .pipe(c.res);
  });

  // ---------- Notificaciones ----------
  r.add('GET', '/api/notificaciones', (c) => {
    const u = requerirUsuario(c);
    const soloNoLeidas = c.query.get('no_leidas') === '1';
    return c.db
      .prepare(`SELECT * FROM notificaciones WHERE usuario_id = ? ${soloNoLeidas ? 'AND leida = 0' : ''} ORDER BY id DESC LIMIT 100`)
      .all(u.id);
  });

  r.add('POST', '/api/notificaciones/leer', async (c) => {
    const u = requerirUsuario(c);
    const b = await c.json();
    if (b.todas) {
      c.db.prepare('UPDATE notificaciones SET leida = 1 WHERE usuario_id = ?').run(u.id);
    } else {
      if (!Array.isArray(b.ids) || b.ids.length > 500) fail(400, 'Envía ids o todas: true');
      const marcar = c.db.prepare('UPDATE notificaciones SET leida = 1 WHERE id = ? AND usuario_id = ?');
      for (const id of b.ids) marcar.run(v.entero(id, 'id', { min: 1, max: Number.MAX_SAFE_INTEGER }), u.id);
    }
    return { ok: true };
  });

  // ---------- Dashboard del veterinario ----------
  r.add('GET', '/api/dashboard', (c) => {
    requerirUsuario(c, ['veterinario']);
    const dias = v.entero(c.query.get('dias'), 'dias', { min: 1, max: 90, opcional: true }) ?? 14;
    const hoy = hoyLima();
    const desde = sumarDias(hoy, -(dias - 1));

    const porDia = new Map(
      c.db
        .prepare(
          `SELECT SUBSTR(inicio, 1, 10) AS fecha, COUNT(*) AS citas, COUNT(DISTINCT cliente_id) AS clientes,
                  COALESCE(SUM(es_emergencia), 0) AS urgencias
           FROM citas WHERE SUBSTR(inicio, 1, 10) BETWEEN ? AND ? AND ${OCUPA_HORARIO}
           GROUP BY fecha`,
        )
        .all(desde, hoy)
        .map((f) => [f.fecha, f]),
    );
    const ingresos = new Map(
      c.db
        .prepare(
          `SELECT fecha_emision AS fecha, SUM(total_mil) AS total FROM boletas
           WHERE estado = 'emitida_local' AND fecha_emision BETWEEN ? AND ? GROUP BY fecha_emision`,
        )
        .all(desde, hoy)
        .map((f) => [f.fecha, f.total]),
    );
    const serie = Array.from({ length: dias }, (_, i) => {
      const fecha = sumarDias(desde, i);
      const d = porDia.get(fecha);
      const ing = ingresos.get(fecha) ?? 0;
      return { fecha, clientes: d?.clientes ?? 0, citas: d?.citas ?? 0, urgencias: d?.urgencias ?? 0, ingresos: soles(ing), ingresos_mil: ing };
    });

    const hoyDatos = serie.at(-1);
    const estadosHoy = Object.fromEntries(
      c.db
        .prepare('SELECT estado, COUNT(*) AS n FROM citas WHERE SUBSTR(inicio, 1, 10) = ? GROUP BY estado')
        .all(hoy)
        .map((f) => [f.estado, f.n]),
    );
    const ahora = textoLima();
    const inventario = alertasInventario(c.db, hoy);

    return {
      hoy,
      kpis: {
        clientes_hoy: hoyDatos.clientes,
        citas_hoy: hoyDatos.citas,
        urgencias_hoy: hoyDatos.urgencias,
        ingresos_hoy: hoyDatos.ingresos,
        pendientes_confirmar: c.db.prepare("SELECT COUNT(*) AS n FROM citas WHERE estado = 'pendiente' AND inicio >= ?").get(ahora).n,
        clientes_registrados: c.db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'cliente'").get().n,
        promedio_clientes_dia: Number((serie.reduce((a, d) => a + d.clientes, 0) / dias).toFixed(1)),
      },
      serie,
      estados_hoy: estadosHoy,
      en_camino: listarCitas(c.db, ["c.estado IN ('en_camino', 'urgente')", 'SUBSTR(c.inicio, 1, 10) >= ?'], [sumarDias(hoy, -1)], 20),
      proximas: listarCitas(c.db, ["c.estado IN ('pendiente', 'confirmada')", 'c.inicio >= ?'], [ahora], 10),
      vencimientos: c.db
        .prepare(
          `SELECT h.id, h.proximo_vencimiento, h.diagnostico, m.id AS mascota_id, m.nombre AS mascota, u.nombre AS cliente, u.telefono
           FROM historial h JOIN mascotas m ON m.id = h.mascota_id JOIN usuarios u ON u.id = m.cliente_id
           WHERE h.proximo_vencimiento BETWEEN ? AND ? ORDER BY h.proximo_vencimiento LIMIT 30`,
        )
        .all(hoy, sumarDias(hoy, 14)),
      inventario: {
        vencidos: inventario.vencidos.length,
        por_vencer: inventario.por_vencer.length,
        bajo_stock: inventario.bajo_stock.length,
        detalle: inventario,
      },
    };
  });
}
