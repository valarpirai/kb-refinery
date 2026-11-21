import {html, css} from 'lit';
import {customElement} from 'lit/decorators.js';
import {AIUXWidgetElement, decorators, getLogger} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {icon} from '@servicenow/aiux/aiux-directive-icon';
import './article-picker-dialog.js';

const {name, description, bestFor, chatCompatible, category, server, discoverable} =
  decorators;

const log = getLogger('pipeline-run-launcher');

@customElement('pipeline-run-launcher')
@name('Pipeline Run Launcher')
@description(
  'Button + KB article picker that starts a real Knowledge Refinery pipeline run scoped to one or more chosen articles.'
)
@bestFor(
  'Letting a user kick off a real pipeline run against specific KB articles, to watch the pipeline live without waiting for the next scheduled batch.'
)
@chatCompatible(false)
@category('custom')
@server('./server.js')
@discoverable(true)
export default class PipelineRunLauncher extends AIUXWidgetElement {
  // Owns its own server calls (searchArticles/startRun), never reads
  // this.data -- the implicit fetch-on-connect path would misfire an empty
  // call against the server action dispatcher on every mount.
  static fetchDataOnConnect = false;

  static properties = {
    _results: {type: Array, state: true},
    _searching: {type: Boolean, state: true},
    _starting: {type: Boolean, state: true},
    _error: {type: String, state: true}
  };

  static styles = css`
    :host {
      display: block;
    }

    /*
     * This is the home page's one primary action, so it is deliberately not an
     * .aiux-btn: a pill with a lit primary gradient, a coloured lift shadow and
     * a diagonal sheen, sized well above the sm buttons around it. The page's
     * own .cta-panel provides the surface this sits on — the two are designed
     * together.
     *
     * Flat token fill declared before the gradient: a browser without
     * color-mix() drops the gradient entirely, and a transparent primary
     * action is worse than a flat one.
     */
    .cta {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      overflow: hidden;
      border: none;
      border-radius: 999px;
      padding: 0.8125rem 1.5rem;
      font-family: inherit;
      font-size: 0.9375rem;
      font-weight: 600;
      letter-spacing: 0.01em;
      white-space: nowrap;
      cursor: pointer;
      color: var(--color-primary-content);
      background: var(--color-primary);
      background: linear-gradient(
        135deg,
        color-mix(in srgb, var(--color-primary) 82%, #ffffff) 0%,
        var(--color-primary) 52%,
        color-mix(in srgb, var(--color-primary) 82%, #000000) 100%
      );
      box-shadow:
        0 1px 2px rgba(0, 0, 0, 0.12),
        0 10px 24px -10px color-mix(in srgb, var(--color-primary) 70%, transparent);
      transition:
        transform var(--duration-sm) var(--ease-medium-accel),
        box-shadow var(--duration-sm) var(--ease-medium-accel);
    }

    /* Diagonal sheen — pure gloss, sits under the label. */
    .cta::after {
      content: '';
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: linear-gradient(
        160deg,
        rgba(255, 255, 255, 0.22) 0%,
        rgba(255, 255, 255, 0.06) 38%,
        rgba(255, 255, 255, 0) 62%
      );
    }

    .cta > * {
      position: relative;
    }

    .cta:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow:
        0 2px 4px rgba(0, 0, 0, 0.14),
        0 16px 32px -12px color-mix(in srgb, var(--color-primary) 80%, transparent);
    }

    .cta:active:not(:disabled) {
      transform: translateY(0);
    }

    .cta:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 3px;
    }

    .cta:disabled {
      cursor: not-allowed;
      opacity: 0.5;
      box-shadow: none;
    }

    /*
     * The lift is emphasis, not information — the disabled state and the label
     * already carry whether the action is available.
     */
    @media (prefers-reduced-motion: reduce) {
      .cta {
        transition: box-shadow var(--duration-xs) linear;
      }
      .cta:hover:not(:disabled),
      .cta:active:not(:disabled) {
        transform: none;
      }
    }

    /*
     * forced-colors replaces the gradient, the sheen and the shadow wholesale,
     * leaving nothing to read the button's boundary from (WCAG 1.4.1) — so it
     * falls back to the system button pair with a real border, and the sheen is
     * dropped rather than painted as an opaque block over the label.
     */
    @media (forced-colors: active) {
      .cta {
        color: ButtonText;
        background: ButtonFace;
        border: 2px solid ButtonBorder;
      }
      .cta::after {
        display: none;
      }
      .cta:disabled {
        color: GrayText;
        border-color: GrayText;
        opacity: 1;
      }
    }
  `;

