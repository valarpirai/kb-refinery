/**
 * AI / RAG readability scorer (port of the AIReadabilityScorer script include).
 *
 * Scores raw HTML or markdown out of 100 across five weighted criteria:
 * C1 self-containedness 30, C2 chunk geometry 25, C3 cleanliness 20,
 * C4 completeness 15, C5 reference integrity 10.
 *
 * Pure functions only. Parsing is regex based, exactly like the original.
 * Internal KB link verification is delegated to an optional callback.
 */

// ================================================================ types

export interface ScorerOptions {
  /** true adds findings and the full stats block to the result. */
  detail: boolean;
  /** Below this many words the scorer refuses to score. */
  minWords: number;
  /** C1: hits per 1,000 words that scores zero. */
  hitRateCeiling: number;
  /** C1/C3: rate denominator floor for short documents. */
  minWordsForRate: number;
  /** C2: max tokens allowed in one section. */
  maxSectionTokens: number;
  tokensPerWord: number;
  /** C3: markup fraction at or below which gets full credit. */
  markupOverheadFloor: number;
  /** C3: markup fraction at or above which gets no credit. */
  markupOverheadCeiling: number;
  /** C3: junk hits per 1,000 words that scores zero. */
  junkCeiling: number;
  minAltWords: number;
  minRestatementWords: number;
  /** Measured in text words, not HTML characters. */
  restatementWindowWords: number;
  decorativeMaxPx: number;
  requireTableHeaders: boolean;
  knownAcronyms: string[];
  /** All-caps English words that are not acronyms. */
  capsStopWords: string[];
  decorativePattern: RegExp;
  /**
   * Replaces the original instance-side link resolution. Called once per
   * distinct internal KB link (sysparm_article, sys_id or KB number
   * references). Return true when the target is broken. When absent, every
   * link is assumed fine.
   */
  isLinkBroken?: (url: string) => boolean;
}

export interface ScoreBreakdown {
  self_containedness: number;
  chunk_geometry: number;
  cleanliness: number;
  completeness: number;
  reference_integrity: number;
}

export interface ScoreWarning {
  code: string;
  message: string;
  count: number;
}

export interface ScoreStats {
  words: number;
  chars: number;
  sections: number;
  headings: number;
  headings_markdown: number;
  headings_html: number;
  images: number;
  tables: number;
  media: number;
  links: number;
  /** Aliases the pipeline stores per snapshot. */
  wordCount: number;
  imageCount: number;
  linkCount: number;
  /** Filled in by the caller after its own link checking; never set here. */
  brokenLinkCount?: number;
}

export interface ScoreFindings {
  self_containedness: Record<string, unknown>;
  chunk_geometry: Record<string, unknown>;
  cleanliness: Record<string, unknown>;
  completeness: Record<string, unknown>;
  reference_integrity: Record<string, unknown>;
}

export interface ScoreError {
  code: string;
  message: string;
}

export interface ScoreResult {
  ok: boolean;
  error: ScoreError | null;
  warnings: ScoreWarning[];
  score: number | null;
  breakdown: ScoreBreakdown | null;
  /** Present only when options.detail is true. */
  findings?: ScoreFindings;
  /** Always present on success; on failure only when options.detail is true. */
  stats?: ScoreStats;
}

interface RawWarning {
  code: string;
  message: string;
}

interface Heading {
  level: number;
  text: string;
  start: number;
  end: number;
  syntax: 'html' | 'markdown';
}

interface Section {
  heading: string | null;
  level: number;
  syntax: 'html' | 'markdown' | null;
  html: string;
  text: string;
}

interface DocObject {
  type: string;
  label: string;
  decorative: boolean;
  covered: boolean;
  reason: string | null;
}

interface DocLink {
  href: string;
  anchor: string;
  syntax: 'html' | 'markdown' | 'autolink';
}

interface ParsedDoc {
  clean: string;
  text: string;
  warnings: RawWarning[];
  headings: Heading[];
  sections: Section[];
  images: DocObject[];
  tables: DocObject[];
  media: DocObject[];
  links: DocLink[];
  stats: ScoreStats;
}

interface CriterionResult {
  points: number;
  detail: Record<string, unknown>;
  warnings?: RawWarning[];
}

// ============================================================== defaults

