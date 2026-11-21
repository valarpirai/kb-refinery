export default function server(data, _options, input) {
  var action = (input && input.action) || 'searchArticles';

  if (action === 'searchArticles') {
    var term = ((input && input.term) || '').trim();
    data.articles = [];

    try {
      var gr = new GlideRecordSecure('kb_knowledge');
      gr.addActiveQuery();
      // Only the latest version of each article -- kb_knowledge.latest is a
      // real, platform-maintained boolean (readonly, defaults true) set false
      // on every superseded version once a newer one exists, regardless of
      // that newer version's own workflow_state. Deliberately not filtering
      // on workflow_state at all: a draft/review *latest* version is still
      // the one to refine, same reasoning startRun's own manual path already
      // uses for not re-applying the active/published/2-year filters to an
      // explicitly-picked set of articles.
      //
      // Kept as its own top-level addQuery() (not chained onto the term
      // OR-group below) so it ANDs with that whole group rather than only
      // the short_description half of it -- same "AND filters as separate
      // addQuery() calls, then an OR'd group of its own" nesting
      // refineryIncidentSearch.server.js's findCandidates already relies on.
      gr.addQuery('latest', true);
      if (term) {
        gr.addQuery('short_description', 'LIKE', term)
          .addOrCondition('number', 'LIKE', term);
      }
      // An empty term is a real query, not a no-op: it browses the most
      // recently updated articles so the picker opens with something in it.
      gr.orderByDesc('sys_updated_on');
      gr.setLimit(20);
      gr.query();

      var articles = [];
      while (gr.next()) {
        articles.push({
          sysId: gr.getUniqueValue(),
          number: gr.getValue('number'),
          shortDescription: gr.getValue('short_description') || '',
          kbName: gr.getDisplayValue('kb_knowledge_base') || '',
          workflowState: gr.getDisplayValue('workflow_state') || ''
        });
      }
      data.articles = articles;
    } catch (e) {
      gs.error('pipeline-run-launcher searchArticles: ' + e.message);
      data.isError = true;
      data.errorMessage = gs.getMessage('Failed to search articles') + ': ' + e.message;
    }
    return;
  }

  if (action === 'startRun') {
    var articleSysIds = (input && input.articleSysIds) || [];
    var force = !!(input && input.force);
    if (!Array.isArray(articleSysIds) || articleSysIds.length === 0) {
      data.isError = true;
      data.errorMessage = gs.getMessage('Select at least one article');
      return;
    }

    try {
      var jobSysId = RefineryOrchestrator.run(articleSysIds, force);
      if (!jobSysId) {
        data.isError = true;
        data.errorMessage = gs.getMessage('A pipeline run is already in progress');
        return;
      }
      data.jobSysId = jobSysId;
    } catch (e) {
      gs.error('pipeline-run-launcher startRun: ' + e.message);
      data.isError = true;
      data.errorMessage = gs.getMessage('Failed to start run') + ': ' + e.message;
    }
  }
}
