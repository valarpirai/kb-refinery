import {html, css} from 'lit';
import {customElement} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {repeat} from 'lit/directives/repeat.js';
import {
  AIUXWidgetElement,
  AMBController,
  decorators
} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {icon} from '@servicenow/aiux/aiux-directive-icon';
import {timeAgo} from '@servicenow/aiux/aiux-directive-time-ago';

const {name, description, bestFor, chatCompatible, category, server, discoverable} =
  decorators;

const JOB_TABLE = 'x_snc_kb_refinery_job';
const JOB_ITEM_TABLE = 'x_snc_kb_refinery_job_item';

// Duplicated (not shared) with job-progress-tracker/index.js deliberately —
// a local module imported by two or more widget *client* bundles is a real
// deploy-time hazard in this project (see environment-build-deploy.md); this
// is a handful of lines, cheaper to duplicate than to risk sharing.
function statusMeta(status) {
  const table = {
    pending: {tone: 'neutral', label: i18n.getMessage('Pending')},
    running: {tone: 'info', label: i18n.getMessage('Running')},
    completed: {tone: 'success', label: i18n.getMessage('Completed')},
    completed_with_errors: {tone: 'warning', label: i18n.getMessage('Completed with Errors')},
    failed: {tone: 'error', label: i18n.getMessage('Failed')}
  };
  return table[status] || {tone: 'neutral', label: status || ''};
}

// Real per-article status counts (x_snc_kb_refinery_job_item.status) --
// same set job-progress-tracker/index.js shows, duplicated for the same
// no-shared-client-module reason above.
function itemStatusMeta() {
  return [
    {id: 'pending', icon: 'clock', tone: 'neutral', label: i18n.getMessage('Pending')},
    {id: 'converting', icon: 'document-convert', tone: 'info', label: i18n.getMessage('Converting')},
    {id: 'analyzing', icon: 'magnifying-glass', tone: 'info', label: i18n.getMessage('Analyzing')},
    {id: 'enriching', icon: 'wrench-ai-sparkle', tone: 'info', label: i18n.getMessage('Enriching')},
    {id: 'scoring', icon: 'chart-speedometer', tone: 'info', label: i18n.getMessage('Scoring')},
    {id: 'completed', icon: 'circle-check', tone: 'success', label: i18n.getMessage('Completed')},
    {id: 'failed', icon: 'circle-exclamation', tone: 'error', label: i18n.getMessage('Failed')},
    {id: 'skipped', icon: 'workflow-skip', tone: 'neutral', label: i18n.getMessage('Skipped')}
  ];
}

@customElement('job-list-panel')
@name('Job List Panel')
@description(
  'Selectable list of Knowledge Refinery analysis jobs with live status, updated in real time via an AMB record watcher.'
)
@bestFor(
  'Letting a user browse and pick a Knowledge Refinery job to inspect elsewhere on the page.'
)
@chatCompatible(false)
@category('custom')
@server('./server.js')
@discoverable(true)
export default class JobListPanel extends AIUXWidgetElement {
  static fetchDataOnConnect = false;

  static properties = {
    selectedJobSysId: {type: String},
    _jobs: {type: Array, state: true},
    _loading: {type: Boolean, state: true},
    _error: {type: String, state: true}
  };

  static styles = css`
    :host {
      display: block;
    }
    .job-row {
      display: block;
      width: 100%;
      text-align: left;
      border: 1px solid var(--color-base-300, #e5e7eb);
      border-radius: var(--radius-lg, 0.5rem);
      background: var(--color-base-100, #fff);
      cursor: pointer;
      transition:
        border-color var(--duration-sm) linear,
        background-color var(--duration-sm) linear;
    }
    .job-row:hover {
      border-color: var(--color-primary, #007b9e);
    }
    .job-row:focus-visible {
      outline: 2px solid var(--color-primary, #007b9e);
      outline-offset: 2px;
    }
    .job-row--selected {
      border-color: var(--color-primary, #007b9e);
      background: var(--color-base-200, #f2f2f2);
    }
    @media (forced-colors: active) {
      .job-row {
        forced-color-adjust: none;
        background-color: ButtonFace;
        color: ButtonText;
        border-color: ButtonBorder;
      }
      .job-row * {
        color: inherit;
      }
      .job-row:hover {
        background-color: Highlight;
        color: HighlightText;
        border-color: Highlight;
      }
      .job-row:focus,
      .job-row:focus-visible {
        border-color: Highlight;
        outline: 2px solid Highlight;
        outline-offset: 2px;
      }
      .job-row[aria-current='true'] {
        background-color: SelectedItem;
        color: SelectedItemText;
        border-color: ButtonBorder;
      }
      .job-row[aria-current='true']:focus,
      .job-row[aria-current='true']:focus-visible {
        outline: 2px solid Highlight;
      }
    }
  `;

  _amb = new AMBController(this);
  _fetching = false;
  _refetchQueued = false;

  constructor() {
    super();
    this.selectedJobSysId = '';
    this._jobs = [];
    this._loading = false;
    this._error = '';
  }

