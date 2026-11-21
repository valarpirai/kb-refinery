import { List, default_view } from '@servicenow/sdk/core'

List({
    table: 'x_snc_kb_refinery_job_item',
    view: default_view,
    columns: ['analysis', 'batch_number', 'job', 'kb_knowledge', 'status'],
})
