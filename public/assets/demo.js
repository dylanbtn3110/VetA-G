// Modo demostración: simula la API dentro del navegador cuando no hay servidor
// (por ejemplo, al abrir los archivos directamente o en un hosting estático).
// Los datos viven solo en este navegador (localStorage).
(() => {
  const KEY = 'veta.demo';
  const CLAVE = 'demo-veta-2026';

  // ---------- Tiempo (hora de Lima, igual que el servidor) ----------
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const textoLima = (d = new Date()) => {
    const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  };
  const hoyLima = () => textoLima().slice(0, 10);
  const sumarMin = (t, m) => {
    const [f, h] = t.split(' ');
    const [y, mo, d] = f.split('-').map(Number);
    const [hh, mm] = h.split(':').map(Number);
    const iso = new Date(Date.UTC(y, mo - 1, d, hh, mm + m)).toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
  };
  const sumarDias = (f, n) => sumarMin(`${f} 12:00`, n * 1440).slice(0, 10);
  const diaSemana = (f) => new Date(`${f}T12:00:00Z`).getUTCDay();
  const minutos = (h) => h.split(':').map(Number).reduce((a, b) => a * 60 + b);
  const aHora = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const ahoraUtc = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

  const HORARIO = { 0: [600, 780], 1: [540, 1140], 2: [540, 1140], 3: [540, 1140], 4: [540, 1140], 5: [540, 1140], 6: [540, 840] };
  const PASO = 15;
  const UMBRAL_DOC_MIL = 700000;
  const soles = (m) => (m / 1000).toFixed(2);
  const unit = (m) => (m / 1000).toFixed(3);

  function fallo(status, mensaje) {
    const e = new Error(mensaje);
    e.status = status;
    throw e;
  }
  const requerido = (v, campo) => {
    if (v === undefined || v === null || String(v).trim() === '') fallo(400, `Falta ${campo}`);
    return typeof v === 'string' ? v.trim() : v;
  };
  const opcional = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : typeof v === 'string' ? v.trim() : v);
  const porId = (lista, id) => lista.find((x) => x.id === Number(id));

  // ---------- Datos iniciales ----------
  function inicial() {
    const s = { seq: 0, usuarios: [], sesiones: {}, mascotas: [], servicios: [], citas: [], historial: [], archivos: [], notificaciones: [], inventario: [], movimientos: [], boletas: [], serie: 0 };
    const id = () => ++s.seq;
    const hoy = hoyLima();
    const servicios = [
      ['Consulta general', 'consulta', 30, 50], ['Vacunación', 'vacuna', 15, 45], ['Desparasitación interna', 'desparasitacion', 15, 25],
      ['Baño', 'bano', 60, 35], ['Baño y corte de pelo', 'peluqueria', 90, 60], ['Corte de uñas', 'peluqueria', 15, 10],
      ['Análisis de laboratorio', 'laboratorio', 20, 70], ['Cirugía (esterilización)', 'cirugia', 120, 350], ['Urgencia', 'emergencia', 30, 100],
    ];
    for (const [nombre, categoria, dur, precio] of servicios) {
      s.servicios.push({ id: id(), nombre, categoria, duracion_min: dur, precio_mil: precio * 1000, tipo_sunat: 'Servicio', activo: 1 });
    }
    const vet = { id: id(), rol: 'veterinario', nombre: 'Veterinario Demo', email: 'vet@veta-g.test', clave: CLAVE, telefono: '999000111', doc_tipo: '0', doc_numero: null };
    const cli = { id: id(), rol: 'cliente', nombre: 'Cliente Demo', email: 'cliente@veta-g.test', clave: CLAVE, telefono: '999000222', doc_tipo: '1', doc_numero: '12345678' };
    s.usuarios.push(vet, cli);
    s.mascotas.push({ id: id(), cliente_id: cli.id, nombre: 'Firulais', especie: 'Perro', raza: 'Mestizo', sexo: 'Macho', peso_kg: 12.4, fecha_nacimiento: null, notas: null });
    s.mascotas.push({ id: id(), cliente_id: cli.id, nombre: 'Michi', especie: 'Gato', raza: null, sexo: 'Hembra', peso_kg: 4.1, fecha_nacimiento: null, notas: null });

    // Clientes y atenciones pasadas para que el dashboard tenga historia.
    const nombres = ['Ana Torres', 'Luis Ramos', 'Carla Díaz', 'Jorge Quispe', 'María Flores', 'Pedro Huamán'];
    const mascotas = [['Rocky', 'Perro'], ['Luna', 'Gato'], ['Toby', 'Perro'], ['Nala', 'Gato'], ['Max', 'Perro'], ['Coco', 'Conejo']];
    const otros = nombres.map((nombre, i) => {
      const u = { id: id(), rol: 'cliente', nombre, email: `cliente${i + 1}@demo.test`, clave: CLAVE, telefono: `98700${i}${i}${i}${i}`, doc_tipo: '0', doc_numero: null };
      s.usuarios.push(u);
      const m = { id: id(), cliente_id: u.id, nombre: mascotas[i][0], especie: mascotas[i][1], raza: null, sexo: null, peso_kg: null, fecha_nacimiento: null, notas: null };
      s.mascotas.push(m);
      return { u, m };
    });
    const porDia = [2, 4, 3, 0, 5, 3, 1, 4, 6, 2, 3, 5, 4];
    porDia.forEach((n, i) => {
      const fecha = sumarDias(hoy, i - porDia.length);
      if (!HORARIO[diaSemana(fecha)]) return;
      for (let k = 0; k < n && k < otros.length; k++) {
        const sv = s.servicios[k % 4];
        const inicio = `${fecha} ${aHora(540 + k * 60)}`;
        s.citas.push({ id: id(), mascota_id: otros[k].m.id, cliente_id: otros[k].u.id, veterinario_id: vet.id, servicio_id: sv.id, inicio, fin: sumarMin(inicio, sv.duracion_min), estado: 'atendida', es_emergencia: 0, motivo: null, recordatorio_enviado: 1, llegada_minutos: null, created_at: ahoraUtc() });
      }
    });

    const productos = [
      ['Vacuna séxtuple canina', 'vacunas', 12, 5, 45, 120], ['Antiparasitario interno (tableta)', 'medicamentos', 4, 10, 15, 20],
      ['Alimento balanceado Cambo 15 kg', 'alimentos', 6, 2, 180, 200], ['Snack Churu', 'snacks', 30, 10, 6, 90],
      ['Pets Milk', 'alimentos', 8, 3, 25, -3], ['Pelota de juguete', 'juguetes', 15, 5, 12, null],
    ];
    for (const [nombre, categoria, stock, minimo, precio, dias] of productos) {
      s.inventario.push({ id: id(), nombre, categoria, tipo_sunat: 'Bien', unidad: 'UNIDAD', stock, stock_minimo: minimo, precio_mil: precio * 1000, lote: null, vence_el: dias === null ? null : sumarDias(hoy, dias), ubicacion: null, activo: 1 });
    }
    return s;
  }

  function cargar() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      /* se recrea */
    }
    return inicial();
  }
  function guardar(s) {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      fallo(507, 'El navegador no tiene espacio para guardar más datos de la demostración');
    }
  }

  // ---------- Vistas ----------
  const vistaUsuario = (u) => u && { id: u.id, rol: u.rol, nombre: u.nombre, email: u.email, telefono: u.telefono ?? null, doc_tipo: u.doc_tipo ?? null, doc_numero: u.doc_numero ?? null, direccion: u.direccion ?? null };
  const vistaServicio = (x) => ({ ...x, precio: soles(x.precio_mil), activo: Boolean(x.activo) });
  const ocupa = (c) => !['cancelada', 'no_asistio'].includes(c.estado);
  function vistaCita(s, c) {
    const m = porId(s.mascotas, c.mascota_id);
    const u = porId(s.usuarios, c.cliente_id);
    const v = porId(s.usuarios, c.veterinario_id);
    const sv = porId(s.servicios, c.servicio_id);
    return { ...c, mascota: m?.nombre, especie: m?.especie, cliente: u?.nombre, cliente_telefono: u?.telefono ?? null, veterinario: v?.nombre, servicio: sv?.nombre, categoria: sv?.categoria, duracion_min: sv?.duracion_min };
  }
  function vistaItem(i, hoy = hoyLima()) {
    let estado = null;
    if (i.vence_el) estado = i.vence_el < hoy ? 'vencido' : i.vence_el <= sumarDias(hoy, 30) ? 'por_vencer' : 'vigente';
    return { ...i, precio: soles(i.precio_mil), activo: Boolean(i.activo), estado_vencimiento: estado, bajo_stock: i.stock_minimo > 0 && i.stock <= i.stock_minimo };
  }
  const comprobante = (b) => `${b.serie}-${String(b.numero).padStart(8, '0')}`;
  function vistaBoleta(b) {
    return {
      id: b.id, comprobante: comprobante(b), serie: b.serie, numero: b.numero, fecha_emision: b.fecha_emision, cliente_id: b.cliente_id,
      cliente: { doc_tipo: b.doc_tipo, doc_numero: b.doc_numero, nombre: b.nombre }, moneda: 'PEN', estado: b.estado, envio_sunat: 'pendiente',
      motivo_anulacion: b.motivo_anulacion ?? null, op_gravadas: soles(b.gravadas), igv: soles(b.igv), total: soles(b.total), total_mil: b.total,
      items: b.items.map((it) => ({ descripcion: it.descripcion, tipo_sunat: it.tipo_sunat, cantidad: it.cantidad, unidad: it.unidad, precio_unitario: soles(it.precio), valor_unitario: unit(it.vu), valor_venta: unit(it.vv), igv: unit(it.igv), total: soles(it.total), inventario_id: it.inventario_id })),
    };
  }

  // ---------- Reglas ----------
  const vets = (s) => s.usuarios.filter((u) => u.rol === 'veterinario').map((u) => u.id);
  const vetLibre = (s, vetId, inicio, fin, excluir = 0) =>
    !s.citas.some((c) => c.veterinario_id === vetId && c.id !== excluir && ocupa(c) && c.inicio < fin && c.fin > inicio);
  const pickVet = (s, inicio, fin, vetId = null, excluir = 0) => (vetId ? [vetId] : vets(s)).find((v) => vetLibre(s, v, inicio, fin, excluir)) ?? null;
  function horarioValido(fecha, hora, dur) {
    const h = HORARIO[diaSemana(fecha)];
    const t = minutos(hora);
    if (!h || t < h[0] || t + dur > h[1] || (t - h[0]) % PASO) fallo(409, 'Fuera del horario de atención');
  }
  function notificar(s, uid, tipo, mensaje, citaId = null) {
    s.notificaciones.push({ id: ++s.seq, usuario_id: uid, tipo, mensaje, cita_id: citaId, leida: 0, created_at: ahoraUtc() });
  }
  const notificarVets = (s, tipo, mensaje, citaId) => vets(s).forEach((v) => notificar(s, v, tipo, mensaje, citaId));
  function requerir(ctx, roles) {
    if (!ctx.user) fallo(401, 'Inicia sesión para continuar');
    if (roles && !roles.includes(ctx.user.rol)) fallo(403, 'No tienes permiso para esta acción');
    return ctx.user;
  }
  const esVet = (u) => u.rol === 'veterinario';
  function mascotaAccesible(s, u, id) {
    const m = porId(s.mascotas, id);
    if (!m || (!esVet(u) && m.cliente_id !== u.id)) fallo(404, 'Mascota no encontrada');
    return m;
  }
  function citaAccesible(s, u, id) {
    const c = porId(s.citas, id);
    if (!c || (!esVet(u) && c.cliente_id !== u.id)) fallo(404, 'Cita no encontrada');
    return c;
  }
  function servicioActivo(s, id) {
    const sv = porId(s.servicios, id);
    if (!sv || !sv.activo) fallo(404, 'Servicio no disponible');
    return sv;
  }
  function nuevoUsuario(s, b, rol) {
    const email = String(requerido(b.email, 'email')).toLowerCase();
    if (s.usuarios.some((u) => u.email === email)) fallo(409, 'Ya existe una cuenta con ese email');
    const clave = b.password ?? Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    if (String(clave).length < 8) fallo(400, 'La contraseña debe tener al menos 8 caracteres');
    const u = { id: ++s.seq, rol, nombre: requerido(b.nombre, 'nombre'), email, clave, telefono: opcional(b.telefono), doc_tipo: opcional(b.doc_tipo) ?? '0', doc_numero: opcional(b.doc_numero), direccion: opcional(b.direccion) };
    s.usuarios.push(u);
    return u;
  }
  function sesion(s, u) {
    const token = `demo-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    s.sesiones[token] = u.id;
    return { token, usuario: vistaUsuario(u) };
  }
  const leerArchivo = (f) =>
    new Promise((ok, mal) => {
      const r = new FileReader();
      r.onload = () => ok(r.result);
      r.onerror = mal;
      r.readAsDataURL(f);
    });

  // ---------- Rutas ----------
  const R = [];
  const ruta = (m, patron, fn) => R.push([m, new RegExp(`^${patron.replace(/:id/g, '(\\d+)')}$`), fn]);

  ruta('POST', 'api/auth/login', ({ s, b }) => {
    const u = s.usuarios.find((x) => x.email === String(b.email ?? '').trim().toLowerCase());
    if (!u || u.clave !== b.password) fallo(401, 'Email o contraseña incorrectos');
    return sesion(s, u);
  });
  ruta('POST', 'api/auth/registro', ({ s, b }) => {
    if (!b.password || String(b.password).length < 8) fallo(400, 'La contraseña debe tener al menos 8 caracteres');
    return sesion(s, nuevoUsuario(s, b, 'cliente'));
  });
  ruta('POST', 'api/auth/logout', ({ s, token }) => {
    delete s.sesiones[token];
    return { ok: true };
  });
  ruta('GET', 'api/auth/yo', (ctx) => vistaUsuario(requerir(ctx)));
  ruta('GET', 'api/veterinarios', (ctx) => (requerir(ctx), ctx.s.usuarios.filter((u) => u.rol === 'veterinario').map((u) => ({ id: u.id, nombre: u.nombre }))));

  // Solicitud desde el formulario público de la página principal.
  ruta('POST', 'api/solicitudes', ({ s, b }) => {
    const nombre = requerido(b.tutor, 'nombre');
    const telefono = requerido(b.telefono, 'teléfono');
    const mascota = requerido(b.mascota, 'nombre de la mascota');
    const motivo = requerido(b.motivo, 'motivo');
    notificarVets(s, 'web', `Solicitud web: ${nombre} (${telefono}) para ${mascota}, ${motivo}${b.fecha ? `, prefiere ${b.fecha}` : ''}`);
    return { ok: true };
  });

  ruta('GET', 'api/servicios', ({ s, q }) => s.servicios.filter((x) => q.get('todos') === '1' || x.activo).map(vistaServicio));
  ruta('POST', 'api/servicios', (ctx) => {
    requerir(ctx, ['veterinario']);
    const { s, b } = ctx;
    const x = { id: ++s.seq, nombre: requerido(b.nombre, 'nombre'), categoria: b.categoria || 'otro', duracion_min: Number(requerido(b.duracion_min, 'duración')), precio_mil: Math.round(Number(requerido(b.precio, 'precio')) * 1000), tipo_sunat: 'Servicio', activo: 1 };
    s.servicios.push(x);
    return vistaServicio(x);
  });
  ruta('PATCH', 'api/servicios/:id', (ctx) => {
    requerir(ctx, ['veterinario']);
    const x = porId(ctx.s.servicios, ctx.p[0]) ?? fallo(404, 'Servicio no encontrado');
    const b = ctx.b;
    if ('duracion_min' in b) x.duracion_min = Number(b.duracion_min);
    if ('precio' in b) x.precio_mil = Math.round(Number(b.precio) * 1000);
    if ('activo' in b) x.activo = b.activo ? 1 : 0;
    return vistaServicio(x);
  });

  ruta('GET', 'api/mascotas', (ctx) => {
    const u = requerir(ctx);
    const conDueno = (m) => ({ ...m, cliente: porId(ctx.s.usuarios, m.cliente_id)?.nombre });
    const cid = Number(ctx.q.get('cliente_id')) || null;
    return ctx.s.mascotas.filter((m) => (esVet(u) ? !cid || m.cliente_id === cid : m.cliente_id === u.id)).map(conDueno);
  });
  ruta('POST', 'api/mascotas', (ctx) => {
    const u = requerir(ctx);
    const b = ctx.b;
    const clienteId = esVet(u) ? Number(requerido(b.cliente_id, 'cliente')) : u.id;
    const m = { id: ++ctx.s.seq, cliente_id: clienteId, nombre: requerido(b.nombre, 'nombre'), especie: requerido(b.especie, 'especie'), raza: opcional(b.raza), sexo: opcional(b.sexo), fecha_nacimiento: opcional(b.fecha_nacimiento), peso_kg: opcional(b.peso_kg) === null ? null : Number(b.peso_kg), notas: opcional(b.notas) };
    ctx.s.mascotas.push(m);
    return m;
  });
  ruta('GET', 'api/mascotas/:id', (ctx) => {
    const m = mascotaAccesible(ctx.s, requerir(ctx), ctx.p[0]);
    return { ...m, cliente: vistaUsuario(porId(ctx.s.usuarios, m.cliente_id)) };
  });

  ruta('GET', 'api/clientes', (ctx) => {
    requerir(ctx, ['veterinario']);
    const q = (ctx.q.get('q') ?? '').toLowerCase();
    return ctx.s.usuarios
      .filter((u) => u.rol === 'cliente' && (!q || [u.nombre, u.email, u.doc_numero, u.telefono].some((x) => String(x ?? '').toLowerCase().includes(q))))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((u) => ({
        ...vistaUsuario(u),
        mascotas: ctx.s.mascotas.filter((m) => m.cliente_id === u.id).length,
        ultima_cita: ctx.s.citas.filter((c) => c.cliente_id === u.id).map((c) => c.inicio).sort().at(-1) ?? null,
      }));
  });
  ruta('POST', 'api/clientes', (ctx) => (requerir(ctx, ['veterinario']), vistaUsuario(nuevoUsuario(ctx.s, { ...ctx.b, password: undefined }, 'cliente'))));
  ruta('GET', 'api/clientes/:id', (ctx) => {
    requerir(ctx, ['veterinario']);
    const u = porId(ctx.s.usuarios, ctx.p[0]);
    if (!u || u.rol !== 'cliente') fallo(404, 'Cliente no encontrado');
    return {
      ...vistaUsuario(u),
      mascotas: ctx.s.mascotas.filter((m) => m.cliente_id === u.id),
      citas: ctx.s.citas.filter((c) => c.cliente_id === u.id).sort((a, b) => b.inicio.localeCompare(a.inicio)).slice(0, 20).map((c) => vistaCita(ctx.s, c)),
    };
  });

  ruta('GET', 'api/disponibilidad', (ctx) => {
    requerir(ctx);
    const fecha = requerido(ctx.q.get('fecha'), 'fecha');
    const sv = servicioActivo(ctx.s, ctx.q.get('servicio_id'));
    const h = HORARIO[diaSemana(fecha)];
    if (!h) return { fecha, duracion_min: sv.duracion_min, cerrado: true, slots: [] };
    const ahora = textoLima();
    const slots = [];
    for (let t = h[0]; t + sv.duracion_min <= h[1]; t += PASO) {
      const inicio = `${fecha} ${aHora(t)}`;
      const fin = sumarMin(inicio, sv.duracion_min);
      slots.push({ hora: aHora(t), disponible: inicio > ahora && vets(ctx.s).some((v) => vetLibre(ctx.s, v, inicio, fin)) });
    }
    return { fecha, duracion_min: sv.duracion_min, cerrado: false, slots };
  });

  ruta('GET', 'api/citas', (ctx) => {
    const u = requerir(ctx);
    const desde = ctx.q.get('desde') || hoyLima();
    const hasta = ctx.q.get('hasta') || sumarDias(desde, 30);
    const estado = ctx.q.get('estado');
    return ctx.s.citas
      .filter((c) => c.inicio.slice(0, 10) >= desde && c.inicio.slice(0, 10) <= hasta && (esVet(u) || c.cliente_id === u.id) && (!estado || c.estado === estado))
      .sort((a, b) => a.inicio.localeCompare(b.inicio))
      .map((c) => vistaCita(ctx.s, c));
  });
  ruta('GET', 'api/citas/:id', (ctx) => vistaCita(ctx.s, citaAccesible(ctx.s, requerir(ctx), ctx.p[0])));
  ruta('POST', 'api/citas', (ctx) => {
    const u = requerir(ctx);
    const { s, b } = ctx;
    const m = mascotaAccesible(s, u, requerido(b.mascota_id, 'mascota'));
    const sv = servicioActivo(s, requerido(b.servicio_id, 'servicio'));
    const fecha = requerido(b.fecha, 'fecha');
    const hora = requerido(b.hora, 'hora');
    horarioValido(fecha, hora, sv.duracion_min);
    const inicio = `${fecha} ${hora}`;
    if (inicio <= textoLima()) fallo(409, 'Ese horario ya pasó');
    const fin = sumarMin(inicio, sv.duracion_min);
    const vet = pickVet(s, inicio, fin);
    if (!vet) fallo(409, 'Ese horario ya no está disponible');
    const c = { id: ++s.seq, mascota_id: m.id, cliente_id: m.cliente_id, veterinario_id: vet, servicio_id: sv.id, inicio, fin, estado: esVet(u) ? 'confirmada' : 'pendiente', es_emergencia: 0, motivo: opcional(b.motivo), recordatorio_enviado: 0, llegada_minutos: null, created_at: ahoraUtc() };
    s.citas.push(c);
    const v = vistaCita(s, c);
    if (esVet(u)) notificar(s, m.cliente_id, 'cita', `Cita confirmada para ${m.nombre}: ${sv.nombre}, ${inicio}`, c.id);
    else notificarVets(s, 'cita', `Nueva solicitud de ${v.cliente} para ${m.nombre}: ${sv.nombre}, ${inicio}`, c.id);
    return v;
  });
  ruta('PATCH', 'api/citas/:id', (ctx) => {
    const u = requerir(ctx);
    const { s, b } = ctx;
    const c = citaAccesible(s, u, ctx.p[0]);
    if (!esVet(u)) {
      if (b.estado !== 'cancelada' || Object.keys(b).length > 1) fallo(403, 'Solo puedes cancelar tu cita');
      if (!['pendiente', 'confirmada', 'urgente'].includes(c.estado)) fallo(409, 'Esta cita ya no se puede cancelar');
      c.estado = 'cancelada';
      notificar(s, c.veterinario_id, 'cita', `${porId(s.usuarios, c.cliente_id)?.nombre} canceló la cita del ${c.inicio}`, c.id);
      return vistaCita(s, c);
    }
    if (b.estado) c.estado = b.estado;
    if (b.fecha || b.hora) {
      const sv = porId(s.servicios, c.servicio_id);
      const fecha = b.fecha ?? c.inicio.slice(0, 10);
      const hora = b.hora ?? c.inicio.slice(11, 16);
      horarioValido(fecha, hora, sv.duracion_min);
      const inicio = `${fecha} ${hora}`;
      const fin = sumarMin(inicio, sv.duracion_min);
      if (!pickVet(s, inicio, fin, c.veterinario_id, c.id)) fallo(409, 'Ese horario ya no está disponible');
      Object.assign(c, { inicio, fin });
    }
    const v = vistaCita(s, c);
    notificar(s, c.cliente_id, 'cita', `Tu cita de ${v.mascota} (${v.servicio}) cambió a: ${c.estado.replace('_', ' ')}`, c.id);
    return v;
  });
  ruta('POST', 'api/citas/:id/llegada', (ctx) => {
    const u = requerir(ctx, ['cliente']);
    const { s, b } = ctx;
    const c = citaAccesible(s, u, ctx.p[0]);
    if (!['pendiente', 'confirmada', 'urgente'].includes(c.estado)) fallo(409, 'Esta cita ya no admite aviso de llegada');
    if (!c.es_emergencia && c.inicio.slice(0, 10) !== hoyLima()) fallo(409, 'Puedes avisar tu llegada el mismo día de la cita');
    const espera = opcional(b.minutos) === null ? null : Number(b.minutos);
    if (c.estado !== 'urgente') c.estado = 'en_camino';
    c.llegada_minutos = espera;
    const v = vistaCita(s, c);
    const cuando = espera === null ? 'está en camino' : espera === 0 ? 'ya llegó' : `llega en ${espera} min`;
    notificar(s, c.veterinario_id, c.es_emergencia ? 'urgencia' : 'llegada', `${v.cliente} ${cuando} con ${v.mascota} (cita ${c.inicio.slice(11)})`, c.id);
    return v;
  });
  ruta('POST', 'api/emergencias', (ctx) => {
    const u = requerir(ctx);
    const { s, b } = ctx;
    const m = mascotaAccesible(s, u, requerido(b.mascota_id, 'mascota'));
    const motivo = requerido(b.motivo, 'motivo');
    const sv = s.servicios.find((x) => x.categoria === 'emergencia' && x.activo) ?? fallo(503, 'No hay un servicio de urgencias configurado');
    const inicio = textoLima();
    const fin = sumarMin(inicio, sv.duracion_min);
    const carga = (v) => s.citas.filter((c) => c.veterinario_id === v && ocupa(c) && c.inicio < fin && c.fin > inicio).length;
    const vet = vets(s).sort((a, x) => carga(a) - carga(x))[0] ?? fallo(503, 'No hay veterinarios registrados');
    const espera = opcional(b.minutos) === null ? null : Number(b.minutos);
    const c = { id: ++s.seq, mascota_id: m.id, cliente_id: m.cliente_id, veterinario_id: vet, servicio_id: sv.id, inicio, fin, estado: 'urgente', es_emergencia: 1, motivo, recordatorio_enviado: 1, llegada_minutos: espera, created_at: ahoraUtc() };
    s.citas.push(c);
    notificarVets(s, 'urgencia', `URGENCIA: ${m.nombre} (${m.especie}): ${motivo}.${espera === null ? '' : ` Llega en ${espera} min.`}`, c.id);
    return vistaCita(s, c);
  });

  ruta('GET', 'api/mascotas/:id/historial', (ctx) => {
    const m = mascotaAccesible(ctx.s, requerir(ctx), ctx.p[0]);
    return ctx.s.historial
      .filter((h) => h.mascota_id === m.id)
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id)
      .map((h) => ({ ...h, veterinario: porId(ctx.s.usuarios, h.veterinario_id)?.nombre }));
  });
  ruta('POST', 'api/mascotas/:id/historial', (ctx) => {
    const u = requerir(ctx, ['veterinario']);
    const { s, b } = ctx;
    const m = mascotaAccesible(s, u, ctx.p[0]);
    const num = (v) => (opcional(v) === null ? null : Number(v));
    const h = { id: ++s.seq, mascota_id: m.id, cita_id: num(b.cita_id), veterinario_id: u.id, fecha: opcional(b.fecha) ?? hoyLima(), peso_kg: num(b.peso_kg), temperatura_c: num(b.temperatura_c), diagnostico: requerido(b.diagnostico, 'diagnóstico'), tratamiento: opcional(b.tratamiento), notas: opcional(b.notas), proximo_vencimiento: opcional(b.proximo_vencimiento), created_at: ahoraUtc() };
    s.historial.push(h);
    if (h.peso_kg !== null) m.peso_kg = h.peso_kg;
    const cita = h.cita_id && porId(s.citas, h.cita_id);
    if (cita && ocupa(cita)) cita.estado = 'atendida';
    notificar(s, m.cliente_id, 'historial', `Se registró una atención de ${m.nombre} en su historial`, h.cita_id);
    return { ...h, veterinario: u.nombre };
  });

  const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  ruta('POST', 'api/mascotas/:id/archivos', async (ctx) => {
    const u = requerir(ctx);
    const m = mascotaAccesible(ctx.s, u, ctx.p[0]);
    const f = ctx.archivo ?? fallo(400, 'Falta el archivo');
    if (!MIMES.includes(f.type)) fallo(415, 'Solo se permiten fotos JPG, PNG o WEBP, o documentos PDF');
    if (f.size > 1.5 * 1024 * 1024) fallo(413, 'En la demostración el máximo es 1.5 MB por archivo');
    const a = { id: ++ctx.s.seq, mascota_id: m.id, cita_id: null, subido_por: u.id, nombre_original: f.name, mime: f.type, tamano: f.size, created_at: ahoraUtc(), data: await leerArchivo(f) };
    ctx.s.archivos.push(a);
    const { data, ...vista } = a;
    return vista;
  });
  ruta('GET', 'api/mascotas/:id/archivos', (ctx) => {
    const m = mascotaAccesible(ctx.s, requerir(ctx), ctx.p[0]);
    return ctx.s.archivos
      .filter((a) => a.mascota_id === m.id)
      .reverse()
      .map(({ data, ...a }) => ({ ...a, subido_por: porId(ctx.s.usuarios, a.subido_por)?.nombre }));
  });
  ruta('GET', 'api/archivos/:id', async (ctx) => {
    const u = requerir(ctx);
    const a = porId(ctx.s.archivos, ctx.p[0]);
    if (!a) fallo(404, 'Archivo no encontrado');
    mascotaAccesible(ctx.s, u, a.mascota_id);
    return (await fetch(a.data)).blob();
  });

  ruta('GET', 'api/notificaciones', (ctx) => {
    const u = requerir(ctx);
    return ctx.s.notificaciones.filter((n) => n.usuario_id === u.id && (ctx.q.get('no_leidas') !== '1' || !n.leida)).reverse().slice(0, 100);
  });
  ruta('POST', 'api/notificaciones/leer', (ctx) => {
    const u = requerir(ctx);
    const ids = new Set((ctx.b.ids ?? []).map(Number));
    for (const n of ctx.s.notificaciones) if (n.usuario_id === u.id && (ctx.b.todas || ids.has(n.id))) n.leida = 1;
    return { ok: true };
  });

  function alertas(s, hoy) {
    const activos = s.inventario.filter((i) => i.activo).map((i) => vistaItem(i, hoy));
    return {
      vencidos: activos.filter((i) => i.stock > 0 && i.estado_vencimiento === 'vencido'),
      por_vencer: activos.filter((i) => i.stock > 0 && i.estado_vencimiento === 'por_vencer'),
      bajo_stock: activos.filter((i) => i.bajo_stock),
    };
  }

  ruta('GET', 'api/dashboard', (ctx) => {
    requerir(ctx, ['veterinario']);
    const s = ctx.s;
    const dias = Number(ctx.q.get('dias')) || 14;
    const hoy = hoyLima();
    const desde = sumarDias(hoy, -(dias - 1));
    const serie = Array.from({ length: dias }, (_, i) => {
      const fecha = sumarDias(desde, i);
      const del = s.citas.filter((c) => c.inicio.startsWith(fecha) && ocupa(c));
      const ing = s.boletas.filter((b) => b.fecha_emision === fecha && b.estado === 'emitida_local').reduce((a, b) => a + b.total, 0);
      return { fecha, clientes: new Set(del.map((c) => c.cliente_id)).size, citas: del.length, urgencias: del.filter((c) => c.es_emergencia).length, ingresos: soles(ing), ingresos_mil: ing };
    });
    const h = serie.at(-1);
    const ahora = textoLima();
    const inv = alertas(s, hoy);
    const estados = {};
    for (const c of s.citas.filter((x) => x.inicio.startsWith(hoy))) estados[c.estado] = (estados[c.estado] ?? 0) + 1;
    return {
      hoy,
      kpis: {
        clientes_hoy: h.clientes, citas_hoy: h.citas, urgencias_hoy: h.urgencias, ingresos_hoy: h.ingresos,
        pendientes_confirmar: s.citas.filter((c) => c.estado === 'pendiente' && c.inicio >= ahora).length,
        clientes_registrados: s.usuarios.filter((u) => u.rol === 'cliente').length,
        promedio_clientes_dia: Number((serie.reduce((a, d) => a + d.clientes, 0) / dias).toFixed(1)),
      },
      serie,
      estados_hoy: estados,
      en_camino: s.citas.filter((c) => ['en_camino', 'urgente'].includes(c.estado) && c.inicio.slice(0, 10) >= sumarDias(hoy, -1)).map((c) => vistaCita(s, c)),
      proximas: s.citas.filter((c) => ['pendiente', 'confirmada'].includes(c.estado) && c.inicio >= ahora).sort((a, b) => a.inicio.localeCompare(b.inicio)).slice(0, 10).map((c) => vistaCita(s, c)),
      vencimientos: s.historial
        .filter((x) => x.proximo_vencimiento && x.proximo_vencimiento >= hoy && x.proximo_vencimiento <= sumarDias(hoy, 14))
        .map((x) => {
          const m = porId(s.mascotas, x.mascota_id);
          const u = porId(s.usuarios, m.cliente_id);
          return { id: x.id, proximo_vencimiento: x.proximo_vencimiento, diagnostico: x.diagnostico, mascota_id: m.id, mascota: m.nombre, cliente: u.nombre, telefono: u.telefono };
        }),
      inventario: { vencidos: inv.vencidos.length, por_vencer: inv.por_vencer.length, bajo_stock: inv.bajo_stock.length, detalle: inv },
    };
  });

  ruta('GET', 'api/inventario', (ctx) => {
    requerir(ctx, ['veterinario']);
    const q = (ctx.q.get('q') ?? '').toLowerCase();
    return ctx.s.inventario.filter((i) => !q || `${i.nombre} ${i.categoria} ${i.lote ?? ''}`.toLowerCase().includes(q)).map((i) => vistaItem(i));
  });
  ruta('GET', 'api/inventario/alertas', (ctx) => (requerir(ctx, ['veterinario']), alertas(ctx.s, hoyLima())));
  ruta('POST', 'api/inventario', (ctx) => {
    const u = requerir(ctx, ['veterinario']);
    const b = ctx.b;
    const i = { id: ++ctx.s.seq, nombre: requerido(b.nombre, 'nombre'), categoria: opcional(b.categoria) ?? 'general', tipo_sunat: b.tipo_sunat || 'Bien', unidad: 'UNIDAD', stock: Number(b.stock ?? 0), stock_minimo: Number(b.stock_minimo ?? 0), precio_mil: Math.round(Number(b.precio ?? 0) * 1000), lote: opcional(b.lote), vence_el: opcional(b.vence_el), ubicacion: opcional(b.ubicacion), activo: 1 };
    ctx.s.inventario.push(i);
    if (i.stock) ctx.s.movimientos.push({ id: ++ctx.s.seq, item_id: i.id, delta: i.stock, motivo: 'Stock inicial', usuario_id: u.id });
    return vistaItem(i);
  });
  ruta('POST', 'api/inventario/:id/movimientos', (ctx) => {
    const u = requerir(ctx, ['veterinario']);
    const i = porId(ctx.s.inventario, ctx.p[0]) ?? fallo(404, 'Producto no encontrado');
    const delta = Number(requerido(ctx.b.delta, 'cantidad'));
    const motivo = requerido(ctx.b.motivo, 'motivo');
    if (i.stock + delta < 0) fallo(409, `Stock insuficiente: hay ${i.stock}`);
    i.stock += delta;
    ctx.s.movimientos.push({ id: ++ctx.s.seq, item_id: i.id, delta, motivo, usuario_id: u.id });
    return vistaItem(i);
  });

  ruta('GET', 'api/boletas', (ctx) => {
    const u = requerir(ctx);
    return ctx.s.boletas.filter((b) => esVet(u) || b.cliente_id === u.id).slice().reverse().map(vistaBoleta);
  });
  ruta('POST', 'api/boletas', (ctx) => {
    const u = requerir(ctx, ['veterinario']);
    const { s, b } = ctx;
    if (!Array.isArray(b.items) || !b.items.length) fallo(400, 'Agrega al menos un ítem');
    let cliente;
    if (b.cliente_id) {
      const c = porId(s.usuarios, b.cliente_id) ?? fallo(404, 'Cliente no encontrado');
      const conDoc = c.doc_tipo && c.doc_tipo !== '0' && c.doc_numero;
      cliente = { id: c.id, doc_tipo: conDoc ? c.doc_tipo : '0', doc_numero: conDoc ? c.doc_numero : '00000000', nombre: c.nombre };
    } else {
      const tipo = b.cliente_doc_tipo || '0';
      if (tipo === '1' && !/^\d{8}$/.test(b.cliente_doc_numero ?? '')) fallo(400, 'El DNI debe tener 8 dígitos');
      cliente = { id: null, doc_tipo: tipo, doc_numero: tipo === '0' ? '00000000' : b.cliente_doc_numero, nombre: opcional(b.cliente_nombre) ?? 'CLIENTE VARIOS' };
    }
    const items = b.items.map((it, n) => {
      const cant = Number(it.cantidad ?? 1);
      let base;
      if (it.servicio_id) {
        const x = porId(s.servicios, it.servicio_id) ?? fallo(404, 'Servicio no encontrado');
        base = { descripcion: x.nombre, tipo_sunat: x.tipo_sunat, precio: x.precio_mil, inventario_id: null };
      } else if (it.inventario_id) {
        const x = porId(s.inventario, it.inventario_id) ?? fallo(404, 'Producto no encontrado');
        if (x.stock < cant) fallo(409, `Stock insuficiente de ${x.nombre}: hay ${x.stock}`);
        base = { descripcion: x.nombre, tipo_sunat: x.tipo_sunat, precio: x.precio_mil, inventario_id: x.id };
      } else {
        base = { descripcion: requerido(it.descripcion, `descripción del ítem ${n + 1}`), tipo_sunat: it.tipo || 'Servicio', precio: 0, inventario_id: null };
      }
      if (opcional(it.precio) !== null) base.precio = Math.round(Number(it.precio) * 1000);
      if (!(base.precio > 0)) fallo(400, `El precio del ítem ${n + 1} debe ser mayor a 0`);
      const vu = Math.round(base.precio / 1.18);
      const total = base.precio * cant;
      return { ...base, unidad: 'UNIDAD', cantidad: cant, vu, vv: vu * cant, igv: total - vu * cant, total };
    });
    const total = items.reduce((a, i) => a + i.total, 0);
    if (total >= UMBRAL_DOC_MIL && cliente.doc_tipo === '0') fallo(400, 'Para boletas desde S/ 700.00 registra el documento del cliente');
    const numero = ++s.serie;
    const boleta = { id: ++s.seq, serie: 'B001', numero, fecha_emision: hoyLima(), cliente_id: cliente.id, doc_tipo: cliente.doc_tipo, doc_numero: cliente.doc_numero, nombre: cliente.nombre, estado: 'emitida_local', items, gravadas: items.reduce((a, i) => a + i.vv, 0), igv: items.reduce((a, i) => a + i.igv, 0), total, emitido_por: u.id };
    for (const it of items) {
      if (!it.inventario_id) continue;
      porId(s.inventario, it.inventario_id).stock -= it.cantidad;
      s.movimientos.push({ id: ++s.seq, item_id: it.inventario_id, delta: -it.cantidad, motivo: `Venta ${comprobante(boleta)}`, usuario_id: u.id });
    }
    s.boletas.push(boleta);
    return vistaBoleta(boleta);
  });
  ruta('GET', 'api/boletas/:id', (ctx) => {
    const u = requerir(ctx);
    const b = porId(ctx.s.boletas, ctx.p[0]);
    if (!b || (!esVet(u) && b.cliente_id !== u.id)) fallo(404, 'Boleta no encontrada');
    return vistaBoleta(b);
  });
  ruta('GET', 'api/boletas/:id/payload', (ctx) => {
    requerir(ctx, ['veterinario']);
    const b = porId(ctx.s.boletas, ctx.p[0]) ?? fallo(404, 'Boleta no encontrada');
    const n3 = (m) => Number(unit(m));
    return {
      tipoComprobante: '03', serie: b.serie, correlativo: b.numero, comprobante: comprobante(b), fechaEmision: b.fecha_emision, moneda: 'PEN',
      emisor: { ruc: '00000000000', razonSocial: 'SERVICIOS VETERINARIOS A & G S.A.C.' },
      cliente: { tipoDocumento: b.doc_tipo, numeroDocumento: b.doc_numero, nombre: b.nombre },
      items: b.items.map((it, i) => ({ orden: i + 1, codigo: it.inventario_id ? `INV-${it.inventario_id}` : null, descripcion: it.descripcion, tipo: it.tipo_sunat, unidadMedida: it.unidad, cantidad: it.cantidad, valorUnitario: n3(it.vu), precioUnitarioConIgv: n3(it.precio), valorVenta: n3(it.vv), igv: n3(it.igv), total: n3(it.total), tipoAfectacionIgv: '10', porcentajeIgv: 18, impuestoBolsasPlasticas: false })),
      totales: { operacionesGravadas: n3(b.gravadas), igv: n3(b.igv), importeTotal: n3(b.total) },
      estado: b.estado, envioSunat: 'pendiente',
    };
  });
  ruta('POST', 'api/boletas/:id/anular', (ctx) => {
    const u = requerir(ctx, ['veterinario']);
    const b = porId(ctx.s.boletas, ctx.p[0]) ?? fallo(404, 'Boleta no encontrada');
    if (b.estado === 'anulada') fallo(409, 'La boleta ya está anulada');
    b.estado = 'anulada';
    b.motivo_anulacion = requerido(ctx.b.motivo, 'motivo');
    for (const it of b.items) {
      if (!it.inventario_id) continue;
      porId(ctx.s.inventario, it.inventario_id).stock += it.cantidad;
      ctx.s.movimientos.push({ id: ++ctx.s.seq, item_id: it.inventario_id, delta: it.cantidad, motivo: `Anulación ${comprobante(b)}`, usuario_id: u.id });
    }
    return vistaBoleta(b);
  });

  // ---------- Punto de entrada ----------
  async function manejar(metodo, rutaPedida, { body, archivo, token } = {}) {
    const url = new URL(rutaPedida.replace(/^\/+/, ''), 'http://demo/');
    const path = url.pathname.replace(/^\/+/, '');
    const s = cargar();
    const user = token && s.sesiones[token] ? porId(s.usuarios, s.sesiones[token]) : null;
    for (const [m, re, fn] of R) {
      const k = re.exec(path);
      if (!k || m !== metodo) continue;
      const r = await fn({ s, q: url.searchParams, b: body ?? {}, p: k.slice(1), user, archivo, token });
      guardar(s);
      return r;
    }
    fallo(404, 'No encontrado');
  }

  window.VetDemo = {
    manejar,
    clave: CLAVE,
    reiniciar() {
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* nada que borrar */
      }
    },
  };
})();
