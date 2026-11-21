import {html, css, nothing} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {AIUXElement} from '@servicenow/aiux/aiux-components-core';
import {icon} from '@servicenow/aiux/aiux-directive-icon';

/**
 * Tone → complete literal Tailwind class strings — building `text-${tone}` inline
 * would hide the class name from Tailwind's static scanner.
 */
const TONE_TEXT = {
  brand: 'text-primary',
  success: 'text-success',
  neutral: 'text-text-tertiary',
  warning: 'text-warning',
  error: 'text-error'
};

/**
 * Lane header renderer for <aiux-visual-board> on the pipeline page.
 *
 * A lane is either on the refining path or an off-path terminal (`exit`). Exits get a
 * dashed rule and a leaving-the-path arrow rather than a stage icon, so the board
 * doesn't read as one straight left-to-right funnel — which it isn't.
 */
@customElement('pipeline-lane-header')
export default class PipelineLaneHeader extends AIUXElement {
  @property({attribute: false}) data;

  static styles = css`
    :host {
      display: block;
    }
    .exit-rule {
      border-bottom: 1px dashed var(--color-base-300);
    }
  `;

  render() {
    const {title, count, done, exit, tone} = this.data ?? {};
    const toneClass = TONE_TEXT[tone] ?? TONE_TEXT.neutral;
    const marker = exit
      ? icon({name: 'arrow-down-right', size: 'xs', class: toneClass})
      : done
        ? icon({name: 'circle-check', size: 'xs', class: 'text-success'})
        : nothing;

    return html`
      <div
        class="flex items-center justify-between gap-2 px-0.5 pb-1 ${exit
          ? 'exit-rule'
          : ''}"
      >
        <span
          class="flex items-center gap-1.5 text-xs font-bold ${exit
            ? 'text-text-secondary'
            : 'text-text-primary'}"
        >
          ${marker} ${title}
        </span>
        <span
          class="rounded-full border border-base-300 bg-base-100 px-2 py-0.5 text-[11px] font-bold text-text-tertiary"
        >
          ${count}
        </span>
      </div>
    `;
  }
}
