# Next.js + AWS Amplify Template (Google Auth Canary)

This template is a minimal Next.js App Router starter with:

- A protected hello-world homepage (`/`)
- Google OAuth login via NextAuth (`/signin`)
- Domain restriction to a company domain (default `zodl.com`)
- A separate OAuth probe page (`/oauth-probe`) to detect Workspace policy friction
- `amplify.yml` for AWS Amplify deployments

No database is required.

## 1. Configure Google OAuth

Create a Google OAuth Web client and add callback URLs:

- `http://localhost:3000/api/auth/callback/google`
- `https://<your-amplify-domain>/api/auth/callback/google`

For the probe flow, add:

- `http://localhost:3000/oauth-probe`
- `https://<your-amplify-domain>/oauth-probe`

## 2. Set environment variables

Copy `.env.example` to `.env.local` and fill in values:

```bash
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<long-random-secret>
GOOGLE_CLIENT_ID=<client-id>
GOOGLE_CLIENT_SECRET=<client-secret>
ALLOWED_GOOGLE_DOMAIN=zodl.com
```

Generate a local secret with:

```bash
openssl rand -base64 32
```

## 3. Run locally

```bash
npm install
npm run dev
```

Visit:

- `http://localhost:3000/signin` for Google login
- `http://localhost:3000/oauth-probe` for policy diagnostics

## 4. Interpreting probe results

The probe page reports raw OAuth return values:

- `error=access_denied` + `error_subtype=admin_policy_enforced`: org policy blocked the app.
- `error=org_internal`: app audience is restricted to a different org.
- `code=<...>`: authorization step succeeded (not blocked at policy gate).

## 5. Deploy to AWS Amplify

1. Copy this folder to a new repository root.
2. Push to GitHub.
3. Create an Amplify app from that repository.
4. Keep the included `amplify.yml`.
5. Set the same env vars in Amplify (use deployed URL for `NEXTAUTH_URL`).
6. Deploy.
