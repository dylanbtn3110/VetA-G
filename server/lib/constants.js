export const ESTADOS_CITA = [
  'pendiente',
  'confirmada',
  'en_camino',
  'en_atencion',
  'atendida',
  'cancelada',
  'no_asistio',
  'urgente',
];

export const CATEGORIAS_SERVICIO = [
  'consulta',
  'vacuna',
  'desparasitacion',
  'cirugia',
  'bano',
  'peluqueria',
  'laboratorio',
  'emergencia',
  'otro',
];

export const TIPOS_SUNAT = ['Bien', 'Servicio'];

// Catálogo 06 de SUNAT: 0 sin documento, 1 DNI, 4 carné de extranjería, 6 RUC, 7 pasaporte
export const DOC_TIPOS = ['0', '1', '4', '6', '7'];

export const SEXOS = ['Macho', 'Hembra'];

export const MIME_ARCHIVOS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

// Monto (en milésimas de sol, con IGV) desde el cual se exige identificar al cliente.
// TODO: confirmar el umbral vigente con SUNAT antes de emitir en producción.
export const UMBRAL_IDENTIFICACION_MIL = 700_000;

// Citas que ocupan horario. Canceladas y "no asistió" liberan el espacio.
export const OCUPA_HORARIO = "estado NOT IN ('cancelada', 'no_asistio')";
