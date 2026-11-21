var RefineryAssistantRag = Class.create();
RefineryAssistantRag.prototype = {
    initialize: function () {
    },

    type: 'RefineryAssistantRag'
};

/**
 * KB source registry -- which AI Search profile/source `search()` hits for
 * a given `kbSource` key. Driven by pages/ask's own source picker (see
 * docs/employeeworks-chat.md); widgets/chat-thread/server.js passes the
 * selected key straight through.
 *
 * `generic` hits `quick_action_kb_search_profile` (sys_id
 * 0d6e994dc30101103f4fcd7b7940ddf6) -- the same profile
 * src/fluent/agents/kb_search_demo_agent.now.ts already uses for its own
 * RAG Search tool, scoped to plain (raw) kb_knowledge content. Its
 * `resultType: 'kb_knowledge'` means a result's sys_id is a kb_knowledge
 * (or subclass) record directly.
 *
 * `converted`/`enriched` both hit `x_snc_kb_refinery_knowledge_refinery_content`
 * -- one profile, with a source-level `condition` (`type=converted`/
 * `type=enriched`) picking out just that type's rows from
 * `x_snc_kb_refinery_snapshot`, which stores raw/converted/enriched
 * together in one table (see snapshot.now.ts). Their `resultType:
 * 'snapshot'` means a result's sys_id is a Snapshot record, not a
 * kb_knowledge one -- `search()` branches on this to resolve the real KB
 * article's title/number back through `Snapshot.parent` ->
 * `Analysis.source_record` (see `_readSnapshotArticle`), since a Snapshot
 * row carries none of that itself.
 *
 * `semanticIndexNames: ['all']` mirrors what the profile owner confirmed
 * is configured on its source today; revisit if that source is ever
 * split into per-field semantic indexes the way kb_knowledge's `body`
 * index was picked deliberately in kb_search_demo_agent.now.ts.
 */
RefineryAssistantRag.KB_SOURCES = {
    generic: {
        label: 'All Knowledge Articles',
        searchProfile: 'quick_action_kb_search_profile',
        resultType: 'kb_knowledge'
    },
    converted: {
        label: 'Converted content',
        searchProfile: 'x_snc_kb_refinery_knowledge_refinery_content',
        resultType: 'snapshot',
        sourceTable: 'x_snc_kb_refinery_snapshot',
        sourceCondition: 'type=converted',
        semanticIndexNames: ['all']
    },
    enriched: {
        label: 'Enriched content',
        searchProfile: 'x_snc_kb_refinery_knowledge_refinery_content',
        resultType: 'snapshot',
        sourceTable: 'x_snc_kb_refinery_snapshot',
        sourceCondition: 'type=enriched',
        semanticIndexNames: ['all']
    }
};

RefineryAssistantRag.DEFAULT_KB_SOURCE = 'generic';

/**
 * Real scripted RAG search via sn_search.RAGRetrievalAPI, replacing the
 * earlier plain kb_knowledge LIKE-query placeholder (see git history /
 * docs/employeeworks-chat.md for that version).
 *
 * Keep the return shape ({title, snippet, number, sysId}[]) stable --
 * nothing else in widgets/chat-thread needs to change as long as this does.
 *
 * @param {string} query
 * @param {number} [limit]
 * @param {string} [kbSource] a key of RefineryAssistantRag.KB_SOURCES
 * @returns {Array<{title: string, snippet: string, number: string, sysId: string}>}
 */
RefineryAssistantRag.search = function (query, limit, kbSource) {
    var results = [];
    var term = (query || '').trim();
    if (!term) return results;

    var maxResults = limit || 5;
    var resolvedKbSource = kbSource || RefineryAssistantRag.DEFAULT_KB_SOURCE;
    var sourceConfig = RefineryAssistantRag.KB_SOURCES[resolvedKbSource] || RefineryAssistantRag.KB_SOURCES[RefineryAssistantRag.DEFAULT_KB_SOURCE];
    if (!sourceConfig.searchProfile) {
        sourceConfig = RefineryAssistantRag.KB_SOURCES[RefineryAssistantRag.DEFAULT_KB_SOURCE];
    }

    gs.info('[Refinery][RAG] search request: type=' + resolvedKbSource + ' profile=' + sourceConfig.searchProfile + ' query="' + term + '"');

    try {
        var request = new sn_search.RAGRetrievalRequest()
            .searchProfile(sourceConfig.searchProfile)
            .disableSpellCheck(true)
            .limit(maxResults)
            .query(term);

        if (sourceConfig.sourceTable) {
            var source = new sn_search.RAGRetrievalSource()
                .sourceTableName(sourceConfig.sourceTable)
                .condition(sourceConfig.sourceCondition || '');
            request.sources([source]);
        }
        if (sourceConfig.semanticIndexNames) {
            // var semanticConfiguration = new sn_search.RAGRetrievalSemanticConfiguration()
            //     .semanticIndexNames(sourceConfig.semanticIndexNames);
            // request.semanticConfiguration(semanticConfiguration);
            request.semanticConfiguration(new sn_search.RAGRetrievalSemanticConfiguration()
                .mode('KEYWORD')
                .documentMatchThreshold(0.75)
                .embeddingModelId('E5FT')
                .semanticIndexNames(sourceConfig.semanticIndexNames)
                .chunkingFormat(new sn_search.RAGRetrievalChunkingFormat()
                    .mode('FIXED_SIZE')
                    .chunkSize(250)
                    .chunkUnit('WORDS')
                    .maxPassagesPerDoc(1)
                ));
        }

        var api = new sn_search.RAGRetrievalAPI();
        var response = api.retrieve(request);

        response = JSON.parse(JSON.parse(JSON.stringify(response)));

        if (response && response.search_results && response.search_results.length > 0) {
            for (var i = 0; i < response.search_results.length; i++) {
                var searchResult = response.search_results[i];
                var result = sourceConfig.resultType === 'snapshot'
                    ? RefineryAssistantRag._buildSnapshotResult(searchResult.sys_id, term)
                    : RefineryAssistantRag._buildKbArticleResult(searchResult.sys_id, term);
                if (result) {
                    results.push(result);
                }
            }
        }
    } catch (e) {
        gs.error('[Refinery] RefineryAssistantRag.search: ' + e.message);
    }

    gs.info('[Refinery][RAG] search results: type=' + resolvedKbSource + ' query="' + term + '" count=' + results.length
        + ' results=' + JSON.stringify(results.map(function (r) { return { sysId: r.sysId, number: r.number, title: r.title }; })));

    return results;
};

