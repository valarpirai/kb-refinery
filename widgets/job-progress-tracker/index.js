import {html, css} from 'lit';
import {customElement} from 'lit/decorators.js';
import {
  AIUXWidgetElement,
  AMBController,
  decorators
} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {icon} from '@servicenow/aiux/aiux-directive-icon';
import '@servicenow/aiux/aiux-components-score';

const {name, description, bestFor, chatCompatible, category, server, discoverable} =
  decorators;

const JOB_TABLE = 'x_snc_kb_refinery_job';
const JOB_ITEM_TABLE = 'x_snc_kb_refinery_job_item';

/**
 * Which article-level statuses to show, in display order, and how to badge
 * each one. Real per-article state (x_snc_kb_refinery_job_item.status) --
 * replaces the old single whole-job phase stepper, since different articles
 * genuinely progress at different rates (see docs/ideas/job-page-status-
 * change.md).
 */
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

function jobStatusMeta(status) {
  const table = {
    pending: {tone: 'neutral', label: i18n.getMessage('Pending')},
    running: {tone: 'info', label: i18n.getMessage('Running')},
    completed: {tone: 'success', label: i18n.getMessage('Completed')},
    completed_with_errors: {tone: 'warning', label: i18n.getMessage('Completed with Errors')},
    failed: {tone: 'error', label: i18n.getMessage('Failed')}
  };
  return table[status] || {tone: 'neutral', label: status || ''};
}

@customElement('job-progress-tracker')
@name('Job Progress Tracker')
@description(
  'Live view of a single Knowledge Refinery job — real per-article status counts, updated in real time via AMB record watchers.'
)
@bestFor(
  'Showing the live per-article progress and running counts of a selected Knowledge Refinery analysis job.'
)
@chatCompatible(false)
@category('custom')
@server('./server.js')
@discoverable(true)
export default class JobProgressTracker extends AIUXWidgetElement {
  // This widget owns its own fetch (keyed off the host-provided jobSysId) and
  // never reads this.data — the implicit fetch-on-connect path would misfire
  // an empty call against the server action dispatcher on every mount.
  static fetchDataOnConnect = false;

  static properties = {
    jobSysId: {type: String},
    _job: {type: Object, state: true},
    _loading: {type: Boolean, state: true},
    _error: {type: String, state: true},
    _announcement: {type: String, state: true}
  };

