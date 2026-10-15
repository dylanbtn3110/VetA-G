(async () => {
  const { esc, estado, intentar, datosForm } = vet;
  const $ = (s) => document.querySelector(s);

  const yo = await vet.sesion('cliente');
  if (!yo) return;

  let mascotas = [];
  let servicios = [];

  // ---------- Datos base ----------
  async function cargarMascotas() {
    mascotas = await vet.get('/api/mascotas');
    const opciones = mascotas.length
      ? mascotas.map((m) => `<option value="${m.id}">${esc(m.nombre)} (${esc(m.especie)})</option>`).join('')
      : '<option value="">Primero registra una mascota</option>';
    for (const sel of document.querySelectorAll('[data-mascotas]')) {
      const actual = sel.value;
      sel.innerHTML = opciones;
      if (mascotas.some((m) => String(m.id) === actual)) sel.value = actual;
    }
    $('#mascotas').innerHTML = mascotas.length
      ? mascotas
          .map(
            (m) => `<li><strong>${esc(m.nombre)}</strong> · ${esc(m.especie)}${m.raza ? ` · ${esc(m.raza)}` : ''}
              ${m.peso_kg ? `· ${m.peso_kg} kg` : ''}${m.notas ? `<div class="small muted">${esc(m.notas)}</div>` : ''}</li>`,
          )
          .join('')
      : '<li class="empty">Aún no registras mascotas.</li>';
  }

  async function cargarServicios() {
    servicios = await vet.get('/api/servicios');
    $('#servicio').innerHTML =
      '<option value="">Elige un servicio</option>' +
      servicios.map((s) => `<option value="${s.id}">${esc(s.nombre)} · ${s.duracion_min} min · S/ ${s.precio}</option>`).join('');
    $('#lista-servicios').innerHTML = servicios
      .map((s) => `<li class="row between"><span>${esc(s.nombre)}</span><span>S/ ${s.precio}</span></li>`)
      .join('');
  }

  // ---------- Inicio ----------
  async function cargarCitas() {
    const citas = await vet.get(`/api/citas?desde=${vet.hoy()}`);
    const activas = citas.filter((c) => !['cancelada', 'atendida', 'no_asistio'].includes(c.estado));
    $('#proximas').innerHTML = activas.length
      ? activas
          .map((c) => {
            const puedeAvisar =
              ['pendiente', 'confirmada', 'urgente'].includes(c.estado) && (c.es_emergencia || c.inicio.startsWith(vet.hoy()));
            return `<li class="stack">
              <div class="row between"><strong>${esc(c.inicio)}</strong>${estado(c.estado)}</div>
              <div>${esc(c.mascota)} · ${esc(c.servicio)} <span class="muted small">con ${esc(c.veterinario)}</span></div>
              <div class="row">
                ${puedeAvisar ? `<select data-min="${c.id}" aria-label="Minutos"><option value="5">5 min</option><option value="10" selected>10 min</option><option value="20">20 min</option><option value="30">30 min</option><option value="0">Ya llegué</option></select>
                <button class="btn small" data-camino="${c.id}">Voy en camino</button>` : ''}
                ${['pendiente', 'confirmada'].includes(c.estado) ? `<button class="btn ghost small" data-cancelar="${c.id}">Cancelar</button>` : ''}
              </div></li>`;
          })
          .join('')
      : '<li class="empty">No tienes citas próximas. Reserva una en «Reservar cita».</li>';
  }

  const refrescarNotificaciones = () => vet.notificaciones($('#notificaciones'), $('#contador')).catch(() => {});

  $('#proximas').addEventListener('click', async (e) => {
    const camino = e.target.closest('[data-camino]');
    const cancelar = e.target.closest('[data-cancelar]');
    if (camino) {
      const minutos = Number($(`[data-min="${camino.dataset.camino}"]`).value);
      await intentar(() => vet.post(`/api/citas/${camino.dataset.camino}/llegada`, { minutos }), 'Avisamos a la clínica que vas en camino');
      cargarCitas();
    }
    if (cancelar && confirm('¿Cancelar esta cita?')) {
      await intentar(() => vet.patch(`/api/citas/${cancelar.dataset.cancelar}`, { estado: 'cancelada' }), 'Cita cancelada');
      cargarCitas();
    }
  });

  $('#leer-todas').addEventListener('click', async () => {
    await intentar(() => vet.post('/api/notificaciones/leer', { todas: true }));
    refrescarNotificaciones();
  });

  $('#form-urgencia').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await intentar(() => vet.post('/api/emergencias', datosForm(e.target)), 'Urgencia enviada. Te estamos esperando.');
    if (r) {
      e.target.reset();
      cargarCitas();
    }
  });

  // ---------- Reservar ----------
  let horaElegida = null;
  $('#fecha').min = vet.hoy();

  async function cargarSlots() {
    horaElegida = null;
    $('#btn-reservar').disabled = true;
    const servicio = $('#servicio').value;
    const fecha = $('#fecha').value;
    if (!servicio || !fecha) return;
    const d = await intentar(() => vet.get(`/api/disponibilidad?fecha=${fecha}&servicio_id=${servicio}`));
    if (!d) return;
    if (d.cerrado) {
      $('#slots-info').textContent = 'La clínica no atiende ese día.';
      $('#slots').innerHTML = '';
      return;
    }
    const libres = d.slots.filter((s) => s.disponible).length;
    $('#slots-info').textContent = libres
      ? `${libres} horarios libres (duración ${d.duracion_min} min).`
      : 'No quedan horarios libres ese día. Prueba otra fecha.';
    $('#slots').innerHTML = d.slots
      .map((s) => `<button type="button" data-hora="${s.hora}" aria-pressed="false" ${s.disponible ? '' : 'disabled'}>${s.hora}</button>`)
      .join('');
  }

  $('#servicio').addEventListener('change', cargarSlots);
  $('#fecha').addEventListener('change', cargarSlots);
  $('#slots').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hora]');
    if (!b || b.disabled) return;
    for (const x of $('#slots').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
    horaElegida = b.dataset.hora;
    $('#btn-reservar').disabled = false;
  });

  $('#form-reserva').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!horaElegida) return;
    const datos = { ...datosForm(e.target), hora: horaElegida };
    const r = await intentar(() => vet.post('/api/citas', datos), 'Solicitud enviada. Te confirmaremos pronto.');
    if (r) {
      e.target.motivo.value = '';
      cargarSlots();
      cargarCitas();
    }
  });

  // ---------- Mascotas ----------
  $('#form-mascota').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await intentar(() => vet.post('/api/mascotas', datosForm(e.target)), 'Mascota registrada');
    if (r) {
      e.target.reset();
      cargarMascotas();
    }
  });

  // ---------- Historial ----------
  async function cargarHistorial() {
    const id = $('#hist-mascota').value;
    if (!id) {
      $('#historial').innerHTML = '<li class="empty">Registra una mascota primero.</li>';
      $('#archivos').innerHTML = '';
      return;
    }
    const [hist, archivos] = await Promise.all([vet.get(`/api/mascotas/${id}/historial`), vet.get(`/api/mascotas/${id}/archivos`)]);
    $('#historial').innerHTML = hist.length
      ? hist
          .map(
            (h) => `<li class="stack"><div class="row between"><strong>${esc(h.fecha)}</strong><span class="small muted">${esc(h.veterinario)}</span></div>
              <div><strong>Diagnóstico:</strong> ${esc(h.diagnostico)}</div>
              ${h.tratamiento ? `<div><strong>Tratamiento:</strong> ${esc(h.tratamiento)}</div>` : ''}
              <div class="small muted">${h.peso_kg ? `Peso ${h.peso_kg} kg · ` : ''}${h.temperatura_c ? `Temp. ${h.temperatura_c} °C` : ''}</div>
              ${h.proximo_vencimiento ? `<div><span class="badge warn">Próximo control: ${esc(h.proximo_vencimiento)}</span></div>` : ''}</li>`,
          )
          .join('')
      : '<li class="empty">Sin atenciones registradas todavía.</li>';
    vet.mostrarArchivos($('#archivos'), archivos);
  }

  $('#hist-mascota').addEventListener('change', cargarHistorial);
  $('#form-foto').addEventListener('submit', async (e) => {
    e.preventDefault();
    const archivo = e.target.archivo.files[0];
    const id = $('#hist-mascota').value;
    if (!archivo || !id) return;
    const r = await intentar(() => vet.subir(`/api/mascotas/${id}/archivos`, archivo), 'Archivo subido');
    if (r) {
      e.target.reset();
      cargarHistorial();
    }
  });

  // ---------- Boletas ----------
  async function cargarBoletas() {
    const boletas = await vet.get(`/api/boletas?desde=2000-01-01`);
    $('#boletas').innerHTML = boletas.length
      ? boletas
          .map(
            (b) => `<tr><td>${esc(b.comprobante)}</td><td>${esc(b.fecha_emision)}</td>
              <td class="small">${b.items.map((i) => `${i.cantidad} × ${esc(i.descripcion)}`).join('<br>')}</td>
              <td class="num">S/ ${b.total}</td><td>${b.estado === 'anulada' ? '<span class="badge anulada">Anulada</span>' : '<span class="badge ok">Emitida</span>'}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="5" class="empty">Aún no tienes boletas.</td></tr>';
  }

  // ---------- Arranque ----------
  await Promise.all([cargarMascotas(), cargarServicios()]);
  vet.pestanas((tab) => {
    if (tab === 'inicio') cargarCitas();
    if (tab === 'historial') cargarHistorial();
    if (tab === 'boletas') cargarBoletas();
  });
  refrescarNotificaciones();
  setInterval(refrescarNotificaciones, 30_000);
})();
