export class Router {
  constructor() {
    this.rutas = [];
  }

  add(metodo, patron, handler) {
    const nombres = [];
    const regex = patron.replace(/:(\w+)/g, (_, nombre) => {
      nombres.push(nombre);
      return '([^/]+)';
    });
    this.rutas.push({ metodo, regex: new RegExp(`^${regex}/?$`), nombres, handler });
  }

  buscar(metodo, pathname) {
    let coincidePatron = false;
    for (const ruta of this.rutas) {
      const m = ruta.regex.exec(pathname);
      if (!m) continue;
      coincidePatron = true;
      if (ruta.metodo !== metodo) continue;
      const params = Object.fromEntries(ruta.nombres.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      return { ruta, params };
    }
    return { ruta: null, metodoNoPermitido: coincidePatron };
  }
}
