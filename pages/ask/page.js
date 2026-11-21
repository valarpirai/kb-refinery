import {html, css} from 'lit';
import {customElement} from 'lit/decorators.js';
import {AIUXElement} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {setDocumentTitle} from '../../utils/document-title.js';
import '../../widgets/chat-launcher/index.js';
import '../../widgets/chat-thread/index.js';

/**
 * Keys/order must match src/fluent/script-includes/refineryAssistantRag.
 * server.js's own RefineryAssistantRag.KB_SOURCES exactly -- this is a
 * client-side mirror, not read from the server, so the label text is kept
 * in sync by hand (same "same fact, two files, keep them in sync manually"
 * situation as job.now.ts's own status choice list, see
 * .claude/rules/kb-refinery-domain.md's "Call 1 dispatched 3 times" note).
 * 'converted'/'enriched' are real, selectable options -- they just fall
 * back to 'generic' search results server-side today, since no search
 * profile/source exists yet over that Snapshot content.
 */
const KB_SOURCE_OPTIONS = [
  {value: 'generic', label: i18n.getMessage('All Knowledge Articles')},
  {value: 'converted', label: i18n.getMessage('Converted content')},
  {value: 'enriched', label: i18n.getMessage('Enriched content')}
];

/**
 * Single-page chat mockup: greeting + <chat-launcher> search box first;
 * once the user submits a question, this page swaps to <chat-thread> in
 * place (same page, same route) instead of navigating anywhere. See
 * .claude/rules/kb-refinery-widgets.md -- a separate /chat page route
 * 404'd ("page not found") on the deployed instance despite its records
 * looking correct, while everything worked immediately once confined to
 * one page. This client-side swap is the resulting design, not a
 * temporary workaround.
 */
@customElement('x-snc-kb-refinery-ask-page')
export default class AskPage extends AIUXElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }

    .kb-source-bar {
      flex-shrink: 0;
      display: flex;
      justify-content: flex-end;
      padding: 0.75rem 1.5rem 0;
    }

    .kb-source-label {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.8125rem;
      color: var(--color-text-tertiary);
    }

    select.kb-source-select {
      font: inherit;
      font-size: 0.8125rem;
      color: var(--color-text-primary);
      background: var(--color-base-100);
      border: 1px solid var(--color-border, var(--color-base-300));
      border-radius: var(--radius-field, 0.5rem);
      padding: 0.3rem 0.6rem;
      cursor: pointer;
    }

    select.kb-source-select:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 1px;
    }

    .swap-area {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
  `;

  static properties = {
    _question: {type: String, state: true},
    _kbSource: {type: String, state: true}
  };

  constructor() {
    super();
    this._question = '';
    this._kbSource = KB_SOURCE_OPTIONS[0].value;
  }

  firstUpdated() {
    setDocumentTitle(i18n.getMessage('EmployeeWorks'));
  }

  _handleSubmit = e => {
    this._question = e.detail?.question || '';
  };

  _handleKbSourceChange = e => {
    this._kbSource = e.target.value;
  };

  _renderKbSourcePicker() {
    return html`
      <div class="kb-source-bar">
        <label class="kb-source-label">
          <span>${i18n.getMessage('Knowledge source')}</span>
          <select
            class="kb-source-select"
            .value=${this._kbSource}
            aria-label=${i18n.getMessage('Knowledge source')}
            @change=${this._handleKbSourceChange}
          >
            ${KB_SOURCE_OPTIONS.map(opt => html`<option value=${opt.value}>${opt.label}</option>`)}
          </select>
        </label>
      </div>
    `;
  }

  render() {
    return html`
      ${this._renderKbSourcePicker()}
      <div class="swap-area">
        ${this._question
          ? html`<chat-thread .initialQuestion=${this._question} .kbSource=${this._kbSource}></chat-thread>`
          : html`
              <div class="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 pt-24 pb-12 text-center">
                <h1 class="text-3xl font-bold tracking-tight text-text-primary">
                  ${i18n.getMessage('Good morning!')}
                </h1>
                <div class="w-full" @chat-launcher:submit=${this._handleSubmit}>
                  <chat-launcher></chat-launcher>
                </div>
              </div>
            `}
      </div>
    `;
  }
}
