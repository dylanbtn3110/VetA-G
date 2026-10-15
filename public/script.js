(() => {
  // Año actual en el pie de página
  const year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();

  // Menú móvil
  const toggle = document.querySelector(".nav-toggle");
  const menu = document.getElementById("menu");
  if (toggle && menu) {
    const setOpen = (open) => {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
      menu.classList.toggle("open", open);
    };
    toggle.addEventListener("click", () => setOpen(!menu.classList.contains("open")));
    menu.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setOpen(false);
    });
  }

  // Formulario de cita: se envía al sistema de la clínica (o a la demostración si no hay
  // servidor) y llega al panel del veterinario como notificación.
  const form = document.getElementById("cita-form");
  const msg = form ? form.querySelector(".form-msg") : null;
  if (form && msg) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const required = ["tutor", "telefono", "mascota", "motivo"];
      const missing = required.filter((k) => !String(data.get(k) || "").trim());

      if (missing.length) {
        msg.textContent = "Por favor completa los campos marcados.";
        msg.classList.add("error");
        const firstEmpty = form.querySelector(`[name="${missing[0]}"]`);
        if (firstEmpty) firstEmpty.focus();
        return;
      }

      const boton = form.querySelector("button[type=submit]");
      boton.disabled = true;
      try {
        await window.vet.post("api/solicitudes", Object.fromEntries(data));
        msg.classList.remove("error");
        msg.innerHTML = "";
        msg.append(
          `¡Gracias, ${data.get("tutor")}! La clínica ya recibió tu solicitud para ${data.get("mascota")} y te contactará pronto. `,
        );
        const enlace = document.createElement("a");
        enlace.href = "acceso.html";
        enlace.textContent = "Crea tu cuenta para reservar con horario exacto.";
        msg.append(enlace);
        form.reset();
      } catch (err) {
        msg.textContent = `No se pudo enviar: ${err.message}. Escríbenos por WhatsApp o llámanos.`;
        msg.classList.add("error");
      } finally {
        boton.disabled = false;
      }
    });
  }
})();
