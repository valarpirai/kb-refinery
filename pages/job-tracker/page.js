import {html, css} from 'lit';
import {customElement} from 'lit/decorators.js';
import {AIUXElement} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {navigate, getGlobalRouter} from '@servicenow/aiux/aiux-client';
import {setDocumentTitle} from '../../utils/document-title.js';
import '../../widgets/job-progress-tracker/index.js';
import '../../widgets/job-list-panel/index.js';

const SYSPARM_JOB = 'job';

@customElement('x-snc-kb-refinery-job-tracker-page')
export default class JobTrackerPage extends AIUXElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100%;
      container-type: inline-size;
    }
  `;

  static async loader(ctx) {
    return {selectedJobSysId: ctx.query?.[SYSPARM_JOB] || ''};
  }

  static properties = {
    _selectedJobSysId: {type: String, state: true}
  };

  _selectedJobSysIdInitialized = false;

  constructor() {
    super();
    this._selectedJobSysId = '';
  }

  firstUpdated() {
    setDocumentTitle(i18n.getMessage('Job Tracker'));
  }

  // Seeds the page's own selection state from the loader-resolved URL param
  // exactly once — after that, user selections (and the URL writes they
  // trigger) are the source of truth, not a re-read of loaderData.
  willUpdate() {
    if (!this._selectedJobSysIdInitialized && this.loaderData) {
      this._selectedJobSysId = this.loaderData.selectedJobSysId || '';
      this._selectedJobSysIdInitialized = true;
    }
  }

  _handleJobSelect = e => {
    const sysId = e.detail?.sysId || '';
    if (sysId === this._selectedJobSysId) return;
    this._selectedJobSysId = sysId;
    this._writeSelectedJobToUrl(sysId);
  };

  _writeSelectedJobToUrl(sysId) {
    const path = getGlobalRouter()?.currentPath ?? window.location.pathname;
    navigate(path, {
      shallow: true,
      replace: true,
      query: sysId ? {[SYSPARM_JOB]: sysId} : {}
    });
  }

  render() {
    return html`
      <div class="mx-auto flex max-w-7xl flex-col gap-6 p-4 lg:p-8">
        <div class="flex flex-col gap-2">
          <h1 class="text-3xl font-bold tracking-tight text-text-primary">
            ${i18n.getMessage('Job Tracker')}
          </h1>
          <p class="max-w-3xl text-sm text-text-secondary">
            ${i18n.getMessage(
              'Track a Knowledge Refinery analysis job through the pipeline in real time, or pick a different job from the list below.'
            )}
          </p>
        </div>

        <job-progress-tracker
          .jobSysId=${this._selectedJobSysId}
        ></job-progress-tracker>

        <job-list-panel
          .selectedJobSysId=${this._selectedJobSysId}
          @job-list:select=${this._handleJobSelect}
        ></job-list-panel>
      </div>
    `;
  }
}
