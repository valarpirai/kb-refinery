var evalGR = new GlideRecord("x_snc_kb_refinery_eval_question");
evalGR.addEncodedQuery("feedback=unhelpful^score_rawISNOTEMPTY^feedback_text!=n/a^ORfeedback_text=NULL");
evalGR.query();
var kbs = [];
while (evalGR.next()) {
    kbs.push(...(evalGR.getValue("kb_article").split(',')));
}
gs.info(JSON.stringify(kbs));


var articleSysIds = kbs;

// Reprocess even if unchanged since the article's last completed run --
// matches the picker dialog's own default. Set false to keep the normal
// skip-if-unchanged-since-last-run behavior.
var force = true;

(function (articleSysIds, force) {
    if (!Array.isArray(articleSysIds) || articleSysIds.length === 0) {
        gs.info('[Refinery] No articleSysIds provided -- nothing to do.');
        return;
    }

    var jobSysId = RefineryOrchestrator.run(articleSysIds, force);

    if (!jobSysId) {
        gs.info('[Refinery] run() returned null -- a pipeline run is already in progress (only one job may be in flight app-wide).');
        return;
    }

    // run() only runs the converting phase (find-or-create Analysis,
    // raw/converted Snapshots, link check) synchronously. Every phase after
    // that (analyzing/deduplicating/enriching/rescoring/scoring_enriched) is
    // dispatched async and finishes later, driven by RefineryLLMCallback --
    // this print does NOT mean the whole run has completed. Check the Job
    // record (x_snc_kb_refinery_job) and its Job Items
    // (x_snc_kb_refinery_job_item) for real progress/completion.
    gs.info('[Refinery] Started job ' + jobSysId + ' for ' + articleSysIds.length + ' article(s). '
        + 'Converting phase ran synchronously; later phases are still in flight -- check the Job record for status.');
})(articleSysIds, force);
