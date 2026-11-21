import { Table, Form, default_view, ListColumn, StringColumn, ChoiceColumn, IntegerColumn } from '@servicenow/sdk/core'

// One-time bulk import of real user queries + the KB article(s) surfaced for
// them (from an external eval-question export CSV), for use as an eval set.
// kb_article is a list because a single query in the source data can cite
// multiple KB numbers (semicolon-separated in the CSV). kb_title is kept as
// the raw, denormalized text from the CSV (which can itself be a "|"-joined
// multi-title string, or "(unknown title <KBNNNN>)" for a number that had no
// resolvable title at export time) -- it's a point-in-time snapshot for eval
// context, not meant to stay in sync with the referenced article's real title.
export const x_snc_kb_refinery_eval_question = Table({
    name: 'x_snc_kb_refinery_eval_question',
    label: 'Eval Question',
    allowWebServiceAccess: true,
    schema: {
        // Longest observed source query is ~26.6k chars -- explicit maxLength
        // well above that (StringColumn defaults to 40 if omitted).
        query: StringColumn({ label: 'Query', mandatory: true, maxLength: 50000 }),
        kb_article: ListColumn({
            label: 'KB Article',
            referenceTable: 'kb_knowledge',
            maxLength: 4000,
        }),
        kb_title: StringColumn({ label: 'KB Title (from source)', maxLength: 2000 }),
        feedback: ChoiceColumn({
            label: 'Feedback',
            choices: {
                helpful: { label: 'Helpful' },
                unhelpful: { label: 'Unhelpful' },
            },
            maxLength: 40,
            dropdown: 'dropdown_with_none',
        }),
        feedback_text: StringColumn({ label: 'Feedback Text', maxLength: 2000 }),
        // Written by RefineryEvalScorer.run() (Scripts - Background) --
        // % (0-100) of the query's own tokens found in the best-matching
        // referenced KB's text, raw HTML included vs. with HTML stripped.
        // No min/max here -- the 0-100 range is enforced in script, at the
        // single write site (RefineryEvalScorer._writeScores), not relied on
        // as a platform-enforced dictionary constraint.
        score_raw: IntegerColumn({ label: 'Score (Raw HTML)', maxLength: 40 }),
        score_stripped: IntegerColumn({ label: 'Score (Stripped HTML)', maxLength: 40 }),
    },
    actions: {
        read: true,
        update: false,
        delete: false,
        create: false,
    },
    allowClientScripts: false,
    allowNewFields: false,
    allowUiActions: false,
    index: [
        {
            name: 'index',
            unique: false,
            element: 'kb_article',
        },
    ],
})

Form({
    table: 'x_snc_kb_refinery_eval_question',
    view: default_view,
    sections: [
        {
            caption: 'Eval Question Details',
            content: [
                {
                    layout: 'one-column',
                    elements: [
                        { field: 'query', type: 'table_field' },
                        { field: 'kb_article', type: 'table_field' },
                        { field: 'kb_title', type: 'table_field' },
                        { field: 'feedback', type: 'table_field' },
                        { field: 'feedback_text', type: 'table_field' },
                        { field: 'score_raw', type: 'table_field' },
                        { field: 'score_stripped', type: 'table_field' },
                    ],
                },
            ],
        },
    ],
})
