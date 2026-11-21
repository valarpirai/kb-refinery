import { List, default_view } from '@servicenow/sdk/core'

List({
    table: 'x_snc_kb_refinery_snapshot',
    view: default_view,
    parent: 'x_snc_kb_refinery_analysis',
    columns: [
        'type',
        'parent',
        'score',
        'llm_score',
        'broken_link_count',
        'image_count',
        'link_count',
        'content',
        'processed_at',
        'last_job',
        'sys_updated_on',
    ],
})
