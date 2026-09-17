# 🇱🇰 Ceylon Stays — Backend REST API & Instant Notification Service

[![Node.js](https://img.shields.io/badge/Node.js-18.x-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express.js-4.x-blue.svg)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-blue.svg)](https://www.postgresql.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Supported-cyan.svg)](https://www.docker.com/)

A full-featured Node.js / Express TypeScript REST API powering the **Ceylon Stays** tourism platform in Sri Lanka. Handles user authentication, property listing management, geospatial distance calculation, and **1-Click Email Action Token workflows** via Resend SMTP.

---

## 🌟 Key Architecture & Features

### 📩 1-Click Email Action Approval Engine
- Dispatches formatted booking notification emails to property owners with **signed 256-bit JWT action links** (`[Accept]` and `[Decline]`).
- Allows hosts to approve or decline reservations instantly from their mobile email client without signing in.
- Asynchronous non-blocking email dispatch maintains `<200ms` API response times for mobile travelers.

### 📍 Geospatial Proximity Search (Haversine Formula)
- Computes exact distances in kilometers (`distanceKm`) between guest coordinates and property locations across Sri Lankan travel hubs (Colombo, Galle, Ella, Kandy, Mirissa, Sigiriya).
- Returns sorted closest-first property search results (`GET /api/businesses/nearby?city=galle&radius=50`).

### 🛡️ Authentication & Authorization
- Password hashing using `bcrypt` and JWT stateless session management for Travelers and Property Owners.
- Role-based access control guarding management endpoints.

---

## 🛠️ Tech Stack

- **Runtime:** Node.js, Express.js (TypeScript)
- **Database:** PostgreSQL (Prisma ORM / Raw SQL queries)
- **Containerization:** Docker & Docker Compose
- **Email Gateway:** Resend API & Nodemailer
- **Security:** JsonWebToken (JWT), bcrypt, CORS, Helmet

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js (v18+)
- PostgreSQL or Docker installed

### 2. Environment Setup
Clone the repository and copy `.env.example`:
```bash
cp .env.example .env
```
Fill in your configuration:
```env
PORT=5000
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/booking_db?schema=public"
JWT_SECRET="your_secure_jwt_secret"
RESEND_API_KEY="re_your_resend_api_key"
BACKEND_URL="http://localhost:5000"
FRONTEND_URL="http://localhost:3000"
```

### 3. Install & Start Services
```bash
# Install dependencies
npm install

# Run database migrations (if using Prisma)
npx prisma db push

# Launch development server
npm run dev
```

---

## 📡 API Endpoints Summary

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Register a new Owner or Traveler |
| `POST` | `/api/auth/login` | Authenticate user & return JWT session token |
| `GET` | `/api/businesses` | List all verified accommodations |
| `GET` | `/api/businesses/nearby` | Geospatial closest-first search by city/coordinates |
| `POST` | `/api/bookings` | Create a reservation & trigger email notification |
| `GET` | `/api/bookings/action` | Execute 1-click `Accept`/`Decline` JWT email action |
| `GET` | `/api/bookings/owner` | Fetch host reservations & occupancy stats |

---

## 🐳 Docker Deployment
Run PostgreSQL in a container:
```bash
docker-compose up -d
```
