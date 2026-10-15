(async () => {
  const { esc, estado, intentar, datosForm } = vet;
  const $ = (s) => document.querySelector(s);

  const yo = await vet.sesion('veterinario');
  if (!yo) return;

  let servicios = [];
  let productos = [];
  let mostrarPestana = () => {};

  const opcionesServicios = (soloActivos = true) =>
    servicios
      .filter((s) => !soloActivos || s.activo)
      .map((s) => `<option value="${s.id}">${esc(s.nombre)} · ${s.duracion_min} min · S/ ${s.precio}</option>`)
      .join('');

  // ---------- Resumen ----------
  async function cargarResumen() {
    const d = await vet.get('/api/dashboard?dias=14');
    const k = d.kpis;
    const alertasInv = d.inventario.vencidos + d.inventario.por_vencer + d.inventario.bajo_stock;
    const kpi = (label, value, alerta = false) =>
      `<div class="kpi ${alerta ? 'alert' : ''}"><div class="label">${label}</div><div class="value">${esc(value)}</div></div>`;
    $('#kpis').innerHTML = [
      kpi('Clientes hoy', k.clientes_hoy),
      kpi('Citas hoy', k.citas_hoy),
      kpi('Urgencias hoy', k.urgencias_hoy, k.urgencias_hoy > 0),
      kpi('Ingresos hoy', `S/ ${k.ingresos_hoy}`),
      kpi('Por confirmar', k.pendientes_confirmar, k.pendientes_confirmar > 0),
      kpi('Promedio clientes/día', k.promedio_clientes_dia),
      kpi('Clientes registrados', k.clientes_registrados),
      kpi('Alertas inventario', alertasInv, alertasInv > 0),
    ].join('');

    const max = Math.max(1, ...d.serie.map((x) => x.clientes));
    $('#grafico').innerHTML = d.serie
      .map(
        (x) => `<div class="bar ${x.fecha === d.hoy ? 'today' : ''}" title="${x.fecha}: ${x.clientes} clientes, ${x.citas} citas, S/ ${x.ingresos}">
          <span class="n">${x.clientes}</span>
          <div class="fill" style="height:${(x.clientes / max) * 100}%"></div>
          <span class="d">${x.fecha.slice(8)}/${x.fecha.slice(5, 7)}</span></div>`,
      )
      .join('');

    $('#en-camino').innerHTML = d.en_camino.length
      ? d.en_camino
          .map(
            (c) => `<li class="stack"><div class="row between"><strong>${esc(c.mascota)}</strong>${estado(c.estado)}</div>
              <div class="small">${esc(c.cliente)} · ${esc(c.cliente_telefono ?? '')} · ${esc(c.servicio)}</div>
              ${c.motivo ? `<div class="small">${esc(c.motivo)}</div>` : ''}
              <div class="small muted">${c.llegada_minutos !== null ? (c.llegada_minutos === 0 ? 'Ya llegó' : `Llega en ~${c.llegada_minutos} min`) : ''} · ${esc(c.inicio)}</div>
              <div class="row"><button class="btn small" data-atender="${c.id}">Atender</button></div></li>`,
          )
          .join('')
      : '<li class="empty">Nadie en camino por ahora.</li>';

    $('#proximas').innerHTML = d.proximas.length
      ? d.proximas
          .map(
            (c) => `<li class="row between"><span><strong>${esc(c.inicio)}</strong> · ${esc(c.mascota)} · ${esc(c.servicio)}
              <span class="small muted">(${esc(c.cliente)})</span></span>
              <span class="row">${estado(c.estado)}${c.estado === 'pendiente' ? `<button class="btn small" data-confirmar="${c.id}">Confirmar</button>` : ''}</span></li>`,
          )
          .join('')
      : '<li class="empty">No hay citas próximas.</li>';

    $('#vencimientos').innerHTML = d.vencimientos.length
      ? d.vencimientos
          .map(
            (h) => `<li class="row between"><span><strong>${esc(h.mascota)}</strong> · ${esc(h.cliente)}
              ${h.telefono ? `· <a href="https://wa.me/51${esc(h.telefono.replace(/\D/g, ''))}" target="_blank" rel="noopener">${esc(h.telefono)}</a>` : ''}
              <div class="small muted">${esc(h.diagnostico)}</div></span><span class="badge warn">${esc(h.proximo_vencimiento)}</span></li>`,
          )
          .join('')
      : '<li class="empty">Sin controles por vencer.</li>';

    const inv = d.inventario.detalle;
    const filaInv = (i, tipo, texto) => `<li class="row between"><span>${esc(i.nombre)}</span><span class="badge ${tipo}">${texto}</span></li>`;
    const items = [
      ...inv.vencidos.map((i) => filaInv(i, 'vencido', `vencido ${i.vence_el}`)),
      ...inv.por_vencer.map((i) => filaInv(i, 'por_vencer', `vence ${i.vence_el}`)),
      ...inv.bajo_stock.map((i) => filaInv(i, 'warn', `stock ${i.stock} / mín. ${i.stock_minimo}`)),
    ];
    $('#alertas-resumen').innerHTML = items.length ? items.join('') : '<li class="empty">Todo en orden.</li>';
  }

  const refrescarNotificaciones = async () => {
    const previas = Number($('#contador').textContent);
    const nuevas = await vet.notificaciones($('#notificaciones'), $('#contador')).catch(() => previas);
    if (nuevas > previas) {
      vet.aviso('Tienes notificaciones nuevas');
      cargarResumen().catch(() => {});
    }
  };

  $('#leer-todas').addEventListener('click', async () => {
    await intentar(() => vet.post('/api/notificaciones/leer', { todas: true }));
    refrescarNotificaciones();
  });

  async function cambiarEstado(id, nuevo, mensaje) {
    const r = await intentar(() => vet.patch(`/api/citas/${id}`, { estado: nuevo }), mensaje);
    if (r) {
      cargarResumen();
      cargarAgenda();
    }
    return r;
  }

  document.addEventListener('click', async (e) => {
    const conf = e.target.closest('[data-confirmar]');
    if (conf) cambiarEstado(conf.dataset.confirmar, 'confirmada', 'Cita confirmada');
    const at = e.target.closest('[data-atender]');
    if (at) {
      const cita = await cambiarEstado(at.dataset.atender, 'en_atencion', 'En atención');
      if (cita) {
        mostrarPestana('agenda');
        prepararAtencion(cita);
      }
    }
  });

  // ---------- Agenda ----------
  $('#agenda-fecha').value = vet.hoy();
  $('#cita-fecha').min = vet.hoy();

  async function cargarAgenda() {
    const fecha = $('#agenda-fecha').value || vet.hoy();
    const citas = await vet.get(`/api/citas?desde=${fecha}&hasta=${fecha}`);
    const opciones = Object.entries(vet.ESTADOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    $('#agenda').innerHTML = citas.length
      ? citas
          .map(
            (c) => `<tr><td><strong>${esc(c.inicio.slice(11))}</strong><div class="small muted">a ${esc(c.fin.slice(11))}</div></td>
              <td>${esc(c.mascota)}<div class="small muted">${esc(c.especie)}</div></td>
              <td>${esc(c.cliente)}<div class="small muted">${esc(c.cliente_telefono ?? '')}</div></td>
              <td>${esc(c.servicio)}</td><td class="small">${esc(c.motivo ?? '')}</td>
              <td><select data-estado="${c.id}" aria-label="Estado">${opciones.replace(`value="${c.estado}"`, `value="${c.estado}" selected`)}</select></td>
              <td><button class="btn small" data-atender-cita="${c.id}">Atender</button></td></tr>`,
          )
          .join('')
      : '<tr><td colspan="7" class="empty">Sin citas para este día.</td></tr>';
  }

  $('#agenda-fecha').addEventListener('change', cargarAgenda);
  $('#agenda').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-estado]');
    if (sel) cambiarEstado(sel.dataset.estado, sel.value, 'Estado actualizado');
  });
  $('#agenda').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-atender-cita]');
    if (!b) return;
    const cita = await vet.get(`/api/citas/${b.dataset.atenderCita}`);
    prepararAtencion(cita);
  });

  function prepararAtencion(cita) {
    const f = $('#form-atencion');
    f.hidden = false;
    f.mascota_id.value = cita.mascota_id;
    f.cita_id.value = cita.id;
    $('#atencion-info').innerHTML = `<strong>${esc(cita.mascota)}</strong> (${esc(cita.especie)}) · ${esc(cita.cliente)} · ${esc(cita.servicio)}${cita.motivo ? `<br>Motivo: ${esc(cita.motivo)}` : ''}`;
    $('#card-atencion').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('#form-atencion').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { mascota_id, ...datos } = datosForm(e.target);
    const r = await intentar(() => vet.post(`/api/mascotas/${mascota_id}/historial`, datos), 'Atención guardada en el historial');
    if (r) {
      e.target.reset();
      e.target.hidden = true;
      $('#atencion-info').textContent = 'Atención registrada. Elige otra cita para continuar.';
      cargarAgenda();
    }
  });

  async function cargarMascotasCita() {
    const mascotas = await vet.get('/api/mascotas');
    $('#cita-mascota').innerHTML =
      '<option value="">Elige la mascota</option>' +
      mascotas.map((m) => `<option value="${m.id}">${esc(m.nombre)} (${esc(m.especie)}) · ${esc(m.cliente)}</option>`).join('');
  }

  let horaCita = null;
  async function cargarSlotsCita() {
    horaCita = null;
    $('#btn-cita').disabled = true;
    const s = $('#cita-servicio').value;
    const f = $('#cita-fecha').value;
    if (!s || !f) return;
    const d = await intentar(() => vet.get(`/api/disponibilidad?fecha=${f}&servicio_id=${s}`));
    if (!d) return;
    $('#cita-slots').innerHTML = d.cerrado
      ? '<p class="empty">Cerrado ese día.</p>'
      : d.slots.map((x) => `<button type="button" data-hora="${x.hora}" aria-pressed="false" ${x.disponible ? '' : 'disabled'}>${x.hora}</button>`).join('');
  }
  $('#cita-servicio').addEventListener('change', cargarSlotsCita);
  $('#cita-fecha').addEventListener('change', cargarSlotsCita);
  $('#cita-slots').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hora]');
    if (!b || b.disabled) return;
    for (const x of $('#cita-slots').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
    horaCita = b.dataset.hora;
    $('#btn-cita').disabled = false;
  });
  $('#form-cita').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await intentar(() => vet.post('/api/citas', { ...datosForm(e.target), hora: horaCita }), 'Cita agendada');
    if (r) {
      cargarSlotsCita();
      cargarAgenda();
    }
  });

  // ---------- Clientes e historial ----------
  async function cargarClientes() {
    const q = encodeURIComponent($('#buscar-cliente').value.trim());
    const clientes = await vet.get(`/api/clientes?q=${q}`);
    $('#clientes').innerHTML = clientes.length
      ? clientes
          .map(
            (c) => `<li class="row between" data-cliente="${c.id}" style="cursor:pointer">
              <span><strong>${esc(c.nombre)}</strong><div class="small muted">${esc(c.telefono ?? '')} ${c.doc_numero ? `· DNI ${esc(c.doc_numero)}` : ''}</div></span>
              <span class="small muted">${c.mascotas} mascota(s)${c.ultima_cita ? `<br>última: ${esc(c.ultima_cita.slice(0, 10))}` : ''}</span></li>`,
          )
          .join('')
      : '<li class="empty">Sin resultados.</li>';
    const sel = $('#boleta-cliente');
    const actual = sel.value;
    sel.innerHTML =
      '<option value="">— Ingresar datos a mano —</option>' + clientes.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
    sel.value = actual;
  }

  let buscarTimer;
  $('#buscar-cliente').addEventListener('input', () => {
    clearTimeout(buscarTimer);
    buscarTimer = setTimeout(cargarClientes, 250);
  });
  $('#clientes').addEventListener('click', (e) => {
    const li = e.target.closest('[data-cliente]');
    if (li) verCliente(li.dataset.cliente);
  });
  $('#form-cliente').addEventListener('submit', async (e) => {
    e.preventDefault();
    const datos = datosForm(e.target);
    if (!datos.doc_numero) datos.doc_tipo = '0';
    const r = await intentar(() => vet.post('/api/clientes', datos), 'Cliente registrado');
    if (r) {
      e.target.reset();
      await cargarClientes();
      verCliente(r.id);
    }
  });

  async function verCliente(id) {
    const c = await vet.get(`/api/clientes/${id}`);
    const caja = $('#detalle-cliente');
    caja.innerHTML = `
      <div class="row between"><h2>${esc(c.nombre)}</h2><span class="small muted">${esc(c.email)}</span></div>
      <p class="small">${esc(c.telefono ?? 'Sin teléfono')} ${c.doc_numero ? `· Doc. ${esc(c.doc_numero)}` : ''}</p>
      <label>Mascota <select id="det-mascota">${c.mascotas.map((m) => `<option value="${m.id}">${esc(m.nombre)} (${esc(m.especie)})</option>`).join('') || '<option value="">Sin mascotas</option>'}</select></label>
      <details><summary><strong>Agregar mascota</strong></summary>
        <form id="det-form-mascota" class="form-grid" style="margin-top:10px">
          <label>Nombre <input name="nombre" required></label>
          <label>Especie <input name="especie" required></label>
          <label>Raza <input name="raza"></label>
          <label>&nbsp;<button class="btn block">Guardar</button></label>
        </form></details>
      <h3>Historial clínico</h3>
      <ul class="list" id="det-historial"></ul>
      <details><summary><strong>Agregar atención sin cita</strong></summary>
        <form id="det-form-hist" class="form" style="margin-top:10px">
          <div class="form-grid">
            <label>Peso (kg) <input type="number" step="0.1" name="peso_kg"></label>
            <label>Temp. (°C) <input type="number" step="0.1" name="temperatura_c"></label>
            <label>Próximo control <input type="date" name="proximo_vencimiento"></label>
          </div>
          <label>Diagnóstico <textarea name="diagnostico" required></textarea></label>
          <label>Tratamiento <textarea name="tratamiento"></textarea></label>
          <button class="btn">Guardar</button>
        </form></details>
      <h3>Fotos y documentos</h3>
      <form id="det-form-foto" class="row"><input type="file" name="archivo" accept="image/jpeg,image/png,image/webp,application/pdf" required style="flex:1"><button class="btn small">Subir</button></form>
      <div class="files" id="det-archivos"></div>
      <h3>Últimas citas</h3>
      <ul class="list small">${c.citas.map((x) => `<li class="row between"><span>${esc(x.inicio)} · ${esc(x.mascota)} · ${esc(x.servicio)}</span>${estado(x.estado)}</li>`).join('') || '<li class="empty">Sin citas.</li>'}</ul>`;

    const mascotaSel = () => $('#det-mascota').value;
    async function cargarMascota() {
      const id = mascotaSel();
      if (!id) return;
      const [hist, archivos] = await Promise.all([vet.get(`/api/mascotas/${id}/historial`), vet.get(`/api/mascotas/${id}/archivos`)]);
      $('#det-historial').innerHTML = hist.length
        ? hist
            .map(
              (h) => `<li class="stack"><div class="row between"><strong>${esc(h.fecha)}</strong><span class="small muted">${esc(h.veterinario)}</span></div>
                <div>${esc(h.diagnostico)}</div>${h.tratamiento ? `<div class="small">Tto.: ${esc(h.tratamiento)}</div>` : ''}
                ${h.notas ? `<div class="small muted">Notas: ${esc(h.notas)}</div>` : ''}
                <div class="small muted">${h.peso_kg ? `${h.peso_kg} kg ` : ''}${h.temperatura_c ? `· ${h.temperatura_c} °C` : ''}${h.proximo_vencimiento ? ` · control ${esc(h.proximo_vencimiento)}` : ''}</div></li>`,
            )
            .join('')
        : '<li class="empty">Sin registros.</li>';
      vet.mostrarArchivos($('#det-archivos'), archivos);
    }
    $('#det-mascota').addEventListener('change', cargarMascota);
    $('#det-form-mascota').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (await intentar(() => vet.post('/api/mascotas', { ...datosForm(e.target), cliente_id: c.id }), 'Mascota agregada')) verCliente(c.id);
    });
    $('#det-form-hist').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!mascotaSel()) return;
      if (await intentar(() => vet.post(`/api/mascotas/${mascotaSel()}/historial`, datosForm(e.target)), 'Atención guardada')) {
        e.target.reset();
        cargarMascota();
      }
    });
    $('#det-form-foto').addEventListener('submit', async (e) => {
      e.preventDefault();
      const archivo = e.target.archivo.files[0];
      if (!archivo || !mascotaSel()) return;
      if (await intentar(() => vet.subir(`/api/mascotas/${mascotaSel()}/archivos`, archivo), 'Archivo subido')) {
        e.target.reset();
        cargarMascota();
      }
    });
    cargarMascota();
  }

  // ---------- Inventario ----------
  async function cargarInventario() {
    const q = encodeURIComponent($('#buscar-producto').value.trim());
    productos = await vet.get(`/api/inventario?q=${q}`);
    const cuenta = (f) => productos.filter(f).length;
    const kpi = (label, n, alerta) => `<div class="kpi ${alerta && n ? 'alert' : ''}"><div class="label">${label}</div><div class="value">${n}</div></div>`;
    $('#inv-kpis').innerHTML = [
      kpi('Productos', productos.length),
      kpi('Vencidos con stock', cuenta((p) => p.estado_vencimiento === 'vencido' && p.stock > 0), true),
      kpi('Vencen en 30 días', cuenta((p) => p.estado_vencimiento === 'por_vencer' && p.stock > 0), true),
      kpi('Stock bajo', cuenta((p) => p.bajo_stock), true),
    ].join('');
    const etiqueta = { vencido: 'Vencido', por_vencer: 'Por vencer', vigente: 'Vigente' };
    $('#inventario').innerHTML = productos.length
      ? productos
          .map(
            (p) => `<tr><td><strong>${esc(p.nombre)}</strong><div class="small muted">${esc(p.tipo_sunat)} · ${esc(p.unidad)}${p.ubicacion ? ` · ${esc(p.ubicacion)}` : ''}</div></td>
              <td>${esc(p.categoria)}</td><td>${esc(p.lote ?? '')}</td>
              <td>${p.vence_el ? `${esc(p.vence_el)}<br><span class="badge ${p.estado_vencimiento}">${etiqueta[p.estado_vencimiento]}</span>` : '<span class="muted">—</span>'}</td>
              <td class="num">${p.stock}${p.bajo_stock ? '<br><span class="badge warn">bajo</span>' : ''}</td>
              <td class="num">S/ ${p.precio}</td>
              <td><div class="row"><input type="number" data-cant="${p.id}" value="1" min="1" style="width:70px" aria-label="Cantidad">
                <button class="btn small" data-mov="${p.id}" data-signo="1" title="Entrada">+</button>
                <button class="btn small ghost" data-mov="${p.id}" data-signo="-1" title="Salida">−</button></div></td></tr>`,
          )
          .join('')
      : '<tr><td colspan="7" class="empty">Sin productos.</td></tr>';
  }

  $('#buscar-producto').addEventListener('input', () => {
    clearTimeout(buscarTimer);
    buscarTimer = setTimeout(cargarInventario, 250);
  });
  $('#inventario').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mov]');
    if (!b) return;
    const cantidad = Number($(`[data-cant="${b.dataset.mov}"]`).value);
    if (!(cantidad > 0)) return;
    const entrada = b.dataset.signo === '1';
    const motivo = prompt(entrada ? 'Motivo de la entrada (ej.: compra a proveedor)' : 'Motivo de la salida (ej.: uso en consulta, vencido)');
    if (!motivo) return;
    await intentar(() => vet.post(`/api/inventario/${b.dataset.mov}/movimientos`, { delta: entrada ? cantidad : -cantidad, motivo }), 'Stock actualizado');
    cargarInventario();
  });
  $('#form-producto').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await intentar(() => vet.post('/api/inventario', datosForm(e.target)), 'Producto agregado')) {
      e.target.reset();
      cargarInventario();
    }
  });

  // ---------- Boletas ----------
  const mil = (soles) => Math.round(Number(soles) * 1000);
  const fmt3 = (m) => (m / 1000).toFixed(3);

  function filaItem() {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><select data-fuente aria-label="Ítem">
        <option value="">Otro (escribir)</option>
        <optgroup label="Servicios">${servicios.filter((s) => s.activo).map((s) => `<option value="s:${s.id}">${esc(s.nombre)}</option>`).join('')}</optgroup>
        <optgroup label="Productos">${productos.filter((p) => p.activo).map((p) => `<option value="i:${p.id}">${esc(p.nombre)} (stock ${p.stock})</option>`).join('')}</optgroup>
      </select></td>
      <td><input data-desc placeholder="Descripción"></td>
      <td><select data-tipo><option>Servicio</option><option>Bien</option></select></td>
      <td class="num"><input type="number" data-cant min="1" value="1" style="width:70px"></td>
      <td class="num"><input type="number" data-precio min="0" step="0.01" style="width:100px"></td>
      <td class="num" data-vu>—</td><td class="num" data-tot>—</td>
      <td><button type="button" class="btn ghost small" data-quitar aria-label="Quitar">✕</button></td>`;
    $('#boleta-items').append(tr);
    recalcular();
  }

  function recalcular() {
    let gravadas = 0;
    let total = 0;
    for (const tr of $('#boleta-items').querySelectorAll('tr')) {
      const precio = mil(tr.querySelector('[data-precio]').value || 0);
      const cant = Number(tr.querySelector('[data-cant]').value || 0);
      const vu = Math.round(precio / 1.18);
      tr.querySelector('[data-vu]').textContent = precio ? fmt3(vu) : '—';
      tr.querySelector('[data-tot]').textContent = precio ? (precio * cant / 1000).toFixed(2) : '—';
      gravadas += vu * cant;
      total += precio * cant;
    }
    $('#b-gravadas').textContent = fmt3(gravadas);
    $('#b-igv').textContent = fmt3(total - gravadas);
    $('#b-total').textContent = `S/ ${(total / 1000).toFixed(2)}`;
  }

  $('#agregar-item').addEventListener('click', filaItem);
  $('#boleta-items').addEventListener('input', recalcular);
  $('#boleta-items').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-fuente]');
    if (!sel) return;
    const tr = sel.closest('tr');
    const [tipo, id] = sel.value.split(':');
    const origen = tipo === 's' ? servicios.find((s) => String(s.id) === id) : tipo === 'i' ? productos.find((p) => String(p.id) === id) : null;
    tr.querySelector('[data-desc]').value = origen ? origen.nombre : '';
    tr.querySelector('[data-desc]').disabled = Boolean(origen);
    tr.querySelector('[data-tipo]').value = origen ? origen.tipo_sunat : 'Servicio';
    tr.querySelector('[data-tipo]').disabled = Boolean(origen);
    if (origen) tr.querySelector('[data-precio]').value = origen.precio;
    recalcular();
  });
  $('#boleta-items').addEventListener('click', (e) => {
    if (e.target.closest('[data-quitar]')) {
      e.target.closest('tr').remove();
      recalcular();
    }
  });

  $('#form-boleta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const items = [...$('#boleta-items').querySelectorAll('tr')].map((tr) => {
      const [tipo, id] = tr.querySelector('[data-fuente]').value.split(':');
      const item = { cantidad: Number(tr.querySelector('[data-cant]').value), precio: tr.querySelector('[data-precio]').value };
      if (tipo === 's') item.servicio_id = Number(id);
      else if (tipo === 'i') item.inventario_id = Number(id);
      else Object.assign(item, { descripcion: tr.querySelector('[data-desc]').value, tipo: tr.querySelector('[data-tipo]').value });
      return item;
    });
    const datos = datosForm(f);
    if (!datos.cliente_doc_numero) datos.cliente_doc_tipo = '0';
    const cuerpo = datos.cliente_id ? { cliente_id: Number(datos.cliente_id), items } : { ...datos, items };
    const r = await intentar(() => vet.post('/api/boletas', cuerpo), 'Boleta emitida');
    if (r) {
      f.reset();
      $('#boleta-items').innerHTML = '';
      filaItem();
      cargarBoletas();
      cargarInventario();
    }
  });

  async function cargarBoletas() {
    const boletas = await vet.get('/api/boletas');
    $('#boletas').innerHTML = boletas.length
      ? boletas
          .map(
            (b) => `<tr><td>${esc(b.comprobante)}</td><td>${esc(b.fecha_emision)}</td><td>${esc(b.cliente.nombre)}<div class="small muted">${esc(b.cliente.doc_numero)}</div></td>
              <td class="num">S/ ${b.total}</td>
              <td>${b.estado === 'anulada' ? '<span class="badge anulada">Anulada</span>' : '<span class="badge ok">Emitida</span>'}<div class="small muted">SUNAT: ${esc(b.envio_sunat)}</div></td>
              <td class="row"><button class="btn ghost small" data-payload="${b.id}">Ver estructura SUNAT</button>
                ${b.estado !== 'anulada' ? `<button class="btn ghost small" data-anular="${b.id}">Anular</button>` : ''}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="6" class="empty">Sin boletas.</td></tr>';
  }

  $('#boletas').addEventListener('click', async (e) => {
    const p = e.target.closest('[data-payload]');
    if (p) {
      const datos = await intentar(() => vet.get(`/api/boletas/${p.dataset.payload}/payload`));
      if (datos) {
        $('#payload').hidden = false;
        $('#payload').textContent = JSON.stringify(datos, null, 2);
      }
    }
    const a = e.target.closest('[data-anular]');
    if (a) {
      const motivo = prompt('Motivo de la anulación');
      if (!motivo) return;
      await intentar(() => vet.post(`/api/boletas/${a.dataset.anular}/anular`, { motivo }), 'Boleta anulada y stock devuelto');
      cargarBoletas();
      cargarInventario();
    }
  });

  // ---------- Servicios ----------
  async function cargarServicios() {
    servicios = await vet.get('/api/servicios?todos=1');
    $('#cita-servicio').innerHTML = '<option value="">Servicio</option>' + opcionesServicios();
    $('#servicios').innerHTML = servicios
      .map(
        (s) => `<tr data-servicio="${s.id}"><td><strong>${esc(s.nombre)}</strong></td><td>${esc(s.categoria)}</td>
          <td class="num"><input type="number" data-campo="duracion_min" value="${s.duracion_min}" min="5" step="5" style="width:80px"></td>
          <td class="num"><input type="number" data-campo="precio" value="${s.precio}" min="0" step="0.01" style="width:100px"></td>
          <td><input type="checkbox" data-campo="activo" ${s.activo ? 'checked' : ''} aria-label="Activo"></td>
          <td><button class="btn small" data-guardar-servicio="${s.id}">Guardar</button></td></tr>`,
      )
      .join('');
  }

  $('#servicios').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-guardar-servicio]');
    if (!b) return;
    const tr = b.closest('tr');
    const datos = {
      duracion_min: Number(tr.querySelector('[data-campo="duracion_min"]').value),
      precio: tr.querySelector('[data-campo="precio"]').value,
      activo: tr.querySelector('[data-campo="activo"]').checked,
    };
    if (await intentar(() => vet.patch(`/api/servicios/${b.dataset.guardarServicio}`, datos), 'Servicio actualizado')) cargarServicios();
  });
  $('#form-servicio').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await intentar(() => vet.post('/api/servicios', datosForm(e.target)), 'Servicio creado')) {
      e.target.reset();
      cargarServicios();
    }
  });

  // ---------- Arranque ----------
  await Promise.all([cargarServicios(), cargarInventario(), cargarClientes()]);
  filaItem();
  mostrarPestana = vet.pestanas((tab) => {
    if (tab === 'resumen') cargarResumen();
    if (tab === 'agenda') {
      cargarAgenda();
      cargarMascotasCita();
    }
    if (tab === 'clientes') cargarClientes();
    if (tab === 'inventario') cargarInventario();
    if (tab === 'boletas') cargarBoletas();
    if (tab === 'servicios') cargarServicios();
  });
  refrescarNotificaciones();
  setInterval(refrescarNotificaciones, 20_000);
})();