/** Builds a result straight off a kb_knowledge (or subclass) record -- the `generic` source's shape. */
RefineryAssistantRag._buildKbArticleResult = function (sysId, term) {
    var kbGr = RefineryAssistantRag._readKbArticle(sysId);
    if (!kbGr) return null;

    var kbText = RefineryKbContent.getText(kbGr.getValue('sys_class_name'), kbGr.getUniqueValue(), kbGr);
    return {
        sysId: kbGr.getUniqueValue(),
        number: kbGr.getValue('number') || '',
        title: kbGr.getValue('short_description') || '',
        snippet: kbText
    };
};

/**
 * Builds a result off a Snapshot record -- the `converted`/`enriched`
 * sources' shape. A Snapshot carries none of the original article's own
 * title/number itself (only its own SNP-prefixed `number` and the
 * extracted `content`), so this resolves the real kb_knowledge title/
 * number back through `Snapshot.parent` -> `Analysis.source_record`
 * (see `_readSourceArticle`). Falls back to the Snapshot's own number and
 * a blank title if that resolve fails (e.g. the source article was since
 * deleted) rather than dropping the result -- the content itself is
 * still real and still worth showing.
 */
RefineryAssistantRag._buildSnapshotResult = function (sysId, term) {
    var snapshotGr = RefineryAssistantRag._readSnapshot(sysId);
    if (!snapshotGr) return null;

    var article = RefineryAssistantRag._readSourceArticle(snapshotGr.getValue('parent'));
    return {
        sysId: snapshotGr.getUniqueValue(),
        number: (article && article.number) || snapshotGr.getValue('number') || '',
        title: (article && article.title) || '',
        snippet: snapshotGr.getValue('content')
    };
};

/** ACL-respecting single-record read, kept separate so a missing/unreadable result is a plain skip, not a thrown error. */
RefineryAssistantRag._readKbArticle = function (sysId) {
    if (!sysId) return null;
    var gr = new GlideRecordSecure('kb_knowledge');
    if (!gr.get(sysId)) return null;
    return gr;
};

/** ACL-respecting single-record read of a Content Snapshot. */
RefineryAssistantRag._readSnapshot = function (sysId) {
    if (!sysId) return null;
    var gr = new GlideRecordSecure('x_snc_kb_refinery_snapshot');
    if (!gr.get(sysId)) return null;
    return gr;
};

/**
 * Resolves an Analysis' polymorphic `source_record` (a DocumentIdColumn,
 * dependent on the `source_table` TableNameColumn -- see analysis.now.ts)
 * back to the real KB article's own {number, title}. Returns null on any
 * missing/unreadable hop (deleted Analysis, deleted source article, ACL
 * denial) -- caller decides the fallback.
 */
RefineryAssistantRag._readSourceArticle = function (analysisSysId) {
    if (!analysisSysId) return null;
    var analysisGr = new GlideRecordSecure('x_snc_kb_refinery_analysis');
    if (!analysisGr.get(analysisSysId)) return null;

    var sourceTable = analysisGr.getValue('source_table');
    var sourceSysId = analysisGr.getValue('source_record');
    if (!sourceTable || !sourceSysId) return null;

    var articleGr = new GlideRecordSecure(sourceTable);
    if (!articleGr.get(sourceSysId)) return null;

    return {
        number: articleGr.getValue('number') || '',
        title: articleGr.getValue('short_description') || ''
    };
};

/** Crude window-around-first-match snippet -- good enough until the RAG response's own matched passage is confirmed to carry a usable field. */
RefineryAssistantRag._snippet = function (text, term) {
    var plain = String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!plain) return '';
    var idx = plain.toLowerCase().indexOf(term.toLowerCase());
    var start = idx >= 0 ? Math.max(0, idx - 80) : 0;
    var snippet = plain.substring(start, start + 240);
    return (start > 0 ? '…' : '') + snippet + (start + 240 < plain.length ? '…' : '');
};
