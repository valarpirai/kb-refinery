import { List, default_view } from '@servicenow/sdk/core'

List({
    table: 'x_snc_kb_refinery_finding',
    view: default_view,
    columns: [
        'broken_url',
        'detail',
        'last_job',
        'parent',
        'recommended_primary',
        'related_article',
        'severity',
        'state',
        'type',
    ],
})
