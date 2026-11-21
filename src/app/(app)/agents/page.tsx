import Link from "next/link";
import { db } from "@/lib/db";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const user = await requirePageUser();
  const agents = await db.agent.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Agents</h1>
        <p className="mt-1 text-sm opacity-70">
          The agents the worker can run. Each has a prompt and a set of tools. {user.role === "admin" ? "Open one to edit it." : "Only admins can edit them."}
        </p>
      </div>

      {agents.length === 0 ? (
        <p className="text-sm opacity-70">No agents yet. Run <code>pnpm db:seed</code>.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {agents.map((a) => (
            <li key={a.id} className="rounded-lg border border-black/10 p-4 dark:border-white/15">
              <h2 className="font-semibold">
                <Link href={`/agents/${a.slug}`} className="hover:underline">{a.name}</Link>
              </h2>
              <p className="mt-1 text-sm opacity-80">{a.description || "No description."}</p>
              <p className="mt-3 text-xs opacity-60">
                {a.tools.length} tool{a.tools.length === 1 ? "" : "s"} · {a.rules.length} rule{a.rules.length === 1 ? "" : "s"} · updated {a.updatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC
              </p>
              <Link href={`/agents/${a.slug}`} className="mt-3 inline-block text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">
                {user.role === "admin" ? "View and edit" : "View"}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
