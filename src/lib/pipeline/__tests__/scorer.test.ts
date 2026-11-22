import { describe, expect, it, vi } from "vitest";
import { scoreContent, type ScoreResult } from ".././scorer";

/**
 * Build filler prose with no pronoun openers, acronyms or back references.
 * @param n number of words wanted
 * @return text of exactly n words in short sentences
 */
function prose(n: number): string {
  const sentence = "Open the settings page and click save now.";
  const per = sentence.split(" ").length;
  const out: string[] = [];
  for (let i = 0; i < Math.ceil(n / per); i++) out.push(sentence);
  return out.join(" ").split(" ").slice(0, n).join(" ");
}

/** A clean, well-structured markdown document that should score full marks. */
const GOOD = `# Reset a password

${prose(40)}

## Verify the account

${prose(40)}
`;

/**
 * Score with detail on and assert success.
 * @param text content to score
 * @param opts option overrides
 * @return the successful result
 */
function detail(text: string, opts: Parameters<typeof scoreContent>[1] = {}) {
  const r = scoreContent(text, { detail: true, ...opts });
  expect(r.ok).toBe(true);
  return r as ScoreResult & { findings: NonNullable<ScoreResult["findings"]>; stats: NonNullable<ScoreResult["stats"]>; breakdown: NonNullable<ScoreResult["breakdown"]> };
}

describe("scoreContent: refusal to score", () => {
  it.each([[""], [null], [undefined], ["   \n  "]])("returns EMPTY_CONTENT for %j", (input) => {
    const r = scoreContent(input as unknown as string);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("EMPTY_CONTENT");
    expect(r.score).toBeNull();
    expect(r.breakdown).toBeNull();
    expect(r.warnings).toEqual([]);
  });

  it("refuses text under 25 words and reports the count", () => {
    const r = scoreContent(prose(24));
    expect(r.ok).toBe(false);
    expect(r.error?.message).toBe("Not enough readable text to score: 24 words, minimum is 25.");
    expect(r.stats?.words).toBe(24);
  });

  it("scores text at exactly 25 words", () => {
    expect(scoreContent(prose(25)).ok).toBe(true);
  });

  it("honours a custom minWords", () => {
    expect(scoreContent(prose(10), { minWords: 5 }).ok).toBe(true);
    expect(scoreContent(prose(40), { minWords: 50 }).ok).toBe(false);
  });

  it("counts words after markup is stripped", () => {
    const r = scoreContent("<p><b>one</b> two</p>");
    expect(r.stats?.words).toBe(2);
  });

  it("ignores script, style and comment content when counting", () => {
    const html = `<script>${prose(100)}</script><style>${prose(100)}</style><!-- ${prose(100)} --><p>hello</p>`;
    expect(scoreContent(html).stats?.words).toBe(1);
  });
});

