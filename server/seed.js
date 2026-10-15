import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { openDatabase } from './lib/db.js';
import { crearUsuario } from './lib/auth.js';
import { insertar } from './lib/crud.js';
import { hoyLima, sumarDias } from './lib/time.js';

// [nombre, categoría, duración en minutos, precio final con IGV en soles]
const SERVICIOS = [
  ['Consulta general', 'consulta', 30, 50],
  ['Vacunación', 'vacuna', 15, 45],
  ['Desparasitación interna', 'desparasitacion', 15, 25],
  ['Baño', 'bano', 60, 35],
  ['Baño y corte de pelo', 'peluqueria', 90, 60],
  ['Corte de uñas', 'peluqueria', 15, 10],
  ['Análisis de laboratorio', 'laboratorio', 20, 70],
  ['Cirugía (esterilización)', 'cirugia', 120, 350],
  ['Urgencia', 'emergencia', 30, 100],
];

// Los precios son de ejemplo: cámbialos desde el panel del veterinario.
export function seedBase(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM servicios').get().n > 0) return;
  for (const [nombre, categoria, duracion, precio] of SERVICIOS) {
    insertar(db, 'servicios', { nombre, categoria, duracion_min: duracion, precio_mil: precio * 1000, tipo_sunat: 'Servicio' });
  }
}

export function seedDemo(db, clave) {
  if (db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n > 0) return false;
  const hoy = hoyLima();
  crearUsuario(db, { rol: 'veterinario', nombre: 'Veterinario Demo', email: 'vet@veta-g.test', clave, telefono: '999000111' });
  const cliente = crearUsuario(db, {
    rol: 'cliente',
    nombre: 'Cliente Demo',
    email: 'cliente@veta-g.test',
    clave,
    telefono: '999000222',
    docTipo: '1',
    docNumero: '12345678',
  });
  insertar(db, 'mascotas', { cliente_id: cliente, nombre: 'Firulais', especie: 'Perro', raza: 'Mestizo', sexo: 'Macho', peso_kg: 12.4 });
  insertar(db, 'mascotas', { cliente_id: cliente, nombre: 'Michi', especie: 'Gato', sexo: 'Hembra', peso_kg: 4.1 });

  // [nombre, categoría, tipo, stock, mínimo, precio, días hasta vencer o null]
  const productos = [
    ['Vacuna séxtuple canina', 'vacunas', 'Bien', 12, 5, 45, 120],
    ['Antiparasitario interno (tableta)', 'medicamentos', 'Bien', 4, 10, 15, 20],
    ['Alimento balanceado Cambo 15 kg', 'alimentos', 'Bien', 6, 2, 180, 200],
    ['Snack Churu', 'snacks', 'Bien', 30, 10, 6, 90],
    ['Pets Milk', 'alimentos', 'Bien', 8, 3, 25, -3],
    ['Pelota de juguete', 'juguetes', 'Bien', 15, 5, 12, null],
  ];
  for (const [nombre, categoria, tipo, stock, minimo, precio, dias] of productos) {
    insertar(db, 'inventario', {
      nombre,
      categoria,
      tipo_sunat: tipo,
      stock,
      stock_minimo: minimo,
      precio_mil: precio * 1000,
      vence_el: dias === null ? null : sumarDias(hoy, dias),
    });
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const clave = process.env.SEED_PASSWORD ?? 'demo-veta-2026';
  const db = openDatabase(config.dbPath);
  seedBase(db);
  if (seedDemo(db, clave)) {
    console.log('Datos de ejemplo creados:');
    console.log('  Veterinario: vet@veta-g.test');
    console.log('  Cliente:     cliente@veta-g.test');
    console.log(`  Contraseña:  ${clave}  (cámbiala o define SEED_PASSWORD)`);
  } else {
    console.log('La base ya tiene usuarios; no se agregaron datos de ejemplo.');
  }
  db.close();
}
