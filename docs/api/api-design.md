# Platform & Gateway API Design Specification — AI GatewayOps

## 1. Overview & Protocol Conventions

This document outlines the REST API contracts for both the **Platform API (Port 5000)** and the **Gateway Service (Port 8000)**.

### Authentication Separation
- **Platform API (Control Plane, Port 5000)**: Uses **JWT access tokens** (`Authorization: Bearer <token>`) for developer user authentication.
- **Gateway Service (Data Plane, Port 8000)**: Uses **API Keys** (`x-api-key: gw_live_...`) for external API consumer authentication on protected routes.

### Standard Response Envelope
All Platform API responses conform to a predictable envelope:

**Success Response (`2xx`)**:
```json
{
  "success": true,
  "data": { ... },
  "meta": { "timestamp": "2026-08-17T00:00:00.000Z" }
}
```

**Error Response (`4xx` / `5xx`)**:
```json
{
  "success": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "The email or password provided is incorrect.",
    "details": []
  }
}
```

---

## 2. Platform API Endpoints (Port 5000)

### A. Authentication Module (`/api/auth`)
*Note: Refresh token rotation and hashed storage are planned architecture for Sprint 1.*

#### 1. Register User
- **Method / Path**: `POST /api/auth/register`
- **Auth**: Public
- **Request Body**:
  ```json
  {
    "email": "alex@dev.com",
    "password": "StrongPassword123!",
    "fullName": "Alex Developer"
  }
  ```
- **Success (`201 Created`)**:
  ```json
  {
    "success": true,
    "data": {
      "user": { "id": "usr_101", "email": "alex@dev.com", "fullName": "Alex Developer" },
      "accessToken": "eyJhbGciOi...",
      "refreshToken": "ref_9a8b..."
    }
  }
  ```

#### 2. Login
- **Method / Path**: `POST /api/auth/login`
- **Auth**: Public
- **Request Body**:
  ```json
  {
    "email": "alex@dev.com",
    "password": "StrongPassword123!"
  }
  ```
- **Success (`200 OK`)**: Returns `user`, `accessToken`, `refreshToken`.

#### 3. Refresh Access Token
- **Method / Path**: `POST /api/auth/refresh`
- **Auth**: Public (Requires Refresh Token)
- **Request Body**:
  ```json
  { "refreshToken": "ref_9a8b..." }
  ```
- **Success (`200 OK`)**: Returns new `accessToken` and rotated `refreshToken`.

#### 4. Logout / Revoke Token
- **Method / Path**: `POST /api/auth/logout`
- **Auth**: Bearer JWT
- **Request Body**:
  ```json
  { "refreshToken": "ref_9a8b..." }
  ```
- **Success (`200 OK`)**: `{ "success": true, "message": "Successfully logged out." }`

#### 5. Get Current User Profile
- **Method / Path**: `GET /api/auth/me`
- **Auth**: Bearer JWT
- **Success (`200 OK`)**: Returns sanitized user object.

---

### B. Project Management Module (`/api/projects`)

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/projects` | Bearer JWT | List all projects owned by user |
| `POST` | `/api/projects` | Bearer JWT | Create a new project workspace |
| `GET` | `/api/projects/:id` | Bearer JWT | Get project details by ID or slug |
| `PATCH` | `/api/projects/:id` | Bearer JWT | Update project settings / rate limits |
| `DELETE` | `/api/projects/:id` | Bearer JWT | Archive / delete project |

---

### C. API Route Configuration Module (`/api/projects/:id/routes`)

#### Create Route
- **Method / Path**: `POST /api/projects/:id/routes`
- **Auth**: Bearer JWT
- **Request Body**:
  ```json
  {
    "name": "Products API",
    "pathPattern": "/api/v1/products",
    "upstreamUrl": "https://store-service.internal/products",
    "methods": ["GET", "POST"],
    "authRequired": true,
    "rateLimit": {
      "enabled": true,
      "maxRequests": 100,
      "windowMs": 60000
    }
  }
  ```
- **Success (`201 Created`)**: Returns created `ApiRoute` record.

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/projects/:id/routes` | Bearer JWT | List all configured routes for a project |
| `GET` | `/api/projects/:id/routes/:routeId` | Bearer JWT | Get specific route config |
| `PATCH` | `/api/projects/:id/routes/:routeId` | Bearer JWT | Update route config |
| `DELETE` | `/api/projects/:id/routes/:routeId` | Bearer JWT | Remove route config |