describe("scoreContent: envelope", () => {
  it("scores a clean document 100 with a full breakdown", () => {
    const r = scoreContent(GOOD);
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
    expect(r.score).toBe(100);
    expect(r.breakdown).toEqual({ self_containedness: 30, chunk_geometry: 25, cleanliness: 20, completeness: 15, reference_integrity: 10 });
    expect(r.warnings).toEqual([]);
  });

  it("omits findings unless detail is set, and includes stats", () => {
    const r = scoreContent(GOOD);
    expect(r.findings).toBeUndefined();
    expect(r.stats?.words).toBeGreaterThan(80);
    expect(r.stats?.wordCount).toBe(r.stats?.words);
  });

  it("adds findings for all five criteria when detail is set", () => {
    const r = detail(GOOD);
    expect(Object.keys(r.findings).sort()).toEqual(["chunk_geometry", "cleanliness", "completeness", "reference_integrity", "self_containedness"]);
  });

  it("score equals the sum of the breakdown, rounded to two decimals", () => {
    const r = scoreContent(`<div style="x">It is bad.</div>\n${prose(60)} XYZ <img src="a.png">`);
    const b = r.breakdown!;
    const sum = b.self_containedness + b.chunk_geometry + b.cleanliness + b.completeness + b.reference_integrity;
    expect(r.score).toBeCloseTo(sum, 1);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("is deterministic and does not mutate shared state between calls", () => {
    const a = scoreContent(GOOD);
    scoreContent("<img src=x>" + prose(40));
    const b = scoreContent(GOOD);
    expect(b).toEqual(a);
  });

  it("does not leak option overrides into later calls", () => {
    scoreContent(prose(10), { minWords: 1 });
    expect(scoreContent(prose(10)).ok).toBe(false);
  });
});

describe("stats", () => {
  it("counts markdown and html headings separately", () => {
    const r = detail(`# One\n${prose(10)}\n<h2>Two</h2>\n${prose(20)}\n## Three\n${prose(10)}`);
    expect(r.stats.headings).toBe(3);
    expect(r.stats.headings_markdown).toBe(2);
    expect(r.stats.headings_html).toBe(1);
    expect(r.stats.sections).toBe(3);
  });

  it("counts images, tables, media and links", () => {
    const html = `<h1>T</h1>${prose(30)}<img src="a.png" alt="a">![b](b.png)<table><tr><th>h</th></tr><tr><td>x</td></tr></table><iframe src="v"></iframe><a href="https://e.test">e</a> [m](https://m.test) <https://auto.test>`;
    const r = detail(html);
    expect(r.stats.images).toBe(2);
    expect(r.stats.imageCount).toBe(2);
    expect(r.stats.tables).toBe(1);
    expect(r.stats.media).toBe(1);
    expect(r.stats.links).toBe(3);
    expect(r.stats.linkCount).toBe(3);
  });

  it("does not count a markdown image as a link", () => {
    const r = detail(`# T\n${prose(30)}\n![alt text here for the picture](x.png)`);
    expect(r.stats.links).toBe(0);
    expect(r.stats.images).toBe(1);
  });

  it("finds two adjacent markdown links", () => {
    const r = detail(`# T\n${prose(30)}\n[a](https://a.test)[b](https://b.test)`);
    expect(r.stats.links).toBe(2);
  });

  it("ignores an escaped markdown link", () => {
    const r = detail(`# T\n${prose(30)}\n\\[a](https://a.test)`);
    expect(r.stats.links).toBe(0);
  });

  it("never sets brokenLinkCount", () => {
    expect(scoreContent(GOOD).stats?.brokenLinkCount).toBeUndefined();
  });

  it("decodes entities before counting words", () => {
    const r = scoreContent(`<p>a&nbsp;b &amp; c &#65; &#x41; &unknown; d</p>`);
    // a b & c A A (space) d  => 7 words
    expect(r.stats?.words).toBe(7);
  });
});

describe("headings and sections", () => {
  it("warns NO_HEADINGS once and scores chunk geometry 0 for headless text", () => {
    const r = scoreContent(prose(80));
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({ code: "NO_HEADINGS", count: 1 });
    expect(r.breakdown?.chunk_geometry).toBe(0);
  });

  it("ignores empty headings", () => {
    const r = detail(`<h1></h1><h2> </h2>\n${prose(40)}`);
    expect(r.stats.headings).toBe(0);
  });

  it("strips closing hashes from a markdown heading", () => {
    const r = detail(`# Title ##\n${prose(40)}`);
    expect(r.findings.chunk_geometry.invalid_sections).toEqual([]);
    expect(r.stats.headings).toBe(1);
  });

  it("does not treat a hash without a space as a heading", () => {
    expect(detail(`#nope\n${prose(40)}`).stats.headings).toBe(0);
  });

  it("recognises html headings of any level", () => {
    const r = detail(`<h3>Deep</h3><p>${prose(40)}</p>`);
    expect(r.stats.headings_html).toBe(1);
    expect(r.breakdown.chunk_geometry).toBe(25);
  });

  it("does not double count markdown heading syntax inside an html heading", () => {
    const r = detail(`<h1>\n# x\n</h1>\n${prose(40)}`);
    expect(r.stats.headings).toBe(1);
  });

  it("flags text before the first heading as a headless section", () => {
    const r = detail(`${prose(30)}\n# Title\n${prose(30)}`);
    const inv = r.findings.chunk_geometry.invalid_sections as { section: string; reason: string }[];
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ section: "(text before first heading)", reason: "no heading" });
    expect(r.breakdown.chunk_geometry).toBe(12.5);
  });

  it("does not create a leading section for whitespace before the first heading", () => {
    const r = detail(`\n\n   \n# Title\n${prose(40)}`);
    expect(r.stats.sections).toBe(1);
  });
});

