import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { buildSystemPrompt } from "../src/lib/agent/prompt";
import { auth } from "../src/lib/auth";
import { articles, incidents, products } from "./seed/data";

const db = new PrismaClient();

/** Load each prompt markdown file into PromptTemplate, keyed by file name. */
async function seedPrompts() {
  const dir = path.join(__dirname, "seed", "prompts");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    const name = file.replace(/\.md$/, "");
    const template = fs.readFileSync(path.join(dir, file), "utf8");
    await db.promptTemplate.upsert({ where: { name }, create: { name, template }, update: { template } });
  }
}

/**
 * Load each agent markdown file into Agent, keyed by file name.
 * The header holds name, description and tools. The body has "## Role", "## Rules" (a list)
 * and "## Tool notes" (one "### tool_name" block per tool).
 * An agent that already exists is left alone, so edits made in the app survive a re-seed.
 */
async function seedAgents() {
  const dir = path.join(__dirname, "seed", "agents");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    const slug = file.replace(/\.md$/, "");
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) throw new Error(`${file}: expected a header between --- lines`);
    const head = Object.fromEntries(m[1].split("\n").map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]));
    const section = (title: string) => (m[2].match(new RegExp(`^## ${title}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m"))?.[1] ?? "").trim();
    const rules = section("Rules").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim());
    const toolNotes: Record<string, string> = {};
    for (const n of section("Tool notes").split(/^### /m).filter(Boolean)) {
      const [name, ...body] = n.split("\n");
      toolNotes[name.trim()] = body.join("\n").trim();
    }
    const parts = { role: section("Role"), rules, toolNotes, tools: (head.tools ?? "").split(",").map((t) => t.trim()).filter(Boolean) };
    await db.agent.upsert({
      where: { slug },
      create: { slug, name: head.name, description: head.description ?? "", ...parts, prompt: buildSystemPrompt(parts) },
      update: {},
    });
  }
}

async function seedCatalog() {
  for (const i of incidents) {
    await db.incident.upsert({ where: { number: i.number }, create: i, update: i });
  }
  for (const p of products) {
    await db.product.upsert({ where: { name: p.name }, create: p, update: p });
  }
  for (const a of articles) {
    const existing = await db.article.findFirst({ where: { externalId: a.externalId, dataSourceId: null } });
    if (existing) await db.article.update({ where: { id: existing.id }, data: a });
    else await db.article.create({ data: a });
  }
}

/** Create one finished demo job so the UI has data. Skipped when any job exists. */
async function seedDemoRun() {
  if ((await db.job.count()) > 0) return;

  const byId = async (externalId: string) =>
    db.article.findFirstOrThrow({ where: { externalId, dataSourceId: null } });
  const [vpn, mfa, outlook, vpn2] = await Promise.all(
    ["KB0001", "KB0002", "KB0003", "KB0005"].map(byId),
  );

  const job = await db.job.create({
    data: {
      status: "completed", startedAt: new Date(Date.now() - 600_000), completedAt: new Date(),
      articlesTotal: 4, articlesProcessed: 4, findingsGenerated: 5, duplicatesFound: 1,
      brokenLinksFound: 1, scope: "Demo seed",
    },
  });

  const demo = [
    { a: vpn, stage: "ready" as const, raw: 41, conv: 58, enr: 86, summary: "Reset a forgotten VPN password through the self-service portal.", audience: "end_user" as const },
    { a: mfa, stage: "ready" as const, raw: 33, conv: 49, enr: 82, summary: "Enrol a phone in Okta MFA using Okta Verify.", audience: "end_user" as const },
    { a: outlook, stage: "ready" as const, raw: 52, conv: 61, enr: 79, summary: "Fix Outlook repeatedly asking for credentials.", audience: "mixed" as const },
    { a: vpn2, stage: "ready" as const, raw: 60, conv: 72, enr: 88, summary: "Reset the VPN password using the self-service portal.", audience: "end_user" as const },
  ];

  const analyses: Record<string, string> = {};
  for (const d of demo) {
    const analysis = await db.analysis.create({
      data: {
        articleId: d.a.id, pipelineStage: d.stage, standardizedSummary: d.summary,
        targetAudience: d.audience, enrichmentConfidence: "medium", lastJobId: job.id,
        searchTerms: ["vpn password", "reset", "self service"],
      },
    });
    analyses[d.a.externalId!] = analysis.id;
    await db.jobItem.create({ data: { jobId: job.id, articleId: d.a.id, analysisId: analysis.id, status: "completed" } });
    const types = [["raw", d.raw], ["converted", d.conv], ["enriched", d.enr]] as const;
    for (const [type, score] of types) {
      await db.snapshot.create({
        data: {
          analysisId: analysis.id, type, version: 1, score, llmScore: score + 3,
          content: type === "raw" ? d.a.body : `${d.a.body}\n\n<!-- ${type} placeholder -->`,
          wordCount: d.a.body.split(/\s+/).length, processedAt: new Date(), lastJobId: job.id,
        },
      });
    }
  }

  const f1 = await db.finding.create({
    data: { analysisId: analyses.KB0001, type: "duplicate", severity: "high", relatedAnalysisId: analyses.KB0005,
      recommendedPrimaryId: analyses.KB0005, detail: "Covers the same VPN reset steps as KB0005.", lastJobId: job.id },
  });
  await db.finding.create({
    data: { analysisId: analyses.KB0001, type: "audience_mismatch", severity: "low",
      detail: "Opens with a bare pronoun and refers to a 'previous article'.", lastJobId: job.id },
  });
  await db.finding.create({
    data: { analysisId: analyses.KB0002, type: "broken_link", severity: "medium", brokenUrl: "https://example.com/old-mfa-page",
      detail: "Link text is 'click here' and the target is dead.", lastJobId: job.id },
  });
  await db.finding.create({
    data: { analysisId: analyses.KB0002, type: "image_dependent", severity: "high",
      detail: "The QR step relies on a screenshot with no alt text.", lastJobId: job.id },
  });
  const f5 = await db.finding.create({
    data: { analysisId: analyses.KB0003, type: "incomplete", severity: "medium",
      detail: "Does not mention token refresh after an MFA change.", lastJobId: job.id },
  });

  const inc = async (number: string) => db.incident.findUniqueOrThrow({ where: { number } });
  await db.evidence.create({ data: { findingId: f5.id, incidentId: (await inc("INC0010006")).id,
    newInformation: "Signing out of all Office apps refreshes an invalid token.", contradictsArticle: false } });
  await db.evidence.create({ data: { findingId: f1.id, incidentId: (await inc("INC0010002")).id,
    newInformation: "Reset works off-network through the public portal.", contradictsArticle: true } });

  const mentions: Array<[string, string, number]> = [
    ["KB0001", "VPN", 3], ["KB0001", "Self-service portal", 1], ["KB0005", "VPN", 3],
    ["KB0005", "Self-service portal", 2], ["KB0002", "Okta", 4], ["KB0003", "Outlook", 3],
    ["KB0003", "Windows", 1],
  ];
  for (const [ext, name, count] of mentions) {
    const product = await db.product.findUniqueOrThrow({ where: { name } });
    await db.mention.create({ data: { analysisId: analyses[ext], productId: product.id, mentionCount: count } });
  }
  for (const p of await db.product.findMany()) {
    await db.product.update({ where: { id: p.id }, data: { articleCount: await db.mention.count({ where: { productId: p.id } }) } });
  }
}

/**
 * Create the default admin account, or make sure the existing one is an admin.
 * Credentials come from ADMIN_EMAIL and ADMIN_PASSWORD. An existing account keeps its password.
 * Refuses to use the built-in default password in production.
 */
async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL ?? "admin@example.com").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "change-me-now";
  const usingDefault = !process.env.ADMIN_PASSWORD;
  if (usingDefault && process.env.NODE_ENV === "production") {
    throw new Error("Set ADMIN_PASSWORD before seeding in production. The built-in default is not safe.");
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== "admin") await db.user.update({ where: { id: existing.id }, data: { role: "admin" } });
    console.log(`Admin ${email} already exists`);
    return;
  }

  // Use Better Auth's own hasher so the seeded account signs in like any other.
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(password);
  const userId = randomUUID();
  await db.user.create({
    data: {
      id: userId, email, name: "Admin", emailVerified: true, role: "admin",
      accounts: { create: { id: randomUUID(), accountId: userId, providerId: "credential", password: hash } },
    },
  });
  console.log(`Created admin ${email}${usingDefault ? " with the default password. Change it." : ""}`);
}

async function main() {
  await seedAdmin();
  await seedPrompts();
  await seedAgents();
  await seedCatalog();
  await seedDemoRun();
  console.log("Seed complete");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => {
    await db.$disconnect();
    process.exit(process.exitCode ?? 0); // auth keeps its own database client open
  });
