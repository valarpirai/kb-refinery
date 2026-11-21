import '@servicenow/sdk/global'
import {
    Table,
    Form,
    default_view,
    TableNameColumn,
    DocumentIdColumn,
    StringColumn,
    DateTimeColumn,
    ReferenceColumn,
    JsonColumn,
    ChoiceColumn,
} from '@servicenow/sdk/core'

export const x_snc_kb_refinery_analysis = Table({
    name: 'x_snc_kb_refinery_analysis',
    label: 'Analysis',
    display: 'number',
    // Auto-increment for the 'number' column declared below (e.g. ANL0001000,
    // ANL0001001, ...) -- per the SDK's own table-api doc, this configures the
    // counter only; the plain StringColumn it writes into still has to be
    // declared explicitly, since this table doesn't extend a table (like
    // 'task') that already has one.
    autoNumber: { prefix: 'ANL', numberOfDigits: 7 },
    allowWebServiceAccess: true,
    schema: {
        number: StringColumn({ label: 'Number', maxLength: 40 }),
        source_table: TableNameColumn({ label: 'Source Table', maxLength: 80 }),
        source_record: DocumentIdColumn({
            label: 'Source Record',
            dependent: 'source_table',
            mandatory: true,
            maxLength: 32,
        }),
        // Denormalized sys_class_name of source_record, for filtering by KB class without a join.
        source_class: StringColumn({ label: 'Source Class', maxLength: 80 }),
        source_updated_on: DateTimeColumn({ label: 'Source Updated On', maxLength: 40 }),
        kb_knowledge_base: ReferenceColumn({
            label: 'Knowledge Base',
            referenceTable: 'kb_knowledge_base',
            maxLength: 32,
        }),
        standardized_summary: StringColumn({ label: 'Standardized Summary', maxLength: 500 }),
        search_terms: JsonColumn({ label: 'Search Terms', maxLength: 4000 }),
        target_audience: ChoiceColumn({
            label: 'Target Audience',
            choices: {
                end_user: { label: 'End User' },
                admin: { label: 'Admin' },
                developer: { label: 'Developer' },
                mixed: { label: 'Mixed' },
            },
            maxLength: 40,
            dropdown: 'dropdown_with_none',
        }),
        pipeline_stage: ChoiceColumn({
            label: 'Pipeline Stage',
            default: 'ingested',
            choices: {
                ingested: { label: 'Ingested' },
                analyzing: { label: 'Analyzing' },
                restructuring: { label: 'Restructuring' },
                validating: { label: 'Validating' },
                ready: { label: 'AI-Ready' },
                // Set when this article hit a genuine LLM/dispatch failure
                // (RefineryOrchestrator.handleBatchFailure) or the enriching
                // phase's "insufficient incident coverage" skip -- either way,
                // this article has no further route to 'ready' for this run.
                // Without this, pipeline_stage sits at 'analyzing' forever
                // with nothing distinguishing "still working" from "this is
                // as far as it got" (see kb-refinery-domain.md).
                failed: { label: 'Finished with Errors' },
            },
            maxLength: 40,
            dropdown: 'dropdown_without_none',
        }),
        enrichment_confidence: ChoiceColumn({
            label: 'Enrichment Confidence',
            choices: {
                high: { label: 'High' },
                medium: { label: 'Medium' },
                low: { label: 'Low' },
            },
            maxLength: 40,
            dropdown: 'dropdown_with_none',
        }),
        // Call 2's (Incident Enrichment) ai_ready_knowledge + recommendations,
        // persisted here because Call 2 (enriching phase) and Call 3 (Article
        // Synthesis, rescoring phase) are separate async round trips -- Call 3's
        // batch dispatch reads this back rather than relying on anything held
        // in memory across the callback boundary. Also doubles as the
        // rescoring-phase work-item query's filter (non-null = made it through
        // enriching).
        enrichment_knowledge: JsonColumn({ label: 'Enrichment Knowledge', maxLength: 4000 }),
        // Denormalized pointer to the most recent job that touched this article.
        last_job: ReferenceColumn({ label: 'Last Job', referenceTable: 'x_snc_kb_refinery_job', maxLength: 32 }),
    },
    actions: {
        read: true,
        update: false,
        delete: false,
        create: false,
    },
    allowClientScripts: false,
    allowNewFields: false,
    allowUiActions: false,
    index: [
        {
            name: 'index',
            unique: false,
            element: 'source_record',
        },
        {
            name: 'index2',
            unique: false,
            element: 'kb_knowledge_base',
        },
        {
            name: 'index3',
            unique: false,
            element: 'last_job',
        },
    ],
})

Form({
    table: 'x_snc_kb_refinery_analysis',
    view: default_view,
    sections: [
        {
            caption: 'Analysis Details',
            content: [
                {
                    layout: 'two-column',
                    leftElements: [
                        { field: 'number', type: 'table_field' },
                        { field: 'source_table', type: 'table_field' },
                        { field: 'source_record', type: 'table_field' },
                        { field: 'source_class', type: 'table_field' },
                        { field: 'kb_knowledge_base', type: 'table_field' },
                        { field: 'pipeline_stage', type: 'table_field' },
                    ],
                    rightElements: [
                        { field: 'source_updated_on', type: 'table_field' },
                        { field: 'target_audience', type: 'table_field' },
                        { field: 'enrichment_confidence', type: 'table_field' },
                        { field: 'last_job', type: 'table_field' },
                    ],
                },
                {
                    layout: 'one-column',
                    elements: [
                        { field: 'standardized_summary', type: 'table_field' },
                        { field: 'search_terms', type: 'table_field' },
                        { field: 'enrichment_knowledge', type: 'table_field' },
                    ],
                },
            ],
        },
    ],
})