describe("C1 self-containedness", () => {
  const withSection = (first: string) => `# Topic\n${first} ${prose(40)}`;
  const openers = (text: string) => detail(text).findings.self_containedness.dangling_openers as { pronoun: string }[];

  it.each([
    ["It crashes when saving.", "it"],
    ["Its value is read first.", "its"],
    ["They must sign in.", "they"],
    ["Their settings differ.", "their"],
    ["Such cases are rare.", "such"],
    ["This is required.", "this"],
    ["These are required.", "these"],
    ["That was removed.", "that"],
    ["This.", "this"],
  ])("flags the opener %j", (first, pronoun) => {
    expect(openers(withSection(first)).map((o) => o.pronoun)).toEqual([pronoun]);
  });

  it.each([
    ["This procedure resets the account."],
    ["These steps reset the account."],
    ["That setting controls access."],
    ["It is important to back up first."],
    ["It's recommended to back up first."],
    ["It can be useful to back up first."],
    ["Open the page."],
  ])("accepts the opener %j", (first) => {
    expect(openers(withSection(first))).toEqual([]);
  });

  it("reports the section name and the start of the sentence", () => {
    const o = detail(withSection("It crashes.")).findings.self_containedness.dangling_openers as { section: string; opens_with: string }[];
    expect(o[0].section).toBe("Topic");
    expect(o[0].opens_with.startsWith("It crashes.")).toBe(true);
  });

  it("only checks the first sentence of each section", () => {
    expect(openers(`# T\nOpen the page. It crashes. ${prose(40)}`)).toEqual([]);
  });

  it("counts back-reference phrases and lists unique examples", () => {
    const text = `# T\n${prose(30)} See above. As mentioned earlier, wait. The above is true. See above.`;
    const f = detail(text).findings.self_containedness;
    expect(f.back_reference_phrases).toBe(4);
    expect(f.back_reference_examples).toEqual(["See above", "As mentioned earlier", "The above"]);
  });

  it("matches the other back-reference forms", () => {
    const phrases = ["see below", "as described above", "shown earlier", "the previous step", "the following section", "in the next section", "see the previous section", "mentioned above"];
    for (const p of phrases) {
      const f = detail(`# T\n${prose(30)} Then ${p} now.`).findings.self_containedness;
      expect(f.back_reference_phrases, p).toBe(1);
    }
  });

  it("flags unknown acronyms but not known ones or stop words", () => {
    const f = detail(`# T\n${prose(30)} Use the XYZ tool and the API. NOTE this. DO NOT skip.`).findings.self_containedness;
    expect(f.unexpanded_acronyms).toEqual(["XYZ"]);
  });

  it("accepts an acronym expanded in parentheses either way", () => {
    const a = detail(`# T\n${prose(30)} Use Foo Bar Tool (XYZ) now. XYZ here.`).findings.self_containedness;
    const b = detail(`# T\n${prose(30)} XYZ (Foo Bar Tool) is used.`).findings.self_containedness;
    expect(a.unexpanded_acronyms).toEqual([]);
    expect(b.unexpanded_acronyms).toEqual([]);
  });

  it("does not flag capitalised words or single letters", () => {
    const f = detail(`# T\n${prose(30)} Hello World A B Okay.`).findings.self_containedness;
    expect(f.unexpanded_acronyms).toEqual([]);
  });

  it("uses a words floor of 250 for the rate so one hit does not zero a short doc", () => {
    const f = detail(`# T\n${prose(40)} See above.`).findings.self_containedness;
    expect(f.hits).toBe(1);
    expect(f.rate_basis_words).toBe(250);
    expect(f.rate_per_1000_words).toBe(4);
  });

  it("scores 15 points at half the ceiling and 0 at or above it", () => {
    // 250-word floor: 1 hit = 4 per 1000. 2 hits = 8 = ceiling.
    const one = detail(`# T\n${prose(40)} See above.`);
    expect(one.breakdown.self_containedness).toBe(15);
    const two = detail(`# T\n${prose(40)} See above. See below.`);
    expect(two.breakdown.self_containedness).toBe(0);
    const many = detail(`# T\n${prose(40)} See above. See below. See above. See below.`);
    expect(many.breakdown.self_containedness).toBe(0);
  });

  it("respects a custom hitRateCeiling", () => {
    const r = detail(`# T\n${prose(40)} See above.`, { hitRateCeiling: 100 });
    expect(r.breakdown.self_containedness).toBeCloseTo(28.8, 1);
  });
});

