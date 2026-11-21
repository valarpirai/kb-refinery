import { List, default_view } from '@servicenow/sdk/core'

List({
    table: 'x_snc_kb_refinery_product',
    view: default_view,
    columns: ['name', 'aliases', 'article_count', 'dedicated_article', 'type'],
})
