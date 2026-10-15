import { fail } from './http.js';

const vacio = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

export function texto(valor, campo, { max = 200, opcional = false } = {}) {
  if (vacio(valor)) {
    if (opcional) return null;
    fail(400, `Falta ${campo}`);
  }
  if (typeof valor !== 'string') fail(400, `${campo} debe ser texto`);
  const t = valor.trim();
  if (t.length > max) fail(400, `${campo} supera ${max} caracteres`);
  return t;
}

export function entero(valor, campo, { min = 0, max = 1_000_000, opcional = false } = {}) {
  if (vacio(valor)) {
    if (opcional) return null;
    fail(400, `Falta ${campo}`);
  }
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `${campo} debe ser un entero entre ${min} y ${max}`);
  return n;
}

export function numero(valor, campo, { min = 0, max = 1_000_000, opcional = false } = {}) {
  if (vacio(valor)) {
    if (opcional) return null;
    fail(400, `Falta ${campo}`);
  }
  const n = Number(valor);
  if (!Number.isFinite(n) || n < min || n > max) fail(400, `${campo} está fuera de rango`);
  return n;
}

// Convierte soles (máximo 2 decimales) a milésimas de sol.
export function soles(valor, campo, { opcional = false } = {}) {
  const n = numero(valor, campo, { max: 100_000, opcional });
  if (n === null) return null;
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) fail(400, `${campo} admite máximo 2 decimales`);
  return Math.round(n * 1000);
}

export function fecha(valor, campo, { opcional = false } = {}) {
  if (vacio(valor)) {
    if (opcional) return null;
    fail(400, `Falta ${campo}`);
  }
  const valida = /^\d{4}-\d{2}-\d{2}$/.test(valor) && new Date(`${valor}T00:00:00Z`).toISOString().slice(0, 10) === valor;
  if (!valida) fail(400, `${campo} debe tener formato AAAA-MM-DD`);
  return valor;
}

export function hora(valor, campo) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(valor ?? '')) fail(400, `${campo} debe tener formato HH:MM`);
  return valor;
}

export function opcion(valor, campo, lista, { opcional = false } = {}) {
  if (vacio(valor)) {
    if (opcional) return null;
    fail(400, `Falta ${campo}`);
  }
  if (!lista.includes(valor)) fail(400, `${campo} no es válido`);
  return valor;
}

export function correo(valor) {
  const t = texto(valor, 'email', { max: 120 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) fail(400, 'El email no es válido');
  return t;
}
