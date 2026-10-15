// Helpers genéricos. Los nombres de tabla y columna vienen siempre del código, nunca del usuario.

export function insertar(db, tabla, campos) {
  const claves = Object.keys(campos).filter((k) => campos[k] !== undefined);
  const marcas = claves.map(() => '?').join(', ');
  const info = db
    .prepare(`INSERT INTO ${tabla} (${claves.join(', ')}) VALUES (${marcas})`)
    .run(...claves.map((k) => campos[k]));
  return Number(info.lastInsertRowid);
}

export function actualizar(db, tabla, id, campos) {
  const claves = Object.keys(campos).filter((k) => campos[k] !== undefined);
  if (!claves.length) return;
  const sets = claves.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE ${tabla} SET ${sets} WHERE id = ?`).run(...claves.map((k) => campos[k]), id);
}
