import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { $queryRaw: vi.fn() } }));

import { db } from "@/lib/db";
import { keywordQuery, retrieve } from ".././retrieve";

const row = (id: string, score = 0.8) => ({ id, articleId: `a-${id}`, analysisId: `an-${id}`, title: `T${id}`, heading: null, content: `C${id}`, score });
const queryRaw = () => vi.mocked(db.$queryRaw) as unknown as ReturnType<typeof vi.fn>;

describe("keywordQuery", () => {
  it("joins usable words with &", () => {
    expect(keywordQuery("VPN password reset")).toBe("vpn & password & reset");
  });
  it("drops words shorter than three characters", () => {
    expect(keywordQuery("how do I be ok")).toBe("how");
  });
  it("removes duplicates and punctuation", () => {
    expect(keywordQuery("Error, error E_42!")).toBe("error & e_42");
  });
  it("caps at twelve words", () => {
    const q = Array.from({ length: 20 }, (_, i) => `word${String.fromCharCode(97 + i)}`).join(" ");
    expect(keywordQuery(q).split(" & ")).toHaveLength(12);
  });
  it("returns an empty string when nothing is usable", () => {
    expect(keywordQuery("? !! a")).toBe("");
    expect(keywordQuery("")).toBe("");
  });
});

describe("retrieve", () => {
  it("skips the keyword search when the question has no usable word", async () => {
    queryRaw().mockResolvedValueOnce([row("1")]);
    const out = await retrieve("refined", [0.1], "?");
    expect(queryRaw()).toHaveBeenCalledTimes(1);
    expect(out).toEqual([{ n: 1, articleId: "a-1", analysisId: "an-1", title: "T1", heading: null, score: 0.8, excerpt: "C1" }]);
  });

  it("returns an empty list when nothing matches", async () => {
    queryRaw().mockResolvedValue([]);
    await expect(retrieve("original", [0.1], "vpn")).resolves.toEqual([]);
  });

  it("fuses both lists so a chunk in both ranks first", async () => {
    queryRaw().mockResolvedValueOnce([row("a"), row("b")]).mockResolvedValueOnce([row("b"), row("c")]);
    const out = await retrieve("refined", [0.1], "vpn issue");
    expect(out.map((s) => s.excerpt)).toEqual(["Cb", "Ca", "Cc"]);
    expect(out.map((s) => s.n)).toEqual([1, 2, 3]);
  });

  it("limits the result to five sources", async () => {
    queryRaw().mockResolvedValueOnce(Array.from({ length: 8 }, (_, i) => row(String(i)))).mockResolvedValueOnce([]);
    const out = await retrieve("refined", [0.1], "vpn issue");
    expect(out).toHaveLength(5);
  });

  it("drops vector hits below minScore but keeps keyword hits", async () => {
    queryRaw().mockResolvedValueOnce([row("low", 0.3), row("ok", 0.9)]).mockResolvedValueOnce([row("kw", 0.1)]);
    const out = await retrieve("refined", [0.1], "vpn issue", 0.6);
    expect(out.map((s) => s.excerpt).sort()).toEqual(["Ckw", "Cok"]);
  });

  it("converts string scores to numbers", async () => {
    queryRaw().mockResolvedValueOnce([row("1", "0.75" as unknown as number)]);
    const [s] = await retrieve("refined", [0.1], "?");
    expect(s.score).toBe(0.75);
  });

  it("passes the vector literal and tags into the query", async () => {
    queryRaw().mockResolvedValueOnce([]);
    await retrieve("refined", [0.5, 0.25], "?", 0, ["vpn"]);
    const values = queryRaw().mock.calls[0].slice(1).flat(Infinity);
    expect(values).toContain("[0.5,0.25]");
    expect(values).toContain("refined");
  });
});
