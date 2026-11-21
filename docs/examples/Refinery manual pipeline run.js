// Background script -- run with Application Scope set to "Knowledge Refinery"
// (x_snc_kb_refinery). Mirrors widgets/pipeline-run-launcher/server.js's
// startRun action / RefineryOrchestrator.run()'s manual-run path: scopes the
// job to exactly these kb_knowledge sys_ids (no active/published/2-year
// filter, no MAX_ARTICLES_PER_RUN cap -- those only apply to the scheduled
// batch query).

var articleSysIds = [
    // paste kb_knowledge sys_ids here
];

// Reprocess even if unchanged since the article's last completed run --
// matches the picker dialog's own default. Set false to keep the normal
// skip-if-unchanged-since-last-run behavior.
var force = true;

(function (articleSysIds, force) {
    if (!Array.isArray(articleSysIds) || articleSysIds.length === 0) {
        gs.print('[Refinery] No articleSysIds provided -- nothing to do.');
        return;
    }

    var jobSysId = RefineryOrchestrator.run(articleSysIds, force);

    if (!jobSysId) {
        gs.print('[Refinery] run() returned null -- a pipeline run is already in progress (only one job may be in flight app-wide).');
        return;
    }

    // run() only runs the converting phase (find-or-create Analysis,
    // raw/converted Snapshots, link check) synchronously. Every phase after
    // that (analyzing/deduplicating/enriching/rescoring/scoring_enriched) is
    // dispatched async and finishes later, driven by RefineryLLMCallback --
    // this print does NOT mean the whole run has completed. Check the Job
    // record (x_snc_kb_refinery_job) and its Job Items
    // (x_snc_kb_refinery_job_item) for real progress/completion.
    gs.print('[Refinery] Started job ' + jobSysId + ' for ' + articleSysIds.length + ' article(s). '
        + 'Converting phase ran synchronously; later phases are still in flight -- check the Job record for status.');
})(articleSysIds, force);
