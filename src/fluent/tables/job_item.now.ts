import '@servicenow/sdk/global'
import { Table, Form, default_view, ChoiceColumn, IntegerColumn, ReferenceColumn } from '@servicenow/sdk/core'

// One row per (job, kb_knowledge) article the job actually looked at --
// including one for an article that ends up 'skipped'. This is the
// real-time, per-article source of truth the job/pipeline pages read their
// status counters from; x_snc_kb_refinery_job.status only tracks the
// coarse job-level lifecycle (pending/running/completed/completed_with_
// errors/failed) now -- see refineryOrchestrator.server.js.
export const x_snc_kb_refinery_job_item = Table({
    name: 'x_snc_kb_refinery_job_item',
    label: 'Job Item',
    display: 'kb_knowledge',
    allowWebServiceAccess: true,
    schema: {
        job: ReferenceColumn({
            label: 'Job',
            referenceTable: 'x_snc_kb_refinery_job',
            mandatory: true,
            maxLength: 32,
        }),
        // Captured at creation, before any Analysis row is resolved -- the
        // conversion step below sets `analysis` once it finds/creates one.
        kb_knowledge: ReferenceColumn({
            label: 'KB Article',
            referenceTable: 'kb_knowledge',
            mandatory: true,
            maxLength: 32,
        }),
        analysis: ReferenceColumn({
            label: 'Analysis',
            referenceTable: 'x_snc_kb_refinery_analysis',
            maxLength: 32,
        }),
        // 'scoring' covers both the article-rewrite call and the immediately
        // following re-score-the-rewrite call -- there's no separate
        // checkpoint between them (see refineryOrchestrator.server.js).
        status: ChoiceColumn({
            label: 'Status',
            default: 'pending',
            choices: {
                pending: { label: 'Pending' },
                converting: { label: 'Converting' },
                analyzing: { label: 'Analyzing' },
                enriching: { label: 'Enriching' },
                scoring: { label: 'Scoring' },
                completed: { label: 'Completed' },
                failed: { label: 'Failed' },
                skipped: { label: 'Skipped' },
            },
            maxLength: 40,
            dropdown: 'dropdown_without_none',
        }),
        // Assigned once at creation (LLM_BATCH_SIZE items per batch) -- batches
        // progress through the pipeline independently of one another.
        batch_number: IntegerColumn({ label: 'Batch Number', default: 0, maxLength: 40 }),
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
            element: 'job',
        },
        {
            name: 'index2',
            unique: false,
            element: 'analysis',
        },
        {
            name: 'index3',
            unique: false,
            element: 'kb_knowledge',
        },
    ],
})

Form({
    table: 'x_snc_kb_refinery_job_item',
    view: default_view,
    sections: [
        {
            caption: 'Job Item Details',
            content: [
                {
                    layout: 'one-column',
                    elements: [
                        { field: 'job', type: 'table_field' },
                        { field: 'kb_knowledge', type: 'table_field' },
                        { field: 'analysis', type: 'table_field' },
                        { field: 'status', type: 'table_field' },
                        { field: 'batch_number', type: 'table_field' },
                    ],
                },
            ],
        },
    ],
})
