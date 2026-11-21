import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

/**
 * The signed-in user for this request, validated against the database.
 * @return the user, or null when not signed in
 */
export async function getUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ? { id: session.user.id, name: session.user.name, email: session.user.email } : null;
}

/**
 * Use in a page or layout. Sends visitors who are not signed in to the login page.
 * @return the signed-in user
 */
export async function requirePageUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

/** Standard 401 response for API routes. */
export function unauthorized() {
  return NextResponse.json({ error: "Sign in required" }, { status: 401 });
}
