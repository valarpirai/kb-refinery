import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";

/** Login and sign-up pages. Signed-in visitors go straight to the app. */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getUser()) redirect("/");
  return <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-8">{children}</main>;
}