---

### D. Observability & Telemetry Module (`/api/projects/:id`)

#### 1. Query Project Logs
- **Method / Path**: `GET /api/projects/:id/logs?limit=50&page=1&status=500&method=POST`
- **Auth**: Bearer JWT
- **Success (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "logs": [
        {
          "id": "log_5501",
          "requestId": "req_9a8b...",
          "method": "POST",
          "path": "/api/v1/orders",
          "statusCode": 500,
          "latencyMs": 42.1,
          "timestamp": "2026-08-17T00:30:00.000Z"
        }
      ],
      "pagination": { "page": 1, "limit": 50, "total": 12 }
    }
  }
  ```

#### 2. Project Metrics & Analytics Summary
- **Method / Path**: `GET /api/projects/:id/analytics?timeframe=24h`
- **Auth**: Bearer JWT
- **Success (`200 OK`)**: Illustrative response schema
  ```json
  {
    "success": true,
    "data": {
      "totalRequests": 1500,
      "totalErrors": 12,
      "errorRate": "0.80%",
      "avgLatencyMs": 45.2,
      "statusCodeDistribution": { "200": 1420, "400": 68, "429": 0, "500": 12 },
      "timeseries": [
        { "timestamp": "2026-08-17T00:00:00Z", "requests": 120, "errors": 1, "avgLatency": 42 }
      ]
    }
  }
  ```

---

### E. AI Operations Module (`/api/ai`)

#### 1. Error Analysis
- **Method / Path**: `POST /api/ai/error-analysis`
- **Auth**: Bearer JWT
- **Request Body**: `{ "projectId": "64abc123", "logId": "log_5501" }`
- **Success (`200 OK`)**: Returns structured root-cause analysis distinguishing observed evidence from inferred causes and recommendations.

#### 2. Documentation Generation
- **Method / Path**: `POST /api/ai/documentation`
- **Auth**: Bearer JWT
- **Request Body**: `{ "projectId": "64abc123", "routeId": "route_202" }`
- **Success (`200 OK`)**: Returns OpenAPI-ready documentation schema and example requests/responses.

#### 3. Security Audit
- **Method / Path**: `POST /api/ai/security-analysis`
- **Auth**: Bearer JWT
- **Request Body**: `{ "projectId": "64abc123", "routeId": "route_202" }`
- **Success (`200 OK`)**: Returns categorized findings (`CONFIRMED_ISSUE`, `STRONG_INDICATION`, `POSSIBLE_ISSUE`) distinguishing rule facts from contextual inferences.

---

## 3. Gateway Data Plane Ingress (Port 8000)

### Reverse Proxy Ingress Path
- **Method / Path**: `ALL /g/:projectId/*` (e.g. `GET http://localhost:8000/g/64abc123/api/v1/products`)
- **Headers Accepted**:
  - `x-api-key: gw_live_...` (required if route has `authRequired: true`)
  - `Authorization: ...` (forwarded transparently to upstream if present)
  - `Content-Type`, `Accept`, custom client headers
- **Gateway Injected Headers on Upstream**:
  - `X-Gateway-Request-ID: req_...`
  - `X-Forwarded-For: <client-ip>`
  - `X-Forwarded-Proto: http`
- **Gateway Response Headers**:
  - `X-Gateway-Latency-Ms: 42.5`
  - `X-Request-Id: req_...`
  - `X-RateLimit-Remaining: 98`

