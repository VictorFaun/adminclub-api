const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const baseOptions = {
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ success: false, message: 'Demasiadas solicitudes. Intenta más tarde.' });
  },
};

/** Límite general aplicado a toda la API. */
const generalRateLimit = rateLimit({
  ...baseOptions,
  windowMs: env.security.rateLimitWindowMin * 60 * 1000,
  max: env.security.rateLimitMax,
});

/**
 * Límite estricto para login: `skipSuccessfulRequests` es correcto acá porque un login
 * exitoso es una señal legítima de uso normal (no queremos bloquear a alguien que solo tipeó
 * mal la contraseña un par de veces antes de acertar) — solo los intentos fallidos cuentan.
 */
const authRateLimit = rateLimit({
  ...baseOptions,
  windowMs: env.security.rateLimitWindowMin * 60 * 1000,
  max: env.security.authRateLimitMax,
  skipSuccessfulRequests: true,
});

/**
 * Límite estricto SIN `skipSuccessfulRequests`, para endpoints que responden 2xx siempre por
 * diseño (forgot-password nunca revela si el correo existe; register solo falla en 409 si el
 * email ya existe; resend-verification siempre reenvía). Con `skipSuccessfulRequests: true`
 * esos endpoints nunca acumulan hacia el límite — quedaban de hecho sin ningún rate limit real,
 * habilitando email-bombing (forgot-password), registro masivo de cuentas (register) o spam de
 * correos de verificación (resend-verification).
 */
const strictAuthRateLimit = rateLimit({
  ...baseOptions,
  windowMs: env.security.rateLimitWindowMin * 60 * 1000,
  max: env.security.authRateLimitMax,
});

module.exports = { generalRateLimit, authRateLimit, strictAuthRateLimit };