describe("C2 chunk geometry", () => {
  it("is full when every section has a heading and fits the token cap", () => {
    expect(detail(GOOD).breakdown.chunk_geometry).toBe(25);
  });

  it("marks a section over the token cap invalid", () => {
    const r = detail(`# Big\n${prose(500)}\n# Small\n${prose(100)}`);
    const inv = r.findings.chunk_geometry.invalid_sections as { section: string; reason: string; tokens: number }[];
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ section: "Big", reason: "over token cap" });
    expect(inv[0].tokens).toBeGreaterThan(512);
    expect(r.findings.chunk_geometry.coverage).toBeCloseTo(100 / 600, 2);
    expect(r.breakdown.chunk_geometry).toBeCloseTo(25 * (100 / 600), 1);
  });

  it("allows a larger cap through options", () => {
    const r = detail(`# Big\n${prose(500)}`, { maxSectionTokens: 1000 });
    expect(r.breakdown.chunk_geometry).toBe(25);
  });

  it("uses the character estimate when it is worse than the word estimate", () => {
    // 40 words but very long ones: 40 * 60 chars / 4 = 600 tokens.
    const dense = Array.from({ length: 40 }, () => "a".repeat(59)).join(" ");
    const r = detail(`# Dense\n${dense}`);
    const inv = r.findings.chunk_geometry.invalid_sections as { tokens: number }[];
    expect(inv).toHaveLength(1);
    expect(inv[0].tokens).toBeGreaterThan(512);
  });

  it("skips empty sections", () => {
    const r = detail(`# Empty\n# Full\n${prose(40)}`);
    expect(r.findings.chunk_geometry.total_words).toBe(40);
    expect(r.breakdown.chunk_geometry).toBe(25);
  });
});

describe("C3 cleanliness", () => {
  it("is full for clean markdown", () => {
    expect(detail(GOOD).breakdown.cleanliness).toBe(20);
  });

  it("penalises heavy markup overhead", () => {
    const html = `<h1>T</h1>` + Array.from({ length: 30 }, () => `<span class="a b c d e f g h i j k l m n o p"><i>word</i></span>`).join(" ") + ` ${prose(0)}`;
    const r = detail(html, { minWords: 5 });
    expect(r.findings.cleanliness.markup_overhead as number).toBeGreaterThan(0.5);
    expect(r.breakdown.cleanliness).toBeLessThan(20);
  });

  it("counts each junk pattern", () => {
    const html = [
      `<h1>T</h1>`,
      `<p style="color:red">x</p>`,
      `<p class="MsoNormal">y</p>`,
      `<font>f</font><center>c</center>`,
      `<p></p><div> </div><span>&nbsp;</span>`,
      `<p>&#8217;</p>`,
      `<p>a​b</p>`,
      prose(40),
    ].join("\n");
    const b = detail(html).findings.cleanliness.junk_breakdown as Record<string, number>;
    expect(b.inline_styles).toBe(1);
    expect(b.word_artifacts).toBe(1);
    expect(b.legacy_tags).toBe(4);
    expect(b.empty_blocks).toBe(3);
    expect(b.numeric_entities).toBe(1);
    expect(b.zero_width_chars).toBe(1);
    expect(b.base64_payloads).toBe(0);
  });

  it("detects base64 payloads and div soup", () => {
    const html = `<h1>T</h1><img src="data:image/png;base64,${"A".repeat(250)}" alt="a long enough alt text here ok"><div><div><div><div>${prose(40)}</div></div></div></div>`;
    const b = detail(html).findings.cleanliness.junk_breakdown as Record<string, number>;
    expect(b.base64_payloads).toBe(1);
    expect(b.div_soup).toBe(1);
  });

  it("lowers the score as junk rises and reports examples", () => {
    const clean = detail(GOOD).breakdown.cleanliness;
    const junk = Array.from({ length: 10 }, () => `<p style="a">x</p>`).join("");
    const r = detail(`# T\n${junk}\n${prose(40)}`);
    expect(r.breakdown.cleanliness).toBeLessThan(clean);
    expect((r.findings.cleanliness.junk_examples as string[])[0]).toMatch(/^inline_styles: /);
  });

  it("scores the junk part zero when junk is far above the ceiling", () => {
    const junk = Array.from({ length: 100 }, () => `<p style="a">x</p>`).join("");
    const r = detail(`# T\n${prose(40)}${junk}`, { markupOverheadFloor: 0.99, markupOverheadCeiling: 1 });
    expect(r.findings.cleanliness.junk_score).toBe(0);
  });
});

