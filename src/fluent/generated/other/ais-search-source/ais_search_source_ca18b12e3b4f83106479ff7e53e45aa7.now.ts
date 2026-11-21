import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['ca18b12e3b4f83106479ff7e53e45aa7'],
    table: 'ais_search_source',
    data: {
        active: 'true',
        condition: 'contentISNOTEMPTY^type=raw',
        datasource: 'x_snc_kb_refinery_snapshot',
        has_dynamic_filters: 'false',
        name: 'Knowledge Refinery - Raw Content',
    },
})
