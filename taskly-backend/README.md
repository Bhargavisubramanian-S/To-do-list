# Taskly backend

Express and Node.js API for the Taskly HTML dashboard. The server serves the dashboard at `http://localhost:3000` and persists account data in `data/store.json`.

## Run

1. Install Node.js 18 or newer.
2. In this directory, run `npm install`.
3. Copy `.env.example` to `.env` and set `SESSION_SECRET` to a long random value.
4. Run `npm start` and open `http://localhost:3000`.

The API uses an HTTP-only, same-site cookie for authentication. In production, set `NODE_ENV=production`, provide a strong `SESSION_SECRET`, and serve the app over HTTPS. Invitation requests are recorded, but sending email and accepting invitations require an email service and a fuller collaboration workflow.

## API

- `POST /api/auth/register` and `POST /api/auth/login`
- `POST /api/auth/logout` and `GET /api/auth/me`
- `GET /api/data` and `PUT /api/data` for the signed-in account's tasks, categories, mail, theme, and profile name
- `POST /api/invitations` to record an invitation request
- `GET /api/health` for a health check