describe("C4 completeness", () => {
  const body = prose(40);

  it("gives full marks when there are no objects", () => {
    const f = detail(GOOD).findings.completeness;
    expect(f).toMatchObject({ objects: 0, covered: 0, uncovered: [] });
  });

  it("flags an image with no alt and no following prose", () => {
    const r = detail(`# T\n${body}\n<img src="/path/shot.png">`);
    const f = r.findings.completeness as { uncovered: { type: string; detail: string; reason: string }[] };
    expect(f.uncovered).toEqual([{ type: "image", detail: "shot.png", reason: "no alt attribute and no prose restatement" }]);
    expect(r.breakdown.completeness).toBe(0);
  });

  it("reports empty alt and short alt reasons", () => {
    const empty = detail(`# T\n${body}\n<img src="a.png" alt="">`).findings.completeness as { uncovered: { reason: string }[] };
    expect(empty.uncovered[0].reason).toBe("empty alt text and no prose restatement");
    const short = detail(`# T\n${body}\n<img src="a.png" alt="two words">`).findings.completeness as { uncovered: { reason: string }[] };
    expect(short.uncovered[0].reason).toBe("alt text too short (2 words) and no prose restatement");
  });

  it("accepts an alt of five or more words", () => {
    const r = detail(`# T\n${body}\n<img src="a.png" alt="the login page with fields">`);
    expect(r.breakdown.completeness).toBe(15);
  });

  it("accepts an image restated by 20 following words", () => {
    const r = detail(`# T\n${body}\n<img src="a.png">\n${prose(20)}`);
    expect(r.breakdown.completeness).toBe(15);
  });

  it("stops the restatement window at the next image so one caption covers one figure", () => {
    const r = detail(`# T\n${body}\n<img src="a.png">\n<img src="b.png">\n${prose(30)}`);
    const f = r.findings.completeness as { objects: number; covered: number };
    expect(f.objects).toBe(2);
    expect(f.covered).toBe(1);
    expect(r.breakdown.completeness).toBe(7.5);
  });

  it("excludes decorative images from the count", () => {
    const html = [
      `<img src="a.png" width="16">`,
      `<img src="b.png" height="32">`,
      `<img src="c.png" role="presentation">`,
      `<img src="d.png" role="none">`,
      `<img src="e.png" aria-hidden="TRUE">`,
      `<img src="spacer.gif" alt="">`,
    ].join("\n");
    const f = detail(`# T\n${body}\n${html}`).findings.completeness;
    expect(f).toMatchObject({ objects: 0, decorative_excluded: 6 });
  });

  it("does not treat a wide image or a spacer name with real alt as decorative", () => {
    const f = detail(`# T\n${body}\n<img src="a.png" width="400">\n<img src="logo.png" alt="Company logo shown at the top">`).findings.completeness;
    expect(f).toMatchObject({ objects: 2, decorative_excluded: 0 });
  });

  it("falls back to data-src for the image name and labels a missing src", () => {
    const f = detail(`# T\n${body}\n<img data-src="x/lazy.png">\n<img alt="">`).findings.completeness as { uncovered: { detail: string }[] };
    expect(f.uncovered.map((u) => u.detail)).toEqual(["lazy.png", "(no src)"]);
  });

  it("scores markdown images, treating empty alt with a decorative name as decorative", () => {
    const f = detail(`# T\n${body}\n![](icon.png)\n![](photo.png)\n![a screenshot of the main login page](ok.png)`).findings.completeness as { objects: number; covered: number; decorative_excluded: number };
    expect(f).toMatchObject({ objects: 2, covered: 1, decorative_excluded: 1 });
  });

  it("flags tables without header cells", () => {
    const r = detail(`# T\n${body}\n<table><tr><td>a</td></tr><tr><td>b</td></tr></table>`);
    const f = r.findings.completeness as { uncovered: { type: string; detail: string; reason: string }[] };
    expect(f.uncovered[0]).toMatchObject({ type: "table", detail: "2 rows, no headers" });
    expect(f.uncovered[0].reason).toMatch(/no <th> header cells/);
  });

  it("accepts a simple table with headers", () => {
    const r = detail(`# T\n${body}\n<table><tr><th>h</th></tr><tr><td>a</td></tr></table>`);
    expect(r.breakdown.completeness).toBe(15);
  });

  it("flags a merged-cell table lacking prose but accepts it with restatement", () => {
    const table = `<table><tr><th colspan="2">h</th></tr><tr><td>a</td><td>b</td></tr></table>`;
    const bad = detail(`# T\n${body}\n${table}`).findings.completeness as { uncovered: { detail: string; reason: string }[] };
    expect(bad.uncovered[0].detail).toBe("2 rows, merged cells");
    expect(bad.uncovered[0].reason).toBe("merged or spanned cells with no prose restatement");
    expect(detail(`# T\n${body}\n${table}\n${prose(25)}`).breakdown.completeness).toBe(15);
  });

  it("treats single-row and presentation tables as decorative", () => {
    const f = detail(`# T\n${body}\n<table><tr><td>a</td></tr></table><table role="presentation"><tr><td>a</td></tr><tr><td>b</td></tr></table>`).findings.completeness;
    expect(f).toMatchObject({ objects: 0, decorative_excluded: 2 });
  });

  it("can waive header requirement via options", () => {
    const r = detail(`# T\n${body}\n<table><tr><td>a</td></tr><tr><td>b</td></tr></table>`, { requireTableHeaders: false });
    expect(r.breakdown.completeness).toBe(15);
  });

  it("flags media without nearby text and accepts it with text", () => {
    const bad = detail(`# T\n${body}\n<video src="movie.mp4"></video>`).findings.completeness as { uncovered: { type: string; detail: string; reason: string }[] };
    expect(bad.uncovered[0]).toEqual({ type: "video", detail: "movie.mp4", reason: "embedded media with no text equivalent nearby" });
    expect(detail(`# T\n${body}\n<iframe src="x"></iframe>\n${prose(25)}`).breakdown.completeness).toBe(15);
  });

  it("excludes aria-hidden media", () => {
    const f = detail(`# T\n${body}\n<iframe src="x" aria-hidden="true"></iframe>`).findings.completeness;
    expect(f).toMatchObject({ objects: 0, decorative_excluded: 1 });
  });

  it("scores the covered fraction", () => {
    const r = detail(`# T\n${body}\n<img src="a.png" alt="a clear description of the page">\n<table><tr><td>a</td></tr><tr><td>b</td></tr></table>`);
    expect(r.breakdown.completeness).toBe(7.5);
  });
});