  static styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .live-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--color-success, #22c55e);
      animation: live-pulse 2.4s ease-in-out infinite;
    }
    @keyframes live-pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.35;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .live-dot {
        animation: none;
      }
    }
    /* The live dot's meaning (job actively running) is otherwise conveyed by
       color alone (WCAG 1.4.1) — swap to a plain outline dot under
       forced-colors rather than relying on the success-color fill. */
    @media (forced-colors: active) {
      .live-dot {
        background-color: SelectedItem;
      }
    }
  `;

  _amb = new AMBController(this);
  _lastLoadedSysId = undefined;
  _subscribedSysId = undefined;
  _fetching = false;
  _refetchQueued = false;
  _lastAnnouncedStatus = undefined;

  constructor() {
    super();
    this.jobSysId = '';
    this._job = null;
    this._loading = false;
    this._error = '';
    this._announcement = '';
  }

  // Deliberately not connectedCallback() — this widget self-triggers a fetch
  // based on a host-provided prop, and connectedCallback() also runs during
  // SSR; firstUpdated() only ever runs client-side, after hydration has
  // already settled for this element (see widget-and-page-conventions.md).
  firstUpdated() {
    this._maybeLoad();
    this._maybeSubscribe();
  }

  updated(changedProperties) {
    if (changedProperties.has('jobSysId')) {
      this._maybeLoad();
      this._maybeSubscribe();
    }
  }

  _maybeLoad() {
    const sysId = this.jobSysId || '';
    if (sysId === this._lastLoadedSysId) return;
    this._lastLoadedSysId = sysId;
    if (!sysId) {
      this._job = null;
      this._error = '';
      this._loading = false;
      return;
    }
    this._fetchJob(sysId);
  }

  _maybeSubscribe() {
    const sysId = this.jobSysId || '';
    if (sysId === this._subscribedSysId) return;
    this._subscribedSysId = sysId;
    if (!sysId) {
      // setRecordWatchers([]) tears down whatever watcher was previously
      // active — this is how the previous job's subscription is released
      // when the tracked job changes or is cleared.
      this._amb.setRecordWatchers([], this._handleAmbMessage);
      return;
    }
    // Two watchers: the Job row itself only flips 2-3 times a run now
    // (pending/running/completed*), so the Job Item watcher is what
    // actually drives real-time per-article progress here.
    this._amb.setRecordWatchers(
      [
        {table: JOB_TABLE, query: `sys_id=${sysId}`},
        {table: JOB_ITEM_TABLE, query: `job=${sysId}`}
      ],
      this._handleAmbMessage
    );
  }

  _handleAmbMessage = () => {
    // The AMB record-watcher payload isn't guaranteed to carry every custom
    // field we display, so treat any message as a signal to refetch the
    // full record rather than trying to parse it.
    if (!this.jobSysId) return;
    this._fetchJob(this.jobSysId, {silent: true});
  };

  async _fetchJob(sysId, {silent = false} = {}) {
    if (this._fetching) {
      this._refetchQueued = true;
      return;
    }
    this._fetching = true;
    if (!silent) this._loading = true;
    try {
      const response = await this.server.get({action: 'getJob', sysId});
      if (this.jobSysId !== sysId) return; // stale response — job changed mid-flight
      if (response?.isError) {
        this._error = response.errorMessage || i18n.getMessage('Failed to load job');
        this._job = null;
      } else {
        this._error = '';
        this._job = response.job;
        this._announceStatusChange(response.job?.status);
      }
    } catch (e) {
      if (this.jobSysId === sysId) {
        this._error = i18n.getMessage('Failed to load job');
        this._job = null;
      }
    } finally {
      this._fetching = false;
      if (this.jobSysId === sysId) this._loading = false;
      if (this._refetchQueued) {
        this._refetchQueued = false;
        this._fetchJob(this.jobSysId, {silent: true});
      }
    }
  }

  _announceStatusChange(status) {
    if (!status || status === this._lastAnnouncedStatus) return;
    this._lastAnnouncedStatus = status;
    const meta = jobStatusMeta(status);
    this._announcement = i18n.getMessage('Job status: {status}', {status: meta.label});
  }

  render() {
    if (this._loading) return this._renderSkeleton();
    if (this._error) return this._renderError();
    if (!this._job) return this._renderEmpty();
    return this._renderJob();
  }

  _renderSkeleton() {
    return html`
      <div class="aiux-card bg-base-100 shadow-sm h-full">
        <div class="aiux-card-body gap-4 p-6">
          <div class="aiux-skeleton h-6 w-48 rounded"></div>
          <div class="aiux-skeleton h-10 w-full rounded"></div>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
            ${Array(6)
              .fill(0)
              .map(() => html`<div class="aiux-skeleton h-16 w-full rounded"></div>`)}
          </div>
        </div>
      </div>
    `;
  }

  _renderError() {
    return html`
      <div class="aiux-card bg-base-100 shadow-sm h-full">
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
      <div class="aiux-card bg-base-100 shadow-sm h-full">
        <div class="aiux-card-body flex flex-col items-center justify-center gap-3 p-10 text-center">
          ${icon({name: 'activity', size: 'lg'})}
          <p class="max-w-xs text-sm text-text-tertiary">
            ${i18n.getMessage('Select a job below to see its live progress.')}
          </p>
        </div>
      </div>
    `;
  }

  _renderJob() {
    const job = this._job;
    const jobMeta = jobStatusMeta(job.status);
    const failed = job.status === 'failed';
    const running = job.status === 'pending' || job.status === 'running';

    return html`
      <div class="aiux-card bg-base-100 shadow-sm h-full">
        <div class="aiux-card-body gap-5 p-6">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              ${running ? html`<span class="live-dot" aria-hidden="true"></span>` : ''}
              <h3 class="aiux-card-title text-base text-text-primary">
                ${i18n.getMessage('Job {sysId}', {
                  sysId: String(job.sys_id).slice(0, 8)
                })}
              </h3>
              <span class="aiux-badge aiux-badge-sm aiux-badge-${jobMeta.tone} aiux-badge-soft">
                ${jobMeta.label}
              </span>
            </div>
            <span class="text-xs text-text-tertiary">
              ${job.triggeredBy
                ? i18n.getMessage('Triggered by {user}', {user: job.triggeredBy})
                : ''}
            </span>
          </div>

          <div class="sr-only" role="status">${this._announcement}</div>

          ${failed
            ? html`
                <div class="aiux-alert aiux-alert-error aiux-alert-soft">
                  ${icon({name: 'circle-exclamation', size: 'sm'})}
                  <span class="break-words">
                    ${job.errorMessage || i18n.getMessage('This job failed.')}
                  </span>
                </div>
              `
            : this._renderItemCounts(job.itemCounts)}

          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
            ${this._scoreTiles(job).map(
              tile => html`<aiux-score size="sm" .data=${tile}></aiux-score>`
            )}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Real per-article status counts, not an approximation — every article
   * this job is working on shows up in exactly one of these buckets right
   * now, and different articles can genuinely sit in different buckets at
   * the same time (an article with no gap finding reaches 'completed'
   * while a sibling is still 'enriching').
   */
  _renderItemCounts(counts) {
    const safeCounts = counts || {};
    return html`
      <ul class="flex flex-wrap gap-2" aria-label=${i18n.getMessage('Article status counts')}>
        ${itemStatusMeta().map(meta => {
          const count = safeCounts[meta.id] || 0;
          return html`
            <li
              class="aiux-badge aiux-badge-sm aiux-badge-${meta.tone} aiux-badge-soft gap-1"
              aria-hidden=${count === 0 ? 'true' : 'false'}
              style=${count === 0 ? 'opacity: 0.45' : ''}
            >
              ${icon({name: meta.icon, size: 'xs'})}
              ${meta.label}
              <span class="font-semibold">${count}</span>
            </li>
          `;
        })}
      </ul>
    `;
  }

  _scoreTiles(job) {
    const tile = (label, value) => ({
      label,
      value,
      formattedValue: String(value),
      format: 'number',
      sentiment: 'neutral'
    });
    return [
      tile(i18n.getMessage('Articles total'), job.articlesTotal),
      tile(i18n.getMessage('Processed'), job.articlesProcessed),
      tile(i18n.getMessage('Skipped'), job.articlesSkipped),
      tile(i18n.getMessage('Findings generated'), job.findingsGenerated),
      tile(i18n.getMessage('Duplicates found'), job.duplicatesFound),
      tile(i18n.getMessage('Broken links found'), job.brokenLinksFound)
    ];
  }
}
