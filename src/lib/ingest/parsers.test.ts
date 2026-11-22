import { describe, expect, it } from "vitest";
import { parseArticleFile, parseFile, parseIncidentFile } from "./parsers";

describe("parseArticleFile markdown", () => {
  it("reads front matter fields", () => {
    const text = "---\nid: KB1\ntitle: Reset\nkb: IT\nurl: http://x/y\nupdated: 2024-01-02\n---\n# Heading\nBody here\n";
    const { items, errors } = parseArticleFile("a.md", text);
    expect(errors).toEqual([]);
    expect(items[0]).toMatchObject({ externalId: "KB1", title: "Reset", knowledgeBase: "IT", url: "http://x/y", format: "md" });
    expect(items[0].body).toBe("# Heading\nBody here");
    expect(items[0].sourceUpdatedAt?.getUTCFullYear()).toBe(2024);
  });

  it("falls back to the first heading, then the file name", () => {
    expect(parseArticleFile("dir/a.md", "# My Title\ntext").items[0].title).toBe("My Title");
    const bare = parseArticleFile("C:\\docs\\notes.markdown", "no heading").items[0];
    expect(bare.title).toBe("notes");
    expect(bare.externalId).toBe("notes");
  });

  it("ignores an invalid updated date", () => {
    const item = parseArticleFile("a.md", "---\nupdated: nonsense\n---\nx").items[0];
    expect(item.sourceUpdatedAt).toBeUndefined();
  });
});

describe("parseArticleFile html and text", () => {
  it("uses the title tag and keeps the whole document", () => {
    const html = "<html><head><title> Hello <b>World</b> </title></head><body><h1>Other</h1></body></html>";
    const item = parseArticleFile("p.html", html).items[0];
    expect(item.title).toBe("Hello World");
    expect(item.body).toBe(html);
    expect(item.format).toBe("html");
  });

  it("falls back to h1 and then the file name", () => {
    expect(parseArticleFile("p.htm", "<h1 class='x'>Top</h1>").items[0].title).toBe("Top");
    expect(parseArticleFile("page.htm", "<p>hi</p>").items[0].title).toBe("page");
    expect(parseArticleFile("page.html", "<title> </title>").items[0].title).toBe("page");
  });

  it("parses plain text", () => {
    const item = parseArticleFile("n.txt", "  hello \n").items[0];
    expect(item).toEqual({ externalId: "n", title: "n", body: "hello", format: "text" });
  });

  it("rejects unsupported types", () => {
    const r = parseArticleFile("a.pdf", "x");
    expect(r.items).toEqual([]);
    expect(r.errors[0]).toContain("unsupported file type");
  });

  it("is case-insensitive about extensions", () => {
    expect(parseArticleFile("A.MD", "# T").items).toHaveLength(1);
  });
});

describe("parseArticleFile csv and json", () => {
  it("maps CSV columns with loose header names", () => {
    const csv = "ID,Title,Body,Knowledge Base,Updated At\n1,One,<p>hi</p>,IT,2024-03-04\n2,Two,plain,,\n";
    const { items, errors } = parseArticleFile("a.csv", csv);
    expect(errors).toEqual([]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ externalId: "1", title: "One", format: "html", knowledgeBase: "IT" });
    expect(items[0].sourceUpdatedAt).toBeInstanceOf(Date);
    expect(items[1]).toMatchObject({ format: "md", knowledgeBase: undefined, sourceUpdatedAt: undefined });
  });

  it("honours a declared format and rejects unknown ones", () => {
    const json = JSON.stringify([
      { title: "a", body: "<p>x</p>", format: "TEXT" },
      { title: "b", body: "x", format: "docx" },
    ]);
    const items = parseArticleFile("a.json", json).items;
    expect(items[0].format).toBe("text");
    expect(items[1].format).toBe("md");
  });

  it("accepts a wrapped articles list or items list", () => {
    const row = { title: "t", body: "b" };
    expect(parseArticleFile("a.json", JSON.stringify({ articles: [row] })).items).toHaveLength(1);
    expect(parseArticleFile("a.json", JSON.stringify({ items: [row] })).items).toHaveLength(1);
  });

  it("reports rows missing body or title and keeps good rows", () => {
    const json = JSON.stringify([{ title: "t" }, { body: "b" }, { title: "ok", body: "b" }]);
    const { items, errors } = parseArticleFile("a.json", json);
    expect(items).toHaveLength(1);
    expect(errors).toEqual(["row 1: no body/content column", "row 2: no title column"]);
  });

  it("skips blank values when picking columns", () => {
    const json = JSON.stringify([{ body: "  ", content: "real", title: "t" }]);
    expect(parseArticleFile("a.json", json).items[0].body).toBe("real");
  });

  it("reports invalid JSON and wrong shapes", () => {
    expect(parseArticleFile("a.json", "{nope").errors[0]).toMatch(/^invalid JSON/);
    expect(parseArticleFile("a.json", '{"x":1}').errors[0]).toContain('{ "articles": [...] }');
    expect(parseArticleFile("a.json", "null").errors).toHaveLength(1);
  });

  it("surfaces CSV parse errors", () => {
    const { errors } = parseArticleFile("a.csv", 'title,body\n"unterminated,x\n');
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("parseIncidentFile", () => {
  it("maps incident columns", () => {
    const csv = "Number,Short Description,Description,Close Notes,Category,Opened At\nINC1,VPN down,details,fixed,Network,2024-05-06\n";
    const { items, errors } = parseIncidentFile("i.csv", csv);
    expect(errors).toEqual([]);
    expect(items[0]).toMatchObject({ number: "INC1", shortDescription: "VPN down", description: "details", resolution: "fixed", category: "Network" });
    expect(items[0].openedAt).toBeInstanceOf(Date);
  });

  it("reads JSON with an incidents key", () => {
    const json = JSON.stringify({ incidents: [{ id: "I2", summary: "s", solution: "r" }] });
    expect(parseIncidentFile("i.json", json).items[0]).toMatchObject({ number: "I2", shortDescription: "s", resolution: "r" });
  });

  it("reports missing number and description", () => {
    const json = JSON.stringify([{ shortDescription: "s" }, { number: "N" }]);
    expect(parseIncidentFile("i.json", json).errors).toEqual(["row 1: no number/id column", "row 2: no short_description column"]);
  });

  it("rejects other file types", () => {
    const r = parseIncidentFile("i.md", "x");
    expect(r.items).toEqual([]);
    expect(r.errors[0]).toContain("incidents need a CSV or JSON file");
  });
});

describe("parseFile", () => {
  it("dispatches on kind", () => {
    expect(parseFile("articles", "a.txt", "x").items[0]).toMatchObject({ format: "text" });
    expect(parseFile("incidents", "a.txt", "x").errors).toHaveLength(1);
  });
});
