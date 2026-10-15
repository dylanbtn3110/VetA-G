import { createServer } from 'node:http';
import { createReadStream, mkdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { openDatabase } from './lib/db.js';
import { HttpError, readBody, readJson, sendJson } from './lib/http.js';
import { construirRouter } from './routes/index.js';
import { seedBase } from './seed.js';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

// Solo se sirven los archivos de la página. Nunca server/, data/ (la base), test/, .git ni package.json.
const PUBLICOS = /^\/(index|acceso|cliente|veterinario|guia-estilo)\.html$|^\/(styles\.css|script\.js)$|^\/assets\/[\w\-./ ]+$/;

async function servirEstatico(res, pathname, dir) {
  let ruta;
  try {
    ruta = decodeURIComponent(pathname);
  } catch {
    return sendJson(res, 400, { error: 'Ruta inválida' });
  }
  if (ruta === '/') ruta = '/index.html';
  if (!PUBLICOS.test(ruta) || ruta.includes('..') || ruta.includes('/.')) return sendJson(res, 404, { error: 'No encontrado' });
  const raiz = resolve(dir);
  const abs = resolve(raiz, `.${ruta}`);
  if (!abs.startsWith(raiz + sep)) return sendJson(res, 404, { error: 'No encontrado' });
  try {
    const info = await stat(abs);
    if (!info.isFile()) throw new Error('no es archivo');
    res.writeHead(200, {
      'Content-Type': TIPOS[extname(abs)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
    });
    createReadStream(abs).pipe(res);
  } catch {
    sendJson(res, 404, { error: 'No encontrado' });
  }
}

async function manejar(req, res, ctx) {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return servirEstatico(res, url.pathname, ctx.config.publicDir);

  const hallado = ctx.router.buscar(req.method, url.pathname);
  if (!hallado.ruta) {
    return sendJson(res, hallado.metodoNoPermitido ? 405 : 404, {
      error: hallado.metodoNoPermitido ? 'Método no permitido' : 'No encontrado',
    });
  }
  const c = {
    req,
    res,
    db: ctx.db,
    config: ctx.config,
    params: hallado.params,
    query: url.searchParams,
    user: undefined,
    json: () => readJson(req),
    raw: (max) => readBody(req, max),
    send: (status, body) => sendJson(res, status, body),
  };
  try {
    const salida = await hallado.ruta.handler(c);
    if (salida !== undefined) sendJson(res, 200, salida);
  } catch (e) {
    if (res.headersSent) return res.destroy();
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
    console.error(e);
    sendJson(res, 500, { error: 'Error interno del servidor' });
  }
}

export function crearApp(config) {
  mkdirSync(config.uploadDir, { recursive: true });
  const db = openDatabase(config.dbPath);
  seedBase(db);
  const ctx = { db, config, router: construirRouter() };
  const server = createServer((req, res) => {
    manejar(req, res, ctx).catch((e) => {
      console.error(e);
      if (!res.headersSent) sendJson(res, 500, { error: 'Error interno del servidor' });
    });
  });
  return { server, db };
}
