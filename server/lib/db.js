import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  rol TEXT NOT NULL CHECK (rol IN ('cliente', 'veterinario')),
  nombre TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  telefono TEXT,
  doc_tipo TEXT,
  doc_numero TEXT,
  direccion TEXT,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sesiones (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mascotas (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  especie TEXT NOT NULL,
  raza TEXT,
  sexo TEXT,
  fecha_nacimiento TEXT,
  peso_kg REAL,
  notas TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS servicios (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  categoria TEXT NOT NULL,
  duracion_min INTEGER NOT NULL CHECK (duracion_min > 0),
  precio_mil INTEGER NOT NULL DEFAULT 0 CHECK (precio_mil >= 0),
  tipo_sunat TEXT NOT NULL DEFAULT 'Servicio' CHECK (tipo_sunat IN ('Bien', 'Servicio')),
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS citas (
  id INTEGER PRIMARY KEY,
  mascota_id INTEGER NOT NULL REFERENCES mascotas(id) ON DELETE CASCADE,
  cliente_id INTEGER NOT NULL REFERENCES usuarios(id),
  veterinario_id INTEGER NOT NULL REFERENCES usuarios(id),
  servicio_id INTEGER NOT NULL REFERENCES servicios(id),
  inicio TEXT NOT NULL,
  fin TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN (
    'pendiente', 'confirmada', 'en_camino', 'en_atencion', 'atendida',
    'cancelada', 'no_asistio', 'urgente')),
  es_emergencia INTEGER NOT NULL DEFAULT 0,
  motivo TEXT,
  recordatorio_enviado INTEGER NOT NULL DEFAULT 0,
  llegada_minutos INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_citas_inicio ON citas(inicio);
CREATE INDEX IF NOT EXISTS idx_citas_vet ON citas(veterinario_id, inicio);

CREATE TABLE IF NOT EXISTS historial (
  id INTEGER PRIMARY KEY,
  mascota_id INTEGER NOT NULL REFERENCES mascotas(id) ON DELETE CASCADE,
  cita_id INTEGER REFERENCES citas(id) ON DELETE SET NULL,
  veterinario_id INTEGER NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,
  peso_kg REAL,
  temperatura_c REAL,
  diagnostico TEXT NOT NULL,
  tratamiento TEXT,
  notas TEXT,
  proximo_vencimiento TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_historial_mascota ON historial(mascota_id, fecha);

CREATE TABLE IF NOT EXISTS archivos (
  id INTEGER PRIMARY KEY,
  mascota_id INTEGER NOT NULL REFERENCES mascotas(id) ON DELETE CASCADE,
  cita_id INTEGER REFERENCES citas(id) ON DELETE SET NULL,
  subido_por INTEGER NOT NULL REFERENCES usuarios(id),
  nombre_original TEXT NOT NULL,
  mime TEXT NOT NULL,
  tamano INTEGER NOT NULL,
  ruta TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notificaciones (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  cita_id INTEGER REFERENCES citas(id) ON DELETE SET NULL,
  leida INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_usuario ON notificaciones(usuario_id, leida);

CREATE TABLE IF NOT EXISTS inventario (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'general',
  tipo_sunat TEXT NOT NULL DEFAULT 'Bien' CHECK (tipo_sunat IN ('Bien', 'Servicio')),
  unidad TEXT NOT NULL DEFAULT 'UNIDAD',
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  stock_minimo INTEGER NOT NULL DEFAULT 0,
  precio_mil INTEGER NOT NULL DEFAULT 0,
  lote TEXT,
  vence_el TEXT,
  ubicacion TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventario_movimientos (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES inventario(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  motivo TEXT NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS series_comprobante (
  serie TEXT PRIMARY KEY,
  ultimo_numero INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS boletas (
  id INTEGER PRIMARY KEY,
  serie TEXT NOT NULL,
  numero INTEGER NOT NULL,
  fecha_emision TEXT NOT NULL,
  cliente_id INTEGER REFERENCES usuarios(id),
  cliente_doc_tipo TEXT NOT NULL DEFAULT '0',
  cliente_doc_numero TEXT NOT NULL,
  cliente_nombre TEXT NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'PEN',
  op_gravadas_mil INTEGER NOT NULL,
  igv_mil INTEGER NOT NULL,
  total_mil INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'emitida_local' CHECK (estado IN ('emitida_local', 'anulada')),
  envio_sunat TEXT NOT NULL DEFAULT 'pendiente' CHECK (envio_sunat IN ('pendiente', 'enviada', 'aceptada', 'rechazada')),
  motivo_anulacion TEXT,
  emitido_por INTEGER REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (serie, numero)
);

CREATE TABLE IF NOT EXISTS boleta_items (
  id INTEGER PRIMARY KEY,
  boleta_id INTEGER NOT NULL REFERENCES boletas(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL,
  tipo_sunat TEXT NOT NULL CHECK (tipo_sunat IN ('Bien', 'Servicio')),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  unidad TEXT NOT NULL DEFAULT 'UNIDAD',
  precio_final_mil INTEGER NOT NULL,
  valor_unitario_mil INTEGER NOT NULL,
  valor_venta_mil INTEGER NOT NULL,
  igv_mil INTEGER NOT NULL,
  total_mil INTEGER NOT NULL,
  inventario_id INTEGER REFERENCES inventario(id) ON DELETE SET NULL
);
`;

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}