  // The dialog is portalled to document.body (see _ensureDialog) rather
  // than rendered in this template — nested two shadow roots deep under
  // whatever ancestor on the host page establishes a containing block for
  // fixed-position elements (a transform/contain/filter/etc. up the tree),
  // <article-picker-dialog>'s native <dialog> centered itself against that
  // ancestor's box instead of the viewport, rendering pinned to a corner
  // instead of centered. Portalling it to document.body removes every such
  // ancestor from the equation.
  _dialogEl = null;

  constructor() {
    super();
    this._results = [];
    this._searching = false;
    this._starting = false;
    this._error = '';
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._dialogEl) {
      this._dialogEl.removeEventListener('article-picker:search', this._handleSearch);
      this._dialogEl.removeEventListener('article-picker:confirm', this._handleConfirm);
      this._dialogEl.remove();
      this._dialogEl = null;
    }
  }

  updated(changed) {
    super.updated(changed);
    if (
      this._dialogEl &&
      (changed.has('_results') ||
        changed.has('_searching') ||
        changed.has('_starting') ||
        changed.has('_error'))
    ) {
      this._syncDialogProps();
    }
  }

  _syncDialogProps() {
    this._dialogEl.results = this._results;
    this._dialogEl.searching = this._searching;
    this._dialogEl.starting = this._starting;
    this._dialogEl.error = this._error;
  }

  _ensureDialog() {
    if (this._dialogEl) return this._dialogEl;
    // Bare addEventListener, not a Lit `@event=${...}` binding, since this
    // element lives outside any Lit render tree once portalled — but
    // _handleSearch/_handleConfirm are arrow-function class fields, so
    // `this` is already lexically bound and needs no extra .bind() here.
    const dialog = document.createElement('article-picker-dialog');
    dialog.addEventListener('article-picker:search', this._handleSearch);
    dialog.addEventListener('article-picker:confirm', this._handleConfirm);
    document.body.appendChild(dialog);
    this._dialogEl = dialog;
    return dialog;
  }

  async _openPicker() {
    this._error = '';
    const dialog = this._ensureDialog();
    this._syncDialogProps();
    await dialog.updateComplete;
    if (!dialog.isConnected) {
      log.error({}, 'article-picker-dialog got disconnected before it could open; aborting.');
      return;
    }
    dialog.open();
    // Browse the most recently updated articles straight away, rather than
    // opening on an empty list that only fills once the user types — an empty
    // term is a real, supported query on the server side, not a no-op.
    void this._search('');
  }

  _handleSearch = e => {
    void this._search(e.detail?.term ?? '');
  };

  /**
   * A failed search sets `_error` rather than just emptying the list: an
   * unreported failure is indistinguishable from "no article matched", which is
   * exactly the confusion a silently-swallowed error here produced before.
   */
  async _search(term) {
    this._searching = true;
    try {
      const response = await this.server.get({action: 'searchArticles', term});
      if (response?.isError) {
        this._results = [];
        this._error =
          response.errorMessage || i18n.getMessage('Failed to search articles');
        return;
      }
      this._error = '';
      this._results = response?.articles ?? [];
    } catch (err) {
      log.error({message: err?.message}, 'searchArticles failed.');
      this._results = [];
      this._error = i18n.getMessage('Failed to search articles');
    } finally {
      this._searching = false;
    }
  }

  _handleConfirm = async e => {
    const articleSysIds = e.detail?.articleSysIds ?? [];
    const force = !!e.detail?.force;
    if (!articleSysIds.length || this._starting) return;
    this._starting = true;
    this._error = '';
    try {
      const response = await this.server.get({action: 'startRun', articleSysIds, force});
      if (response?.isError) {
        this._error = response.errorMessage || i18n.getMessage('Failed to start run');
        return;
      }
      this._dialogEl?.close();
      this.dispatchEvent(
        new CustomEvent('pipeline-run-launcher:started', {
          detail: {jobSysId: response?.jobSysId ?? ''},
          bubbles: true,
          composed: true
        })
      );
    } catch (err) {
      this._error = i18n.getMessage('Failed to start run');
    } finally {
      this._starting = false;
    }
  };

  render() {
    return html`
      <button
        type="button"
        class="cta"
        @click=${() => this._openPicker()}
      >
        <span aria-hidden="true">${icon({name: 'ai-sparkle', size: 'sm'})}</span>
        <span>${i18n.getMessage('Refine articles')}</span>
      </button>
    `;
  }
}
