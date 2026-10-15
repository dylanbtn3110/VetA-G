# VetA-G

Página web y sistema de gestión para la veterinaria familiar: página pública, portal del cliente,
panel del veterinario y backend con base de datos.

## Requisitos

- Node.js 22.5 o superior (usa `node:sqlite`, incluido en Node). No hay dependencias que instalar.

## Cómo ejecutarlo

```bash
npm run seed    # opcional: crea usuarios y productos de ejemplo
npm start       # http://localhost:3000
npm test        # pruebas de la API
```

Usuarios de ejemplo: `vet@veta-g.test` y `cliente@veta-g.test`, contraseña `demo-veta-2026`
(o la que definas en `SEED_PASSWORD`). Si la base está vacía, `npm start` los crea solo,
salvo con `NODE_ENV=production`.

### Sin servidor: modo demostración

Si abres `public/index.html` directamente o publicas la carpeta `public/` en un hosting estático
(por ejemplo GitHub Pages), la página detecta que no hay servidor y usa un modo demostración:
todo el portal funciona, pero los datos se guardan solo en ese navegador. La página de acceso
muestra botones para entrar como veterinario o como cliente, y un aviso arriba permite reiniciar
los datos. Para uso real con clientes hay que correr el servidor (`npm start`).

| Página | Para quién |
| --- | --- |
| `/` | Página pública de la clínica |
| `/acceso.html` | Iniciar sesión o crear cuenta |
| `/cliente.html` | Portal del cliente |
| `/veterinario.html` | Panel del veterinario |

### Variables de entorno

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `PORT` | `3000` | Puerto HTTP |
| `DB_PATH` | `data/veta.db` | Archivo SQLite |
| `UPLOAD_DIR` | `data/uploads` | Fotos y PDFs subidos |
| `MAX_UPLOAD_MB` | `8` | Tamaño máximo por archivo |
| `RECORDATORIOS` | activado | `0` desactiva los avisos de 1 hora antes |
| `EMISOR_RUC` | `00000000000` | RUC para las boletas |
| `EMISOR_RAZON_SOCIAL` | `SERVICIOS VETERINARIOS A & G S.A.C.` | Razón social |
| `SERIE_BOLETA` | `B001` | Serie de las boletas |

## Estructura

```
public/            páginas y recursos del navegador
server/
  app.js           servidor HTTP, archivos estáticos y manejo de errores
  index.js         arranque y recordatorios cada minuto
  seed.js          servicios base y datos de ejemplo
  lib/             base de datos, autenticación, agenda, validación, montos
  routes/          cuentas, citas, clínica (historial, fotos, dashboard), inventario, boletas
test/api.test.js   pruebas de punta a punta de la API
```

## API principal

Autenticación con `Authorization: Bearer <token>` (se obtiene en login o registro).

| Método y ruta | Quién | Qué hace |
| --- | --- | --- |
| `POST /api/auth/registro`, `POST /api/auth/login` | público | Crea cuenta de cliente o inicia sesión |
| `POST /api/solicitudes` | público | Formulario de la página principal; avisa al veterinario (máx. 5 cada 10 min por IP) |
| `GET /api/servicios` | público | Servicios activos con duración y precio |
| `GET /api/disponibilidad?fecha=&servicio_id=` | sesión | Horarios libres cada 15 min |
| `GET/POST /api/citas`, `PATCH /api/citas/:id` | sesión | Listar, reservar, cambiar estado o reprogramar |
| `POST /api/citas/:id/llegada` | cliente | Avisa «voy en camino» al veterinario |
| `POST /api/emergencias` | sesión | Urgencia inmediata y alerta a todos los veterinarios |
| `GET/POST /api/mascotas`, `GET/POST /api/mascotas/:id/historial` | sesión | Mascotas e historial clínico |
| `POST /api/mascotas/:id/archivos` | sesión | Sube foto o PDF (cuerpo binario, cabecera `X-Nombre-Archivo`) |
| `GET /api/notificaciones`, `POST /api/notificaciones/leer` | sesión | Avisos del usuario |
| `GET /api/dashboard` | veterinario | Clientes por día, urgencias, ingresos, alertas |
| `GET/POST /api/inventario`, `POST /api/inventario/:id/movimientos` | veterinario | Productos, vencimientos y stock |
| `POST /api/boletas`, `GET /api/boletas/:id/payload`, `POST /api/boletas/:id/anular` | veterinario | Boletas con IGV y estructura para SUNAT |

## Boletas y SUNAT

El valor unitario sin IGV se calcula como precio final ÷ 1.18 con 3 decimales, igual que en SEE-SOL.
Las boletas quedan registradas con serie y correlativo, y `GET /api/boletas/:id/payload` entrega la
estructura lista para un OSE/PSE. **El envío real a SUNAT no está implementado**: requiere certificado
digital y un proveedor autorizado. Confirmar con SUNAT el monto desde el cual se exige identificar al
cliente (configurado en S/ 700 en `server/lib/constants.js`).
