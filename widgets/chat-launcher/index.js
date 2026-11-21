import {html, css} from 'lit';
import {customElement} from 'lit/decorators.js';
import {AIUXElement, decorators} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {icon} from '@servicenow/aiux/aiux-directive-icon';

const {name, description, bestFor, chatCompatible, category, discoverable} = decorators;

/** Static, non-functional beyond filling the textarea -- purely for visual parity with the mockup. */
function quickPrompts() {
  return [
    i18n.getMessage('Get started'),
    i18n.getMessage('Find information'),
    i18n.getMessage('Give kudos'),
    i18n.getMessage('Expense a meal')
  ];
}

/**
 * Landing search box: greeting + a single textarea with a send button,
 * mirroring the ServiceNow homepage's "Find answers..." box. No server.js --
 * this widget never fetches anything, it only dispatches
 * `chat-launcher:submit` (detail: {question}) with the typed question.
 *
 * Deliberately does NOT navigate to a separate page for this -- see
 * .claude/rules/kb-refinery-widgets.md for why: a second, brand-new AIUX
 * page route 404'd ("page not found") on the deployed instance even
 * though its page/widget/experience-page-rel records all looked correct,
 * while mounting the same chat-thread widget directly alongside this one
 * on a single existing page worked immediately. Same event-dispatch
 * pattern already used by pipeline-run-launcher's `pipeline-run-launcher:
 * started` (see pages/home/page.js's _handleRunStarted) -- the host page
 * listens and swaps in <chat-thread>.
 */
@customElement('chat-launcher')
@name('Chat Launcher')
@description('Greeting + search box that starts a new Knowledge Refinery assistant chat.')
@bestFor('A landing page entry point into the chat assistant, matching the ServiceNow homepage search box.')
@chatCompatible(false)
@category('custom')
@discoverable(true)
export default class ChatLauncher extends AIUXElement {
  static properties = {
    _value: {type: String, state: true}
  };

  static styles = css`
    :host {
      display: block;
    }

    .search-box {
      position: relative;
      background: var(--color-base-100);
      border-radius: var(--radius-box, 1rem);
      box-shadow: var(--shadow-lg);
    }

    textarea {
      width: 100%;
      resize: none;
      border: none;
      outline: none;
      background: transparent;
      font-family: inherit;
      font-size: 1rem;
      line-height: 1.5rem;
      color: var(--color-text-primary);
      padding: 1.25rem 4rem 1.25rem 1.5rem;
      min-height: 3.5rem;
      max-height: 12rem;
    }

    textarea::placeholder {
      color: var(--color-text-tertiary);
    }

    .send-btn {
      position: absolute;
      right: 0.75rem;
      bottom: 0.75rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.5rem;
      height: 2.5rem;
      border-radius: 999px;
      border: none;
      cursor: pointer;
      background: color-mix(in srgb, var(--color-primary) 16%, transparent);
      color: var(--color-primary);
      transition: background-color var(--duration-sm) linear;
    }

    .send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .send-btn:not(:disabled):hover {
      background: color-mix(in srgb, var(--color-primary) 26%, transparent);
    }
  `;

  constructor() {
    super();
    this._value = '';
  }

  get _canSend() {
    return this._value.trim().length > 0;
  }

  _handleInput(e) {
    this._value = e.target.value;
  }

  _handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._submit();
    }
  }

  _handleQuickPrompt(text) {
    this._value = text;
    this.updateComplete.then(() => {
      this.renderRoot.querySelector('textarea')?.focus();
    });
  }

  _submit() {
    const text = this._value.trim();
    if (!text) return;
    this.dispatchEvent(
      new CustomEvent('chat-launcher:submit', {
        detail: {question: text},
        bubbles: true,
        composed: true
      })
    );
  }

  render() {
    return html`
      <div class="flex flex-col gap-4">
        <div class="search-box">
          <textarea
            rows="1"
            .value=${this._value}
            placeholder=${i18n.getMessage('Find answers, automate tasks, or create content instantly')}
            aria-label=${i18n.getMessage('Ask the assistant')}
            @input=${this._handleInput}
            @keydown=${this._handleKeydown}
          ></textarea>
          <button
            type="button"
            class="send-btn"
            ?disabled=${!this._canSend}
            aria-label=${i18n.getMessage('Send')}
            @click=${this._submit}
          >
            ${icon({name: 'circle-arrow-up', size: 'md'})}
          </button>
        </div>
        <div class="flex flex-wrap gap-2">
          ${quickPrompts().map(
            text => html`
              <button
                type="button"
                class="aiux-btn aiux-btn-sm aiux-btn-outline rounded-full"
                @click=${() => this._handleQuickPrompt(text)}
              >
                ${text}
              </button>
            `
          )}
        </div>
      </div>
    `;
  }
}
