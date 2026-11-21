import {html, css} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {AIUXElement} from '@servicenow/aiux/aiux-components-core';

/** Lane footer renderer for <aiux-visual-board> — shows the "N more" remainder text. */
@customElement('pipeline-lane-footer')
export default class PipelineLaneFooter extends AIUXElement {
  @property({attribute: false}) data;

  static styles = css`
    :host {
      display: block;
    }
  `;

  render() {
    const {remainingLabel} = this.data ?? {};
    return html`
      <p class="pt-0.5 text-center text-[11px] text-text-tertiary">
        ${remainingLabel}
      </p>
    `;
  }
}