const DEFAULTS: ScorerOptions = {
  detail: false,
  minWords: 25,
  hitRateCeiling: 8,
  minWordsForRate: 250,
  maxSectionTokens: 512,
  tokensPerWord: 1.3,
  markupOverheadFloor: 0.5,
  markupOverheadCeiling: 0.9,
  junkCeiling: 25,
  minAltWords: 5,
  minRestatementWords: 20,
  restatementWindowWords: 60,
  decorativeMaxPx: 32,
  requireTableHeaders: true,
  knownAcronyms: [
    'AI', 'API', 'URL', 'ID', 'OK', 'FAQ', 'PDF', 'HTML', 'CSV', 'JSON',
    'HTTP', 'HTTPS', 'IT', 'PC', 'USB', 'FYI', 'CEO', 'CTO', 'US', 'UK',
    'EU', 'AM', 'PM', 'UTC', 'GMT', 'SSO', 'VPN', 'CPU', 'RAM', 'OS',
    'KB', 'CMDB', 'ITSM', 'ITIL', 'SLA', 'CI', 'RITM', 'CHG', 'INC',
    'SN', 'MID', 'ACL', 'UI', 'MFA', 'LDAP', 'SAML', 'REST',
  ],
  capsStopWords: [
    'NOTE', 'NOTES', 'DO', 'NOT', 'AND', 'OR', 'THE', 'ALL', 'NEW', 'OLD',
    'YES', 'NO', 'TIP', 'STEP', 'END', 'SEE', 'ADD', 'SET', 'GET', 'RUN',
    'TODO', 'FIXME', 'WARN', 'IMPORTANT', 'ONLY', 'THEN', 'IF', 'FOR',
    'YOU', 'WE', 'MUST', 'CAN', 'WILL', 'ONE', 'TWO', 'TIPS', 'FROM',
  ],
  decorativePattern: /(spacer|divider|separator|logo|icon|bullet|pixel|blank|shim)/i,
};

// ================================================================ utils

/**
 * Runs a global regex over text, calling cb for every match.
 * Guards against zero-length matches.
 * @param re global regular expression (lastIndex is reset)
 * @param text text to scan
 * @param cb receives the match and the index just past it
 * @return nothing
 */
function findAll(
  re: RegExp,
  text: string,
  cb: (m: RegExpExecArray, end: number) => void,
): void {
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    cb(m, re.lastIndex);
    if (m[0].length === 0) re.lastIndex++;
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  ndash: '-', mdash: '-', hellip: '...', bull: '\u2022',
  rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"',
  euro: '\u20AC', pound: '\u00A3', deg: '\u00B0', middot: '\u00B7',
  trade: '', reg: '', copy: '',
};

/**
 * Decodes numeric and a fixed set of named entities; unknown names become a space.
 * @param s string possibly containing entities
 * @return decoded string
 */
function decode(s: string): string {
  return String(s)
    .replace(/&#x([0-9a-f]{1,6});/gi, (_a, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d{1,7});/g, (_a, d: string) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&([a-z][a-z0-9]{1,10});/gi, (_a, n: string) => {
      const k = n.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, k) ? NAMED_ENTITIES[k] : ' ';
    });
}

/**
 * Strips tags and light markdown syntax, leaving readable text.
 * @param s html or markdown source
 * @return plain text
 */
