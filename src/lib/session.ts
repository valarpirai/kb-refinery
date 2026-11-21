import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
}

/**
 * The signed-in user for this request, validated against the database.
 * @return the user, or null when not signed in
 */
export async function getUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  const { id, name, email } = session.user;
  return { id, name, email, role: (session.user as { role?: string }).role === "admin" ? "admin" : "user" };
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
