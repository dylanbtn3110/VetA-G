// Montos internos en milésimas de sol. Precio final = con IGV.
export const TASA_IGV = 0.18;

// Texto para mostrar: 2 decimales en importes, 3 en valores unitarios (como pide SUNAT).
export const soles = (mil) => (mil / 1000).toFixed(2);
export const unitario = (mil) => (mil / 1000).toFixed(3);

// Valor unitario sin IGV = precio final / 1.18, redondeado a milésimas.
export function valorSinIgv(precioFinalMil) {
  return Math.round(precioFinalMil / (1 + TASA_IGV));
}
