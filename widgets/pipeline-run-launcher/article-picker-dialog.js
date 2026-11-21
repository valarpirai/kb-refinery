import {html, css} from 'lit';
import {customElement, property, query, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {AIUXElement, getLogger} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {icon} from '@servicenow/aiux/aiux-directive-icon';

/** Debounce for the search-as-you-type field, same order of magnitude as
 * <aiux-control-input>'s own STAGED_VALUE_CHANGED debounce. */
const SEARCH_DEBOUNCE_MS = 250;

const log = getLogger('article-picker-dialog');

/**
 * KB-article search + multi-select picker, opened from
 * pipeline-run-launcher's button. Mirrors article-diff-dialog.js's native
 * <dialog> pattern (no <aiux-dialog> component exists in this app). Purely
 * presentational + selection state — the host widget owns the actual
 * searchArticles/startRun server calls, since only an AIUXWidgetElement has
 * `this.server`.
 */
@customElement('article-picker-dialog')
export default class ArticlePickerDialog extends AIUXElement {
  @property({attribute: false}) results = [];
  @property({type: Boolean}) searching = false;
  @property({type: Boolean}) starting = false;
  @property({type: String}) error = '';

  @state() _term = '';
  @state() _selectedIds = new Set();
  // Defaults true: a user who explicitly opened this picker and picked
  // specific articles has already made the judgment call that they want
  // those articles reprocessed right now, unchanged-since-last-run or not.
  @state() _force = true;

  @query('dialog') _dialogEl;

  _debounceTimer = null;

  static styles = css`
    :host {
      display: contents;
    }
    dialog {
      /*
       * A modal <dialog> is centered by the UA's own dialog:modal {margin:
       * auto} rule — but this shadow root adopts the app's Tailwind sheet,
       * whose preflight (*, :after, :before, ::backdrop { ... margin: 0;
       * padding: 0 }) zeroes it, pinning the dialog to the viewport's
       * top-left corner. Set it back explicitly; there is nothing to opt out
       * of the preflight with.
       */
      margin: auto;
      max-width: min(640px, calc(100vw - 2rem));
      width: 100%;
      max-height: calc(100vh - 2rem);
      padding: 0;
      border: none;
      border-radius: var(--radius-2xl, 1rem);
      overflow: hidden;
      background-color: var(--color-base-100);
      color: var(--color-text-primary);
    }
    dialog::backdrop {
      background: rgba(15, 23, 32, 0.55);
    }
    .article-row {
      display: block;
      width: 100%;
      text-align: left;
      border: 1px solid var(--color-base-300, #e5e7eb);
      border-radius: var(--radius-lg, 0.5rem);
      background: var(--color-base-100, #fff);
      cursor: pointer;
    }
    .article-row:hover {
      border-color: var(--color-primary, #007b9e);
    }
    .article-row--selected {
      border-color: var(--color-primary, #007b9e);
      background: var(--color-base-200, #f2f2f2);
    }
    @media (forced-colors: active) {
      dialog {
        background-color: Canvas;
        color: CanvasText;
        border: 2px solid CanvasText;
      }
      .article-row {
        forced-color-adjust: none;
        background-color: ButtonFace;
        color: ButtonText;
        border-color: ButtonBorder;
      }
      .article-row--selected {
        background-color: SelectedItem;
        color: SelectedItemText;
      }
    }
  `;

  open() {
    this._term = '';
    this._selectedIds = new Set();
    this._force = true;
    this.results = [];
    if (!this._dialogEl) {
      log.error({}, 'No <dialog> element in shadow root; article picker cannot open.');
      return;
    }
    try {
      this._dialogEl.showModal();
    } catch (err) {
      log.error({message: err?.message}, 'dialog.showModal() threw; article picker did not open.');
    }
  }

  close() {
    this._dialogEl?.close();
  }

  _handleBackdropClick(e) {
    if (e.target === this._dialogEl) this.close();
  }

  _handleInput(e) {
    this._term = e.target.value;
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this.dispatchEvent(
        new CustomEvent('article-picker:search', {
          detail: {term: this._term.trim()},
          bubbles: true,
          composed: true
        })
      );
    }, SEARCH_DEBOUNCE_MS);
  }

  _toggle(sysId) {
    const next = new Set(this._selectedIds);
    if (next.has(sysId)) {
      next.delete(sysId);
    } else {
      next.add(sysId);
    }
    this._selectedIds = next;
  }

  _handleForceToggle(e) {
    this._force = e.target.checked;
  }

  _handleConfirm() {
    if (this._selectedIds.size === 0 || this.starting) return;
    this.dispatchEvent(
      new CustomEvent('article-picker:confirm', {
        detail: {articleSysIds: Array.from(this._selectedIds), force: this._force},
        bubbles: true,
        composed: true
      })
    );
  }

  // data-a11y-skip: backdrop-click-to-close is a pointer-only convenience;
  // Escape already closes <dialog> natively for keyboard users.
  render() {
    return html`
      <dialog
        @click=${e => this._handleBackdropClick(e)}
        aria-labelledby="article-picker-title"
        data-a11y-skip
      >
        <div class="flex max-h-[calc(100vh-2rem)] flex-col">
          <header class="flex items-start justify-between gap-4 border-b border-base-300 bg-base-100 p-5">
            <div class="min-w-0">
              <h2 id="article-picker-title" class="text-lg font-bold text-text-primary">
                ${i18n.getMessage('Refine articles')}
              </h2>
              <p class="mt-1 text-sm text-text-secondary">
                ${i18n.getMessage(
                  'Pick one or more knowledge articles to send through the refinery right now, instead of waiting for the next scheduled batch.'
                )}
              </p>
            </div>
            <button
              type="button"
              class="aiux-btn aiux-btn-ghost aiux-btn-sm aiux-btn-square flex-shrink-0"
              aria-label=${i18n.getMessage('Close')}
              @click=${() => this.close()}
            >
              ${icon({name: 'close', size: 'sm'})}
            </button>
          </header>

          <div class="flex-1 overflow-y-auto p-5">
            <input
              type="text"
              class="aiux-input w-full"
              aria-label=${i18n.getMessage('Search by title or number')}
              placeholder=${i18n.getMessage('Search by title or number…')}
              .value=${this._term}
              @input=${e => this._handleInput(e)}
            />

            ${this.error
              ? html`
                  <div class="aiux-alert aiux-alert-error aiux-alert-soft mt-3">
                    ${icon({name: 'circle-exclamation', size: 'sm'})}
                    <span>${this.error}</span>
                  </div>
                `
              : ''}

            <ul class="mt-3 flex flex-col gap-2">
              ${this.searching
                ? html`<li class="aiux-skeleton h-12 w-full rounded"></li>`
                : this.results.length === 0
                  ? this._term.trim()
                    ? html`<li class="p-3 text-sm text-text-tertiary">
                        ${i18n.getMessage('No matching articles.')}
                      </li>`
                    : // An empty term is a real query now (the host browses the
                      // most recently updated articles on open), so an empty
                      // list here means there genuinely are none to pick.
                      html`<li class="p-3 text-sm text-text-tertiary">
                        ${i18n.getMessage('No knowledge articles available to refine.')}
                      </li>`
                  : this.results.map(article => this._renderRow(article))}
            </ul>
          </div>

          <footer class="flex items-center justify-between gap-3 border-t border-base-300 bg-base-100 p-5">
            <div class="flex flex-col gap-2">
              <span class="text-sm text-text-secondary">
                ${i18n.getMessage('{count} selected', {
                  count: String(this._selectedIds.size)
                })}
              </span>
              <label class="flex items-center gap-2 text-sm text-text-secondary" for="force-reprocess">
                <input
                  id="force-reprocess"
                  type="checkbox"
                  class="aiux-checkbox aiux-checkbox-sm"
                  .checked=${this._force}
                  @change=${e => this._handleForceToggle(e)}
                />
                ${i18n.getMessage('Reprocess even if unchanged since last run')}
              </label>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="aiux-btn aiux-btn-ghost aiux-btn-sm"
                @click=${() => this.close()}
              >
                ${i18n.getMessage('Cancel')}
              </button>
              <button
                type="button"
                class="aiux-btn aiux-btn-primary aiux-btn-sm"
                ?disabled=${this._selectedIds.size === 0 || this.starting}
                @click=${() => this._handleConfirm()}
              >
                ${this.starting
                  ? i18n.getMessage('Starting…')
                  : i18n.getMessage('Start refining')}
              </button>
            </div>
          </footer>
        </div>
      </dialog>
    `;
  }

  _renderRow(article) {
    const selected = this._selectedIds.has(article.sysId);
    return html`
      <li>
        <button
          type="button"
          class=${classMap({'article-row': true, 'article-row--selected': selected})}
          aria-pressed=${selected ? 'true' : 'false'}
          @click=${() => this._toggle(article.sysId)}
        >
          <div class="flex items-center gap-3 p-3">
            <input
              type="checkbox"
              class="aiux-checkbox aiux-checkbox-sm"
              aria-label=${article.shortDescription || article.number}
              .checked=${selected}
              tabindex="-1"
              aria-hidden="true"
            />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-semibold text-text-primary">
                ${article.shortDescription || article.number}
              </div>
              <div class="mt-0.5 truncate text-xs text-text-tertiary">
                ${article.number}${article.kbName ? ` · ${article.kbName}` : ''}${article.workflowState
                  ? ` · ${article.workflowState}`
                  : ''}
              </div>
            </div>
          </div>
        </button>
      </li>
    `;
  }
}
