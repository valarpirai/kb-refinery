import { List, default_view } from '@servicenow/sdk/core'

List({
    table: 'x_snc_kb_refinery_snapshot',
    view: default_view,
    columns: [
        'broken_link_count',
        'content',
        'image_count',
        'last_job',
        'link_count',
        'llm_score',
        'parent',
        'processed_at',
        'processing_message',
        'score',
    ],
})
