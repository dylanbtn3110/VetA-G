import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { crearApp } from '../server/app.js';
import { config as base } from '../server/config.js';
import { seedDemo } from '../server/seed.js';
import { enviarRecordatorios } from '../server/routes/citas.js';
import { diaSemana, hoyLima, sumarDias, sumarMin } from '../server/lib/time.js';

const CLAVE = 'clave-de-prueba';
let dir, app, url, vet, cliente, otro;

async function api(metodo, ruta, { token, body, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(url + ruta, { method: metodo, headers: h, body: payload });
  const tipo = res.headers.get('content-type') ?? '';
  return { status: res.status, data: tipo.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}

const login = async (email) => (await api('POST', '/api/auth/login', { body: { email, password: CLAVE } })).data.token;

// Próximo lunes a partir de una semana adelante: siempre futuro y con horario 9:00–19:00.
function proximoLunes() {
  let f = sumarDias(hoyLima(), 7);
  while (diaSemana(f) !== 1) f = sumarDias(f, 1);
  return f;
}

const servicio = async (categoria) => (await api('GET', '/api/servicios')).data.find((s) => s.categoria === categoria);

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'veta-test-'));
  app = crearApp({ ...base, dbPath: join(dir, 'test.db'), uploadDir: join(dir, 'uploads') });
  seedDemo(app.db, CLAVE);
  await new Promise((ok) => app.server.listen(0, ok));
  url = `http://127.0.0.1:${app.server.address().port}`;
  vet = await login('vet@veta-g.test');
  cliente = await login('cliente@veta-g.test');
  const reg = await api('POST', '/api/auth/registro', {
    body: { nombre: 'Otra Persona', email: 'otra@example.com', password: CLAVE, doc_tipo: '1', doc_numero: '87654321' },
  });
  assert.equal(reg.status, 201);
  otro = reg.data.token;
});

