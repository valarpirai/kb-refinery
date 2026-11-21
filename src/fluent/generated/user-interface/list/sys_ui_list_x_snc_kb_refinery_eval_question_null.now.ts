import { List, default_view } from '@servicenow/sdk/core'

List({
    table: 'x_snc_kb_refinery_eval_question',
    view: default_view,
    columns: [
        'query',
        'kb_article',
        'kb_title',
        'feedback',
        'feedback_text',
        'score_raw',
        'score_stripped',
        'sys_updated_on',
    ],
})
