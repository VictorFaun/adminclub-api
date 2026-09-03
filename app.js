const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const hpp = require('hpp');
const path = require('path');

const env = require('./config/env');
const corsOptions = require('./config/cors');
const loggerMiddleware = require('./middlewares/logger.middleware');
const { generalRateLimit } = require('./middlewares/rateLimit.middleware');
const { notFoundMiddleware, errorMiddleware } = require('./middlewares/error.middleware');
const routes = require('./routes');

const app = express();

// La app corre detrás de un proxy/balanceador en producción (Nginx, etc.)
app.set('trust proxy', 1);

// --- Seguridad HTTP ---
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(cors(corsOptions));
app.use(hpp());

// --- Parsers ---
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(compression());

// --- Logging ---
app.use(loggerMiddleware);

// --- Rate limiting general ---
app.use(env.apiPrefix, generalRateLimit);

// --- Archivos estáticos (logos, banners, avatares) ---
app.use('/uploads', express.static(path.join(__dirname, env.upload.dir)));

// --- Rutas de la API ---
app.use(env.apiPrefix, routes);

// --- 404 y manejo de errores (siempre al final) ---
app.use(notFoundMiddleware);
app.use(errorMiddleware);

module.exports = app;
