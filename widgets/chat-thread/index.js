import {html, css, nothing} from 'lit';
import {customElement} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {unsafeHTML} from 'lit/directives/unsafe-html.js';
import {AIUXWidgetElement, decorators} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {icon} from '@servicenow/aiux/aiux-directive-icon';
import '@servicenow/aiux-components-loader';

const {name, description, bestFor, chatCompatible, category, server, discoverable} = decorators;

let _seq = 0;
function nextId() {
  return ++_seq;
}

function formatTimestamp(ts) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit',
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(ts));
  } catch (e) {
    return '';
  }
}

/**
 * Multi-turn chat thread: message bubbles, a "Thinking…" placeholder shown
 * immediately (not awaited before the UI updates) while widgets/chat-
 * thread/server.js's `ask` action runs, and a fixed input box for
 * follow-ups. See widget-and-page-conventions.md -- explicit-fetch widget,
 * never reads this.data, so fetchDataOnConnect is off.
 */
@customElement('chat-thread')
@name('Chat Thread')
@description('Multi-turn chat UI backed by a server-side LLM call + RAG search.')
@bestFor('The assistant conversation page -- shows a message thread and a follow-up input box.')
@chatCompatible(false)
@category('custom')
@server('./server.js')
@discoverable(true)
export default class ChatThread extends AIUXWidgetElement {
  static fetchDataOnConnect = false;

  static properties = {
    /** Optional first question, e.g. from a ?q= query param on the page. */
    initialQuestion: {type: String},
    /** Which RefineryAssistantRag.KB_SOURCES key to search -- set by pages/ask's own source picker. */
    kbSource: {type: String},
    _messages: {type: Array, state: true},
    _input: {type: String, state: true},
    _sending: {type: Boolean, state: true}
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }

    .thread {
      flex: 1;
      overflow-y: auto;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .message {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      max-width: 48rem;
    }

    .message--assistant {
      align-self: flex-start;
    }

    .message--user {
      align-self: flex-start;
    }

    .message-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.75rem;
      height: 1.75rem;
      border-radius: 999px;
      flex-shrink: 0;
      font-size: 0.75rem;
      font-weight: 700;
    }

    .avatar--user {
      background: color-mix(in srgb, var(--color-success) 30%, var(--color-base-100));
      color: var(--color-text-primary);
    }

    .avatar--assistant {
      color: var(--color-primary);
    }

    .author {
      font-weight: 600;
      font-size: 0.875rem;
      color: var(--color-text-primary);
    }

    .timestamp {
      font-size: 0.75rem;
      color: var(--color-text-tertiary);
    }

    .message-body {
      font-size: 0.9375rem;
      line-height: 1.6;
      color: var(--color-text-primary);
      padding-left: 2.25rem;
    }

    .message-body :first-child {
      margin-top: 0;
    }
    .message-body p {
      margin: 0.5em 0;
    }
    .message-body ul,
    .message-body ol {
      margin: 0.5em 0;
      padding-left: 1.4em;
    }
    .message-body ul {
      list-style: disc;
    }
    .message-body ol {
      list-style: decimal;
    }
    .message-body code {
      font-family: var(--font-mono, monospace);
      background: var(--color-base-200);
      border-radius: 3px;
      padding: 0.1em 0.3em;
      font-size: 0.9em;
    }
    .message-body a {
      color: var(--color-primary);
      text-decoration: underline;
    }

    .sources {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
      padding-left: 2.25rem;
    }

    .thinking {
      padding-left: 2.25rem;
    }

    .composer {
      flex-shrink: 0;
      padding: 1rem 1.5rem 1.5rem;
    }

    .composer-box {
      position: relative;
      max-width: 48rem;
      margin: 0 auto;
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
      font-size: 0.9375rem;
      line-height: 1.4rem;
      color: var(--color-text-primary);
      padding: 1rem 3.5rem 1rem 1.25rem;
      min-height: 3rem;
      max-height: 10rem;
    }

    .send-btn {
      position: absolute;
      right: 0.625rem;
      bottom: 0.625rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.25rem;
      height: 2.25rem;
      border-radius: 999px;
      border: none;
      cursor: pointer;
      background: color-mix(in srgb, var(--color-primary) 16%, transparent);
      color: var(--color-primary);
    }

