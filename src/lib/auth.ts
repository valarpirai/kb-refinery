import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";

/**
 * Server-side auth. Email and password, sessions stored in Postgres.
 * Set ALLOW_SIGNUP="false" to close registration once your users exist.
 */
export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
    disableSignUp: process.env.ALLOW_SIGNUP === "false",
  },
  user: {
    // Set by the seed script, never by the sign-up form.
    additionalFields: { role: { type: "string", defaultValue: "user", input: false } },
  },
  // Dev falls back to 3001 when 3000 is busy.
  trustedOrigins: ["http://localhost:3000", "http://localhost:3001"],
  plugins: [nextCookies()],
});
