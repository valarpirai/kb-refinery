import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['9a98b5ae3b4f83106479ff7e53e45ac0'],
    table: 'ais_search_source',
    data: {
        active: 'true',
        condition: 'contentISNOTEMPTY^type=enriched',
        datasource: 'x_snc_kb_refinery_snapshot',
        has_dynamic_filters: 'false',
        name: 'Knowledge Refinery - Enriched Content',
    },
})
