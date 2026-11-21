export default function server(data, _options, input) {
  var action = (input && input.action) || 'getJob';

  if (action === 'getJob') {
    var sysId = input && input.sysId;
    if (!sysId) {
      data.isError = true;
      data.errorMessage = gs.getMessage('No job selected');
      return;
    }

    try {
      var gr = new GlideRecordSecure('x_snc_kb_refinery_job');
      if (!gr.get(sysId)) {
        data.isError = true;
        data.errorMessage = gs.getMessage('Job not found');
        return;
      }
      if (!gr.canRead()) {
        data.isError = true;
        data.errorMessage = gs.getMessage('Access denied');
        return;
      }

      data.job = {
        sys_id: gr.getUniqueValue(),
        status: gr.getValue('status'),
        statusLabel: gr.getDisplayValue('status'),
        startedAt: toEpochMs(gr, 'started_at'),
        completedAt: toEpochMs(gr, 'completed_at'),
        articlesTotal: parseInt(gr.getValue('articles_total'), 10) || 0,
        articlesProcessed: parseInt(gr.getValue('articles_processed'), 10) || 0,
        articlesSkipped: parseInt(gr.getValue('articles_skipped'), 10) || 0,
        findingsGenerated: parseInt(gr.getValue('findings_generated'), 10) || 0,
        duplicatesFound: parseInt(gr.getValue('duplicates_found'), 10) || 0,
        brokenLinksFound: parseInt(gr.getValue('broken_links_found'), 10) || 0,
        errorMessage: gr.getValue('error_message') || '',
        scope: gr.getValue('scope') || '',
        triggeredBy: gr.getDisplayValue('triggered_by') || ''
      };
      data.job.itemCounts = getJobItemCounts(sysId);
    } catch (e) {
      gs.error('job-progress-tracker getJob: ' + e.message);
      data.isError = true;
      data.errorMessage =
        gs.getMessage('Failed to load job') + ': ' + e.message;
    }
  }

  function toEpochMs(gr, field) {
    var value = gr.getValue(field);
    if (!value) return null;
    return new GlideDateTime(value).getNumericValue();
  }

  // Real per-article status counts, grouped server-side -- the single
  // source of truth for "where is each article right now," replacing the
  // old pendingWorkCount/pendingBatchCount job-level approximation.
  function getJobItemCounts(jobSysId) {
    var counts = {
      pending: 0, converting: 0, analyzing: 0, enriching: 0,
      scoring: 0, completed: 0, failed: 0, skipped: 0
    };

    var ga = new GlideAggregate('x_snc_kb_refinery_job_item');
    ga.addQuery('job', jobSysId);
    ga.groupBy('status');
    ga.addAggregate('COUNT');
    ga.query();
    while (ga.next()) {
      var status = ga.getValue('status');
      counts[status] = parseInt(ga.getAggregate('COUNT'), 10) || 0;
    }
    return counts;
  }
}
