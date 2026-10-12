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

  // Formulario de cita: validación básica y mensaje de confirmación.
  // No envía datos a ningún servidor; conéctalo a tu backend, Formspree o WhatsApp cuando lo tengas.
  const form = document.getElementById("cita-form");
  const msg = form ? form.querySelector(".form-msg") : null;
  if (form && msg) {
    form.addEventListener("submit", (e) => {
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

      msg.classList.remove("error");
      msg.textContent = `¡Gracias, ${data.get("tutor")}! Recibimos la solicitud para ${data.get("mascota")}. Te contactaremos pronto.`;
      form.reset();
    });
  }
})();
