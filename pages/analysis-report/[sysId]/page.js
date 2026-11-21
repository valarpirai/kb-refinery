import {html, css, nothing} from 'lit';
import {customElement} from 'lit/decorators.js';
import {AIUXElement} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {icon} from '@servicenow/aiux/aiux-directive-icon';
import {navigate} from '@servicenow/aiux/aiux-client';
import {setDocumentTitle} from '../../../utils/document-title.js';
import './components/analysis-content-viewer.js';
import {fetchAnalysisReport} from './analysis-report-data.js';

const PIPELINE_PATH = '/pipeline';
const ANALYSIS_REPORT_PATH_PREFIX = '/analysis-report/';

const NO_VALUE = '—';

const SEVERITY_ORDER = ['high', 'medium', 'low'];

/** Rows shown in the score/counter comparison table, in display order. */
const SNAPSHOT_METRIC_ROWS = [
  {key: 'score', label: () => i18n.getMessage('Mechanical score')},
  {key: 'llm_score', label: () => i18n.getMessage('LLM score')},
  {key: 'word_count', label: () => i18n.getMessage('Word count')},
  {key: 'token_count', label: () => i18n.getMessage('Token count')},
  {key: 'image_count', label: () => i18n.getMessage('Image count')},
  {key: 'link_count', label: () => i18n.getMessage('Link count')},
  {key: 'broken_link_count', label: () => i18n.getMessage('Broken links')}
];

/** Score/health thresholds -- matches the bands used on the pipeline/home pages. */
function scoreTone(score) {
  if (score >= 80) return 'success';
  if (score >= 50) return 'warning';
  return 'error';
}

function stageTone(stage) {
  if (stage === 'ready') return 'success';
  if (stage === 'failed') return 'error';
  return 'info';
}

function confidenceTone(confidence) {
  if (confidence === 'high') return 'success';
  if (confidence === 'medium') return 'warning';
  if (confidence === 'low') return 'error';
  return 'neutral';
}

