import { Router } from '../lib/router.js';
import * as cuentas from './cuentas.js';
import * as citas from './citas.js';
import * as clinica from './clinica.js';
import * as inventario from './inventario.js';
import * as boletas from './boletas.js';

export function construirRouter() {
  const r = new Router();
  for (const modulo of [cuentas, citas, clinica, inventario, boletas]) modulo.registrar(r);
  return r;
}
