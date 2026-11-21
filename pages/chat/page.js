import {html, css} from 'lit';
import {customElement} from 'lit/decorators.js';
import {AIUXElement} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {setDocumentTitle} from '../../utils/document-title.js';
import '../../widgets/chat-thread/index.js';

const SYSPARM_QUESTION = 'q';

/**
 * Multi-turn chat page. If arriving from /ask's search box, ?q=<question>
 * carries the first question, which widgets/chat-thread sends itself on
 * mount (see its firstUpdated()) -- this page doesn't call the backend
 * directly, it only forwards the query param.
 */
@customElement('x-snc-kb-refinery-chat-page')
export default class ChatPage extends AIUXElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
  `;

  static async loader(ctx) {
    return {initialQuestion: ctx.query?.[SYSPARM_QUESTION] || ''};
  }

  static properties = {
    _initialQuestion: {type: String, state: true}
  };

  _initialQuestionInitialized = false;

  constructor() {
    super();
    this._initialQuestion = '';
  }

  firstUpdated() {
    setDocumentTitle(i18n.getMessage('EmployeeWorks'));
  }

  // Same one-time loaderData seeding pattern as pages/job-tracker/page.js --
  // willUpdate() runs during SSR too, unlike firstUpdated(), so the widget's
  // initialQuestion prop is already correct on first paint.
  willUpdate() {
    if (!this._initialQuestionInitialized && this.loaderData) {
      this._initialQuestion = this.loaderData.initialQuestion || '';
      this._initialQuestionInitialized = true;
    }
  }

  render() {
    return html`<chat-thread .initialQuestion=${this._initialQuestion}></chat-thread>`;
  }
}