  connectedCallback() {
    super.connectedCallback();
    // Subscription setup only (no data access) — AMBController itself
    // no-ops on the server, so this is safe to call during SSR too.
    // Job Item is watched too, broadly (any job) — the Job-table watcher
    // alone rarely refires now that Job.status only changes 2-3 times per
    // run; per-article progress lives on Job Item instead.
    this._amb.setRecordWatchers(
      [
        {table: JOB_TABLE, query: 'sys_idISNOTEMPTY'},
        {table: JOB_ITEM_TABLE, query: 'sys_idISNOTEMPTY'}
      ],
      this._handleAmbMessage
    );
  }

  // Not connectedCallback() for the actual fetch — see
  // widget-and-page-conventions.md on the SSR double-render race.
  firstUpdated() {
    this._fetchJobs();
  }

  _handleAmbMessage = () => {
    this._fetchJobs({silent: true});
  };

  async _fetchJobs({silent = false} = {}) {
    if (this._fetching) {
      this._refetchQueued = true;
      return;
    }
    this._fetching = true;
    if (!silent) this._loading = true;
    try {
      const response = await this.server.get({action: 'getJobs'});
      if (response?.isError) {
        this._error = response.errorMessage || i18n.getMessage('Failed to load jobs');
      } else {
        this._error = '';
        this._jobs = response.jobs || [];
      }
    } catch (e) {
      this._error = i18n.getMessage('Failed to load jobs');
    } finally {
      this._fetching = false;
      this._loading = false;
      if (this._refetchQueued) {
        this._refetchQueued = false;
        this._fetchJobs({silent: true});
      }
    }
  }

  _handleSelect(sysId) {
    this.dispatchEvent(
      new CustomEvent('job-list:select', {
        detail: {sysId},
        bubbles: true,
        composed: true
      })
    );
  }

  render() {
    if (this._loading) return this._renderSkeleton();
    if (this._error) return this._renderError();
    if (!this._jobs.length) return this._renderEmpty();
    return this._renderList();
  }

  _renderSkeleton() {
    return html`
      <div class="aiux-card bg-base-100 shadow-sm">
        <div class="aiux-card-body gap-3 p-6">
          ${Array(4)
            .fill(0)
            .map(() => html`<div class="aiux-skeleton h-14 w-full rounded"></div>`)}
        </div>
      </div>
    `;
  }

  _renderError() {
    return html`
      <div class="aiux-card bg-base-100 shadow-sm">
        <div class="aiux-card-body p-6">
          <div class="aiux-alert aiux-alert-error aiux-alert-soft">
            ${icon({name: 'circle-exclamation', size: 'sm'})}
            <span>${this._error}</span>
          </div>
        </div>
      </div>
    `;
  }

  _renderEmpty() {
    return html`
      <div class="aiux-card bg-base-100 shadow-sm">
        <div class="aiux-card-body flex flex-col items-center gap-2 p-10 text-center">
          ${icon({name: 'inbox', size: 'lg'})}
          <p class="text-sm text-text-tertiary">
            ${i18n.getMessage('No analysis jobs have run yet.')}
          </p>
        </div>
      </div>
    `;
  }

  _renderList() {
    return html`
      <div class="aiux-card bg-base-100 shadow-sm">
        <div class="aiux-card-body gap-3 p-6">
          <h3 class="aiux-card-title text-base text-text-primary">
            ${i18n.getMessage('Jobs')}
          </h3>
          <ul class="flex flex-col gap-2">
            ${repeat(
              this._jobs,
              job => job.sys_id,
              job => this._renderRow(job)
            )}
          </ul>
        </div>
      </div>
    `;
  }

  _renderRow(job) {
    const meta = statusMeta(job.status);
    const selected = job.sys_id === this.selectedJobSysId;
    const isFinished = job.status === 'completed' || job.status === 'completed_with_errors' || job.status === 'failed';

    return html`
      <li>
        <button
          type="button"
          class=${classMap({'job-row': true, 'job-row--selected': selected})}
          aria-current=${selected ? 'true' : 'false'}
          @click=${() => this._handleSelect(job.sys_id)}
        >
          <div class="flex flex-wrap items-center gap-3 p-3.5">
            <span
              class="aiux-badge aiux-badge-sm aiux-badge-${meta.tone} aiux-badge-soft gap-1"
            >
              ${meta.label}
            </span>
            <span class="flex flex-1 min-w-0 flex-wrap items-center gap-1">
              ${isFinished ? '' : this._renderItemCounts(job.itemCounts)}
            </span>
            <span class="text-xs text-text-tertiary">
              ${job.startedAt
                ? timeAgo(job.startedAt, {live: false})
                : ''}
            </span>
            <span class="text-xs text-text-tertiary">
              ${job.triggeredBy}
            </span>
          </div>
        </button>
      </li>
    `;
  }

  // Compact per-status count chips for a still-in-flight job -- only shows
  // buckets with a nonzero count, since this is a small space inside a list
  // row (job-progress-tracker's own detail view shows every bucket).
  _renderItemCounts(counts) {
    const safeCounts = counts || {};
    return itemStatusMeta()
      .filter(meta => (safeCounts[meta.id] || 0) > 0)
      .map(
        meta => html`
          <span class="aiux-badge aiux-badge-xs aiux-badge-${meta.tone} aiux-badge-soft gap-1">
            ${icon({name: meta.icon, size: 'xs'})}
            ${safeCounts[meta.id]}
          </span>
        `
      );
  }
}
