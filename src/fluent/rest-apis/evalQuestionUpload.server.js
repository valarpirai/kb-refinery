(function process(request, response) {

    var body;
    try {
        body = request.body.data;
    } catch (e) {
        return send(400, { error: 'Body is not valid JSON. Set Content-Type: application/json.' });
    }
    if (!body || typeof body !== 'object' || !Array.isArray(body.questions)) {
        return send(400, { error: 'Expected { questions: [...] }.' });
    }

    var results = [];
    var inserted = 0;
    var skipped = 0;

    for (var i = 0; i < body.questions.length; i++) {
        var item = body.questions[i] || {};
        var query = typeof item.query === 'string' ? item.query : '';
        var kbNumbers = Array.isArray(item.kbNumbers) ? item.kbNumbers : [];

        if (!query) {
            results.push({ index: i, status: 'skipped', reason: 'MISSING_QUERY' });
            skipped++;
            continue;
        }
        if (!kbNumbers.length) {
            results.push({ index: i, status: 'skipped', reason: 'MISSING_KB_NUMBERS' });
            skipped++;
            continue;
        }

        // Resolve each KB number to the latest active, published kb_knowledge
        // record with that number -- a KB number can have multiple
        // kb_knowledge rows (prior versions), so this is not a unique lookup.
        var resolvedSysIds = [];
        var seenNumbers = {};
        for (var j = 0; j < kbNumbers.length; j++) {
            var kbNumber = (kbNumbers[j] || '').trim();
            if (!kbNumber || seenNumbers[kbNumber]) continue;
            seenNumbers[kbNumber] = true;

            var kbGr = new GlideRecord('kb_knowledge');
            kbGr.addQuery('number', kbNumber);
            kbGr.addQuery('active', true);
            kbGr.addQuery('workflow_state', 'published');
            kbGr.orderByDesc('sys_updated_on');
            kbGr.setLimit(1);
            kbGr.query();
            if (kbGr.next()) {
                resolvedSysIds.push(kbGr.getUniqueValue());
            }
        }

        if (!resolvedSysIds.length) {
            results.push({ index: i, status: 'skipped', reason: 'NO_MATCHING_KB_ARTICLE' });
            skipped++;
            continue;
        }

        // Plain GlideRecord (not Secure): this endpoint deliberately runs with
        // no authentication, so there is no real session/role to satisfy a
        // write ACL with -- see the .now.ts file's own comment.
        var eqGr = new GlideRecord('x_snc_kb_refinery_eval_question');
        eqGr.initialize();
        eqGr.setValue('query', query);
        eqGr.setValue('kb_article', resolvedSysIds.join(','));
        if (typeof item.kbTitle === 'string') eqGr.setValue('kb_title', item.kbTitle);
        if (typeof item.feedback === 'string') eqGr.setValue('feedback', item.feedback);
        if (typeof item.feedbackText === 'string') eqGr.setValue('feedback_text', item.feedbackText);
        var newSysId = eqGr.insert();

        if (!newSysId) {
            results.push({ index: i, status: 'error', reason: 'INSERT_FAILED' });
            skipped++;
            continue;
        }

        results.push({ index: i, status: 'inserted', sys_id: newSysId, kb_article: resolvedSysIds });
        inserted++;
    }

    return send(200, {
        total: body.questions.length,
        inserted: inserted,
        skipped: skipped,
        results: results,
    });

    function send(status, payload) {
        response.setStatus(status);
        response.setContentType('application/json');
        response.getStreamWriter().writeString(JSON.stringify(payload));
    }

})(request, response);
