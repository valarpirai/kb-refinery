"use client";

import { createAuthClient } from "better-auth/react";

/** Browser-side auth client: sign in, sign up, sign out, read the session. */
export const authClient = createAuthClient();
