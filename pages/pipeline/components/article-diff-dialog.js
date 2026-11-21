import {html, css} from 'lit';
import {customElement, property, query} from 'lit/decorators.js';
import {AIUXElement} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {icon} from '@servicenow/aiux/aiux-directive-icon';

const PRINTER_TITLE = 'Troubleshooting printer connectivity issues';
/**
 * States with no enriched version to compare against yet. `no_gaps` and `no_evidence`
 * belong here too: both are terminals that legitimately never produce a rewritten
 * article, so there is nothing to show on the right-hand side — a real outcome rather
 * than a stage still in progress.
 */
const PENDING_STAGES = new Set([
  'ingested',
  'converted',
  'analyzed',
  'enriching',
  'synthesizing',
  'no_gaps',
  'no_evidence',
  'failed'
]);

/**
 * Why there is nothing to compare against, per state. The three terminals are not
 * "not yet" cases — an article that left the path never produces a rewritten version
 * at all, so saying it is still on its way would be wrong.
 *
 * Getters, not plain strings: the i18n extractor only captures literal arguments at
 * build time, so each message has to sit inside its own inline getMessage call.
 */
const PENDING_COPY = {
  no_gaps: {
    title: () => i18n.getMessage('Never rewritten'),
    body: () =>
      i18n.getMessage(
        'Analysis found no gap that incident evidence could close, so this article skipped enrichment entirely. Its findings and its converted version are still available — it was diagnosed, not changed.'
      )
  },
  no_evidence: {
    title: () => i18n.getMessage('Nothing to rewrite from'),
    body: () =>
      i18n.getMessage(
        'Enrichment ran, but the matched incidents revealed nothing this article was missing. The enriched version records that reason instead of content.'
      )
  },
  failed: {
    title: () => i18n.getMessage('Stopped before rewriting'),
    body: () =>
      i18n.getMessage(
        'This article stopped before a rewritten version was produced. The failure is recorded against the state it was in at the time, per article.'
      )
  }
};

const PENDING_DEFAULT = {
  title: () => i18n.getMessage('No rewritten version yet'),
  body: () =>
    i18n.getMessage(
      'This article is still on the refining path. A rewritten version appears here once article synthesis has run for it.'
    )
};

function scoreTone(score) {
  if (score >= 80) return 'success';
  if (score >= 50) return 'warning';
  return 'error';
}

/**
 * Side-by-side "original vs. AI shadow record" comparison, opened from either a
 * traveling tunnel dot or an "Articles in flight" card. Purely presentational —
 * receives an `article` record and decides bespoke vs. generic filler content and
 * pending-vs-available state itself, since that's display logic, not page state.
 */
@customElement('article-diff-dialog')
export default class ArticleDiffDialog extends AIUXElement {
  @property({attribute: false}) article = null;
  @property({type: String}) currentStageId = '';

  @query('dialog') _dialogEl;

  static styles = css`
    :host {
      display: contents;
    }
    /*
     * A <dialog> gets no background of its own — the UA default is plain white. Pulling
     * the surface and text from the theme tokens instead keeps it consistent with
     * whatever the page is themed to rather than pinning a palette here.
     */
    dialog {
      max-width: min(920px, calc(100vw - 2rem));
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
    .hl-remove {
      background: #fbe7e7;
      color: #b23b3b;
      text-decoration: line-through;
      text-decoration-color: #b23b3b;
      border-radius: 3px;
      padding: 1px 3px;
    }
    .hl-reword {
      background: #fbeeda;
      color: #6b4708;
      border-radius: 3px;
      padding: 1px 3px;
    }
    .hl-add {
      background: #e1f3e8;
      color: #145c39;
      border-radius: 3px;
      padding: 1px 3px;
    }
    @media (forced-colors: active) {
      dialog {
        background-color: Canvas;
        color: CanvasText;
        border: 2px solid CanvasText;
      }
      .hl-remove,
      .hl-reword,
      .hl-add {
        background: Canvas;
        color: CanvasText;
        forced-color-adjust: none;
      }
      .close-btn {
        forced-color-adjust: none;
        background-color: ButtonFace;
        color: ButtonText;
        border: 2px solid ButtonBorder;
      }
      .close-btn:hover {
        background-color: Highlight;
        color: HighlightText;
      }
    }
  `;