@customElement('x-snc-kb-refinery-analysis-report-page')
export default class AnalysisReportPage extends AIUXElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100%;
      container-type: inline-size;
    }
  `;

  static async loader(ctx) {
    const sysId = ctx.params?.sysId ?? '';
    if (!sysId) return {sysId: '', notFound: true};
    return fetchAnalysisReport(sysId);
  }

  // Deliberately firstUpdated() and not connectedCallback() -- the latter
  // also runs during SSR, and setting document.title there is pointless
  // (see widget-and-page-conventions.md).
  firstUpdated() {
    const analysis = this.loaderData?.analysis;
    const title = analysis
      ? analysis.standardized_summary?.display_value ||
        analysis.standardized_summary?.value ||
        i18n.getMessage('Analysis report')
      : i18n.getMessage('Analysis report');
    setDocumentTitle(title);
  }

  _renderNotFound() {
    return html`
      <div class="mx-auto flex max-w-3xl flex-col items-center gap-3 p-10 text-center">
        ${icon({name: 'triangle-exclamation', size: 'lg', class: 'text-text-tertiary'})}
        <h1 class="text-xl font-bold text-text-primary">${i18n.getMessage('Analysis not found')}</h1>
        <p class="text-sm text-text-tertiary">
          ${i18n.getMessage("This analysis record doesn't exist, or you don't have access to it.")}
        </p>
        <button
          type="button"
          class="aiux-btn aiux-btn-primary aiux-btn-sm"
          @click=${() => navigate(PIPELINE_PATH)}
        >
          ${i18n.getMessage('Back to pipeline')}
        </button>
      </div>
    `;
  }

  _renderHeader(data) {
    const {analysis, source} = data;
    const title =
      analysis.standardized_summary?.display_value ||
      analysis.standardized_summary?.value ||
      (source.ok ? source.title : '') ||
      i18n.getMessage('Untitled analysis');

    const subtitleParts = [];
    if (source.ok) {
      if (source.number) subtitleParts.push(source.number);
      if (source.title && source.title !== title) subtitleParts.push(source.title);
      if (source.category) subtitleParts.push(source.category);
    }

    return html`
      <div>
        <p class="font-mono text-xs font-bold uppercase tracking-wide text-primary">
          ${i18n.getMessage('Analysis report')}
        </p>
        <h1 class="mt-1 text-3xl font-bold tracking-tight text-text-primary">${title}</h1>
        ${source.ok
          ? html`<p class="mt-1.5 text-sm text-text-secondary">${subtitleParts.join(' · ')}</p>`
          : html`
              <span class="mt-1.5 inline-flex aiux-badge aiux-badge-sm aiux-badge-warning aiux-badge-soft">
                ${i18n.getMessage('Source article unavailable')}
              </span>
            `}
      </div>
    `;
  }

  _renderBadges(analysis, findings) {
    const stage = analysis.pipeline_stage?.value || '';
    const stageLabel = analysis.pipeline_stage?.display_value || stage;
    const audience = analysis.target_audience?.display_value || '';
    const confidence = analysis.enrichment_confidence?.value || '';
    const confidenceLabel = analysis.enrichment_confidence?.display_value || '';
    const kb = analysis.kb_knowledge_base?.display_value || '';
    const sourceUpdated = analysis.source_updated_on?.display_value || '';
    const hasAudienceMismatch = (findings || []).some(f => f.type?.value === 'audience_mismatch');

    return html`
      <div class="flex flex-wrap items-center gap-2">
        ${stageLabel
          ? html`<span class="aiux-badge aiux-badge-sm aiux-badge-${stageTone(stage)} aiux-badge-soft">${stageLabel}</span>`
          : nothing}
        ${audience
          ? html`
              <span class="aiux-badge aiux-badge-sm aiux-badge-neutral aiux-badge-soft">
                ${i18n.getMessage('Audience: {audience}', {audience})}
              </span>
            `
          : nothing}
        ${hasAudienceMismatch
          ? html`
              <span class="aiux-badge aiux-badge-sm aiux-badge-warning aiux-badge-soft">
                ${i18n.getMessage('Audience mismatch flagged')}
              </span>
            `
          : nothing}
        ${confidenceLabel
          ? html`
              <span class="aiux-badge aiux-badge-sm aiux-badge-${confidenceTone(confidence)} aiux-badge-soft">
                ${i18n.getMessage('Enrichment confidence: {level}', {level: confidenceLabel})}
              </span>
            `
          : nothing}
        ${kb ? html`<span class="aiux-badge aiux-badge-sm aiux-badge-neutral aiux-badge-soft">${kb}</span>` : nothing}
        ${sourceUpdated
          ? html`
              <span class="text-xs text-text-tertiary">
                ${i18n.getMessage('Source updated {date}', {date: sourceUpdated})}
              </span>
            `
          : nothing}
      </div>
    `;
  }

  _renderFailureAlert(analysis) {
    if ((analysis.pipeline_stage?.value || '') !== 'failed') return nothing;
    const jobError = analysis['last_job.error_message']?.display_value || analysis['last_job.error_message']?.value || '';
    if (!jobError) return nothing;
    return html`
      <div class="aiux-alert aiux-alert-error aiux-alert-soft">
        <p class="text-sm">${jobError}</p>
      </div>
    `;
  }

  /**
   * Mechanical/LLM score rows get a tone-colored badge; plain counters stay
   * plain text. `snapshots[type][rowKey]` is already a real number (or
   * `null`) by the time it reaches here -- analysis-report-data.js coerces
   * it once at the data layer, since the Table API itself serializes every
   * field (Integer columns included) as a JSON string.
   */
  _renderMetricCell(snapshots, type, rowKey) {
    const value = snapshots?.[type]?.[rowKey];
    if (typeof value !== 'number') return html`<span class="text-text-tertiary">${NO_VALUE}</span>`;
    if (rowKey === 'score' || rowKey === 'llm_score') {
      return html`
        <span class="aiux-badge aiux-badge-sm aiux-badge-${scoreTone(value)} aiux-badge-soft">${value}</span>
      `;
    }
    return html`${value}`;
  }

  _renderScoreTable(snapshots) {
    return html`
      <div class="overflow-x-auto">
        <table class="aiux-table">
          <thead>
            <tr>
              <th scope="col">${i18n.getMessage('Metric')}</th>
              <th scope="col">${i18n.getMessage('Raw')}</th>
              <th scope="col">${i18n.getMessage('Converted')}</th>
              <th scope="col">${i18n.getMessage('Enriched')}</th>
            </tr>
          </thead>
          <tbody>
            ${SNAPSHOT_METRIC_ROWS.map(
              row => html`
                <tr>
                  <td class="text-sm font-semibold text-text-primary">${row.label()}</td>
                  <td>${this._renderMetricCell(snapshots, 'raw', row.key)}</td>
                  <td>${this._renderMetricCell(snapshots, 'converted', row.key)}</td>
                  <td>${this._renderMetricCell(snapshots, 'enriched', row.key)}</td>
                </tr>
              `
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderProcessingNotes(snapshots) {
    const stageLabels = {
      raw: i18n.getMessage('Raw'),
      converted: i18n.getMessage('Converted'),
      enriched: i18n.getMessage('Enriched')
    };
    const notes = ['raw', 'converted', 'enriched']
      .map(type => ({type, message: snapshots?.[type]?.processing_message}))
      .filter(n => n.message);
    if (!notes.length) return nothing;
    return html`
      <div class="flex flex-col gap-1.5">
        ${notes.map(
          n => html`
            <p class="text-xs text-text-tertiary">
              <span class="font-semibold text-text-secondary">${stageLabels[n.type]}:</span> ${n.message}
            </p>
          `
        )}
      </div>
    `;
  }

  _severityLabel(severity) {
    if (severity === 'high') return i18n.getMessage('High severity');
    if (severity === 'low') return i18n.getMessage('Low severity');
    return i18n.getMessage('Medium severity');
  }

  _renderFinding(finding) {
    const type = finding.type?.display_value || finding.type?.value || '';
    const state = finding.state?.display_value || finding.state?.value || '';
    const detail = finding.detail?.value || '';
    const evidence = finding.evidence || [];
    const relatedArticle = finding.related_article?.display_value || '';
    const brokenUrl = finding.broken_url?.value || '';

    return html`
      <details class="aiux-card bg-base-100 shadow-sm">
        <summary class="cursor-pointer list-none p-4">
          <div class="flex flex-wrap items-center gap-2">
            <span class="aiux-badge aiux-badge-sm aiux-badge-neutral aiux-badge-soft">${type}</span>
            ${state ? html`<span class="aiux-badge aiux-badge-sm aiux-badge-info aiux-badge-soft">${state}</span>` : nothing}
            ${relatedArticle
              ? html`
                  <span class="text-xs text-text-tertiary">
                    ${i18n.getMessage('Related: {article}', {article: relatedArticle})}
                  </span>
                `
              : nothing}
          </div>
        </summary>
        <div class="flex flex-col gap-2 border-t border-base-300 p-4 text-sm text-text-secondary">
          ${detail ? html`<p>${detail}</p>` : nothing}
          ${brokenUrl
            ? html`<p class="text-xs text-text-tertiary">${i18n.getMessage('Broken URL: {url}', {url: brokenUrl})}</p>`
            : nothing}
          ${evidence.length
            ? html`
                <div class="mt-2 flex flex-col gap-2">
                  <p class="text-xs font-semibold text-text-tertiary">${i18n.getMessage('Supporting incidents')}</p>
                  ${evidence.map(ev => this._renderEvidence(ev))}
                </div>
              `
            : nothing}
        </div>
      </details>
    `;
  }

  _renderEvidence(evidence) {
    const incidentLabel = evidence.incident?.display_value || '';
    const contradicts = evidence.contradicts_article?.value === 'true';
    const description = evidence['incident.short_description']?.display_value || '';
    const newInfo = evidence.new_information?.value || '';
    return html`
      <div class="rounded-lg border border-base-300 bg-base-200 p-3 text-xs">
        <p class="flex items-center gap-2 font-semibold text-text-primary">
          ${incidentLabel}
          ${contradicts
            ? html`<span class="aiux-badge aiux-badge-sm aiux-badge-error aiux-badge-soft">${i18n.getMessage('Contradicts article')}</span>`
            : nothing}
        </p>
        ${description ? html`<p class="mt-1 text-text-secondary">${description}</p>` : nothing}
        ${newInfo ? html`<p class="mt-1 text-text-tertiary">${newInfo}</p>` : nothing}
      </div>
    `;
  }

  _renderFindings(findings) {
    if (!findings.length) {
      return html`
        <p class="text-sm text-text-tertiary">${i18n.getMessage('No quality findings recorded for this article.')}</p>
      `;
    }
    const bySeverity = new Map();
    for (const finding of findings) {
      const severity = finding.severity?.value || 'medium';
      if (!bySeverity.has(severity)) bySeverity.set(severity, []);
      bySeverity.get(severity).push(finding);
    }
    return html`
      <div class="flex flex-col gap-4">
        ${SEVERITY_ORDER.filter(severity => bySeverity.has(severity)).map(
          severity => html`
            <div class="flex flex-col gap-2">
              <h3 class="text-xs font-bold uppercase tracking-wide text-text-tertiary">
                ${this._severityLabel(severity)} (${bySeverity.get(severity).length})
              </h3>
              <div class="flex flex-col gap-2">${bySeverity.get(severity).map(f => this._renderFinding(f))}</div>
            </div>
          `
        )}
      </div>
    `;
  }

  _renderMentions(mentions) {
    if (!mentions.length) {
      return html`
        <p class="text-sm text-text-tertiary">${i18n.getMessage('No product mentions recorded for this article.')}</p>
      `;
    }
    return html`
      <div class="overflow-x-auto">
        <table class="aiux-table">
          <thead>
            <tr>
              <th scope="col">${i18n.getMessage('Product')}</th>
              <th scope="col">${i18n.getMessage('Type')}</th>
              <th scope="col">${i18n.getMessage('Mentions')}</th>
            </tr>
          </thead>
          <tbody>
            ${mentions.map(mention => {
              // `mention.product` is null when the join in attachProducts() found no
              // matching Product row for this mention's product sys_id (e.g. a
              // Mention referencing a Product record that's since been deleted) --
              // surfaced as a visibly-flagged sys_id rather than a blank cell, so a
              // resolution failure is never indistinguishable from a genuinely empty
              // field.
              if (!mention.product) {
                return html`
                  <tr>
                    <td>
                      <span class="text-sm text-text-tertiary">
                        ${i18n.getMessage('Unresolved product ({sysId})', {sysId: mention.product_sys_id || '?'})}
                      </span>
                    </td>
                    <td class="text-sm text-text-tertiary">${NO_VALUE}</td>
                    <td class="text-sm text-text-secondary">${mention.mention_count}</td>
                  </tr>
                `;
              }
              const dedicatedArticleId = mention.product?.dedicated_article?.value || '';
              const productName = mention.product?.name?.display_value || mention.product?.name?.value || '';
              return html`
                <tr>
                  <td>
                    ${dedicatedArticleId
                      ? html`
                          <button
                            type="button"
                            class="aiux-link aiux-link-hover aiux-link-primary text-left text-sm font-semibold"
                            @click=${() => navigate(`${ANALYSIS_REPORT_PATH_PREFIX}${dedicatedArticleId}`)}
                          >
                            ${productName}
                          </button>
                        `
                      : html`<span class="text-sm text-text-primary">${productName}</span>`}
                  </td>
                  <td class="text-sm text-text-secondary">${mention.product?.type?.display_value || ''}</td>
                  <td class="text-sm text-text-secondary">${mention.mention_count}</td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderDebug(analysis) {
    const raw = analysis.enrichment_knowledge?.value;
    if (!raw) return nothing;
    let pretty = raw;
    try {
      pretty = JSON.stringify(JSON.parse(raw), null, 2);
    } catch (e) {
      // Not valid JSON (or already pretty) -- show it as-is.
    }
    return html`
      <details class="aiux-card bg-base-100 shadow-sm">
        <summary class="cursor-pointer p-4 text-sm font-semibold text-text-secondary">
          ${i18n.getMessage('Enrichment knowledge (debug)')}
        </summary>
        <pre class="overflow-x-auto border-t border-base-300 p-4 text-xs text-text-tertiary">${pretty}</pre>
      </details>
    `;
  }

  render() {
    const data = this.loaderData || {};
    if (!data.analysis || data.notFound) return this._renderNotFound();

    const {analysis, snapshots, findings, mentions} = data;

    return html`
      <div class="mx-auto flex max-w-6xl flex-col gap-6 p-4 lg:p-8">
        ${this._renderHeader(data)}
        ${this._renderBadges(analysis, findings)}
        ${this._renderFailureAlert(analysis)}

        <div class="aiux-card bg-base-100 shadow-sm">
          <div class="aiux-card-body gap-3 p-6">
            <h2 class="aiux-card-title text-base text-text-primary">
              ${i18n.getMessage('Scores & counters by stage')}
            </h2>
            ${this._renderScoreTable(snapshots)}
            ${this._renderProcessingNotes(snapshots)}
          </div>
        </div>

        <analysis-content-viewer .snapshots=${snapshots}></analysis-content-viewer>

        <div class="aiux-card bg-base-100 shadow-sm">
          <div class="aiux-card-body gap-3 p-6">
            <h2 class="aiux-card-title text-base text-text-primary">${i18n.getMessage('Findings')}</h2>
            ${this._renderFindings(findings)}
          </div>
        </div>

        <div class="aiux-card bg-base-100 shadow-sm">
          <div class="aiux-card-body gap-3 p-6">
            <h2 class="aiux-card-title text-base text-text-primary">${i18n.getMessage('Product mentions')}</h2>
            ${this._renderMentions(mentions)}
          </div>
        </div>

        ${this._renderDebug(analysis)}
      </div>
    `;
  }
}
