import '@servicenow/sdk/global'
import {
    Table,
    Form,
    default_view,
    DateTimeColumn,
    ChoiceColumn,
    IntegerColumn,
    StringColumn,
    ReferenceColumn,
} from '@servicenow/sdk/core'

export const x_snc_kb_refinery_job = Table({
    name: 'x_snc_kb_refinery_job',
    label: 'Analysis Job',
    display: 'number',
    // Auto-increment for the 'number' column declared below (e.g. JOB0001000,
    // JOB0001001, ...) -- see analysis.now.ts's comment for why the column
    // itself still needs an explicit declaration alongside this.
    autoNumber: { prefix: 'JOB', numberOfDigits: 7 },
    allowWebServiceAccess: true,
    schema: {
        number: StringColumn({ label: 'Number', maxLength: 40 }),
        started_at: DateTimeColumn({ label: 'Started At', maxLength: 40 }),
        completed_at: DateTimeColumn({ label: 'Completed At', maxLength: 40 }),
        // Coarse job-level lifecycle only -- which pipeline phase each article
        // is actually in lives on x_snc_kb_refinery_job_item.status instead
        // (real per-article state; this field can't represent that, since
        // different articles/batches genuinely progress at different rates).
        // The job-lock guard (RefineryOrchestrator.run) checks status NOT IN
        // (completed, completed_with_errors, failed).
        status: ChoiceColumn({
            label: 'Status',
            default: 'pending',
            choices: {
                pending: { label: 'Pending' },
                running: { label: 'Running' },
                completed: { label: 'Completed' },
                completed_with_errors: { label: 'Completed with Errors' },
                failed: { label: 'Failed' },
            },
            maxLength: 40,
            dropdown: 'dropdown_without_none',
        }),
        articles_total: IntegerColumn({ label: 'Articles Total', default: 0, maxLength: 40 }),
        articles_processed: IntegerColumn({ label: 'Articles Processed', default: 0, maxLength: 40 }),
        articles_skipped: IntegerColumn({ label: 'Articles Skipped', default: 0, maxLength: 40 }),
        findings_generated: IntegerColumn({ label: 'Findings Generated', default: 0, maxLength: 40 }),
        duplicates_found: IntegerColumn({ label: 'Duplicates Found', default: 0, maxLength: 40 }),
        broken_links_found: IntegerColumn({ label: 'Broken Links Found', default: 0, maxLength: 40 }),
        // How many of this job's batches are still working. Set once, to the
        // total batch count, when the job starts; decremented by exactly 1
        // each time a batch's every Job Item reaches a terminal status
        // (completed/failed/skipped). Reaching 0 finalizes the Job -- see
        // RefineryOrchestrator._checkBatchFinished/_finalizeJob. Deliberately
        // a small, per-batch counter rather than a whole-job aggregate
        // re-derived on every single article's status change, to shrink how
        // often/where a race between two concurrent finalize-checks could
        // even occur.
        remaining_batches: IntegerColumn({ label: 'Remaining Batches', default: 0, maxLength: 40 }),
        // Batch-level failure only. Per-article/per-stage outcomes live on
        // x_snc_kb_refinery_snapshot's processing_message instead.
        error_message: StringColumn({ label: 'Error Message', maxLength: 4000 }),
        scope: StringColumn({ label: 'Scope', maxLength: 4000 }),
        triggered_by: ReferenceColumn({ label: 'Triggered By', referenceTable: 'sys_user', maxLength: 32 }),
        // Set once, in RefineryOrchestrator.run(), from whether articleSysIds
        // was passed -- 'user_initiated' is also the only trigger_type for
        // which a caller may set the `force` param truthy (see run()'s own
        // doc comment) to bypass the unchanged-since-last-run skip in
        // _prepareAnalysis. A scheduled run is never forced.
        trigger_type: ChoiceColumn({
            label: 'Trigger Type',
            default: 'scheduled',
            choices: {
                scheduled: { label: 'Scheduled' },
                user_initiated: { label: 'User Initiated' },
            },
            maxLength: 40,
            dropdown: 'dropdown_without_none',
        }),
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
            element: 'triggered_by',
        },
    ],
})

Form({
    table: 'x_snc_kb_refinery_job',
    view: default_view,
    sections: [
        {
            caption: 'Job Details',
            content: [
                {
                    layout: 'two-column',
                    leftElements: [
                        { field: 'number', type: 'table_field' },
                        { field: 'status', type: 'table_field' },
                        { field: 'started_at', type: 'table_field' },
                        { field: 'completed_at', type: 'table_field' },
                        { field: 'triggered_by', type: 'table_field' },
                        { field: 'trigger_type', type: 'table_field' },
                    ],
                    rightElements: [
                        { field: 'articles_total', type: 'table_field' },
                        { field: 'articles_processed', type: 'table_field' },
                        { field: 'articles_skipped', type: 'table_field' },
                        { field: 'findings_generated', type: 'table_field' },
                        { field: 'duplicates_found', type: 'table_field' },
                        { field: 'broken_links_found', type: 'table_field' },
                        { field: 'remaining_batches', type: 'table_field' },
                    ],
                },
                {
                    layout: 'one-column',
                    elements: [
                        { field: 'scope', type: 'table_field' },
                        { field: 'error_message', type: 'table_field' },
                    ],
                },
            ],
        },
    ],
})
