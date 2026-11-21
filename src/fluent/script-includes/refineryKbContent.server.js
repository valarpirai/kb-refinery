/**
 * Shared KB-article content extraction, keyed by the record's own
 * sys_class_name. Moved out of RefineryEvalScorer so every caller that
 * needs a KB article's real body text (RefineryOrchestrator,
 * AIReadabilityScorer, RefineryEvalScorer, ...) shares one implementation
 * instead of each re-implementing -- or, worse, silently omitting --
 * subclass handling on its own.
 *
 * Most kb_knowledge rows carry real content on the generic `text` field,
 * but several subclasses keep it on their own type-specific fields
 * instead:
 *   - The kb_template_* KCS-style templates (TEMPLATE_CLASSES): each has
 *     its own small set of rich-text fields, assembled into one string.
 *   - u_kb_template_esc_kb_template_faq (FAQ_CLASS): an FAQ article whose
 *     content is 15 question/answer field pairs, not a body field at all.
 */
var RefineryKbContent = Class.create();
RefineryKbContent.prototype = {
    initialize: function () {
    },
    type: 'RefineryKbContent'
};

RefineryKbContent.TEMPLATE_CLASSES = [
    'kb_template_kcs_article',
    'kb_template_how_to',
    'kb_template_known_error_article',
    'kb_template_what_is'
];

RefineryKbContent.FAQ_CLASS = 'u_kb_template_esc_kb_template_faq';
RefineryKbContent.FAQ_PAIR_COUNT = 15;

/**
 * @param {string} kbClass The record's sys_class_name.
 * @param {string} kbSysId
 * @param {GlideRecord} baseGr An already-`.get()`-ed kb_knowledge (or
 *   subclass) record for kbSysId -- reused as-is for the plain-`text`
 *   case so a caller that already holds one doesn't pay for a second
 *   query. Ignored for the template/FAQ cases, which need their own
 *   subclass-typed re-query to see their own fields.
 * @returns {string} Raw (un-stripped) content -- caller decides
 *   raw-vs-stripped/Markdown handling.
 */
RefineryKbContent.getText = function (kbClass, kbSysId, baseGr) {
    if (RefineryKbContent.TEMPLATE_CLASSES.indexOf(kbClass) !== -1) {
        var templateGr = new GlideRecordSecure(kbClass);
        if (!templateGr.get(kbSysId)) {
            return '';
        }
        return RefineryKbContent._templateTextFor(kbClass, templateGr);
    }

    if (kbClass === RefineryKbContent.FAQ_CLASS) {
        var faqGr = new GlideRecordSecure(kbClass);
        if (!faqGr.get(kbSysId)) {
            return '';
        }
        return RefineryKbContent._faqTextFor(faqGr);
    }

    return baseGr.text.nil() ? '' : baseGr.getValue('text');
};

RefineryKbContent._templateTextFor = function (kbClass, kbGr) {
    var text = '';
    if (kbClass === 'kb_template_kcs_article') {
        if (kbGr.kb_resolution.nil()) {
            return '';
        }
        if (!kbGr.kb_issue.nil()) {
            text += 'Issue: ' + kbGr.getValue('kb_issue') + '\n\n';
        }
        if (!kbGr.kb_cause.nil()) {
            text += 'Cause: ' + kbGr.getValue('kb_cause') + '\n\n';
        }
        text += 'Resolution: ' + kbGr.getValue('kb_resolution');
    } else if (kbClass === 'kb_template_how_to') {
        if (kbGr.kb_instructions.nil()) {
            return '';
        }
        text = kbGr.getValue('kb_instructions');
    } else if (kbClass === 'kb_template_known_error_article') {
        if (kbGr.kb_workaround.nil()) {
            return '';
        }
        if (!kbGr.kb_description.nil()) {
            text += 'Description: ' + kbGr.getValue('kb_description') + '\n\n';
        }
        text += 'Workaround: ' + kbGr.getValue('kb_workaround');
    } else if (kbClass === 'kb_template_what_is') {
        if (kbGr.kb_explanation.nil()) {
            return '';
        }
        if (!kbGr.kb_introduction.nil()) {
            text += 'Introduction: ' + kbGr.getValue('kb_introduction') + '\n\n';
        }
        text += 'Explanation: ' + kbGr.getValue('kb_explanation');
    }
    return text;
};

/**
 * FAQ template: content lives on 15 question/answer field pairs
 * (u_kb_question_1/u_kb_answer_1 .. u_kb_question_15/u_kb_answer_15), not
 * one body field. Pairs are matched by number, in order; a pair whose
 * question is blank is skipped entirely (an answer with no question
 * isn't a usable Q&A pair -- the answer field itself isn't checked).
 * @returns {string} Each pair rendered as "Question: <q>\nAnswer: <a>",
 *   with pairs separated by a blank line (two newlines).
 */
RefineryKbContent._faqTextFor = function (kbGr) {
    var pairs = [];
    for (var i = 1; i <= RefineryKbContent.FAQ_PAIR_COUNT; i++) {
        var questionField = 'u_kb_question_' + i;
        if (kbGr[questionField].nil()) {
            continue;
        }
        var answerField = 'u_kb_answer_' + i;
        var question = kbGr.getValue(questionField);
        var answer = kbGr[answerField].nil() ? '' : kbGr.getValue(answerField);
        pairs.push('Question: ' + question + '\nAnswer: ' + answer);
    }
    return pairs.join('\n\n');
};
