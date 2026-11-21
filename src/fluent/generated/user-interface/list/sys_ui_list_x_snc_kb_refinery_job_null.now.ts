import { List, default_view } from '@servicenow/sdk/core'

List({
    table: 'x_snc_kb_refinery_job',
    view: default_view,
    columns: [
        'articles_processed',
        'articles_skipped',
        'articles_total',
        'broken_links_found',
        'completed_at',
        'duplicates_found',
        'error_message',
        'findings_generated',
    ],
})
