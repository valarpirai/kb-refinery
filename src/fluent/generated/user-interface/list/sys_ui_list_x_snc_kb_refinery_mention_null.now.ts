import { List, default_view } from '@servicenow/sdk/core'

List({
    table: 'x_snc_kb_refinery_mention',
    view: default_view,
    columns: ['analysis', 'mention_count', 'product'],
})
