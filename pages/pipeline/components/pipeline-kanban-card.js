import {html, css, nothing} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {AIUXElement} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {icon} from '@servicenow/aiux/aiux-directive-icon';

/**
 * Tone → complete literal Tailwind class strings — building `text-${tone}` inline
 * would hide the class name from Tailwind's static scanner.
 */
const FLAG_TONE = {
  neutral: 'text-text-tertiary',
  warning: 'text-warning',
  error: 'text-error'
};

/**
 * Card renderer for <aiux-visual-board> on the pipeline page — read-only, no drag
 * affordance. Clicking or activating the card fires `pipeline-kanban-card:open` with
 * the full article record so the page can show the original/shadow comparison.
 *
 * A card shows its score progression once it has one, and otherwise the plain status
 * line for its state. `flag` is separate from both: it carries what the state itself
 * doesn't say — a gap-finding count, a matched-incident count, a duplicate pairing —
 * since those come from passes that don't move the article between states.
 */
@customElement('pipeline-kanban-card')
export default class PipelineKanbanCard extends AIUXElement {
  @property({attribute: false}) data;

  static styles = css`
    :host {
      display: block;
    }
    @media (forced-colors: active) {
      .card {
        forced-color-adjust: none;
        background-color: Canvas;
        color: CanvasText;
        border-color: CanvasText;
      }
    }
  `;

  _open() {
    this.dispatchEvent(
      new CustomEvent('pipeline-kanban-card:open', {
        detail: {...this.data},
        bubbles: true,
        composed: true
      })
    );
  }

  render() {
    const {title, meta, readability, flag} = this.data ?? {};
    const flagClass = flag ? (FLAG_TONE[flag.tone] ?? FLAG_TONE.neutral) : '';
    return html`
      <button
        type="button"
        class="card flex w-full flex-col gap-1.5 rounded-[10px] border border-base-300 bg-base-100 p-3 text-left"
        aria-label=${i18n.getMessage('Open {title}', {title})}
        @click=${() => this._open()}
      >
        <p class="break-words text-xs font-semibold leading-snug text-text-primary">
          ${title}
        </p>
        ${readability
          ? html`
              <span class="inline-flex items-center gap-1 text-[11px] font-bold text-success">
                <span>${readability.from}</span>
                ${icon({name: 'arrow-right', size: 'xs'})}
                <span>${readability.to}</span>
                ${icon({name: 'chevron-up', size: 'xs'})}
              </span>
            `
          : nothing}
        ${meta
          ? html`<span class="text-[11px] text-text-tertiary">${meta}</span>`
          : nothing}
        ${flag
          ? html`<span
              class="inline-flex w-fit items-center gap-1 rounded-full border border-base-300 px-1.5 py-0.5 text-[10px] font-semibold ${flagClass}"
              >${flag.label}</span
            >`
          : nothing}
      </button>
    `;
  }
}
