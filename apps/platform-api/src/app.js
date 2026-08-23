const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const env = require('./config/env');
const apiRoutes = require('./routes');
const notFoundHandler = require('./middleware/notFoundHandler');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Security headers
app.use(helmet());

// CORS configuration supporting single origin or comma-separated origins
const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests or same-origin requests (origin is undefined)
    if (!origin) return callback(null, true);

    const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim());
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS error: Origin ${origin} not allowed by CORS policy`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

app.use(cors(corsOptions));

// Body parsing with conservative 1mb limit
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Mount API routes
app.use('/api', apiRoutes);

// Catch 404 for undefined routes
app.use(notFoundHandler);

// Centralized error handler
app.use(errorHandler);

module.exports = app;
