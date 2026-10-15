import { config } from './config.js';
import { crearApp } from './app.js';
import { enviarRecordatorios } from './routes/citas.js';

const { server, db } = crearApp(config);

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