after(() => {
  app.server.close();
  app.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('registro valida datos y evita emails repetidos', async () => {
  const corta = await api('POST', '/api/auth/registro', { body: { nombre: 'X', email: 'x@example.com', password: '123' } });
  assert.equal(corta.status, 400);
  const repetido = await api('POST', '/api/auth/registro', { body: { nombre: 'X', email: 'otra@example.com', password: CLAVE } });
  assert.equal(repetido.status, 409);
  const mal = await api('POST', '/api/auth/login', { body: { email: 'vet@veta-g.test', password: 'incorrecta' } });
  assert.equal(mal.status, 401);
});

test('el cliente no ve mascotas ajenas ni rutas de veterinario', async () => {
  const mias = (await api('GET', '/api/mascotas', { token: cliente })).data;
  assert.equal(mias.length, 2);
  const ajena = await api('GET', `/api/mascotas/${mias[0].id}`, { token: otro });
  assert.equal(ajena.status, 404);
  assert.equal((await api('GET', '/api/dashboard', { token: cliente })).status, 403);
  assert.equal((await api('GET', '/api/inventario', { token: cliente })).status, 403);
  assert.equal((await api('GET', '/api/mascotas')).status, 401);
});

test('agenda: horarios libres, reserva, choque y fuera de horario', async () => {
  const fecha = proximoLunes();
  const bano = await servicio('bano');
  const [firulais] = (await api('GET', '/api/mascotas', { token: cliente })).data;

  const disp = (await api('GET', `/api/disponibilidad?fecha=${fecha}&servicio_id=${bano.id}`, { token: cliente })).data;
  assert.equal(disp.cerrado, false);
  assert.equal(disp.slots[0].hora, '09:00');
  assert.equal(disp.slots.at(-1).hora, '18:00'); // baño de 60 min debe terminar a las 19:00
  assert.ok(disp.slots.every((s) => s.disponible));

  const cita = await api('POST', '/api/citas', {
    token: cliente,
    body: { mascota_id: firulais.id, servicio_id: bano.id, fecha, hora: '10:00', motivo: 'Baño mensual' },
  });
  assert.equal(cita.status, 201);
  assert.equal(cita.data.estado, 'pendiente');
  assert.equal(cita.data.fin, `${fecha} 11:00`);

  // Con un solo veterinario, 10:30 se cruza con el baño de 10:00 a 11:00.
  const choque = await api('POST', '/api/citas', {
    token: cliente,
    body: { mascota_id: firulais.id, servicio_id: bano.id, fecha, hora: '10:30' },
  });
  assert.equal(choque.status, 409);

  const disp2 = (await api('GET', `/api/disponibilidad?fecha=${fecha}&servicio_id=${bano.id}`, { token: cliente })).data;
  const libre = Object.fromEntries(disp2.slots.map((s) => [s.hora, s.disponible]));
  assert.equal(libre['09:00'], true);
  assert.equal(libre['09:15'], false); // terminaría 10:15, se cruza
  assert.equal(libre['10:30'], false);
  assert.equal(libre['11:00'], true);

  const tarde = await api('POST', '/api/citas', {
    token: cliente,
    body: { mascota_id: firulais.id, servicio_id: bano.id, fecha, hora: '18:30' },
  });
  assert.equal(tarde.status, 409);

  const ajena = await api('POST', '/api/citas', {
    token: otro,
    body: { mascota_id: firulais.id, servicio_id: bano.id, fecha, hora: '12:00' },
  });
  assert.equal(ajena.status, 404);

  // El veterinario recibió aviso de la nueva solicitud.
  const notifs = (await api('GET', '/api/notificaciones', { token: vet })).data;
  assert.ok(notifs.some((n) => n.tipo === 'cita' && n.cita_id === cita.data.id));
});

test('aviso de llegada, cambios de estado y cancelación', async () => {
  const fecha = sumarDias(proximoLunes(), 1);
  const consulta = await servicio('consulta');
  const [, michi] = (await api('GET', '/api/mascotas', { token: cliente })).data;
  const { data: cita } = await api('POST', '/api/citas', {
    token: vet,
    body: { mascota_id: michi.id, servicio_id: consulta.id, fecha, hora: '15:00' },
  });
  assert.equal(cita.estado, 'confirmada');

  // El aviso de llegada solo vale el mismo día de la cita.
  assert.equal((await api('POST', `/api/citas/${cita.id}/llegada`, { token: cliente, body: { minutos: 10 } })).status, 409);

  // Cita de hoy insertada directo (por API dependería de la hora a la que corre la prueba).
  const vetId = app.db.prepare("SELECT id FROM usuarios WHERE rol = 'veterinario'").get().id;
  const hoyCita = Number(
    app.db
      .prepare(
        `INSERT INTO citas (mascota_id, cliente_id, veterinario_id, servicio_id, inicio, fin, estado)
         VALUES (?, ?, ?, ?, ?, ?, 'confirmada')`,
      )
      .run(michi.id, michi.cliente_id, vetId, consulta.id, `${hoyLima()} 23:00`, `${hoyLima()} 23:30`).lastInsertRowid,
  );
  const llegada = await api('POST', `/api/citas/${hoyCita}/llegada`, { token: cliente, body: { minutos: 10 } });
  assert.equal(llegada.status, 200);
  assert.equal(llegada.data.estado, 'en_camino');
  const avisos = (await api('GET', '/api/notificaciones?no_leidas=1', { token: vet })).data;
  assert.ok(avisos.some((n) => n.tipo === 'llegada' && n.mensaje.includes('llega en 10 min')));
  assert.equal((await api('PATCH', `/api/citas/${hoyCita}`, { token: vet, body: { estado: 'atendida' } })).data.estado, 'atendida');

  // El cliente solo puede cancelar, no cambiar el estado a otra cosa.
  assert.equal((await api('PATCH', `/api/citas/${cita.id}`, { token: cliente, body: { estado: 'atendida' } })).status, 403);

  const atencion = await api('PATCH', `/api/citas/${cita.id}`, { token: vet, body: { estado: 'en_atencion' } });
  assert.equal(atencion.data.estado, 'en_atencion');
  assert.equal((await api('PATCH', `/api/citas/${cita.id}`, { token: cliente, body: { estado: 'cancelada' } })).status, 409);

  const otra = await api('POST', '/api/citas', {
    token: cliente,
    body: { mascota_id: michi.id, servicio_id: consulta.id, fecha, hora: '16:00' },
  });
  const cancel = await api('PATCH', `/api/citas/${otra.data.id}`, { token: cliente, body: { estado: 'cancelada' } });
  assert.equal(cancel.data.estado, 'cancelada');

  // Reprogramar (solo veterinario) valida el nuevo horario.
  const repro = await api('PATCH', `/api/citas/${cita.id}`, { token: vet, body: { hora: '17:00' } });
  assert.equal(repro.data.inicio, `${fecha} 17:00`);
});

test('urgencias entran de inmediato y avisan a los veterinarios', async () => {
  const [firulais] = (await api('GET', '/api/mascotas', { token: cliente })).data;
  const urg = await api('POST', '/api/emergencias', {
    token: cliente,
    body: { mascota_id: firulais.id, motivo: 'Comió chocolate', minutos: 15 },
  });
  assert.equal(urg.status, 201);
  assert.equal(urg.data.estado, 'urgente');
  assert.equal(urg.data.es_emergencia, 1);
  const avisos = (await api('GET', '/api/notificaciones', { token: vet })).data;
  assert.ok(avisos.some((n) => n.tipo === 'urgencia' && n.mensaje.includes('Comió chocolate')));
  assert.equal((await api('POST', '/api/emergencias', { token: cliente, body: { mascota_id: firulais.id } })).status, 400);
});

test('historial clínico: solo el veterinario escribe, el dueño lee', async () => {
  const [firulais] = (await api('GET', '/api/mascotas', { token: cliente })).data;
  const body = { diagnostico: 'Otitis leve', tratamiento: 'Gotas 7 días', peso_kg: 12.8, temperatura_c: 38.6, proximo_vencimiento: sumarDias(hoyLima(), 5) };
  assert.equal((await api('POST', `/api/mascotas/${firulais.id}/historial`, { token: cliente, body })).status, 403);
  const reg = await api('POST', `/api/mascotas/${firulais.id}/historial`, { token: vet, body });
  assert.equal(reg.status, 201);
  const hist = (await api('GET', `/api/mascotas/${firulais.id}/historial`, { token: cliente })).data;
  assert.equal(hist[0].diagnostico, 'Otitis leve');
  assert.equal((await api('GET', `/api/mascotas/${firulais.id}`, { token: cliente })).data.peso_kg, 12.8);
  assert.equal((await api('GET', `/api/mascotas/${firulais.id}/historial`, { token: otro })).status, 404);
});

test('fotos: sube, lista, descarga y rechaza tipos no permitidos', async () => {
  const [firulais] = (await api('GET', '/api/mascotas', { token: cliente })).data;
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const sub = await api('POST', `/api/mascotas/${firulais.id}/archivos`, {
    token: cliente,
    raw: png,
    headers: { 'Content-Type': 'image/png', 'X-Nombre-Archivo': encodeURIComponent('herida pata.png') },
  });
  assert.equal(sub.status, 201);
  assert.equal(sub.data.nombre_original, 'herida pata.png');

  const lista = (await api('GET', `/api/mascotas/${firulais.id}/archivos`, { token: vet })).data;
  assert.equal(lista.length, 1);
  const desc = await api('GET', `/api/archivos/${sub.data.id}`, { token: cliente });
  assert.equal(desc.status, 200);
  assert.deepEqual(desc.data, png);
  assert.equal((await api('GET', `/api/archivos/${sub.data.id}`, { token: otro })).status, 404);

  const exe = await api('POST', `/api/mascotas/${firulais.id}/archivos`, {
    token: cliente,
    raw: Buffer.from('MZ'),
    headers: { 'Content-Type': 'application/x-msdownload' },
  });
  assert.equal(exe.status, 415);
});

test('inventario: alertas de vencimiento y stock, movimientos', async () => {
  const alertas = (await api('GET', '/api/inventario/alertas', { token: vet })).data;
  assert.deepEqual(alertas.vencidos.map((i) => i.nombre), ['Pets Milk']);
  assert.ok(alertas.por_vencer.some((i) => i.nombre.startsWith('Antiparasitario')));
  assert.ok(alertas.bajo_stock.some((i) => i.nombre.startsWith('Antiparasitario')));

  const nuevo = await api('POST', '/api/inventario', {
    token: vet,
    body: { nombre: 'Vacuna antirrábica', stock: 3, stock_minimo: 2, precio: 30, vence_el: sumarDias(hoyLima(), 10), lote: 'L-77' },
  });
  assert.equal(nuevo.status, 201);
  assert.equal(nuevo.data.estado_vencimiento, 'por_vencer');

  const salida = await api('POST', `/api/inventario/${nuevo.data.id}/movimientos`, { token: vet, body: { delta: -2, motivo: 'Aplicadas' } });
  assert.equal(salida.data.stock, 1);
  assert.equal(salida.data.bajo_stock, true);
  const negativo = await api('POST', `/api/inventario/${nuevo.data.id}/movimientos`, { token: vet, body: { delta: -5, motivo: 'Error' } });
  assert.equal(negativo.status, 409);
  const movs = (await api('GET', `/api/inventario/${nuevo.data.id}/movimientos`, { token: vet })).data;
  assert.equal(movs.length, 2);
});

test('boletas: IGV con 3 decimales, correlativo, stock y estructura SUNAT', async () => {
  const productos = (await api('GET', '/api/inventario', { token: vet })).data;
  const churu = productos.find((p) => p.nombre === 'Snack Churu');
  const bano = await servicio('bano');

  const res = await api('POST', '/api/boletas', {
    token: vet,
    body: {
      cliente_doc_tipo: '1',
      cliente_doc_numero: '12345678',
      cliente_nombre: 'Cliente Demo',
      items: [
        { servicio_id: bano.id },
        { inventario_id: churu.id, cantidad: 3 },
        { descripcion: 'Corte de uñas', tipo: 'Servicio', precio: 10 },
      ],
    },
  });
  assert.equal(res.status, 201);
  const b = res.data;
  assert.equal(b.comprobante, 'B001-00000001');
  // Baño S/ 35 -> valor 35 / 1.18 = 29.661
  assert.equal(b.items[0].valor_unitario, '29.661');
  assert.equal(b.items[0].tipo_sunat, 'Servicio');
  assert.equal(b.items[1].tipo_sunat, 'Bien');
  assert.equal(b.items[1].valor_unitario, '5.085');
  assert.equal(b.total, '63.00'); // 35 + 3 x 6 + 10
  assert.equal(Number(b.op_gravadas) + Number(b.igv), 63);

  const stock = (await api('GET', '/api/inventario', { token: vet })).data.find((p) => p.id === churu.id).stock;
  assert.equal(stock, churu.stock - 3);

  const segunda = await api('POST', '/api/boletas', { token: vet, body: { items: [{ descripcion: 'Consulta', precio: 50 }] } });
  assert.equal(segunda.data.comprobante, 'B001-00000002');
  assert.equal(segunda.data.cliente.doc_tipo, '0');

  const payload = (await api('GET', `/api/boletas/${b.id}/payload`, { token: vet })).data;
  assert.equal(payload.tipoComprobante, '03');
  assert.equal(payload.items[0].valorUnitario, 29.661);
  assert.equal(payload.items[0].tipoAfectacionIgv, '10');
  assert.equal(payload.totales.importeTotal, 63);

  const sinStock = await api('POST', '/api/boletas', {
    token: vet,
    body: { cliente_doc_tipo: '1', cliente_doc_numero: '12345678', items: [{ inventario_id: churu.id, cantidad: 999 }] },
  });
  assert.equal(sinStock.status, 409);
  const dniMalo = await api('POST', '/api/boletas', { token: vet, body: { cliente_doc_tipo: '1', cliente_doc_numero: '123', items: [{ descripcion: 'X', precio: 5 }] } });
  assert.equal(dniMalo.status, 400);
  const grande = await api('POST', '/api/boletas', { token: vet, body: { items: [{ descripcion: 'Cirugía', precio: 800 }] } });
  assert.equal(grande.status, 400);

  const anulada = await api('POST', `/api/boletas/${b.id}/anular`, { token: vet, body: { motivo: 'Error de digitación' } });
  assert.equal(anulada.data.estado, 'anulada');
  const repuesto = (await api('GET', '/api/inventario', { token: vet })).data.find((p) => p.id === churu.id).stock;
  assert.equal(repuesto, churu.stock);

  // El cliente ve solo sus boletas (la primera se emitió sin cliente_id, así que no le aparece).
  assert.equal((await api('GET', `/api/boletas/${b.id}`, { token: cliente })).status, 404);
  assert.equal((await api('GET', `/api/boletas/${b.id}/payload`, { token: cliente })).status, 403);
});

test('dashboard: clientes por día, en camino y vencimientos', async () => {
  const d = (await api('GET', '/api/dashboard?dias=7', { token: vet })).data;
  assert.equal(d.serie.length, 7);
  assert.equal(d.serie.at(-1).fecha, hoyLima());
  assert.equal(d.kpis.urgencias_hoy, 1);
  assert.equal(d.kpis.clientes_hoy, 1);
  assert.ok(d.en_camino.some((c) => c.estado === 'urgente'));
  assert.ok(d.vencimientos.some((h) => h.diagnostico === 'Otitis leve'));
  assert.equal(d.inventario.vencidos, 1);
  assert.equal(d.kpis.clientes_registrados, 2);
});

test('recordatorios: avisa una sola vez a las citas de la próxima hora', () => {
  const fecha = proximoLunes();
  // Simula estar 30 minutos antes de la cita de las 10:00 de ese lunes (hora de Lima = UTC-5).
  const [y, m, d] = fecha.split('-').map(Number);
  const ahora = new Date(Date.UTC(y, m - 1, d, 14, 30));
  assert.equal(sumarMin(`${fecha} 09:30`, 30), `${fecha} 10:00`);
  assert.equal(enviarRecordatorios(app.db, ahora), 1);
  assert.equal(enviarRecordatorios(app.db, ahora), 0);
});

test('formulario público: la solicitud llega al veterinario y se limita el spam', async () => {
  const body = { tutor: 'Rosa Pérez', telefono: '987654321', mascota: 'Pelusa', motivo: 'Vacunación', fecha: sumarDias(hoyLima(), 2) };
  const ok = await api('POST', '/api/solicitudes', { body });
  assert.equal(ok.status, 201);
  const avisos = (await api('GET', '/api/notificaciones', { token: vet })).data;
  assert.ok(avisos.some((n) => n.tipo === 'web' && n.mensaje.includes('Rosa Pérez') && n.mensaje.includes('Pelusa')));
  assert.equal((await api('POST', '/api/solicitudes', { body: { tutor: 'X' } })).status, 400);
  let ultimo;
  for (let i = 0; i < 6; i++) ultimo = await api('POST', '/api/solicitudes', { body });
  assert.equal(ultimo.status, 429);
});

test('archivos estáticos sin salir de public/', async () => {
  assert.equal((await api('GET', '/')).status, 200);
  // fetch normaliza "..", así que se envía la ruta cruda con http.request.
  const status = await new Promise((ok, mal) => {
    const req = httpRequest({ host: '127.0.0.1', port: app.server.address().port, path: '/../server/config.js' }, (res) => {
      res.resume();
      ok(res.statusCode);
    });
    req.on('error', mal);
    req.end();
  });
  assert.equal(status, 404);
  assert.equal((await api('GET', '/api/no-existe')).status, 404);
  assert.equal((await api('DELETE', '/api/servicios')).status, 405);
});
