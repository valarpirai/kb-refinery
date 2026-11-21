import { List, default_view } from '@servicenow/sdk/core'

List({
    table: 'x_snc_kb_refinery_analysis',
    view: default_view,
    columns: [
        'enrichment_confidence',
        'enrichment_knowledge',
        'kb_knowledge_base',
        'last_job',
        'pipeline_stage',
        'search_terms',
        'source_class',
        'source_record',
        'source_table',
        'source_updated_on',
    ],
})
