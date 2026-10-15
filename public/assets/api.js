// Cliente de la API y utilidades compartidas por las páginas del portal.
(() => {
  const KEY = 'veta.token';

  const leerToken = () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };
  const guardarToken = (t) => {
    try {
      if (t) localStorage.setItem(KEY, t);
      else localStorage.removeItem(KEY);
    } catch {
      /* sin almacenamiento: la sesión dura lo que la página */
    }
  };

  async function pedir(metodo, ruta, { body, archivo } = {}) {
    const headers = {};
    const token = leerToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload;
    if (archivo) {
      payload = archivo;
      headers['Content-Type'] = archivo.type || 'application/octet-stream';
      headers['X-Nombre-Archivo'] = encodeURIComponent(archivo.name);
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(ruta, { method: metodo, headers, body: payload });
    if (res.status === 401 && !ruta.startsWith('/api/auth/')) {
      guardarToken(null);
      location.href = '/acceso.html';
      throw new Error('Sesión vencida');
    }
    const esJson = (res.headers.get('content-type') ?? '').includes('application/json');
    const data = esJson ? await res.json() : await res.blob();
    if (!res.ok) throw new Error((esJson && data.error) || `Error ${res.status}`);
    return data;
  }

  const ESTADOS = {
    pendiente: 'Pendiente',
    confirmada: 'Confirmada',
    en_camino: 'En camino',
    en_atencion: 'En atención',
    atendida: 'Atendida',
    cancelada: 'Cancelada',
    no_asistio: 'No asistió',
    urgente: 'Urgente',
  };

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  let temporizador;
  function aviso(mensaje, error = false) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.append(el);
    }
    el.textContent = mensaje;
    el.classList.toggle('error', error);
    el.hidden = false;
    clearTimeout(temporizador);
    temporizador = setTimeout(() => (el.hidden = true), 3500);
  }

  // Ejecuta una acción asíncrona mostrando el error si falla.
  async function intentar(fn, exito) {
    try {
      const r = await fn();
      if (exito) aviso(exito);
      return r;
    } catch (e) {
      aviso(e.message, true);
      return null;
    }
  }

  async function sesion(rolEsperado) {
    if (!leerToken()) {
      location.href = '/acceso.html';
      return null;
    }
    const u = await pedir('GET', '/api/auth/yo');
    if (u.rol !== rolEsperado) {
      location.href = u.rol === 'veterinario' ? '/veterinario.html' : '/cliente.html';
      return null;
    }
    for (const el of document.querySelectorAll('[data-usuario]')) el.textContent = u.nombre;
    document.querySelector('[data-salir]')?.addEventListener('click', async () => {
      await pedir('POST', '/api/auth/logout').catch(() => {});
      guardarToken(null);
      location.href = '/acceso.html';
    });
    return u;
  }

  function pestanas(alCambiar) {
    const botones = [...document.querySelectorAll('.tabs [data-tab]')];
    const mostrar = (id) => {
      for (const b of botones) b.setAttribute('aria-selected', String(b.dataset.tab === id));
      for (const s of document.querySelectorAll('[data-panel]')) s.hidden = s.dataset.panel !== id;
      try {
        sessionStorage.setItem(`tab:${location.pathname}`, id);
      } catch {
        /* opcional */
      }
      alCambiar?.(id);
    };
    for (const b of botones) b.addEventListener('click', () => mostrar(b.dataset.tab));
    let inicial = botones[0]?.dataset.tab;
    try {
      inicial = sessionStorage.getItem(`tab:${location.pathname}`) ?? inicial;
    } catch {
      /* opcional */
    }
    if (!botones.some((b) => b.dataset.tab === inicial)) inicial = botones[0]?.dataset.tab;
    mostrar(inicial);
    return mostrar;
  }

  // created_at viene de SQLite en UTC ('AAAA-MM-DD HH:MM:SS').
  const horaLima = (utc) =>
    new Date(`${utc.replace(' ', 'T')}Z`).toLocaleString('es-PE', {
      timeZone: 'America/Lima',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  async function notificaciones(lista, contador) {
    const datos = await pedir('GET', '/api/notificaciones');
    const noLeidas = datos.filter((n) => !n.leida).length;
    contador.textContent = noLeidas;
    contador.hidden = noLeidas === 0;
    lista.innerHTML = datos.length
      ? datos
          .slice(0, 30)
          .map(
            (n) => `<li class="${n.leida ? 'muted' : ''}">
              <span class="badge ${n.tipo === 'urgencia' ? 'danger' : n.tipo === 'llegada' ? 'warn' : 'info'}">${esc(n.tipo)}</span>
              ${esc(n.mensaje)} <span class="small muted">· ${esc(horaLima(n.created_at))}</span></li>`,
          )
          .join('')
      : '<li class="empty">Sin notificaciones.</li>';
    return noLeidas;
  }

  // Muestra fotos y PDFs pidiéndolos con la sesión (no se pueden enlazar directo).
  async function mostrarArchivos(contenedor, archivos) {
    if (!archivos.length) {
      contenedor.innerHTML = '<p class="empty">Sin fotos ni documentos.</p>';
      return;
    }
    contenedor.innerHTML = archivos
      .map(
        (a) => `<figure data-archivo="${a.id}">
          ${a.mime.startsWith('image/') ? '<img alt="">' : '<div class="doc">PDF</div>'}
          <figcaption title="${esc(a.nombre_original)}">${esc(a.nombre_original)}</figcaption></figure>`,
      )
      .join('');
    for (const a of archivos) {
      const fig = contenedor.querySelector(`[data-archivo="${a.id}"]`);
      const blob = await pedir('GET', `/api/archivos/${a.id}`).catch(() => null);
      if (!blob) continue;
      const enlace = URL.createObjectURL(blob);
      const img = fig.querySelector('img');
      if (img) img.src = enlace;
      fig.style.cursor = 'pointer';
      fig.addEventListener('click', () => window.open(enlace, '_blank', 'noopener'));
    }
  }

  // Fecha de hoy en Lima, igual que el servidor.
  const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

  window.vet = {
    get: (r) => pedir('GET', r),
    post: (r, body) => pedir('POST', r, { body }),
    patch: (r, body) => pedir('PATCH', r, { body }),
    subir: (r, archivo) => pedir('POST', r, { archivo }),
    token: { leer: leerToken, guardar: guardarToken },
    ESTADOS,
    esc,
    aviso,
    intentar,
    sesion,
    pestanas,
    notificaciones,
    mostrarArchivos,
    hoy,
    estado: (e) => `<span class="badge ${esc(e)}">${esc(ESTADOS[e] ?? e)}</span>`,
    datosForm: (form) => Object.fromEntries([...new FormData(form)].filter(([, v]) => v !== '')),
  };
})();
