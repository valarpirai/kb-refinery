import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const h = vi.hoisted(() => ({
  T: {} as Record<string, Row[]>,
  seq: { n: 0 },
  renderPrompt: vi.fn(),
  chatJson: vi.fn(),
  findCandidateIncidents: vi.fn(),
  indexArticle: vi.fn(),
}));

// ---------------------------------------------------------------- fake database

const COMPOUND = new Set(["analysisId_version_type", "articleId_tagId", "findingId_incidentId"]);
const DEFAULTS: Record<string, Row> = {
  finding: { state: "new" },
  jobItem: { restarts: 0, attempts: 0 },
  product: { aliases: "", articleCount: 0 },
  job: { findingsGenerated: 0, duplicatesFound: 0 },
};

/**
 * Match a row against the subset of Prisma where syntax the pipeline uses.
 * @param name table the row belongs to
 * @param row the row
 * @param where the filter
 * @return true when the row matches
 */
function match(name: string, row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Row[]).some((w) => match(name, row, w));
    if (COMPOUND.has(k)) return match(name, row, v);
    if (k === "jobItems") return h.T.jobItem.some((j) => j.analysisId === row.id && match("jobItem", j, v.some));
    if (k === "articles") return !h.T.articleTag.some((a) => a.tagId === row.id);
    const val = row[k] ?? null;
    if (v instanceof Date) return val instanceof Date && val.getTime() === v.getTime();
    if (v && typeof v === "object") {
      const lower = (x: unknown) => String(x ?? "").toLowerCase();
      if ("in" in v) return v.in.includes(val);
      if ("notIn" in v) return !v.notIn.includes(val);
      if ("not" in v) return val !== v.not;
      if ("lt" in v) return val != null && val < v.lt;
      if ("gt" in v) return val != null && val > v.gt;
      if ("equals" in v) return lower(val) === lower(v.equals);
      if ("contains" in v) return lower(val).includes(lower(v.contains));
    }
    return val === v;
  });
}

/**
 * Apply a Prisma data object to a row, including increment.
 * @param row the row to change
 * @param data the new values
 */
function apply(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    row[k] = v && typeof v === "object" && !(v instanceof Date) && "increment" in v ? (row[k] ?? 0) + v.increment : v;
  }
  row.updatedAt = new Date(1_700_000_000_000 + ++h.seq.n * 1000);
}

/**
 * Build a table with the Prisma methods the pipeline calls.
 * @param name table name, which is also the db property
 * @return the fake delegate
 */
function table(name: string) {
  const rows = () => h.T[name];
  const decorate = (r: Row): Row => {
    const out = { ...r };
    if (name === "jobItem") out.article = h.T.article.find((a) => a.id === r.articleId);
    if (name === "mention") out.product = h.T.product.find((p) => p.id === r.productId);
    return out;
  };
  const find = (args: Row = {}) => {
    let out = rows().filter((r) => match(name, r, args.where));
    const order = Array.isArray(args.orderBy) ? args.orderBy[0] : args.orderBy;
    if (order) {
      const [key, dir] = Object.entries(order)[0] as [string, string];
      out = [...out].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (dir === "desc" ? -1 : 1));
    }
    if (args.distinct) {
      const seen = new Set();
      out = out.filter((r) => !seen.has(r[args.distinct[0]]) && seen.add(r[args.distinct[0]]));
    }
    return args.take != null ? out.slice(0, args.take) : out;
  };
  const create = async ({ data }: Row) => {
    const n = ++h.seq.n;
    const r = { id: `${name}-${n}`, createdAt: new Date(1_700_000_000_000 + n * 1000), updatedAt: new Date(1_700_000_000_000 + n * 1000), ...DEFAULTS[name], ...data };
    rows().push(r);
    return decorate(r);
  };
  return {
    create: vi.fn(create),
    findMany: vi.fn(async (a: Row) => find(a).map(decorate)),
    findFirst: vi.fn(async (a: Row) => (find(a)[0] ? decorate(find(a)[0]) : null)),
    findUnique: vi.fn(async (a: Row) => (find(a)[0] ? decorate(find(a)[0]) : null)),
    findUniqueOrThrow: vi.fn(async (a: Row) => {
      const r = find(a)[0];
      if (!r) throw new Error(`${name} not found`);
      return decorate(r);
    }),
    update: vi.fn(async ({ where, data }: Row) => {
      const r = find({ where })[0];
      if (!r) throw new Error(`${name} to update not found`);
      apply(r, data);
      return decorate(r);
    }),
    updateMany: vi.fn(async ({ where, data }: Row) => {
      const hit = find({ where });
      hit.forEach((r) => apply(r, data));
      return { count: hit.length };
    }),
    deleteMany: vi.fn(async ({ where }: Row) => {
      const hit = new Set(find({ where }));
      h.T[name] = rows().filter((r) => !hit.has(r));
      return { count: hit.size };
    }),
    count: vi.fn(async (a: Row) => find(a).length),
    aggregate: vi.fn(async (a: Row) => {
      const v = find(a).map((r) => r.version);
      return { _max: { version: v.length ? Math.max(...v) : null } };
    }),
    upsert: vi.fn(async ({ where, create: c, update: u }: Row) => {
      const r = find({ where })[0];
      if (r) { apply(r, u); return decorate(r); }
      return create({ data: c });
    }),
  };
}