function strip(s: string | null | undefined): string {
  return decode(
    String(s || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|tr|h[1-6]|td|th|ul|ol|table|blockquote|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/(^|\n)[ \t]{0,3}#{1,6}[ \t]+/g, '$1')
    .replace(/(^|\n)[ \t]{0,3}>[ \t]?/g, '$1')
    .replace(/(^|\n)[ \t]{0,3}([-*_])[ \t]*\2[ \t]*\2[-*_ \t]*(?=\n|$)/g, '$1')
    .replace(/(^|\n)[ \t]*\|/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/(^|\n)[ \t]{0,3}[-*+][ \t]+/g, '$1')
    .replace(/\*\*|__|`{1,3}|~~/g, '')
    .replace(/[ \t]+/g, ' ');
}

/**
 * @param text any text
 * @return whitespace-separated words
 */
function words(text: string | null | undefined): string[] {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t ? t.split(' ') : [];
}

/**
 * Splits text into sentences, masking abbreviation periods first.
 * @param text any text
 * @return sentences
 */
function sentences(text: string | null | undefined): string[] {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];

  t = t.replace(
    /\b(?:e\.g|i\.e|etc|vs|approx|Mr|Mrs|Ms|Dr|Fig|No|Inc|Ltd|Jr|Sr|St|min|max|sec)\./gi,
    (a) => a.replace(/\./g, '\u0002'),
  );

  const parts = t.replace(/([.!?])\s+/g, '$1\u0001').split('\u0001');
  const out: string[] = [];
  for (const part of parts) {
    const p = part.replace(/\u0002/g, '.').trim();
    if (p) out.push(p);
  }
  return out;
}

/**
 * @param attrStr the attribute portion of a tag
 * @param name attribute name
 * @return null when absent, empty string when present but empty
 */
function attrOrNull(attrStr: string | null | undefined, name: string): string | null {
  const m = new RegExp(
    '(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]*))',
    'i',
  ).exec(attrStr || '');
  if (!m) return null;
  const v = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3] || '';
  return v.trim();
}

/**
 * @param attrStr the attribute portion of a tag
 * @param name attribute name
 * @return the value, or empty string when absent
 */
function attr(attrStr: string | null | undefined, name: string): string {
  const v = attrOrNull(attrStr, name);
  return v === null ? '' : v;
}

/**
 * @param n value
 * @param max upper bound
 * @return n clamped to 0..max, rounded to 2 decimals
 */
function clamp(n: number, max: number): number {
  return Math.round(Math.max(0, Math.min(max, n)) * 100) / 100;
}

/**
 * @param n value
 * @return n rounded to 2 decimals
 */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * @param arr values
 * @return case-insensitive unique values, first occurrence kept
 */
function uniq(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of arr) {
    const k = String(v).toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  }
  return out;
}

/**
 * Collapses warnings to one per code, with a count.
 * @param list raw warnings
 * @return folded warnings
 */
function foldWarnings(list: RawWarning[]): ScoreWarning[] {
  const byCode = new Map<string, ScoreWarning>();
  const out: ScoreWarning[] = [];
  for (const w of list) {
    const hit = byCode.get(w.code);
    if (hit) {
      hit.count++;
      continue;
    }
    const folded: ScoreWarning = { code: w.code, message: w.message, count: 1 };
    byCode.set(w.code, folded);
    out.push(folded);
  }
  return out;
}

/**
 * @param code error code
 * @param message human readable message
 * @param stats optional stats to attach
 * @return a failure envelope
 */
function errorResult(code: string, message: string, stats?: ScoreStats): ScoreResult {
  const out: ScoreResult = {
    ok: false,
    error: { code, message },
    warnings: [],
    score: null,
    breakdown: null,
  };
  if (stats) out.stats = stats;
  return out;
}

// ========================================================== parse layer

/**
 * Words of prose following an object, measured in text words and stopped at
 * the next block object so one caption cannot cover two figures.
 * @param clean cleaned source
 * @param fromIndex index just past the object
 * @param cfg options
 * @return word count, capped at the restatement window
 */
function followingWords(clean: string, fromIndex: number, cfg: ScorerOptions): number {
  let slice = clean.substring(fromIndex, fromIndex + cfg.restatementWindowWords * 40);
  const stop = slice.search(/<(?:img|table|iframe|video|object|embed|h[1-6])\b|!\[/i);
  if (stop > -1) slice = slice.substring(0, stop);
  return Math.min(words(strip(slice)).length, cfg.restatementWindowWords);
}

/**
 * @param altWords words in the alt text
 * @param restateWords words of prose restating the object
 * @param cfg options
 * @return true when the object is described well enough
 */
function isCovered(altWords: number, restateWords: number, cfg: ScorerOptions): boolean {
  return altWords >= cfg.minAltWords || restateWords >= cfg.minRestatementWords;
}

/**
 * @param clean cleaned source
 * @return headings in document order, overlaps removed
 */
function collectHeadings(clean: string): Heading[] {
  const out: Heading[] = [];

  findAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, clean, (m) => {
    const t = strip(m[2]).replace(/\s+/g, ' ').trim();
    if (!t) return;
    out.push({
      level: parseInt(m[1], 10),
      text: t,
      start: m.index,
      end: m.index + m[0].length,
      syntax: 'html',
    });
  });

  findAll(/(^|\n)[ \t]{0,3}(#{1,6})[ \t]+([^\n]+)/g, clean, (m) => {
    const t = m[3].replace(/[ \t]*#+[ \t]*$/, '').replace(/\s+/g, ' ').trim();
    if (!t) return;
    out.push({
      level: m[2].length,
      text: t,
      start: m.index + m[1].length,
      end: m.index + m[0].length,
      syntax: 'markdown',
    });
  });

  out.sort((a, b) => a.start - b.start);

  const deduped: Heading[] = [];
  for (const h of out) {
    if (deduped.length && h.start < deduped[deduped.length - 1].end) continue;
    deduped.push(h);
  }
  return deduped;
}

/**
 * @param clean cleaned source
 * @param headings collected headings
 * @return one section per heading, plus a leading unlabelled one if needed
 */
function buildSections(clean: string, headings: Heading[]): Section[] {
  if (headings.length === 0) {
    return [{ heading: null, level: 0, syntax: null, html: clean, text: strip(clean) }];
  }

  const sections: Section[] = [];

  if (headings[0].start > 0) {
    const pre = clean.substring(0, headings[0].start);
    if (strip(pre).replace(/\s+/g, '').length > 0) {
      sections.push({ heading: null, level: 0, syntax: null, html: pre, text: strip(pre) });
    }
  }

  for (let i = 0; i < headings.length; i++) {
    const to = i + 1 < headings.length ? headings[i + 1].start : clean.length;
    const seg = clean.substring(headings[i].end, to);
    sections.push({
      heading: headings[i].text,
      level: headings[i].level,
      syntax: headings[i].syntax,
      html: seg,
      text: strip(seg),
    });
  }

  return sections;
}

/**
 * @param alt alt text, or null when the attribute is absent
 * @param src image source
 * @param decorative whether the image is decorative
 * @param restateWords prose words following the image
 * @param cfg options
 * @return a scored image entry
 */
function imageEntry(
  alt: string | null,
  src: string,
  decorative: boolean,
  restateWords: number,
  cfg: ScorerOptions,
): DocObject {
  const hasAlt = alt !== null;
  const altWords = hasAlt ? words(alt).length : 0;
  const covered = isCovered(altWords, restateWords, cfg);

  let name = String(src || '');
  name = name.substring(name.lastIndexOf('/') + 1).substring(0, 60);

  let reason: string | null = null;
  if (!covered) {
    if (!hasAlt) reason = 'no alt attribute and no prose restatement';
    else if (altWords === 0) reason = 'empty alt text and no prose restatement';
    else reason = 'alt text too short (' + altWords + ' words) and no prose restatement';
  }

  return { type: 'image', label: name || '(no src)', decorative: !!decorative, covered, reason };
}

/**
 * Collects html and markdown images.
 * @param doc document being built
 * @param clean cleaned source
 * @param cfg options
 * @return nothing
 */
function collectImages(doc: ParsedDoc, clean: string, cfg: ScorerOptions): void {
  findAll(/<img\b([^>]*)>/gi, clean, (m, end) => {
    const attrs = m[1];
    const alt = attrOrNull(attrs, 'alt');
    const src = attr(attrs, 'src') || attr(attrs, 'data-src');
    const w = parseInt(attr(attrs, 'width'), 10);
    const h = parseInt(attr(attrs, 'height'), 10);
    const role = attr(attrs, 'role').toLowerCase();

    const tiny =
      (!isNaN(w) && w > 0 && w <= cfg.decorativeMaxPx) ||
      (!isNaN(h) && h > 0 && h <= cfg.decorativeMaxPx);

    const declaredDecorative =
      tiny ||
      role === 'presentation' ||
      role === 'none' ||
      attr(attrs, 'aria-hidden').toLowerCase() === 'true' ||
      (alt === '' && cfg.decorativePattern.test(src));

    doc.images.push(
      imageEntry(alt, src, declaredDecorative, followingWords(clean, end, cfg), cfg),
    );
  });

  findAll(/!\[([^\]]{0,300})\]\(\s*<?([^)\s>]+)>?[^)]*\)/g, clean, (m, end) => {
    doc.images.push(
      imageEntry(
        m[1],
        m[2],
        m[1] === '' && cfg.decorativePattern.test(m[2]),
        followingWords(clean, end, cfg),
        cfg,
      ),
    );
  });
}

/**
 * Collects html tables.
 * @param doc document being built
 * @param clean cleaned source
 * @param cfg options
 * @return nothing
 */
function collectTables(doc: ParsedDoc, clean: string, cfg: ScorerOptions): void {
  findAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi, clean, (m, end) => {
    const body = m[2];
    const rows = (body.match(/<tr\b/gi) || []).length;
    const complex = /(?:colspan|rowspan)\s*=/i.test(body);
    const headers = /<th\b/i.test(body);
    const role = attr(m[1], 'role').toLowerCase();
    const restate = followingWords(clean, end, cfg);

    const decorative = role === 'presentation' || role === 'none' || rows <= 1;

    const needsRestatement = complex && restate < cfg.minRestatementWords;
    const missingHeaders = cfg.requireTableHeaders && !headers;
    const covered = !needsRestatement && !missingHeaders;

    let reason: string | null = null;
    if (!covered) {
      reason = missingHeaders
        ? 'no <th> header cells, so column meaning is unrecoverable from text'
        : 'merged or spanned cells with no prose restatement';
    }

    doc.tables.push({
      type: 'table',
      label: rows + ' rows' + (complex ? ', merged cells' : '') + (headers ? '' : ', no headers'),
      decorative,
      covered,
      reason,
    });
  });
}

/**
 * Collects embedded media.
 * @param doc document being built
 * @param clean cleaned source
 * @param cfg options
 * @return nothing
 */
function collectMedia(doc: ParsedDoc, clean: string, cfg: ScorerOptions): void {
  findAll(/<(iframe|video|object|embed)\b([^>]*)>/gi, clean, (m, end) => {
    const restate = followingWords(clean, end, cfg);
    const covered = restate >= cfg.minRestatementWords;

    doc.media.push({
      type: m[1].toLowerCase(),
      label: (attr(m[2], 'src') || attr(m[2], 'data')).substring(0, 60),
      decorative: attr(m[2], 'aria-hidden').toLowerCase() === 'true',
      covered,
      reason: covered ? null : 'embedded media with no text equivalent nearby',
    });
  });
}

/**
 * Collects html links, markdown links and autolinks.
 * @param doc document being built
 * @param clean cleaned source
 * @return nothing
 */
function collectLinks(doc: ParsedDoc, clean: string): void {
  findAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, clean, (m) => {
    doc.links.push({
      href: attr(m[1], 'href'),
      anchor: strip(m[2]).replace(/\s+/g, ' ').trim(),
      syntax: 'html',
    });
  });

  // The leading "!" is captured, not consumed, so adjacent links are both found.
  findAll(/(!?)\[([^\]\n]{1,300})\]\(\s*<?([^)\s>]+)>?[^)]*\)/g, clean, (m) => {
    if (m[1] === '!') return;
    if (clean.charAt(m.index - 1) === '\\') return;
    doc.links.push({
      href: m[3],
      anchor: m[2].replace(/\s+/g, ' ').trim(),
      syntax: 'markdown',
    });
  });

  findAll(/<((?:https?|mailto):[^>\s]+)>/gi, clean, (m) => {
    doc.links.push({ href: m[1], anchor: m[1], syntax: 'autolink' });
  });
}

/**
 * Parses raw html or markdown into sections, objects and links.
 * @param text raw content
 * @param cfg options
 * @return the parsed document with stats
 */
function parse(text: string, cfg: ScorerOptions): ParsedDoc {
  const clean = String(text || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const headings = collectHeadings(clean);
  const doc: ParsedDoc = {
    clean,
    text: strip(clean),
    warnings: [],
    headings,
    sections: buildSections(clean, headings),
    images: [],
    tables: [],
    media: [],
    links: [],
    stats: undefined as unknown as ScoreStats,
  };

  collectImages(doc, clean, cfg);
  collectTables(doc, clean, cfg);
  collectMedia(doc, clean, cfg);
  collectLinks(doc, clean);

  if (doc.headings.length === 0) {
    doc.warnings.push({
      code: 'NO_HEADINGS',
      message: 'No headings found; the whole document is a single unlabelled chunk.',
    });
  }

  const mdHeadings = doc.headings.filter((h) => h.syntax === 'markdown').length;
  const wordCount = words(doc.text).length;

  doc.stats = {
    words: wordCount,
    chars: clean.length,
    sections: doc.sections.length,
    headings: doc.headings.length,
    headings_markdown: mdHeadings,
    headings_html: doc.headings.length - mdHeadings,
    images: doc.images.length,
    tables: doc.tables.length,
    media: doc.media.length,
    links: doc.links.length,
    wordCount,
    imageCount: doc.images.length,
    linkCount: doc.links.length,
  };

  return doc;
}

// ========================================================= C1 . 30 pts

const BACK_REF_SOURCE =
  /\b(?:the above|as mentioned(?:\s+(?:earlier|above))?|mentioned above|see above|see below|see (?:the )?previous section|(?:as )?(?:described|shown|noted|discussed) (?:above|below|earlier|previously)|the (?:previous|preceding|following) (?:step|section|table|procedure)|in the (?:previous|next) section)\b/gi
    .source;

const IMPERSONAL_IT =
  /^it(?:'s| is| was| can be| may be| might be| would be| will be| has been)\s+(?:important|necessary|recommended|possible|worth|best|common|critical|useful|advisable|likely|unlikely|helpful|essential|good|safe|normal|expected|easy|difficult)\b/i;

const PRONOUN_VERB =
  /^(?:is|are|was|were|will|would|can|could|should|shall|must|may|might|has|have|had|does|do|did|means|allows|requires|causes|includes|applies|occurs|happens|ensures|prevents|lets|gives|makes|results|works|explains|describes|shows|indicates|refers|depends|needs|appears|becomes|remains|seems|takes|creates|provides|enables|affects|s|ll|re|d)$/;

/**
 * A section opening with a bare pronoun has no antecedent inside its own
 * chunk. "This procedure ..." is fine; "This is required ..." is not.
 * @param sentence the first sentence of a section
 * @return the offending pronoun, or null
 */
function danglingOpener(sentence: string): string | null {
  const m = /^(it|its|they|their|them|such|this|that|these|those)\b\s*('?[a-z]+)?/i.exec(sentence);
  if (!m) return null;

  const pronoun = m[1].toLowerCase();
  const next = (m[2] || '').toLowerCase().replace(/^'/, '');

  if (pronoun === 'it' || pronoun === 'its') {
    if (IMPERSONAL_IT.test(sentence)) return null;
    return pronoun;
  }

  if (pronoun === 'they' || pronoun === 'their' || pronoun === 'them' || pronoun === 'such') {
    return pronoun;
  }

  if (!next) return pronoun;
  return PRONOUN_VERB.test(next) ? pronoun : null;
}

/**
 * @param text document text
 * @param cfg options
 * @return acronyms that are neither known nor expanded in the text
 */
function unexpandedAcronyms(text: string, cfg: ScorerOptions): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  findAll(/\b([A-Z][A-Z0-9]{1,5})(?![a-z])\b/g, text, (m) => {
    const a = m[1];
    if (seen.has(a)) return;
    seen.add(a);

    if (cfg.knownAcronyms.includes(a)) return;
    if (cfg.capsStopWords.includes(a)) return;

    const expanded =
      new RegExp('\\([^)]*\\b' + a + '\\b[^)]*\\)').test(text) ||
      new RegExp('\\b' + a + '\\s*\\(\\s*[A-Za-z][^)]{3,}\\)').test(text);

    if (!expanded) out.push(a);
  });

  return out;
}

/**
 * @param doc parsed document
 * @param cfg options
 * @return C1 points and findings
 */
function selfContainedness(doc: ParsedDoc, cfg: ScorerOptions): CriterionResult {
  const openers: { section: string; pronoun: string; opens_with: string }[] = [];

  for (const section of doc.sections) {
    const first = sentences(section.text)[0] || '';
    const pronoun = danglingOpener(first);
    if (pronoun) {
      openers.push({
        section: section.heading || '(text before first heading)',
        pronoun,
        opens_with: first.substring(0, 80),
      });
    }
  }

  const backRefs = doc.text.match(new RegExp(BACK_REF_SOURCE, 'gi')) || [];
  const acronyms = unexpandedAcronyms(doc.text, cfg);
  const hits = openers.length + backRefs.length + acronyms.length;

  // Floor the denominator so one hit cannot zero a short document.
  const basis = Math.max(doc.stats.words, cfg.minWordsForRate);
  const per1k = hits / (basis / 1000);
  const pts = 30 * (1 - Math.min(1, per1k / cfg.hitRateCeiling));

  return {
    points: clamp(pts, 30),
    detail: {
      hits,
      words: doc.stats.words,
      rate_basis_words: basis,
      rate_per_1000_words: r2(per1k),
      ceiling: cfg.hitRateCeiling,
      dangling_openers: openers,
      back_reference_phrases: backRefs.length,
      back_reference_examples: uniq(backRefs).slice(0, 8),
      unexpanded_acronyms: acronyms,
    },
  };
}

// ========================================================= C2 . 25 pts

/**
 * @param doc parsed document
 * @param cfg options
 * @return C2 points and findings
 */
function chunkGeometry(doc: ParsedDoc, cfg: ScorerOptions): CriterionResult {
  let validWords = 0;
  let totalWords = 0;
  const invalid: { section: string; words: number; tokens: number; reason: string }[] = [];

  for (const s of doc.sections) {
    const w = words(s.text).length;
    if (w === 0) continue;

    // Worse of word- and character-based estimates: dense content tokenises badly.
    const tokens = Math.max(Math.round(w * cfg.tokensPerWord), Math.round(s.text.length / 4));
    totalWords += w;

    const hasHeading = !!(s.heading && s.heading.length);
    if (hasHeading && tokens <= cfg.maxSectionTokens) {
      validWords += w;
    } else {
      invalid.push({
        section: s.heading || '(text before first heading)',
        words: w,
        tokens,
        reason: !hasHeading ? 'no heading' : 'over token cap',
      });
    }
  }

  const coverage = totalWords > 0 ? validWords / totalWords : 0;

  return {
    points: clamp(25 * coverage, 25),
    detail: {
      token_cap: cfg.maxSectionTokens,
      coverage: r2(coverage),
      words_in_valid_sections: validWords,
      total_words: totalWords,
      invalid_sections: invalid,
    },
  };
}

// ========================================================= C3 . 20 pts

/**
 * @param raw cleaned source
 * @return junk hit counts per pattern, a total and a few examples
 */
function junkSignals(raw: string): {
  total: number;
  counts: Record<string, number>;
  examples: string[];
} {
  const patterns: Record<string, RegExp> = {
    inline_styles: /<[a-z][^>]*\sstyle\s*=/gi,
    word_artifacts: /(?:class\s*=\s*"[^"]*Mso|<\/?o:p|<\/?w:|mso-)/gi,
    legacy_tags: /<\/?(?:font|center|basefont|marquee|blink)\b/gi,
    empty_blocks: /<(p|div|span)\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi,
    base64_payloads: /src\s*=\s*["']?data:[^"'\s>]{200,}/gi,
    numeric_entities: /&#(?:x[0-9a-f]{1,6}|\d{1,7});/gi,
    zero_width_chars: /[​-‍﻿­]/g,
    div_soup: /(?:<div\b[^>]*>\s*){4,}/gi,
    mojibake: /(?:â\u0080|Ã¢|Â\s|Ã‚)/g,
  };

  const counts: Record<string, number> = {};
  const examples: string[] = [];
  let total = 0;

  for (const k of Object.keys(patterns)) {
    const hits = raw.match(patterns[k]) || [];
    counts[k] = hits.length;
    total += hits.length;
    if (hits.length && examples.length < 8) {
      examples.push(k + ': ' + String(hits[0]).replace(/\s+/g, ' ').substring(0, 90));
    }
  }

  return { total, counts, examples };
}

/**
 * Two document-level measures: markup overhead and junk density.
 * @param doc parsed document
 * @param cfg options
 * @return C3 points and findings
 */
function cleanliness(doc: ParsedDoc, cfg: ScorerOptions): CriterionResult {
  const rawLen = doc.clean.replace(/\s+/g, ' ').trim().length;
  const textLen = doc.text.replace(/\s+/g, ' ').trim().length;

  const overhead = rawLen > 0 ? 1 - Math.min(1, textLen / rawLen) : 0;
  const span = Math.max(0.01, cfg.markupOverheadCeiling - cfg.markupOverheadFloor);
  const overheadScore =
    1 - Math.min(1, Math.max(0, (overhead - cfg.markupOverheadFloor) / span));

  const junk = junkSignals(doc.clean);
  const basis = Math.max(doc.stats.words, cfg.minWordsForRate);
  const per1k = junk.total / (basis / 1000);
  const junkScore = 1 - Math.min(1, per1k / cfg.junkCeiling);

  const pts = 20 * (0.6 * overheadScore + 0.4 * junkScore);

  return {
    points: clamp(pts, 20),
    detail: {
      markup_overhead: r2(overhead),
      markup_overhead_band: [cfg.markupOverheadFloor, cfg.markupOverheadCeiling],
      markup_overhead_score: r2(overheadScore),
      text_chars: textLen,
      payload_chars: rawLen,
      junk_hits: junk.total,
      junk_per_1000_words: r2(per1k),
      junk_ceiling: cfg.junkCeiling,
      junk_score: r2(junkScore),
      junk_breakdown: junk.counts,
      junk_examples: junk.examples,
    },
  };
}

// ========================================================= C4 . 15 pts

/**
 * @param doc parsed document
 * @return C4 points and findings
 */
function completeness(doc: ParsedDoc): CriterionResult {
  const objs = doc.images.concat(doc.tables, doc.media);
  const counted = objs.filter((o) => !o.decorative);

  if (counted.length === 0) {
    return {
      points: 15,
      detail: { objects: 0, covered: 0, decorative_excluded: objs.length, uncovered: [] },
    };
  }

  let covered = 0;
  const uncovered: { type: string; detail: string; reason: string | null }[] = [];
  for (const o of counted) {
    if (o.covered) covered++;
    else uncovered.push({ type: o.type, detail: o.label || '', reason: o.reason });
  }

  return {
    points: clamp(15 * (covered / counted.length), 15),
    detail: {
      objects: counted.length,
      covered,
      decorative_excluded: objs.length - counted.length,
      uncovered,
    },
  };
}

// ========================================================= C5 . 10 pts

/**
 * @param href link target
 * @return the KB reference the link points at, or null for non-KB links
 */
function kbRef(href: string): string | null {
  const m =
    /sysparm_article=([A-Za-z0-9]+)/.exec(href) ||
    /[?&]sys_id=([0-9a-f]{32})/i.exec(href) ||
    /\b(KB\d{5,})\b/.exec(href);
  return m ? m[1] : null;
}

/**
 * Internal KB links are checked through cfg.isLinkBroken when supplied.
 * @param doc parsed document
 * @param cfg options
 * @return C5 points and findings
 */
function referenceIntegrity(doc: ParsedDoc, cfg: ScorerOptions): CriterionResult {
  let internal = 0;
  let resolvable = 0;
  let malformed = 0;
  let externalCount = 0;
  const dead: { href: string; ref: string; reason: string }[] = [];
  const bad: string[] = [];
  const cache = new Map<string, boolean>();
  const check = cfg.isLinkBroken;

  for (const link of doc.links) {
    const href = (link.href || '').trim();

    if (!href || href === '#' || /^javascript:/i.test(href) || /^(?:undefined|null)$/i.test(href)) {
      malformed++;
      bad.push(href || '(empty href)');
      continue;
    }

    const ref = kbRef(href);

    if (!ref) {
      if (/^https?:\/\//i.test(href)) externalCount++;
      continue;
    }

    internal++;

    let broken = false;
    if (check) {
      const cached = cache.get(ref);
      if (cached === undefined) {
        broken = !!check(href);
        cache.set(ref, broken);
      } else {
        broken = cached;
      }
    }

    if (broken) dead.push({ href, ref, reason: 'reported broken by isLinkBroken' });
    else resolvable++;
  }

  const denom = internal + malformed;

  return {
    points: denom === 0 ? 10 : clamp(10 * (resolvable / denom), 10),
    warnings: [],
    detail: {
      total_links: doc.links.length,
      internal_kb_links: internal,
      resolvable,
      dead_internal: dead,
      malformed: bad,
      external_excluded: externalCount,
      link_resolution: check ? 'enabled' : 'disabled',
    },
  };
}

// ================================================================ public

/**
 * Scores content for AI / RAG readability out of 100.
 * @param text raw html or markdown
 * @param options per-call overrides of the defaults
 * @return an envelope; check ok before reading score
 */
export function scoreContent(text: string, options?: Partial<ScorerOptions>): ScoreResult {
  const cfg: ScorerOptions = { ...DEFAULTS, ...(options || {}) };
  const raw = text === null || text === undefined ? '' : String(text);
  const doc = parse(raw, cfg);

  if (doc.stats.words < cfg.minWords) {
    return errorResult(
      'EMPTY_CONTENT',
      'Not enough readable text to score: ' + doc.stats.words + ' words, minimum is ' + cfg.minWords + '.',
      doc.stats,
    );
  }

  const c1 = selfContainedness(doc, cfg);
  const c2 = chunkGeometry(doc, cfg);
  const c3 = cleanliness(doc, cfg);
  const c4 = completeness(doc);
  const c5 = referenceIntegrity(doc, cfg);

  const total = c1.points + c2.points + c3.points + c4.points + c5.points;

  const out: ScoreResult = {
    ok: true,
    error: null,
    warnings: foldWarnings(doc.warnings.concat(c5.warnings || [])),
    score: r2(total),
    breakdown: {
      self_containedness: c1.points,
      chunk_geometry: c2.points,
      cleanliness: c3.points,
      completeness: c4.points,
      reference_integrity: c5.points,
    },
    stats: doc.stats,
  };

  if (cfg.detail) {
    out.findings = {
      self_containedness: c1.detail,
      chunk_geometry: c2.detail,
      cleanliness: c3.detail,
      completeness: c4.detail,
      reference_integrity: c5.detail,
    };
  }

  return out;
}
