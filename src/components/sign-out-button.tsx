"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

/** Ends the session and returns to the login page. */
export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="rounded border border-black/20 px-2 py-1 text-xs dark:border-white/20"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