    .send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `;

  constructor() {
    super();
    this._messages = [];
    this._input = '';
    this._sending = false;
    this._rendered = new Map();
    this.kbSource = 'generic';
  }

  // Deliberately firstUpdated(), not connectedCallback() -- the latter
  // also runs during SSR, and firing the initial question's async server
  // call there could race client hydration (see widget-and-page-
  // conventions.md).
  firstUpdated() {
    if (this.initialQuestion) {
      void this._send(this.initialQuestion);
    }
  }

  updated(changed) {
    if (changed.has('_messages')) {
      void this._renderMarkdown();
      this._scrollToBottom();
    }
  }

  _scrollToBottom() {
    const thread = this.renderRoot.querySelector('.thread');
    if (thread) thread.scrollTop = thread.scrollHeight;
  }

  async _ensureRenderer() {
    if (this._renderer) return this._renderer;
    const [{marked}, DOMPurifyMod] = await Promise.all([import('marked'), import('dompurify')]);
    this._renderer = {marked, DOMPurify: DOMPurifyMod.default ?? DOMPurifyMod};
    return this._renderer;
  }

  async _renderMarkdown() {
    const pending = this._messages.filter(
      m => m.role === 'assistant' && !m.thinking && !m.error && m.content && !this._rendered.has(m.id)
    );
    if (!pending.length) return;
    const {marked, DOMPurify} = await this._ensureRenderer();
    for (const msg of pending) {
      try {
        this._rendered.set(msg.id, DOMPurify.sanitize(await marked.parse(msg.content)));
      } catch (e) {
        this._rendered.set(msg.id, '');
      }
    }
    // Trigger a re-render now that new entries exist -- _rendered itself
    // isn't a reactive property.
    this.requestUpdate();
  }

  _replaceMessage(id, patch) {
    this._messages = this._messages.map(m => (m.id === id ? {...m, ...patch} : m));
  }

  async _send(rawText) {
    const text = (rawText ?? this._input).trim();
    if (!text || this._sending) return;

    const history = this._messages
      .filter(m => !m.thinking && !m.error)
      .map(m => ({role: m.role, content: m.content}));

    const userMessage = {id: nextId(), role: 'user', content: text, ts: Date.now()};
    const thinkingMessage = {id: nextId(), role: 'assistant', content: '', thinking: true, ts: Date.now()};

    this._input = '';
    this._messages = [...this._messages, userMessage, thinkingMessage];
    this._sending = true;

    try {
      const response = await this.server.get({action: 'ask', message: text, history, kbSource: this.kbSource});
      if (response?.isError) {
        this._replaceMessage(thinkingMessage.id, {
          thinking: false,
          error: true,
          content: response.errorMessage || i18n.getMessage('Something went wrong.')
        });
      } else {
        this._replaceMessage(thinkingMessage.id, {
          thinking: false,
          content: response?.reply || '',
          sources: response?.sources || []
        });
      }
    } catch (e) {
      this._replaceMessage(thinkingMessage.id, {
        thinking: false,
        error: true,
        content: i18n.getMessage('Something went wrong.')
      });
    } finally {
      this._sending = false;
    }
  }

  get _canSend() {
    return this._input.trim().length > 0 && !this._sending;
  }

  _handleInput(e) {
    this._input = e.target.value;
  }

  _handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void this._send();
    }
  }

  _renderAvatar(role) {
    return role === 'user'
      ? html`<span class="avatar avatar--user">${i18n.getMessage('You').charAt(0)}</span>`
      : html`<span class="avatar avatar--assistant">${icon({name: 'ai-sparkle', size: 'sm'})}</span>`;
  }

  _renderBody(message) {
    if (message.thinking) {
      return html`
        <div class="thinking">
          <aiux-loader size="4xs" label=${i18n.getMessage('Thinking…')}></aiux-loader>
        </div>
      `;
    }
    if (message.error) {
      return html`<p class="message-body text-error">${message.content}</p>`;
    }
    const rendered = this._rendered.get(message.id);
    return html`
      <div class="message-body">
        ${rendered !== undefined ? unsafeHTML(rendered) : message.content}
      </div>
    `;
  }

  _renderSources(message) {
    if (message.thinking || message.error || !message.sources?.length) return nothing;
    return html`
      <div class="sources">
        ${message.sources.map(
          (src, i) => html`
            <span class="aiux-badge aiux-badge-sm aiux-badge-neutral aiux-badge-soft">
              [${i + 1}] ${src.title || src.number}
            </span>
          `
        )}
      </div>
    `;
  }

  _renderMessage(message) {
    const author = message.role === 'user' ? i18n.getMessage('You') : i18n.getMessage('EmployeeWorks');
    return html`
      <div class=${classMap({message: true, [`message--${message.role}`]: true})}>
        <div class="message-header">
          ${this._renderAvatar(message.role)}
          <span class="author">${author}</span>
          <span class="timestamp">${formatTimestamp(message.ts)}</span>
        </div>
        ${this._renderBody(message)}
        ${this._renderSources(message)}
      </div>
    `;
  }

  render() {
    return html`
      <div class="thread">${this._messages.map(m => this._renderMessage(m))}</div>
      <div class="composer">
        <div class="composer-box">
          <textarea
            rows="1"
            .value=${this._input}
            placeholder=${i18n.getMessage('Find answers, automate tasks, or create content instantly')}
            aria-label=${i18n.getMessage('Ask a follow-up question')}
            @input=${this._handleInput}
            @keydown=${this._handleKeydown}
          ></textarea>
          <button
            type="button"
            class="send-btn"
            ?disabled=${!this._canSend}
            aria-label=${i18n.getMessage('Send')}
            @click=${() => this._send()}
          >
            ${icon({name: 'circle-arrow-up', size: 'md'})}
          </button>
        </div>
      </div>
    `;
  }
}
