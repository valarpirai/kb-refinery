import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['a388392e3b4f83106479ff7e53e45aed'],
    table: 'ais_search_source',
    data: {
        active: 'true',
        condition: 'contentISNOTEMPTY^type=converted',
        datasource: 'x_snc_kb_refinery_snapshot',
        has_dynamic_filters: 'false',
        name: 'Knowledge Refinery - Converted Content',
    },
})