  open() {
    this._dialogEl?.showModal();
  }

  close() {
    this._dialogEl?.close();
  }

  _handleBackdropClick(e) {
    if (e.target === this._dialogEl) this.close();
  }

  render() {
    const article = this.article;
    if (!article) return html`<dialog></dialog>`;

    const pending = this.currentStageId
      ? PENDING_STAGES.has(this.currentStageId)
      : !article.readability;
    const health = article.health ?? 70;
    const readability = article.readability;

    // data-a11y-skip: backdrop-click-to-close is a pointer-only convenience;
    // Escape already closes <dialog> natively for keyboard users.
    return html`
      <dialog
        @click=${e => this._handleBackdropClick(e)}
        aria-labelledby="article-diff-title"
        data-a11y-skip
      >
        <div class="flex max-h-[calc(100vh-2rem)] flex-col">
          <header class="flex items-start justify-between gap-4 border-b border-base-300 bg-base-100 p-5">
            <div class="min-w-0">
              <p class="font-mono text-[11px] font-bold uppercase tracking-wide text-text-tertiary">
                ${i18n.getMessage('Article detail')}
              </p>
              <h2 id="article-diff-title" class="mt-1 break-words text-xl font-bold text-text-primary">
                ${article.title}
              </h2>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <span class="text-sm text-text-secondary">${article.category}</span>
                <span class="aiux-badge aiux-badge-sm aiux-badge-${scoreTone(health)} aiux-badge-soft">
                  ${i18n.getMessage('Health {score}', {score: String(health)})}
                </span>
                ${readability
                  ? html`
                      <span class="aiux-badge aiux-badge-sm aiux-badge-info aiux-badge-soft">
                        ${i18n.getMessage('Readability {from} → {to}', {
                          from: String(readability.from),
                          to: String(readability.to)
                        })}
                      </span>
                    `
                  : html`
                      <span class="aiux-badge aiux-badge-sm aiux-badge-neutral aiux-badge-soft">
                        ${i18n.getMessage('Not yet restructured')}
                      </span>
                    `}
              </div>
            </div>
            <button
              type="button"
              class="close-btn aiux-btn aiux-btn-ghost aiux-btn-sm aiux-btn-square flex-shrink-0"
              aria-label=${i18n.getMessage('Close')}
              @click=${() => this.close()}
            >
              ${icon({name: 'close', size: 'sm'})}
            </button>
          </header>

          <div class="flex-1 overflow-y-auto p-5">
            ${pending
              ? this._renderPending()
              : article.title === PRINTER_TITLE
                ? this._renderPrinterDiff()
                : this._renderGenericDiff(article)}
          </div>
        </div>
      </dialog>
    `;
  }

  _renderPending() {
    const copy = PENDING_COPY[this.currentStageId] ?? PENDING_DEFAULT;
    const iconName =
      this.currentStageId === 'failed'
        ? 'triangle-exclamation'
        : this.currentStageId === 'no_gaps'
          ? 'shield-check'
          : 'clipboard-check-ai-sparkle';

    return html`
      <div class="flex flex-col items-center gap-2 rounded-2xl border border-base-300 bg-base-200 px-6 py-10 text-center">
        ${icon({name: iconName, size: 'lg', class: 'text-text-tertiary'})}
        <p class="text-sm font-semibold text-text-primary">
          ${copy.title()}
        </p>
        <p class="max-w-md text-sm text-text-tertiary">
          ${copy.body()}
        </p>
      </div>
    `;
  }