describe("C5 reference integrity", () => {
  const body = `# T\n${prose(40)}\n`;
  const ri = (text: string, opts?: Parameters<typeof scoreContent>[1]) => detail(text, opts);

  it("is full with no links", () => {
    expect(ri(body).breakdown.reference_integrity).toBe(10);
    expect(ri(body).findings.reference_integrity.link_resolution).toBe("disabled");
  });

  it("counts external links without penalty", () => {
    const r = ri(`${body}<a href="https://example.test/x">x</a>`);
    expect(r.findings.reference_integrity).toMatchObject({ external_excluded: 1, internal_kb_links: 0, total_links: 1 });
    expect(r.breakdown.reference_integrity).toBe(10);
  });

  it.each([[""], ["#"], ["javascript:void(0)"], ["undefined"], ["null"]])("treats href %j as malformed", (href) => {
    const r = ri(`${body}<a href="${href}">x</a>`);
    const f = r.findings.reference_integrity as { malformed: string[] };
    expect(f.malformed).toHaveLength(1);
    expect(r.breakdown.reference_integrity).toBe(0);
  });

  it("labels an empty href", () => {
    const f = ri(`${body}<a>x</a>`).findings.reference_integrity as { malformed: string[] };
    expect(f.malformed).toEqual(["(empty href)"]);
  });

  it("recognises KB links in three forms and assumes them fine without a checker", () => {
    const links = [
      `<a href="/kb_view.do?sysparm_article=KB0012345">a</a>`,
      `<a href="/x?sys_id=${"a".repeat(32)}">b</a>`,
      `<a href="/kb/KB0054321">c</a>`,
    ].join("");
    const r = ri(body + links);
    expect(r.findings.reference_integrity).toMatchObject({ internal_kb_links: 3, resolvable: 3, dead_internal: [] });
    expect(r.breakdown.reference_integrity).toBe(10);
  });

  it("asks isLinkBroken once per distinct reference and reports dead links", () => {
    const isLinkBroken = vi.fn((href: string) => href.includes("KB0000002"));
    const links = [
      `<a href="/a?sysparm_article=KB0000001">1</a>`,
      `<a href="/b?sysparm_article=KB0000001">1 again</a>`,
      `<a href="/c?sysparm_article=KB0000002">2</a>`,
    ].join("");
    const r = ri(body + links, { isLinkBroken });
    expect(isLinkBroken).toHaveBeenCalledTimes(2);
    const f = r.findings.reference_integrity as { dead_internal: { ref: string }[]; resolvable: number; link_resolution: string };
    expect(f.link_resolution).toBe("enabled");
    expect(f.dead_internal.map((d) => d.ref)).toEqual(["KB0000002"]);
    expect(f.resolvable).toBe(2);
    expect(r.breakdown.reference_integrity).toBeCloseTo(6.67, 2);
  });

  it("combines broken and malformed in the denominator", () => {
    const r = ri(`${body}<a href="#">x</a><a href="/k?sysparm_article=KB0000009">y</a>`, { isLinkBroken: () => false });
    expect(r.breakdown.reference_integrity).toBe(5);
  });

  it("reads markdown links and autolinks too", () => {
    const r = ri(`${body}[kb](/a?sysparm_article=KB0000003) <mailto:a@b.test>`);
    expect(r.findings.reference_integrity).toMatchObject({ total_links: 2, internal_kb_links: 1 });
  });

  it("does not count non-http links without a KB reference as external", () => {
    const f = ri(`${body}<a href="/relative/page">x</a>`).findings.reference_integrity;
    expect(f).toMatchObject({ external_excluded: 0, internal_kb_links: 0 });
  });
});

