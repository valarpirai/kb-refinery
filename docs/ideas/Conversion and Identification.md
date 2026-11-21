# AI Readability & Conversion Architecture: HTML to Markdown

This blueprint outlines strategies for parsing, auditing, and converting HTML into LLM-optimized Markdown using **`node-html-markdown`** directly in the browser. It operates synchronously and runs entirely on the main thread without Web Workers.

---

## 🏗️ Architectural Overview

To calculate structural scores (e.g., noise density, semantic layout health) *before* pruning elements during the enrichment phase, you can implement one of two distinct structural pipelines:

1. **The Interception Pipeline (Single-Pass):** Captures metadata using custom translators inside `node-html-markdown`, logging metrics inline before stripping the nodes.
2. **The Dom Tree Pipeline (Two-Stage):** Uses the browser's native `DOMParser` to run complex analytical metrics, updates a telemetry object, extracts noisy nodes, and translates the remaining clean markup.

---

## 🛠️ Implementation Layouts

### Strategy 1: The Interception Audit (Single-Pass Tracking)
This model avoids double-parsing overhead. It hooks directly into the translator pipeline to increment telemetry registers before returning an empty string, effectively dropping unwanted layout data from your final markdown payload.

```javascript
import { NodeHtmlMarkdown } from 'node-html-markdown';

// 1. Maintain an isolated telemetry register for the current execution cycle
const auditScoreTracker = {
  navigationElementsCount: 0,
  footerBlocksFound: 0,
  advertisementClassesDetected: 0,
  hasMainContentAnchor: false
};

// 2. Configure translation rules with metric tracking hooks
const nhm = new NodeHtmlMarkdown({}, {
  // Catch navigation layouts
  'nav, [class*="navigation"]': {
    postprocess: () => {
      auditScoreTracker.navigationElementsCount++;
      return ''; // Strips element content from the final Markdown output
    }
  },
  // Catch footer blocks
  'footer': {
    postprocess: () => {
      auditScoreTracker.footerBlocksFound++;
      return ''; // Strips element content from the final Markdown output
    }
  },
  // Catch advertisement wrappers or layout banners
  'div.sidebar, div.ads, div.cookie-banner': {
    postprocess: () => {
      auditScoreTracker.advertisementClassesDetected++;
      return ''; // Strips element content from the final Markdown output
    }
  },
  // Validate presence of high-priority semantic structures
  'main, article': {
    postprocess: ({ content }) => {
      auditScoreTracker.hasMainContentAnchor = true;
      return content; // Keeps text intact
    }
  }
});

// 3. Execute compilation
const rawWebpageHtml = `<nav>Home Links</nav><main><p>Core AI Prompt Content.</p></main><footer>Legal info</footer>`;
const cleanMarkdown = nhm.translate(rawWebpageHtml);

console.log('Markdown Output:\n', cleanMarkdown);
console.log('AI Scoring Analytics Payload:', auditScoreTracker);
```

### Strategy 2: Two-Stage Native Parsing (Recommended for Advanced Scoring)
This approach handles deep relational queries, character counts, or parent-child context calculations. It evaluates structural relationships using the browser's layout engine before translation begins.

```javascript
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * Evaluates webpage layouts for AI compatibility, logs metrics, and outputs optimized markdown text.
 * @param {string} htmlString - Raw HTML input content string.
 */
function analyzeAndConvert(htmlString) {
  // --- STAGE 1: NATIVE ANALYSIS & SCORING ---
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  
  // Query specific layout components to build a structural profile
  const navElements = doc.querySelectorAll('nav, [class*="nav"], [id*="nav"]');
  const footerElements = doc.querySelectorAll('footer, [id*="footer"]');
  const totalCharacterLength = doc.body.textContent?.length || 0;
  const semanticAnchorPresent = doc.querySelector('main, article') !== null;
  
  const telemetryReport = {
    detectedNavs: navElements.length,
    detectedFooters: footerElements.length,
    rawCharacterDensity: totalCharacterLength,
    isHighlySemantic: semanticAnchorPresent
  };

  // Compute a custom layout score for LLM consumption
  const aiReadabilityScore = calculateContextScore(telemetryReport);

  // --- STAGE 2: TARGETED PRUNING & CONVERSION ---
  // Clean up noisy nodes inside the managed DOM instance before conversion
  navElements.forEach(element => element.remove());
  footerElements.forEach(element => element.remove());

  // Convert the clean DOM instance string synchronously
  const cleanMarkdown = NodeHtmlMarkdown.translate(doc.body.innerHTML, {
    codeFence: '```',            // Forces clean code container fences
    codeBlockStyle: 'fenced',   // Prevents space indentation fallbacks
    bulletMarker: '-',           // Predictable list tokens for token patterns
    useInlineLinks: true         // Inline mapping instead of footnotes layout
  });

  return {
    cleanMarkdown,
    telemetryReport,
    aiReadabilityScore
  };
}

