import { Nav } from "@/components/nav";
import { requirePageUser } from "@/lib/session";

/** Every page in this group needs a signed-in user. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  return (
    <>
      <Nav user={user} />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </>
  );
}