describe("parsing details", () => {
  it("handles single-quoted and unquoted attributes", () => {
    const r = detail(`# T\n${prose(40)}\n<img src='a.png' alt='five words are in this alt'>\n<img src=b.png alt=x>`);
    const f = r.findings.completeness as { objects: number; covered: number };
    expect(f.objects).toBe(2);
    expect(f.covered).toBe(1);
  });

  it("is case-insensitive about tags", () => {
    const r = detail(`<H1>Title</H1>${prose(40)}<IMG SRC="a.png" ALT="a b c d e">`);
    expect(r.stats.headings).toBe(1);
    expect(r.stats.images).toBe(1);
  });

  it("does not hang on malformed or unclosed markup", () => {
    const r = scoreContent(`<h1>Oops ${prose(40)} <a href="x <table><tr>`);
    expect(r.ok).toBe(true);
  });

  it("splits sentences without breaking on abbreviations", () => {
    // If "e.g." split the sentence, the next fragment "it ..." would be seen as a first sentence only for the first sentence of a section, so test via the first sentence.
    const r = detail(`# T\nUse tools, e.g. Foo and Bar, to reset. ${prose(40)}`);
    expect(r.findings.self_containedness.dangling_openers).toEqual([]);
  });

  it("handles very large input in reasonable time", () => {
    const start = Date.now();
    const r = scoreContent(`# T\n${prose(20000)}`);
    expect(r.ok).toBe(true);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});
