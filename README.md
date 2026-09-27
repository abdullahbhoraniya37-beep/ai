# AI Workspace SaaS

A premium HTML/CSS/Vanilla-JS AI SaaS starter with an Express backend.

## Included
- Premium landing page
- User registration/login
- User dashboard
- AI chat + conversation history
- Separate admin login/dashboard
- Groq + OpenRouter provider routing
- Primary/fallback provider logic
- Provider connection testing
- Admin user management
- AI settings/system prompt
- Usage limits
- AI logs
- Responsive dark SaaS-style interface

## Run locally
1. Install Node.js 18+.
2. Copy `.env.example` to `.env`.
3. Set a strong `SESSION_SECRET`.
4. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
5. Add `GROQ_API_KEY` and/or `OPENROUTER_API_KEY`.
6. Run:
   npm install
   npm start
7. Open http://localhost:3000

Admin:
- /admin/login.html
- Credentials are the ADMIN_EMAIL / ADMIN_PASSWORD from .env.

## Important security note
This project intentionally does not put provider secrets in browser JavaScript. The starter reads provider secrets from server environment variables. For a production SaaS where the administrator must enter/update API keys through the browser, add an authenticated server-side secret-management endpoint backed by encrypted database/secret storage. Never store API keys in localStorage or public frontend files.

## Data note
This starter uses in-memory state for simplicity. Restarting the Node process clears users, chats, logs and settings. Replace the state layer with PostgreSQL/Supabase/Firebase/etc. before production deployment.