vi.mock("@/lib/db", () => {
  const db: Record<string, unknown> = {};
  for (const n of ["article", "jobItem", "analysis", "snapshot", "finding", "mention", "product", "tag", "articleTag", "evidence", "stageRun", "job"]) {
    h.T[n] = [];
    db[n] = table(n);
  }
  return { db };
});
vi.mock("./prompts", () => ({ renderPrompt: h.renderPrompt }));
vi.mock("./llm", () => ({ chatJson: h.chatJson }));
vi.mock("./incidents", () => ({ findCandidateIncidents: h.findCandidateIncidents }));
vi.mock("@/lib/chat/indexer", () => ({ indexArticle: h.indexArticle }));

import { db } from "@/lib/db";
import { processJobItem, STAGES } from "./run-article";
import { scoreOnlySchema } from "./schemas";
import { ClaimLostError, HEARTBEAT_MS, WORKER_ID } from "./worker-id";

const T = h.T;

// ---------------------------------------------------------------- scenario helpers

const BODY = `<h1>Reset a password</h1><p>${Array.from({ length: 12 }, () => "Open the settings page and click save now.").join(" ")}</p>`;
const UPDATED = new Date("2026-03-01T00:00:00Z");

interface Script {
  analysis: Row;
  score: number | Error;
  enrichment: Row;
  synthesis: Row;
  duplicate: Row;
  /** Runs inside the analysis call, before it returns. */
  onAnalysis?: () => Promise<void> | void;
}

let script: Script;

/** What the fake model says by default: one content gap, one product, no duplicate. */
function defaultScript(): Script {
  return {
    analysis: {
      quality_score: 62.4, target_audience: "admin", standardized_summary: "Resets a password.",
      findings: [{ type: "no_resolution_steps", severity: "high", location: "", evidence: "", detail: "No steps" }],
      search_terms: ["password", "reset"], product_mentions: ["Okta"], summary: "",
    },
    score: 40,
    enrichment: {
      incident_analysis: [{ incident_id: "INC1", relevant: true, new_information: "Clear cache", contradicts_article: false }],
      ai_ready_knowledge: { extractable: true, steps: ["a"] }, contradictions: [], recommendations: ["Add steps"], confidence: "high", summary: "E",
    },
    synthesis: { enriched_content: "# Reset\n\nNew text", summary: "Added steps", resolved_finding_ids: [], unresolved_gaps: [] },
    duplicate: { same_topic: false, more_complete_article: "a", reasoning: "" },
  };
}

/**
 * Seed an article and a claimed job item.
 * @param id suffix used for ids
 * @param item overrides for the job item
 * @param article overrides for the article
 * @return the item id
 */
function seed(id = "1", item: Row = {}, article: Row = {}): string {
  T.article.push({ id: `art${id}`, title: `Title ${id}`, body: BODY, format: "html", knowledgeBase: "KB", updatedAt: UPDATED, ...article });
  T.jobItem.push({
    id: `item${id}`, jobId: "j1", articleId: `art${id}`, status: "converting", claimedBy: WORKER_ID, analysisId: null, failedStage: null,
    message: null, restarts: 0, attempts: 1, heartbeatAt: new Date(0), updatedAt: new Date(0), createdAt: new Date(0), ...item,
  });
  if (!T.job.some((j) => j.id === "j1")) T.job.push({ id: "j1", findingsGenerated: 0, duplicatesFound: 0 });
  return `item${id}`;
}

const item = (id = "item1") => T.jobItem.find((r) => r.id === id)!;
const analysisOf = (articleId = "art1") => T.analysis.find((a) => a.articleId === articleId)!;
const snaps = (type?: string, analysisId?: string) => T.snapshot.filter((s) => (!type || s.type === type) && (!analysisId || s.analysisId === analysisId));
const openFindings = (analysisId: string) => T.finding.filter((f) => f.analysisId === analysisId && f.state !== "cancelled");
const stagesRun = (id = "item1") => T.stageRun.filter((s) => s.jobItemId === id).map((s) => `${s.stage}:${s.status}`);

/** Put an item back the way a worker claim leaves it, ready for another run. */
function reclaim(id = "item1", patch: Row = {}) {
  Object.assign(item(id), { status: "converting", claimedBy: WORKER_ID, ...patch });
}

