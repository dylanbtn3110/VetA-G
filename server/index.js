import { config } from './config.js';
import { crearApp } from './app.js';
import { enviarRecordatorios } from './routes/citas.js';
import { seedDemo } from './seed.js';

const { server, db } = crearApp(config);

// Fuera de producción, una base vacía arranca con las cuentas de ejemplo para poder ingresar.
if (process.env.NODE_ENV !== 'production') {
  const clave = process.env.SEED_PASSWORD ?? 'demo-veta-2026';
  if (seedDemo(db, clave)) {
    console.log(`Base nueva: cuentas de ejemplo vet@veta-g.test y cliente@veta-g.test (contraseña ${clave})`);
  }
}

server.listen(config.port, () => {
  console.log(`VetA-G escuchando en http://localhost:${config.port}`);
});

if (config.recordatorios) {
  setInterval(() => {
    try {
      enviarRecordatorios(db);
    } catch (e) {
      console.error('Error enviando recordatorios', e);
    }
  }, 60_000).unref();
}

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
