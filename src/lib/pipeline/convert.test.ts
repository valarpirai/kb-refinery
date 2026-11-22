import { describe, expect, it } from "vitest";
import { toMarkdown } from "./convert";

describe("toMarkdown", () => {
  it("passes markdown through, trimmed", () => {
    expect(toMarkdown("  # Title\n\ntext  \n", "markdown")).toBe("# Title\n\ntext");
  });

  it("passes plain text through for any non-html format", () => {
    expect(toMarkdown("<b>not html</b>", "text")).toBe("<b>not html</b>");
  });

  it("converts headings to atx style", () => {
    expect(toMarkdown("<h1>Title</h1><h2>Sub</h2>", "html")).toBe("# Title\n\n## Sub");
  });

  it("converts lists with dash bullets", () => {
    const out = toMarkdown("<ul><li>a</li><li>b</li></ul>", "html");
    expect(out).toMatch(/^-\s+a\n-\s+b$/);
  });

  it("converts code blocks to fenced style", () => {
    const out = toMarkdown("<pre><code>x = 1</code></pre>", "html");
    expect(out).toBe("```\nx = 1\n```");
  });

  it("converts tables using the gfm plugin", () => {
    const out = toMarkdown("<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>", "html");
    expect(out).toContain("| A | B |");
    expect(out).toContain("| 1 | 2 |");
  });

  it("removes script, style and noscript content", () => {
    const out = toMarkdown("<p>keep</p><script>alert(1)</script><style>p{}</style><noscript>nojs</noscript>", "html");
    expect(out).toBe("keep");
  });

  it("returns an empty string for empty html", () => {
    expect(toMarkdown("", "html")).toBe("");
    expect(toMarkdown("   ", "markdown")).toBe("");
  });

  it("converts links and images", () => {
    const out = toMarkdown('<a href="https://x.test">go</a> <img src="a.png" alt="pic">', "html");
    expect(out).toBe("[go](https://x.test) ![pic](a.png)");
  });
});
