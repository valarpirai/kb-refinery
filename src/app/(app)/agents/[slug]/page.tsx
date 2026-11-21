import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentForm } from "@/components/agent-form";
import { db } from "@/lib/db";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requirePageUser();
  const { slug } = await params;
  const agent = await db.agent.findUnique({ where: { slug } });
  if (!agent) notFound();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="text-sm"><Link href="/agents" className="hover:underline">← Agents</Link></p>
        <h1 className="mt-2 text-2xl font-semibold">{agent.name}</h1>
        <p className="mt-1 text-sm opacity-70">
          Saved changes apply to the next message. Updated {agent.updatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC.
        </p>
      </div>
      <AgentForm
        canEdit={user.role === "admin"}
        agent={{ slug: agent.slug, name: agent.name, description: agent.description, role: agent.role, rules: agent.rules, tools: agent.tools, toolNotes: (agent.toolNotes ?? {}) as Record<string, string> }}
      />

    </div>
  );
}
