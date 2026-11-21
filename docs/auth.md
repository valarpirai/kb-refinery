# Login and accounts

This is how sign-in works and what each kind of user can do.

## What it is

Email and password accounts, built on Better Auth. Sessions live in Postgres. Passwords are hashed.

Every page except Login and Sign up needs a signed-in user. Every API route checks the session against the database, not just the cookie.

## Roles

| Role | Can |
|---|---|
| `user` | Use everything except Traces |
| `admin` | Everything, including the Traces pages |

A user's role is a column on the `User` table. Sign-up always creates a `user`. Only the seed script or a database edit makes an admin.

## The default admin

`pnpm db:seed` creates one admin if it does not exist:

| Setting | Default |
|---|---|
| `ADMIN_EMAIL` | `admin@example.com` |
| `ADMIN_PASSWORD` | `change-me-now` |

Change both in `.env` before you seed anywhere other than your own machine. With `NODE_ENV=production`, the seed refuses to run on the default password.

Running the seed again does not change an existing password. It only makes sure that account is an admin.

## Closing sign-up

Anyone who can reach the app can create an account. To stop that, set:

```
ALLOW_SIGNUP="false"
```

The Sign up page then returns Not Found, and the API refuses new accounts.

## What belongs to a user

- **Chat conversations** and everything in them. Nobody else sees them.
- **Notifications.**
- **Jobs, imports and sources** record who started them, so the right person is told when they finish.

Articles, findings and scores are shared. The whole team sees one set of articles.

## Secrets

`BETTER_AUTH_SECRET` signs sessions. Set a long random value (`openssl rand -base64 32`). Never commit `.env`.

## Where the code is

| File | Job |
|---|---|
| `src/lib/auth.ts` | Server auth setup |
| `src/lib/auth-client.ts` | Browser client |
| `src/lib/session.ts` | `getUser`, `requirePageUser`, `unauthorized` |
| `src/app/(auth)/` | Login and sign-up pages |
| `src/app/(app)/layout.tsx` | Requires a session for every app page |