beforeEach(() => {
  for (const k of Object.keys(T)) T[k] = [];
  h.seq.n = 0;
  script = defaultScript();
  h.renderPrompt.mockImplementation(async (name: string, vars: Row) => `${name}|${JSON.stringify(vars)}`);
  h.chatJson.mockImplementation(async (prompt: string, schema: unknown) => {
    const name = prompt.split("|")[0];
    if (name === "kb_article_analysis" && schema === scoreOnlySchema) {
      if (script.score instanceof Error) throw script.score;
      return { data: { quality_score: script.score }, thinking: "" };
    }
    if (name === "kb_article_analysis") { await script.onAnalysis?.(); return { data: structuredClone(script.analysis), thinking: "" }; }
    if (name === "incident_enrichment") return { data: structuredClone(script.enrichment), thinking: "" };
    if (name === "article_synthesis") return { data: structuredClone(script.synthesis), thinking: "" };
    if (name === "duplicate_confirmation") return { data: structuredClone(script.duplicate), thinking: "" };
    throw new Error(`unexpected prompt ${name}`);
  });
  h.findCandidateIncidents.mockResolvedValue([{ id: "inc-id-1", number: "INC1", shortDescription: "VPN", resolution: "Restart" }]);
  h.indexArticle.mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

/** Calls to the full analysis, leaving out the score-only calls that share its prompt. */
const analysisCalls = () => h.chatJson.mock.calls.filter((c) => String(c[0]).startsWith("kb_article_analysis|") && c[1] !== scoreOnlySchema);
const calls = (promptName: string) => h.chatJson.mock.calls.filter((c) => String(c[0]).startsWith(`${promptName}|`));

// ---------------------------------------------------------------- tests

describe("STAGES", () => {
  it("lists the four refine stages in order", () => {
    expect([...STAGES]).toEqual(["convert", "analyze", "enrich", "rewrite"]);
  });
});

describe("processJobItem: full run", () => {
  it("runs every stage, saves three snapshots and finishes the item", async () => {
    seed();
    await processJobItem("item1");

    expect(item()).toMatchObject({ status: "completed", failedStage: null, message: null });
    const an = analysisOf();
    expect(an).toMatchObject({ pipelineStage: "ready", sourceUpdatedAt: UPDATED, targetAudience: "admin", standardizedSummary: "Resets a password.", enrichmentConfidence: "high" });
    expect(an.searchTerms).toEqual(["password", "reset"]);
    expect(item().analysisId).toBe(an.id);
    expect(snaps().map((s) => `${s.type}@${s.version}`).sort()).toEqual(["converted@1", "enriched@1", "raw@1"]);
    expect(stagesRun()).toEqual(["convert:ok", "analyze:ok", "enrich:ok", "rewrite:ok", "index:ok"]);
  });

  it("stores raw and converted content with mechanical scores and counters", async () => {
    seed();
    await processJobItem("item1");
    const raw = snaps("raw")[0];
    const conv = snaps("converted")[0];
    expect(raw.content).toBe(BODY);
    expect(conv.content.startsWith("# Reset a password")).toBe(true);
    expect(conv.wordCount).toBeGreaterThan(80);
    expect(typeof conv.score).toBe("number");
    expect(conv.tokenCount).toBe(Math.round(conv.wordCount * 1.3));
    expect(conv.imageCount).toBe(0);
  });

  it("scores the three versions with the model: converted from analysis, raw and rewrite from score-only calls", async () => {
    seed();
    await processJobItem("item1");
    expect(snaps("converted")[0].llmScore).toBe(62);
    expect(snaps("raw")[0].llmScore).toBe(40);
    const enriched = snaps("enriched")[0];
    expect(enriched).toMatchObject({ content: "# Reset\n\nNew text", llmScore: 40, processingMessage: "Added steps" });
  });

  it("saves findings with location and evidence folded into the detail", async () => {
    script.analysis.findings = [
      { type: "no_resolution_steps", severity: "high", location: "Step 2", evidence: "TBD", detail: "No steps" },
      { type: "too_vague", severity: "low", location: "", evidence: "", detail: "Vague" },
    ];
    seed();
    await processJobItem("item1");
    const f = openFindings(analysisOf().id);
    expect(f.map((x) => x.detail)).toEqual(['No steps [Step 2] "TBD"', "Vague"]);
    expect(f.map((x) => `${x.type}/${x.severity}`)).toEqual(["no_resolution_steps/high", "too_vague/low"]);
    expect(f.every((x) => x.lastJobId === "j1")).toBe(true);
  });

  it("limits the summary to 500 characters and search terms to eight", async () => {
    script.analysis.standardized_summary = "x".repeat(900);
    script.analysis.search_terms = Array.from({ length: 12 }, (_, i) => `t${i}`);
    seed();
    await processJobItem("item1");
    expect(analysisOf().standardizedSummary).toHaveLength(500);
    expect(analysisOf().searchTerms).toHaveLength(8);
  });

  it("counts findings on the job", async () => {
    script.analysis.findings = [
      { type: "no_resolution_steps", severity: "high", location: "", evidence: "", detail: "a" },
      { type: "too_vague", severity: "low", location: "", evidence: "", detail: "b" },
    ];
    seed();
    await processJobItem("item1");
    expect(T.job[0]).toMatchObject({ findingsGenerated: 2, duplicatesFound: 0 });
  });

  it("feeds the analysis prompt the article details, and the same prompt scores raw text", async () => {
    seed();
    await processJobItem("item1");
    const vars = JSON.parse(String(calls("kb_article_analysis")[0][0]).split("|").slice(1).join("|"));
    expect(vars).toMatchObject({ title: "Title 1", kbname: "KB", lastupdated: "2026-03-01", articletype: "Knowledge article" });
    expect(vars.content.startsWith("# Reset a password")).toBe(true);
    const rawVars = JSON.parse(String(calls("kb_article_analysis")[1][0]).split("|").slice(1).join("|"));
    expect(rawVars.content).toBe(BODY);
  });

  it("uses thinking for enrichment and rewrite only", async () => {
    seed();
    await processJobItem("item1");
    const think = (name: string) => h.chatJson.mock.calls.find((c) => String(c[0]).startsWith(name))![2];
    expect(think("incident_enrichment")).toEqual({ think: true });
    expect(think("article_synthesis")).toEqual({ think: true });
    expect(h.chatJson.mock.calls.find((c) => String(c[0]).startsWith("kb_article_analysis"))![2]).toBeUndefined();
  });

  it("uses a default knowledge base label when the article has none", async () => {
    seed("1", {}, { knowledgeBase: null });
    await processJobItem("item1");
    expect(String(calls("kb_article_analysis")[0][0])).toContain('"kbname":"General"');
  });

  it("indexes the article for chat", async () => {
    seed();
    await processJobItem("item1");
    expect(h.indexArticle).toHaveBeenCalledWith("art1");
  });

  it("stops its heartbeat timer when done", async () => {
    vi.useFakeTimers();
    try {
      seed();
      await processJobItem("item1");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("processJobItem: branching by findings", () => {
  it("finishes after analysis when there are no findings", async () => {
    script.analysis.findings = [];
    seed();
    await processJobItem("item1");
    expect(item().status).toBe("completed");
    expect(analysisOf().pipelineStage).toBe("ready");
    expect(snaps("enriched")).toHaveLength(0);
    expect(calls("incident_enrichment")).toHaveLength(0);
    expect(calls("article_synthesis")).toHaveLength(0);
    expect(stagesRun()).toEqual(["convert:ok", "analyze:ok", "index:ok"]);
    expect(T.job[0].findingsGenerated).toBe(0);
  });

  it("skips enrichment for a structure problem but still rewrites", async () => {
    script.analysis.findings = [{ type: "too_vague", severity: "low", location: "", evidence: "", detail: "v" }];
    seed();
    await processJobItem("item1");
    expect(calls("incident_enrichment")).toHaveLength(0);
    expect(h.findCandidateIncidents).not.toHaveBeenCalled();
    expect(snaps("enriched")).toHaveLength(1);
    expect(analysisOf().enrichmentKnowledge).toBeUndefined();
    expect(stagesRun()).toEqual(["convert:ok", "analyze:ok", "rewrite:ok", "index:ok"]);
  });

  it.each(["incomplete", "no_resolution_steps", "missing_prerequisites", "no_error_guidance", "outdated", "missing_context"])("enriches for the content gap %s", async (type) => {
    script.analysis.findings = [{ type, severity: "medium", location: "", evidence: "", detail: "d" }];
    seed();
    await processJobItem("item1");
    expect(calls("incident_enrichment")).toHaveLength(1);
  });

  it("only gives content gap findings to the enrichment prompt", async () => {
    script.analysis.findings = [
      { type: "too_vague", severity: "low", location: "", evidence: "", detail: "vague one" },
      { type: "outdated", severity: "high", location: "", evidence: "", detail: "old one" },
    ];
    seed();
    await processJobItem("item1");
    const vars = JSON.parse(String(calls("incident_enrichment")[0][0]).split("|").slice(1).join("|"));
    expect(vars.findings).toContain("old one");
    expect(vars.findings).not.toContain("vague one");
  });

  it("passes enrichment results to the rewrite only when knowledge is extractable", async () => {
    script.enrichment.ai_ready_knowledge = { extractable: false };
    seed();
    await processJobItem("item1");
    const vars = JSON.parse(String(calls("article_synthesis")[0][0]).split("|").slice(1).join("|"));
    expect(vars.ai_ready_knowledge).toBe("(none)");
    expect(vars.recommendations).toContain("Add steps");
  });

  it("saves the enrichment output on the analysis", async () => {
    seed();
    await processJobItem("item1");
    expect(analysisOf().enrichmentKnowledge).toMatchObject({ confidence: "high", summary: "E" });
  });

  it("attaches evidence only for relevant incidents it offered, to the first content gap finding", async () => {
    script.enrichment.incident_analysis = [
      { incident_id: "INC1", relevant: true, new_information: "info", contradicts_article: true },
      { incident_id: "INC9", relevant: true, new_information: "ghost", contradicts_article: false },
      { incident_id: "INC1", relevant: false, new_information: "no", contradicts_article: false },
    ];
    seed();
    await processJobItem("item1");
    expect(T.evidence).toHaveLength(1);
    expect(T.evidence[0]).toMatchObject({ incidentId: "inc-id-1", newInformation: "info", contradictsArticle: true, findingId: openFindings(analysisOf().id)[0].id });
  });

  it("still rewrites when incident lookup finds nothing", async () => {
    h.findCandidateIncidents.mockResolvedValue([]);
    script.enrichment.incident_analysis = [];
    seed();
    await processJobItem("item1");
    expect(T.evidence).toHaveLength(0);
    expect(snaps("enriched")).toHaveLength(1);
  });

  it("uses the analysis search terms to find incidents", async () => {
    seed();
    await processJobItem("item1");
    expect(h.findCandidateIncidents).toHaveBeenCalledWith(["password", "reset"]);
  });

  it("keeps the enriched snapshot's score empty when the model score call fails", async () => {
    script.score = new Error("model down");
    seed();
    await processJobItem("item1");
    expect(item().status).toBe("completed");
    expect(snaps("raw")[0].llmScore ?? null).toBeNull();
    expect(snaps("enriched")[0].llmScore).toBeNull();
    expect(snaps("converted")[0].llmScore).toBe(62);
  });

  it("stores the rewrite summary as null when empty", async () => {
    script.synthesis.summary = "";
    seed();
    await processJobItem("item1");
    expect(snaps("enriched")[0].processingMessage).toBeNull();
  });
});

describe("processJobItem: skipping unchanged articles", () => {
  /** Finish one run, then claim the item again as a new job would. */
  async function firstRun() {
    seed();
    await processJobItem("item1");
    h.chatJson.mockClear();
    h.renderPrompt.mockClear();
    reclaim("item1", { status: "converting" });
  }

  it("skips an article that is ready and has not changed since", async () => {
    await firstRun();
    await processJobItem("item1");
    expect(item()).toMatchObject({ status: "skipped", message: "Unchanged since last run", analysisId: analysisOf().id });
    expect(h.chatJson).not.toHaveBeenCalled();
    expect(snaps("raw")).toHaveLength(1);
  });

  it("re-runs an article that changed after its last run", async () => {
    await firstRun();
    T.article[0].updatedAt = new Date("2026-04-01T00:00:00Z");
    await processJobItem("item1");
    expect(item().status).toBe("completed");
    expect(snaps("raw").map((s) => s.version)).toEqual([1, 2]);
  });

  it("re-runs an unchanged article when the user restarted it", async () => {
    await firstRun();
    item().restarts = 1;
    await processJobItem("item1");
    expect(item().status).toBe("completed");
    expect(snaps("raw")).toHaveLength(2);
  });

  it("does not skip an article whose analysis never finished", async () => {
    await firstRun();
    analysisOf().pipelineStage = "failed";
    await processJobItem("item1");
    expect(item().status).toBe("completed");
  });
});

describe("processJobItem: running twice is safe", () => {
  /** Run an article, then force a second full run of the same item. */
  async function twice(from?: "convert" | "analyze" | "enrich" | "rewrite") {
    seed();
    await processJobItem("item1");
    reclaim("item1", { restarts: 1 });
    await processJobItem("item1", from);
  }

  it("keeps one set of open findings, cancelling the earlier set", async () => {
    await twice();
    const an = analysisOf();
    expect(openFindings(an.id)).toHaveLength(1);
    expect(T.finding.filter((f) => f.state === "cancelled")).toHaveLength(1);
  });

  it("keeps one analysis for the article", async () => {
    await twice();
    expect(T.analysis).toHaveLength(1);
  });

  it("adds a new snapshot version, never overwriting earlier ones, with one of each type per version", async () => {
    await twice();
    const an = analysisOf();
    for (const v of [1, 2]) {
      for (const t of ["raw", "converted", "enriched"]) expect(T.snapshot.filter((s) => s.analysisId === an.id && s.version === v && s.type === t)).toHaveLength(1);
    }
  });

  it("does not repeat product mentions, tags or counters", async () => {
    await twice();
    expect(T.product).toHaveLength(1);
    expect(T.mention).toHaveLength(1);
    expect(T.product[0].articleCount).toBe(1);
    expect(T.tag.map((t) => t.name)).toEqual(["okta"]);
    expect(T.articleTag).toHaveLength(1);
  });

  it("keeps evidence unique per finding and incident, with one row on the open finding", async () => {
    await twice();
    const open = openFindings(analysisOf().id).map((f) => f.id);
    expect(T.evidence.filter((e) => open.includes(e.findingId))).toHaveLength(1);
    const keys = T.evidence.map((e) => `${e.findingId}/${e.incidentId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("clears a leftover half-made version (raw without converted) before starting", async () => {
    seed();
    const an = { id: "an-old", articleId: "art1", pipelineStage: "failed" };
    T.analysis.push(an);
    T.snapshot.push({ id: "s-old", analysisId: "an-old", type: "raw", version: 3, content: "x" });
    await processJobItem("item1");
    expect(T.snapshot.some((s) => s.id === "s-old")).toBe(false);
    expect(snaps("raw", "an-old").map((s) => s.version)).toEqual([1]);
  });

  it("re-running the rewrite alone leaves exactly one rewrite for the version", async () => {
    await twice("rewrite");
    const an = analysisOf();
    expect(snaps("enriched", an.id)).toHaveLength(1);
    expect(snaps("raw", an.id)).toHaveLength(1);
    expect(calls("article_synthesis")).toHaveLength(2);
  });

  it("re-running the rewrite alone twice more still leaves one rewrite", async () => {
    await twice("rewrite");
    reclaim("item1", { restarts: 2 });
    await processJobItem("item1", "rewrite");
    expect(snaps("enriched")).toHaveLength(1);
  });

  it("re-running enrich alone keeps one evidence row and one rewrite", async () => {
    await twice("enrich");
    expect(T.evidence).toHaveLength(1);
    expect(snaps("enriched")).toHaveLength(1);
  });

  it("re-running analyze alone cancels earlier findings and does not stack them", async () => {
    await twice("analyze");
    expect(openFindings(analysisOf().id)).toHaveLength(1);
    expect(T.mention).toHaveLength(1);
    expect(snaps("converted")).toHaveLength(1);
  });

  it("does not repeat a duplicate pair when the second article is analyzed again", async () => {
    script.duplicate = { same_topic: true, more_complete_article: "b", reasoning: "same" };
    seed("1");
    await processJobItem("item1");
    seed("2");
    await processJobItem("item2");
    const dupes = () => T.finding.filter((f) => f.type === "duplicate" && f.state !== "cancelled");
    expect(dupes()).toHaveLength(2);
    reclaim("item2", { restarts: 1 });
    await processJobItem("item2");
    expect(dupes()).toHaveLength(2);
    expect(T.job[0].duplicatesFound).toBe(2);
  });
});

describe("processJobItem: duplicate check", () => {
  it("flags both articles when the model says they match, pointing at the more complete one", async () => {
    script.duplicate = { same_topic: true, more_complete_article: "a", reasoning: "same topic" };
    seed("1");
    await processJobItem("item1");
    seed("2");
    await processJobItem("item2");
    const a1 = analysisOf("art1").id;
    const a2 = analysisOf("art2").id;
    const dupes = T.finding.filter((f) => f.type === "duplicate");
    expect(dupes).toHaveLength(2);
    expect(dupes.find((d) => d.analysisId === a2)).toMatchObject({ relatedAnalysisId: a1, recommendedPrimaryId: a2, detail: "same topic", severity: "medium" });
    expect(dupes.find((d) => d.analysisId === a1)).toMatchObject({ relatedAnalysisId: a2, recommendedPrimaryId: a2 });
    expect(T.job[0].duplicatesFound).toBe(1);
  });

  it("picks the other article as primary when the model says b", async () => {
    script.duplicate = { same_topic: true, more_complete_article: "b", reasoning: "r" };
    seed("1");
    await processJobItem("item1");
    seed("2");
    await processJobItem("item2");
    expect(T.finding.find((d) => d.type === "duplicate")!.recommendedPrimaryId).toBe(analysisOf("art1").id);
  });

  it("adds nothing when the model says the topics differ", async () => {
    seed("1");
    await processJobItem("item1");
    seed("2");
    await processJobItem("item2");
    expect(T.finding.filter((f) => f.type === "duplicate")).toHaveLength(0);
    expect(calls("duplicate_confirmation")).toHaveLength(1);
  });

  it("does not compare articles that share no search term", async () => {
    seed("1");
    await processJobItem("item1");
    script.analysis.search_terms = ["completely", "different"];
    seed("2");
    await processJobItem("item2");
    expect(calls("duplicate_confirmation")).toHaveLength(0);
  });

  it("matches search terms regardless of case", async () => {
    seed("1");
    await processJobItem("item1");
    script.analysis.search_terms = ["PASSWORD"];
    seed("2");
    await processJobItem("item2");
    expect(calls("duplicate_confirmation")).toHaveLength(1);
  });

  it("only compares articles in the same job", async () => {
    seed("1");
    await processJobItem("item1");
    seed("2", { jobId: "j2" });
    await processJobItem("item2");
    expect(calls("duplicate_confirmation")).toHaveLength(0);
  });

  it("checks at most three candidates, best overlap first", async () => {
    for (let i = 1; i <= 5; i++) {
      script.analysis.search_terms = i === 5 ? ["password", "reset"] : i === 4 ? ["password", "reset"] : ["password"];
      seed(String(i));
      await processJobItem(`item${i}`);
    }
    h.chatJson.mockClear();
    h.renderPrompt.mockClear();
    script.analysis.search_terms = ["password", "reset"];
    seed("6");
    await processJobItem("item6");
    const asked = h.renderPrompt.mock.calls.filter((c) => c[0] === "duplicate_confirmation");
    expect(asked).toHaveLength(3);
    expect(asked[0][1].terms_b).toBe("password, reset");
    expect(asked[1][1].terms_b).toBe("password, reset");
  });
});

describe("processJobItem: product mentions and tags", () => {
  it("creates a product and tag per mention, counting repeats", async () => {
    script.analysis.product_mentions = ["Okta", "okta ", "Slack"];
    seed();
    await processJobItem("item1");
    expect(T.product.map((p) => p.name).sort()).toEqual(["Okta", "Slack"]);
    expect(T.mention.find((m) => m.productId === T.product.find((p) => p.name === "Okta")!.id)!.mentionCount).toBe(2);
    expect(T.tag.map((t) => t.name).sort()).toEqual(["okta", "slack"]);
  });

  it("reuses an existing product matched by name or alias, ignoring case", async () => {
    T.product.push({ id: "p1", name: "ServiceNow", aliases: "SN, Now Platform", articleCount: 0 });
    script.analysis.product_mentions = ["servicenow", "now platform"];
    seed();
    await processJobItem("item1");
    expect(T.product).toHaveLength(1);
    expect(T.mention[0]).toMatchObject({ productId: "p1", mentionCount: 2 });
    expect(T.product[0].articleCount).toBe(1);
  });

  it("ignores blank mentions", async () => {
    script.analysis.product_mentions = ["", "   "];
    seed();
    await processJobItem("item1");
    expect(T.product).toHaveLength(0);
    expect(T.mention).toHaveLength(0);
  });

  it("removes the tag and counts when a later run no longer mentions the product", async () => {
    seed();
    await processJobItem("item1");
    script.analysis.product_mentions = ["Slack"];
    reclaim("item1", { restarts: 1 });
    await processJobItem("item1");
    expect(T.mention.map((m) => T.product.find((p) => p.id === m.productId)!.name)).toEqual(["Slack"]);
    expect(T.tag.map((t) => t.name)).toEqual(["slack"]);
    expect(T.articleTag).toHaveLength(1);
    expect(T.product.find((p) => p.name === "Okta")!.articleCount).toBe(0);
  });

  it("keeps a hand-added tag that matches no dropped product", async () => {
    seed();
    await processJobItem("item1");
    T.tag.push({ id: "t-hand", name: "vip" });
    T.articleTag.push({ id: "at-hand", articleId: "art1", tagId: "t-hand" });
    reclaim("item1", { restarts: 1 });
    await processJobItem("item1");
    expect(T.tag.map((t) => t.name).sort()).toEqual(["okta", "vip"]);
  });

  it("keeps a product tag that another article still uses", async () => {
    seed();
    await processJobItem("item1");
    T.articleTag.push({ id: "at-other", articleId: "art-other", tagId: T.tag[0].id });
    script.analysis.product_mentions = [];
    reclaim("item1", { restarts: 1 });
    await processJobItem("item1");
    expect(T.tag).toHaveLength(1);
    expect(T.articleTag.map((a) => a.articleId)).toEqual(["art-other"]);
  });

  it("stops adding product tags at the per-article limit", async () => {
    script.analysis.product_mentions = Array.from({ length: 25 }, (_, i) => `Prod${i}`);
    seed();
    await processJobItem("item1");
    expect(T.articleTag).toHaveLength(20);
    expect(T.mention).toHaveLength(25);
  });
});

describe("processJobItem: restarting from a later stage", () => {
  /** Complete a run, then ask for a restart at a stage. */
  async function restartAt(from: "analyze" | "enrich" | "rewrite") {
    seed();
    await processJobItem("item1");
    h.chatJson.mockClear();
    reclaim("item1", { restarts: 1, failedStage: from });
    await processJobItem("item1", from);
  }

  it("from analyze: reuses the converted snapshot and does not convert again", async () => {
    await restartAt("analyze");
    expect(snaps("raw")).toHaveLength(1);
    expect(stagesRun().filter((s) => s.startsWith("convert"))).toHaveLength(1);
    expect(analysisCalls()).toHaveLength(1);
    expect(item().status).toBe("completed");
  });

  it("from enrich: does not ask the analysis model again", async () => {
    await restartAt("enrich");
    expect(analysisCalls()).toHaveLength(0);
    expect(calls("incident_enrichment")).toHaveLength(1);
    expect(calls("article_synthesis")).toHaveLength(1);
    expect(item().status).toBe("completed");
  });

  it("from enrich: rebuilds the findings from the saved ones, without duplicate findings", async () => {
    script.analysis.findings.push({ type: "too_vague", severity: "low", location: "", evidence: "", detail: "Vague" });
    seed();
    await processJobItem("item1");
    T.finding.push({ id: "dup", analysisId: analysisOf().id, type: "duplicate", state: "new", detail: "x", createdAt: new Date() });
    h.chatJson.mockClear();
    h.renderPrompt.mockClear();
    reclaim("item1", { restarts: 1 });
    await processJobItem("item1", "enrich");
    const vars = h.renderPrompt.mock.calls.find((c) => c[0] === "article_synthesis")![1];
    expect(vars.findings).toContain("no_resolution_steps");
    expect(vars.findings).toContain("too_vague");
    expect(vars.findings).not.toContain("duplicate");
    expect(vars.targetaudience).toBe("admin");
  });

  it("from rewrite: reuses saved enrichment and runs only the rewrite", async () => {
    await restartAt("rewrite");
    expect(analysisCalls()).toHaveLength(0);
    expect(calls("incident_enrichment")).toHaveLength(0);
    expect(calls("article_synthesis")).toHaveLength(1);
    const vars = h.renderPrompt.mock.calls.filter((c) => c[0] === "article_synthesis").at(-1)![1];
    expect(vars.ai_ready_knowledge).toContain("extractable");
    expect(snaps("enriched")).toHaveLength(1);
  });

  it("from rewrite: saves no second raw or converted snapshot", async () => {
    await restartAt("rewrite");
    expect(snaps("raw")).toHaveLength(1);
    expect(snaps("converted")).toHaveLength(1);
  });

  it("falls back to the full pipeline when nothing was saved to resume from", async () => {
    seed();
    await processJobItem("item1", "rewrite");
    expect(item().status).toBe("completed");
    expect(snaps("raw")).toHaveLength(1);
    expect(analysisCalls()).toHaveLength(1);
    expect(stagesRun().some((s) => s.startsWith("convert"))).toBe(true);
  });

  it("falls back to the full pipeline when the analysis has no converted snapshot", async () => {
    seed();
    T.analysis.push({ id: "an1", articleId: "art1", pipelineStage: "failed" });
    T.snapshot.push({ id: "s1", analysisId: "an1", type: "raw", version: 1, content: "x" });
    await processJobItem("item1", "analyze");
    expect(item().status).toBe("completed");
    expect(stagesRun()[0]).toBe("convert:ok");
  });
});

describe("processJobItem: failures", () => {
  it("records a failure in the analyze stage and does not throw", async () => {
    script.onAnalysis = () => { throw new Error("Model reply did not match the expected shape"); };
    seed();
    await expect(processJobItem("item1")).resolves.toBeUndefined();
    expect(item()).toMatchObject({ status: "failed", failedStage: "analyze", message: "Model reply did not match the expected shape" });
    expect(analysisOf().pipelineStage).toBe("failed");
    expect(stagesRun()).toEqual(["convert:ok", "analyze:error"]);
    expect(h.indexArticle).not.toHaveBeenCalled();
    expect(T.job[0].findingsGenerated).toBe(0);
  });

  it("records a failure in the enrich stage", async () => {
    h.findCandidateIncidents.mockRejectedValue(new Error("db down"));
    seed();
    await processJobItem("item1");
    expect(item()).toMatchObject({ status: "failed", failedStage: "enrich", message: "db down" });
    expect(stagesRun()).toContain("enrich:error");
  });

  it("records a failure in the rewrite stage and leaves no half-made rewrite", async () => {
    script.synthesis = { enriched_content: "x" };
    h.chatJson.mockImplementation(async (prompt: string, schema: unknown) => {
      if (String(prompt).startsWith("article_synthesis")) throw new Error("rewrite failed");
      if (String(prompt).startsWith("incident_enrichment")) return { data: script.enrichment, thinking: "" };
      if (schema === scoreOnlySchema) return { data: { quality_score: 1 }, thinking: "" };
      return { data: structuredClone(script.analysis), thinking: "" };
    });
    seed();
    await processJobItem("item1");
    expect(item()).toMatchObject({ status: "failed", failedStage: "rewrite" });
    expect(snaps("enriched")).toHaveLength(0);
  });

  it("records a failure in the convert stage", async () => {
    seed();
    const failing = vi.mocked(db.snapshot.create).mockRejectedValueOnce(new Error("disk full"));
    await processJobItem("item1");
    expect(failing).toHaveBeenCalled();
    expect(item()).toMatchObject({ status: "failed", failedStage: "convert", message: "disk full" });
    expect(stagesRun()).toEqual(["convert:error"]);
  });

  it("truncates a long error message to 1000 characters", async () => {
    script.onAnalysis = () => { throw new Error("e".repeat(5000)); };
    seed();
    await processJobItem("item1");
    expect(item().message).toHaveLength(1000);
  });

  it("can be restarted after a failure and then completes", async () => {
    let fail = true;
    script.onAnalysis = () => { if (fail) throw new Error("flaky"); };
    seed();
    await processJobItem("item1");
    expect(item().status).toBe("failed");
    fail = false;
    reclaim("item1", { restarts: 1 });
    await processJobItem("item1", "analyze");
    expect(item()).toMatchObject({ status: "completed", failedStage: null, message: null });
    expect(analysisOf().pipelineStage).toBe("ready");
    expect(snaps("converted")).toHaveLength(1);
  });

  it("does not fail when indexing for chat fails, but still records the index run", async () => {
    h.indexArticle.mockRejectedValue(new Error("no embeddings"));
    seed();
    await processJobItem("item1");
    expect(item().status).toBe("completed");
    expect(analysisOf().pipelineStage).toBe("ready");
    expect(stagesRun()).toContain("index:error");
    expect(console.warn).toHaveBeenCalledWith("[index] art1: no embeddings");
    expect(T.job[0].findingsGenerated).toBe(1);
  });

  it("does not fail when the stage-run record cannot be saved", async () => {
    vi.mocked(db.stageRun.create).mockRejectedValue(new Error("write failed"));
    seed();
    await processJobItem("item1");
    expect(item().status).toBe("completed");
  });

  it("throws only when the job item itself does not exist", async () => {
    await expect(processJobItem("ghost")).rejects.toThrow();
  });
});

describe("processJobItem: losing the claim", () => {
  it("stops quietly when another worker already holds the item", async () => {
    seed("1", { claimedBy: "someone-else", status: "analyzing" });
    await expect(processJobItem("item1")).resolves.toBeUndefined();
    expect(item()).toMatchObject({ status: "analyzing", claimedBy: "someone-else" });
    expect(T.analysis).toHaveLength(0);
    expect(T.snapshot).toHaveLength(0);
    expect(T.stageRun).toHaveLength(0);
    expect(h.chatJson).not.toHaveBeenCalled();
  });

  it("does not overwrite the new owner when the claim is lost mid-run", async () => {
    script.onAnalysis = () => { item().claimedBy = "new-worker"; item().status = "analyzing"; };
    seed();
    await processJobItem("item1");
    expect(item()).toMatchObject({ status: "analyzing", claimedBy: "new-worker", failedStage: null });
    expect(item().message).toBeNull();
    expect(analysisOf().pipelineStage).not.toBe("failed");
    expect(analysisOf().pipelineStage).not.toBe("ready");
    expect(calls("article_synthesis")).toHaveLength(0);
    expect(h.indexArticle).not.toHaveBeenCalled();
    expect(T.job[0].findingsGenerated).toBe(0);
  });

  it("records nothing when the first claim check fails", async () => {
    const lost = vi.mocked(db.jobItem.updateMany).mockImplementationOnce((async () => ({ count: 0 })) as never);
    seed();
    await processJobItem("item1");
    expect(lost).toHaveBeenCalled();
    expect(T.stageRun).toHaveLength(0);
    expect(item().status).toBe("converting");
  });

  it("exposes ClaimLostError for callers to recognise", () => {
    expect(new ClaimLostError()).toBeInstanceOf(Error);
  });
});

describe("processJobItem: heartbeat", () => {
  afterEach(() => vi.useRealTimers());

  it("stamps the heartbeat while a slow model call runs, only for the holder of a running item", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    script.onAnalysis = async () => {
      item().status = "analyzing";
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2 + 1);
    };
    seed();
    await processJobItem("item1");
    const beats = vi.mocked(db.jobItem.updateMany).mock.calls.filter((c) => (c[0] as Row).where.status?.in);
    expect(beats.length).toBeGreaterThanOrEqual(2);
    expect((beats[0][0] as Row).where).toMatchObject({ id: "item1", claimedBy: WORKER_ID });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops beating after a failure", async () => {
    vi.useFakeTimers();
    script.onAnalysis = () => { throw new Error("x"); };
    seed();
    await processJobItem("item1");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("swallows a failed heartbeat write", async () => {
    vi.useFakeTimers();
    script.onAnalysis = async () => {
      vi.mocked(db.jobItem.updateMany).mockRejectedValueOnce(new Error("beat failed"));
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS + 1);
    };
    seed();
    await processJobItem("item1");
    expect(item().status).toBe("completed");
  });
});
