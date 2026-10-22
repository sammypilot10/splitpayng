# SplitPayNG — Subscription Sharing Marketplace

A full-stack marketplace platform for sharing subscription costs across groups. Hosts create pools for services (Netflix, Spotify, etc.), members join and split the cost, and credentials are securely encrypted end-to-end.

## Tech Stack

| Layer      | Technology                        |
|------------|-----------------------------------|
| Frontend   | React 18 · TypeScript · Vite · TailwindCSS |
| Backend    | Node.js · Express · TypeScript    |
| Database   | PostgreSQL · Prisma ORM           |
| Payments   | Paystack (NGN)                    |
| Auth       | JWT · Magic Link email login      |
| Infra      | Docker Compose                    |

## Features

- **Marketplace** — Browse and filter subscription pools by category
- **Pool Management** — Create pools with max-seat limits, billing cycles, and encrypted credentials
- **Payments** — Paystack-powered payments with webhook verification (HMAC-signed) and escrow-style flow
- **Credential Vault** — AES-256 encrypted credentials; only members can decrypt with their passphrase
- **Dispute Resolution** — Member-initiated disputes with evidence uploads; admin arbitration portal
- **Host Payouts** — Stripe-style payout setup for hosts
- **Admin Panel** — Dispute queue, user management, platform analytics
- **Security Hardened** — Atomic transactions, concurrency guards, rate limiting, authenticated file access

## Getting Started

### Prerequisites

- Node.js ≥ 18
- PostgreSQL ≥ 14
- Paystack account (for payment processing)

### 1. Clone & Install

```bash
git clone https://github.com/sammypilot10/splitpayng.git
cd splitpayng

# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 2. Environment Variables

Create `backend/.env`:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/splitpayng"
JWT_SECRET="your-jwt-secret"
PAYSTACK_SECRET_KEY="sk_test_..."
PAYSTACK_WEBHOOK_SECRET="whsk_..."
FROM_EMAIL="noreply@splitpay.ng"
SMTP_HOST="smtp.example.com"
SMTP_PORT=587
SMTP_USER="user"
SMTP_PASS="pass"
```

Create `frontend/.env`:

```env
VITE_API_URL=http://localhost:5000
```

### 3. Database Setup

```bash
cd backend
npx prisma migrate deploy
npx prisma generate
```

### 4. Run Development Servers

```bash
# Terminal 1 — Backend
cd backend
npm run dev        # → http://localhost:5000

# Terminal 2 — Frontend
cd frontend
npm run dev        # → http://localhost:5173
```

### 5. Docker (optional)

```bash
docker-compose up -d   # Starts PostgreSQL + Redis
```

## Project Structure

```
splitpayng/
├── backend/
│   ├── prisma/          # Schema & migrations
│   ├── src/
│   │   ├── middleware/   # Auth, uploads, rate limiting
│   │   ├── routes/       # API endpoints
│   │   ├── job/          # Cron scheduler
│   │   └── server.ts     # Express entry point
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/   # Reusable UI components
│   │   ├── pages/        # Route pages
│   │   ├── context/      # React context providers
│   │   └── App.tsx       # Router & layout
│   └── package.json
├── docker-compose.yml
└── .gitignore
```

## Security

- **Webhook HMAC** — Raw body buffer verification for Paystack webhooks
- **Concurrency** — Prisma `$transaction` guards on last-seat allocation
- **Atomic state** — All dispute/membership mutations use database transactions
- **Upload ACL** — Evidence files served through authenticated middleware
- **Rate limiting** — Anti-spam on vault operations and sensitive endpoints
- **DB resilience** — Keep-alive pings with exponential retry backoff

## License

MIT