  _renderSummaryBar(chips) {
    return html`
      <div class="aiux-card mb-4 bg-base-100 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-4 p-4">
          <div class="flex flex-wrap items-center gap-4 text-xs text-text-secondary">
            <span class="flex items-center gap-1.5">
              <span class="hl-remove inline-block h-3 w-3 rounded-sm"></span>
              ${i18n.getMessage('Removed')}
            </span>
            <span class="flex items-center gap-1.5">
              <span class="hl-reword inline-block h-3 w-3 rounded-sm"></span>
              ${i18n.getMessage('Reworded')}
            </span>
            <span class="flex items-center gap-1.5">
              <span class="hl-add inline-block h-3 w-3 rounded-sm"></span>
              ${i18n.getMessage('Added for clarity')}
            </span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            ${chips.map(
              chip => html`
                <span class="rounded-full border border-base-300 bg-base-200 px-3 py-1 text-xs font-semibold text-text-primary">
                  ${chip}
                </span>
              `
            )}
          </div>
        </div>
      </div>
    `;
  }

  _renderPanel({icon: iconName, iconTone, title, sub, children}) {
    return html`
      <div class="aiux-card flex flex-col bg-base-100 shadow-sm">
        <div class="flex items-center gap-2.5 border-b border-base-300 p-4">
          <span class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[8px] bg-base-200 ${iconTone}">
            ${icon({name: iconName, size: 'sm'})}
          </span>
          <div>
            <p class="text-[13px] font-bold text-text-primary">${title}</p>
            <p class="text-[11px] text-text-tertiary">${sub}</p>
          </div>
        </div>
        <div class="flex flex-col gap-3.5 p-5 text-[13.5px] leading-relaxed text-text-primary">
          ${children}
        </div>
      </div>
    `;
  }

  _renderPrinterDiff() {
    return html`
      ${this._renderSummaryBar([
        i18n.getMessage('4 jargon terms simplified'),
        i18n.getMessage('3 steps reworded'),
        i18n.getMessage('Reading grade 14 → 8')
      ])}
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        ${this._renderPanel({
          icon: 'document-workflow',
          iconTone: 'text-text-secondary',
          title: i18n.getMessage('Original article'),
          sub: i18n.getMessage('As authored · KB0012938, v3'),
          children: html`
            <p>
              <span class="hl-remove"
                >${i18n.getMessage(
                  'Occasionally end users will encounter degraded connectivity to networked print devices due to DHCP lease expiration or a stale ARP cache entry on the workstation NIC.'
                )}</span
              >
              ${i18n.getMessage(
                'This document enumerates remediation steps for L1 support technicians triaging print connectivity tickets prior to escalation.'
              )}
            </p>
            <ol class="flex list-decimal flex-col gap-2.5 pl-5">
              <li>
                ${i18n.getMessage(
                  "Confirm the printer's IP is reachable via ICMP echo request (ping) from the affected workstation."
                )}
              </li>
              <li>
                <span class="hl-reword">
                  ${i18n.getMessage(
                    'If unreachable, release and renew the DHCP lease via'
                  )}
                  <code class="rounded bg-base-200 px-1 py-0.5 font-mono text-xs">ipconfig /release &amp;&amp; ipconfig /renew</code>.
                </span>
              </li>
              <li>
                ${i18n.getMessage('Flush the local ARP cache using')}
                <code class="rounded bg-base-200 px-1 py-0.5 font-mono text-xs">arp -d *</code>.
              </li>
              <li>
                <span class="hl-reword">
                  ${i18n.getMessage(
                    'Restart the Print Spooler service (services.msc > Print Spooler > Restart).'
                  )}
                </span>
              </li>
              <li>
                ${i18n.getMessage(
                  'If the issue persists, escalate to Network Operations with the ticket number and workstation hostname.'
                )}
              </li>
            </ol>
          `
        })}
        ${this._renderPanel({
          icon: 'clipboard-check-ai-sparkle',
          iconTone: 'text-primary',
          title: i18n.getMessage('AI-readable shadow record'),
          sub: i18n.getMessage('Generated · pending approval'),
          children: html`
            <p>
              <span class="hl-add">
                ${i18n.getMessage(
                  "Your printer may lose connection when your computer's network settings expire or become outdated."
                )}
              </span>
            </p>
            <ol class="flex list-decimal flex-col gap-2.5 pl-5">
              <li>
                <b>${i18n.getMessage('Check the connection')}</b> —
                ${i18n.getMessage(
                  "try printing a test page or pinging the printer's IP address."
                )}
              </li>
              <li>
                <span class="hl-reword">
                  <b>${i18n.getMessage('Refresh your network settings')}</b>
                  —
                  ${i18n.getMessage('open Command Prompt and run')}
                  <code class="rounded bg-base-200 px-1 py-0.5 font-mono text-xs">ipconfig /release</code>,
                  ${i18n.getMessage('then')}
                  <code class="rounded bg-base-200 px-1 py-0.5 font-mono text-xs">ipconfig /renew</code>.
                </span>
              </li>
              <li>
                <b>${i18n.getMessage('Clear stored device addresses')}</b> —
                ${i18n.getMessage('run')}
                <code class="rounded bg-base-200 px-1 py-0.5 font-mono text-xs">arp -d *</code>
                ${i18n.getMessage('in Command Prompt.')}
              </li>
              <li>
                <span class="hl-reword">
                  <b>${i18n.getMessage('Restart the print service')}</b> —
                  ${i18n.getMessage('open')}
                  <code class="rounded bg-base-200 px-1 py-0.5 font-mono text-xs">services.msc</code>,
                  ${i18n.getMessage(
                    'find Print Spooler, and click Restart.'
                  )}
                </span>
              </li>
              <li>
                <span class="hl-add">
                  <b>${i18n.getMessage('Still not working?')}</b> —
                  ${i18n.getMessage(
                    'contact Network Operations and include your ticket number and computer name.'
                  )}
                </span>
              </li>
            </ol>
          `
        })}
      </div>
    `;
  }

