export default function server(data, _options, input) {
  var action = (input && input.action) || 'getJobs';

  if (action === 'getJobs') {
    var limit = 25;
    try {
      var gr = new GlideRecordSecure('x_snc_kb_refinery_job');
      gr.orderByDesc('sys_created_on');
      gr.setLimit(limit);
      gr.query();

      var jobSysIds = [];
      var jobs = [];
      while (gr.next()) {
        var jobSysId = gr.getUniqueValue();
        jobSysIds.push(jobSysId);
        jobs.push({
          sys_id: jobSysId,
          status: gr.getValue('status'),
          statusLabel: gr.getDisplayValue('status'),
          startedAt: toEpochMs(gr, 'started_at'),
          completedAt: toEpochMs(gr, 'completed_at'),
          articlesTotal: parseInt(gr.getValue('articles_total'), 10) || 0,
          articlesProcessed: parseInt(gr.getValue('articles_processed'), 10) || 0,
          triggeredBy: gr.getDisplayValue('triggered_by') || ''
        });
      }

      var itemCountsByJob = getJobItemCounts(jobSysIds);
      for (var j = 0; j < jobs.length; j++) {
        jobs[j].itemCounts = itemCountsByJob[jobs[j].sys_id] || {};
      }

      // Total count via GlideAggregate for the truncation notice only — the
      // rows themselves already went through GlideRecordSecure above, so
      // this aggregate's own lack of row-level ACL enforcement doesn't widen
      // what's actually returned to the client.
      var ga = new GlideAggregate('x_snc_kb_refinery_job');
      ga.addAggregate('COUNT');
      ga.query();
      var totalAvailable = 0;
      if (ga.next()) {
        totalAvailable = parseInt(ga.getAggregate('COUNT'), 10) || 0;
      }

      data.jobs = jobs;
      data.total = jobs.length;
      data.totalAvailable = totalAvailable;
      data.hasMore = totalAvailable > jobs.length;
    } catch (e) {
      gs.error('job-list-panel getJobs: ' + e.message);
      data.isError = true;
      data.errorMessage =
        gs.getMessage('Failed to load jobs') + ': ' + e.message;
    }
  }

  function toEpochMs(gr, field) {
    var value = gr.getValue(field);
    if (!value) return null;
    return new GlideDateTime(value).getNumericValue();
  }

  // One compound aggregate across every listed job, grouped by (job, status)
  // -- real per-article counts instead of a single job-level status badge,
  // which can't represent articles genuinely sitting at different stages.
  function getJobItemCounts(jobSysIds) {
    var byJob = {};
    if (!jobSysIds.length) return byJob;

    var ga = new GlideAggregate('x_snc_kb_refinery_job_item');
    ga.addQuery('job', 'IN', jobSysIds.join(','));
    ga.groupBy('job');
    ga.groupBy('status');
    ga.addAggregate('COUNT');
    ga.query();

    while (ga.next()) {
      var jobSysId = ga.getValue('job');
      if (!byJob[jobSysId]) byJob[jobSysId] = {};
      byJob[jobSysId][ga.getValue('status')] = parseInt(ga.getAggregate('COUNT'), 10) || 0;
    }
    return byJob;
  }
}
