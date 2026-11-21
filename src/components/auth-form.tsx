"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

const input = "w-full rounded border border-black/20 px-3 py-2 text-sm dark:border-white/20 dark:bg-transparent";

/** Email and password form for signing in or creating an account. */
export function AuthForm({ mode, canSignUp = true }: { mode: "login" | "signup"; canSignUp?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email")).trim();
    const password = String(f.get("password"));
    setBusy(true);
    setError(null);
    const result = signup
      ? await authClient.signUp.email({ name: String(f.get("name")).trim(), email, password })
      : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (result.error) return setError(result.error.message ?? "Something went wrong");
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{signup ? "Create your account" : "Sign in"}</h1>
        <p className="mt-1 text-sm opacity-70">KB Refinery</p>
      </div>
      {signup && (
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium">Name</label>
          <input id="name" name="name" required autoComplete="name" className={input} />
        </div>
      )}
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" className={input} />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">Password</label>
        <input id="password" name="password" type="password" required minLength={8} autoComplete={signup ? "new-password" : "current-password"} className={input} />
        {signup && <p className="mt-1 text-xs opacity-70">At least 8 characters.</p>}
      </div>
      <p aria-live="polite" className="min-h-5 text-sm text-red-600">{error}</p>
      <button type="submit" disabled={busy} className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {busy ? "Please wait…" : signup ? "Create account" : "Sign in"}
      </button>
      {canSignUp && (
        <p className="text-center text-sm">
          {signup ? "Already have an account? " : "New here? "}
          <Link href={signup ? "/login" : "/signup"} className="text-blue-700 underline dark:text-blue-300">
            {signup ? "Sign in" : "Create an account"}
          </Link>
        </p>
      )}
    </form>
  );
}