  _renderGenericDiff(article) {
    return html`
      ${this._renderSummaryBar([
        i18n.getMessage('3 jargon terms simplified'),
        i18n.getMessage('2 steps reworded'),
        i18n.getMessage('Reading grade 12 → 8')
      ])}
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        ${this._renderPanel({
          icon: 'document-workflow',
          iconTone: 'text-text-secondary',
          title: i18n.getMessage('Original article'),
          sub: i18n.getMessage('As authored'),
          children: html`
            <p>
              <span class="hl-remove">
                ${i18n.getMessage(
                  'This article describes "{title}" using dense, unstructured paragraphs written for readers already familiar with the underlying system.',
                  {title: article.title}
                )}
              </span>
            </p>
            <ol class="flex list-decimal flex-col gap-2.5 pl-5">
              <li>${i18n.getMessage('Review the relevant system settings before making any change.')}</li>
              <li>
                <span class="hl-reword">
                  ${i18n.getMessage('Apply the required change according to the documented procedure.')}
                </span>
              </li>
              <li>${i18n.getMessage('Confirm the change took effect as expected.')}</li>
              <li>${i18n.getMessage('Escalate to the relevant team if the issue persists.')}</li>
            </ol>
          `
        })}
        ${this._renderPanel({
          icon: 'clipboard-check-ai-sparkle',
          iconTone: 'text-primary',
          title: i18n.getMessage('AI-readable shadow record'),
          sub: i18n.getMessage('Generated · pending approval'),
          children: html`
            <p>
              <span class="hl-add">
                ${i18n.getMessage(
                  "Here's a simplified walkthrough for “{title}.”",
                  {title: article.title}
                )}
              </span>
            </p>
            <ol class="flex list-decimal flex-col gap-2.5 pl-5">
              <li>
                <b>${i18n.getMessage('Check your current settings')}</b> —
                ${i18n.getMessage('confirm what needs to change before you start.')}
              </li>
              <li>
                <span class="hl-reword">
                  <b>${i18n.getMessage('Make the change')}</b> —
                  ${i18n.getMessage('follow the steps in order, one at a time.')}
                </span>
              </li>
              <li>
                <b>${i18n.getMessage('Double-check it worked')}</b> —
                ${i18n.getMessage('verify the result before closing this out.')}
              </li>
              <li>
                <span class="hl-add">
                  <b>${i18n.getMessage('Still stuck?')}</b> —
                  ${i18n.getMessage('reach out to the owning team with your ticket number.')}
                </span>
              </li>
            </ol>
          `
        })}
      </div>
    `;
  }
}