/**
 * Mathematical evaluation loop to determine layout quality parameters.
 */
function calculateContextScore(report) {
  let score = 100;
  if (report.detectedNavs > 2) score -= 25;       // Penalize messy layout structures
  if (!report.isHighlySemantic) score -= 35;       // Penalize unstructured data sets
  if (report.rawCharacterDensity < 50) score -= 20; // Penalize lack of contextual text elements
  return Math.max(0, score);
}

// Execution Pass
const response = analyzeAndConvert(`<div><nav>Sidebar Context</nav><article><h1>Data Matrix</h1></article></div>`);
console.log(response);
```

---

## 🎯 LLM Optimization Configuration Guide

When configuring `node-html-markdown` for AI processing pipelines, keep the following configuration settings in mind:

| Configuration Parameter | Target Settings | Purpose for AI Readability |
| :--- | :--- | :--- |
| `codeFence` | `'```'` | Guarantees clear boundaries for programming languages, minimizing extraction errors. |
| `codeBlockStyle` | `'fenced'` | Prevents conversion to space-indented markdown code blocks, which LLMs can mistake for regular spacing. |
| `bulletMarker` | `'-'` | Enforces a uniform character marker format across all nested levels for parsing loops. |
| `useInlineLinks` | `true` | Embeds references directly inline with their anchor text, helping the AI associate links with context. |
| `maxConsecutiveNewlines`| `2` | Compresses empty rows to minimize token consumption and reduce processing noise. |

---

## 🧠 Code Snippet & Layout Safeguards (AI Context Preservation)

LLMs depend on rigid code block tracking. If inline spaces or un-fenced fragments leak into the layout, an AI can parse code blocks as standard plain text or break code synthesis loops.

### 1. Enforcing Fenced Blocks vs. Four-Space Indents
By default, standard markdown can treat lines indented by 4 spaces as code blocks. For automated content scraping, this is a dangerous default because random website formatting, padding, or nested paragraphs might accidentally be rendered as a code block, breaking the AI's structural awareness.

Setting `codeBlockStyle: 'fenced'` completely fixes this behavior by guaranteeing that all blocks use structural triple-backticks instead of indentation.

```javascript
// Example Scenario
import { NodeHtmlMarkdown } from 'node-html-markdown';

// ❌ BAD DEFAULT (Default fallback behavior)
// Can produce loose indentations which confuse structural reasoning layers:
//     const x = 10;
//     console.log(x);

// ✅ GOOD EXTREME (Explicit config constraints)
const nhm = new NodeHtmlMarkdown({
  codeFence: '```',            // Rigid layout boundary markers
  codeBlockStyle: 'fenced'    // Forces wrapping fences over structural indentation spaces
});
```

### 2. Automatic Language Detection (Regular Behavior)
Out of the box, `node-html-markdown` scans internal layout structures for standard syntax highlighting classes (like `class="language-typescript"` or `class="lang-python"`). It automatically parses these string flags and attaches them directly onto the opening fence marker, alerting the LLM to switch token weights to that explicit language syntax immediately.

```html
<!-- Native Input HTML -->
<pre><code class="language-javascript">console.log("AI Optimized");</code></pre>
```

```markdown
<!-- Default Output Yielded -->
```javascript
console.log("AI Optimized");
```
```

### 3. Custom Language Interception Handling (Irregular Behavior)
When processing messy user submissions or poorly scraped sites, language tags may sit on non-standard parent wrapper targets instead of nested elements (e.g., `<div class="code-holder-rust">`). You can build a custom translator handler rule to reliably extract the metadata and inject it cleanly onto your code fence boundaries for the AI.

```javascript
import { NodeHtmlMarkdown } from 'node-html-markdown';

const nhmWithCustomCodeParsing = new NodeHtmlMarkdown({}, {
  // Capture non-standard wrapper targets with irregular styling tags
  'div[class*="code-holder-"], pre[class*="custom-lang-"]': {
    postprocess: ({ element, content }) => {
      const classAttr = element.getAttribute('class') || '';
      
      // Clean up strings to locate raw programming identifier keynames
      const targetLanguage = classAttr
        .replace('code-holder-', '')
        .replace('custom-lang-', '')
        .trim() || 'text';
        
      // Explicitly return a beautifully isolated, typed markdown fence block
      return `\`\`\`${targetLanguage}\n${content.trim()}\n\`\`\``;
    }
  }
});

// Test Run
const malformedInput = `<div class="code-holder-rust">fn main() {}</div>`;
console.log(nhmWithCustomCodeParsing.translate(malformedInput));

/* Cleaned LLM Output:
```rust
fn main() {}
```
*/
