# AI GatewayOps — Platform API (Control Plane)

The **Platform API** is the control plane backend for AI GatewayOps. It is responsible for managing the SaaS platform (user accounts, projects, route registries, API key issuance, and telemetry aggregation).

> [!NOTE]
> The Platform API is **NOT** the data plane reverse proxy. API consumer traffic is handled separately by the Gateway service (`apps/gateway`).

---

## Directory Structure

```
apps/platform-api/
├── src/
│   ├── config/
│   │   ├── db.js                # MongoDB Mongoose connection & lifecycle
│   │   └── env.js               # Environment variables parsing & defaults
│   ├── controllers/
│   │   └── health.controller.js # Health / liveness check controller
│   ├── middleware/
│   │   ├── errorHandler.js      # Centralized error handler
│   │   └── notFoundHandler.js   # 404 handler for unmatched routes
│   ├── models/                  # Mongoose models (Sprint 1B+)
│   ├── routes/
│   │   ├── health.routes.js     # Health route definition (/api/health)
│   │   └── index.js             # API route aggregator mounted at /api
│   ├── services/                # Business logic services (Sprint 1B+)
│   ├── utils/                   # Shared utility functions (Sprint 1B+)
│   ├── app.js                   # Express application setup
│   └── server.js                # HTTP server bootstrap & graceful shutdown
├── package.json
└── README.md
```

---

## Required Environment Variables

Configure these in the repository root `.env` file (copied from `.env.example`):

| Variable | Default | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `development` | Runtime environment (`development`, `production`, `test`) |
| `PORT` or `PLATFORM_PORT` | `5000` | HTTP port the Platform API listens on |
| `MONGODB_URI` | `mongodb://localhost:27017/ai_gatewayops` | MongoDB connection string |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed CORS origins (comma-separated or single) |

---

## Running the Platform API

### From Monorepo Root:
```bash
# Run Platform API in development mode
npm run dev:platform
```

### From `apps/platform-api`:
```bash
# Run using node
npm run dev
# or
npm start
```

---

## Core Endpoints (Sprint 1A)

### Health Check (Liveness)
- **Endpoint**: `GET /api/health`
- **Response**:
```json
{
  "success": true,
  "message": "AI GatewayOps Platform API is running"
}
```

### 404 Handling
- **Endpoint**: `GET /api/any-unregistered-path`
- **Response**:
```json
{
  "success": false,
  "error": {
    "code": "ROUTE_NOT_FOUND",
    "message": "Route GET /api/any-unregistered-path not found.",
    "details": []
  }
}
```
