import {html, css, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {unsafeHTML} from 'lit/directives/unsafe-html.js';
import {AIUXElement} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {icon} from '@servicenow/aiux/aiux-directive-icon';

const STAGE_ORDER = ['raw', 'converted', 'enriched'];

const STAGE_LABEL = {
  raw: () => i18n.getMessage('Raw'),
  converted: () => i18n.getMessage('Converted'),
  enriched: () => i18n.getMessage('Enriched')
};

// Real KB articles run far below this; this only exists to keep a
// pathological row (the `content` column allows up to 4MB) from hanging
// markdown parsing/sanitization on the main thread.
const MAX_RENDER_CHARS = 200_000;

/**
 * Side-by-side viewer for the raw/converted/enriched content stages --
 * rendered HTML, not raw markdown/HTML source in a text box, with a picker
 * to choose any 1-3 of the three stages to show at once.
 *
 * Its own file/custom element: a widget or page entry file may declare only
 * one top-level widget-base-class class (see article-diff-dialog.js for the
 * exact same split on the pipeline page).
 *
 * Rendering must be client-only. `marked` (markdown -> HTML) and `dompurify`
 * (sanitize before unsafeHTML) are dynamically import()ed from
 * firstUpdated() rather than statically imported at module top level, so
 * they're stubbed out of the SSR isolate bundle instead of being inlined,
 * and so this never attempts DOM-dependent sanitization in the Node SSR
 * pass -- the exact mechanism environment-build-deploy.md documents for
 * this same pair of libraries.
 */
@customElement('analysis-content-viewer')
export default class AnalysisContentViewer extends AIUXElement {
  static styles = css`
    :host {
      display: block;
    }

    /*
     * Minimal readable typography for the sanitized markdown/HTML content --
     * Tailwind's preflight strips default heading/list/link styling, so
     * without this the rendered content would read as one undifferentiated
     * block of text.
     */
    .prose-content :first-child {
      margin-top: 0;
    }
    .prose-content h1,
    .prose-content h2,
    .prose-content h3,
    .prose-content h4 {
      margin-top: 1em;
      margin-bottom: 0.4em;
      font-weight: 700;
      color: var(--color-text-primary);
    }
    .prose-content p {
      margin: 0.6em 0;
    }
    .prose-content ul,
    .prose-content ol {
      margin: 0.6em 0;
      padding-left: 1.4em;
    }
    .prose-content ul {
      list-style: disc;
    }
    .prose-content ol {
      list-style: decimal;
    }
    .prose-content li {
      margin: 0.2em 0;
    }
    .prose-content a {
      color: var(--color-primary);
      text-decoration: underline;
    }
    .prose-content code {
      font-family: var(--font-mono, monospace);
      background: var(--color-base-200);
      border-radius: 3px;
      padding: 0.1em 0.3em;
      font-size: 0.9em;
    }
    .prose-content pre {
      background: var(--color-base-200);
      border-radius: 6px;
      padding: 0.75em;
      overflow-x: auto;
    }
    .prose-content pre code {
      background: none;
      padding: 0;
    }
    .prose-content img {
      max-width: 100%;
    }
    .prose-content table {
      border-collapse: collapse;
    }
    .prose-content th,
    .prose-content td {
      border: 1px solid var(--color-base-300);
      padding: 0.4em 0.6em;
    }
  `;

  @property({attribute: false}) snapshots = {raw: null, converted: null, enriched: null};

  /** Which stages are currently shown side by side -- always at least 1. */
  @state() _selected = new Set();

  /** True only client-side, once firstUpdated() has run. */
  @state() _ready = false;

  /**
   * type -> {html} | {tooLarge: true} | {error: true}. A real @state
   * property so Lit's own reactivity picks up a re-render when
   * _prepareSelectedContent() reassigns it -- never mutated in place, and never
   * paired with a manual requestUpdate() call.
   */
  @state() _rendered = new Map();

  _renderer = null;

  _availableTypes() {
    return STAGE_ORDER.filter(type => Boolean(this.snapshots?.[type]?.content));
  }

  /**
   * Keeps _selected valid whenever `snapshots` changes -- both the very
   * first time it's set (seeding the default: every stage that exists) and
   * later (pruning a selection that's no longer available). Runs during SSR
   * too (unlike firstUpdated), so the picker/grid already reflect the right
   * stage count on first paint, even though the panels themselves can't
   * show real rendered content until hydration.
   */
  willUpdate(changed) {
    if (changed.has('snapshots')) {
      const available = new Set(this._availableTypes());
      const pruned = new Set([...this._selected].filter(type => available.has(type)));
      this._selected = pruned.size ? pruned : available;
    }
  }

  updated(changed) {
    if (changed.has('snapshots')) this._rendered = new Map();
    if (this._ready && (changed.has('snapshots') || changed.has('_selected'))) {
      void this._prepareSelectedContent();
    }
  }

  async _ensureRenderer() {
    if (this._renderer) return this._renderer;
    const [{marked}, DOMPurifyMod] = await Promise.all([import('marked'), import('dompurify')]);
    this._renderer = {marked, DOMPurify: DOMPurifyMod.default ?? DOMPurifyMod};
    return this._renderer;
  }

  // Deliberately firstUpdated() and not connectedCallback() -- the latter
  // also runs during SSR, and this is exactly the "browser-only library,
  // client-only work" case documented in environment-build-deploy.md.
  async firstUpdated() {
    this._ready = true;
    await this._ensureRenderer();
    await this._prepareSelectedContent();
  }

  async _prepareSelectedContent() {
    const updates = new Map();
    for (const type of this._selected) {
      if (this._rendered.has(type)) continue;
      const snap = this.snapshots?.[type];
      if (!snap?.content) continue; // render() falls back to its own "no version yet" copy
      if (snap.content.length > MAX_RENDER_CHARS) {
        updates.set(type, {tooLarge: true});
        continue;
      }
      try {
        const {marked, DOMPurify} = await this._ensureRenderer();
        const rawHtml = type === 'raw' ? snap.content : await marked.parse(snap.content);
        updates.set(type, {html: DOMPurify.sanitize(rawHtml)});
      } catch (e) {
        updates.set(type, {error: true});
      }
    }
    // Reassigned, never mutated in place -- this is what triggers Lit's own
    // reactivity for the new entries, with no manual requestUpdate() call.
    if (updates.size) {
      const next = new Map(this._rendered);
      for (const [type, value] of updates) next.set(type, value);
      this._rendered = next;
    }
  }

  _toggle(type) {
    if (!this.snapshots?.[type]?.content) return;
    const next = new Set(this._selected);
    if (next.has(type)) {
      if (next.size === 1) return; // always keep at least one stage shown
      next.delete(type);
    } else {
      next.add(type);
    }
    this._selected = next;
  }

  _renderChip(type) {
    const available = Boolean(this.snapshots?.[type]?.content);
    const selected = this._selected.has(type);
    return html`
      <button
        type="button"
        class="aiux-btn aiux-btn-sm ${selected ? 'aiux-btn-primary' : 'aiux-btn-ghost'}"
        ?disabled=${!available}
        aria-pressed=${selected}
        @click=${() => this._toggle(type)}
      >
        ${STAGE_LABEL[type]()}
      </button>
    `;
  }

  _gridColsClass() {
    if (this._selected.size >= 3) return 'lg:grid-cols-3';
    if (this._selected.size === 2) return 'lg:grid-cols-2';
    return '';
  }

  _renderStageContent(type) {
    const snap = this.snapshots?.[type];
    if (!snap?.content) {
      return html`
        <p class="text-sm text-text-tertiary">
          ${i18n.getMessage('No {stage} version available yet.', {stage: STAGE_LABEL[type]()})}
        </p>
      `;
    }
    const rendered = this._rendered.get(type);
    if (!rendered) {
      return html`<p class="text-sm text-text-tertiary">${i18n.getMessage('Loading…')}</p>`;
    }
    if (rendered.tooLarge) {
      return html`
        <p class="text-sm text-text-tertiary">
          ${i18n.getMessage('This content is too large to preview here.')}
        </p>
      `;
    }
    if (rendered.error) {
      return html`
        <p class="text-sm text-error">${i18n.getMessage('Could not render this content.')}</p>
      `;
    }
    if (!rendered.html) {
      return html`<p class="text-sm text-text-tertiary">${i18n.getMessage('Loading…')}</p>`;
    }
    return html`<div class="prose-content">${unsafeHTML(rendered.html)}</div>`;
  }

  _renderStagePanel(type) {
    const snap = this.snapshots?.[type];
    return html`
      <div class="flex flex-col overflow-hidden rounded-lg border border-base-300">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-base-300 bg-base-200 px-3 py-2">
          <span class="text-xs font-bold uppercase tracking-wide text-text-secondary">
            ${STAGE_LABEL[type]()}
          </span>
          ${snap
            ? html`
                <span class="flex items-center gap-2 text-xs text-text-tertiary">
                  ${typeof snap.score === 'number'
                    ? html`
                        <span class="aiux-badge aiux-badge-sm aiux-badge-neutral aiux-badge-soft">
                          ${i18n.getMessage('Score {value}', {value: String(snap.score)})}
                        </span>
                      `
                    : nothing}
                  ${typeof snap.word_count === 'number'
                    ? html`${i18n.getMessage('{count} words', {count: String(snap.word_count)})}`
                    : nothing}
                </span>
              `
            : nothing}
        </div>
        <div class="max-h-[32rem] overflow-y-auto p-4 text-sm leading-relaxed text-text-primary">
          ${this._renderStageContent(type)}
        </div>
      </div>
    `;
  }

  render() {
    if (!this._availableTypes().length) {
      return html`
        <div class="aiux-card bg-base-100 shadow-sm">
          <div class="aiux-card-body items-center gap-2 p-8 text-center">
            ${icon({name: 'clipboard-check-ai-sparkle', size: 'lg', class: 'text-text-tertiary'})}
            <p class="text-sm font-semibold text-text-primary">${i18n.getMessage('No content yet')}</p>
            <p class="max-w-md text-sm text-text-tertiary">
              ${i18n.getMessage("The pipeline hasn't produced any content snapshot for this article yet.")}
            </p>
          </div>
        </div>
      `;
    }

    const selectedOrdered = STAGE_ORDER.filter(type => this._selected.has(type));

    return html`
      <div class="aiux-card bg-base-100 shadow-sm">
        <div class="aiux-card-body gap-4 p-6">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="aiux-card-title text-base text-text-primary">
              ${i18n.getMessage('Content comparison')}
            </h2>
            <div class="flex flex-wrap items-center gap-2" role="group" aria-label=${i18n.getMessage('Stages to show')}>
              ${STAGE_ORDER.map(type => this._renderChip(type))}
            </div>
          </div>
          <div class="grid grid-cols-1 gap-4 ${this._gridColsClass()}">
            ${selectedOrdered.map(type => this._renderStagePanel(type))}
          </div>
        </div>
      </div>
    `;
  }
}
