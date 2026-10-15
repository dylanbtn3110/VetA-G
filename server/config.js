import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? join(raiz, 'data', 'veta.db'),
  uploadDir: process.env.UPLOAD_DIR ?? join(raiz, 'data', 'uploads'),
  // La página vive en la raíz del repositorio (así también funciona en GitHub Pages).
  publicDir: raiz,
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 8) * 1024 * 1024,
  recordatorios: process.env.RECORDATORIOS !== '0',
  // Datos del emisor para las boletas. Configurar con variables de entorno en producción.
  ruc: process.env.EMISOR_RUC ?? '00000000000',
  razonSocial: process.env.EMISOR_RAZON_SOCIAL ?? 'SERVICIOS VETERINARIOS A & G S.A.C.',
  serieBoleta: process.env.SERIE_BOLETA ?? 'B001',
};
