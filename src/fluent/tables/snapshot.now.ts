import {
    Table,
    Form,
    default_view,
    ReferenceColumn,
    ChoiceColumn,
    StringColumn,
    IntegerColumn,
    DateTimeColumn,
} from '@servicenow/sdk/core'

// Append-only: rerunning the pipeline on an article adds new rows rather than
// overwriting old ones, so "current" is just the latest row per (parent, type)
// ordered by processed_at. That's what gives raw/converted/enriched real
// version history across pipeline runs, not just within a single run.
export const x_snc_kb_refinery_snapshot = Table({
    name: 'x_snc_kb_refinery_snapshot',
    label: 'Content Snapshot',
    display: 'number',
    // Auto-increment for the 'number' column declared below (e.g. SNP0001000,
    // SNP0001001, ...) -- see analysis.now.ts's comment for why the column
    // itself still needs an explicit declaration alongside this.
    autoNumber: { prefix: 'SNP', numberOfDigits: 7 },
    allowWebServiceAccess: true,
    schema: {
        number: StringColumn({ label: 'Number', maxLength: 40 }),
        parent: ReferenceColumn({
            label: 'Analysis',
            referenceTable: 'x_snc_kb_refinery_analysis',
            mandatory: true,
            maxLength: 32,
        }),
        type: ChoiceColumn({
            label: 'Type',
            mandatory: true,
            choices: {
                raw: { label: 'Raw' },
                converted: { label: 'Converted' },
                enriched: { label: 'Enriched' },
            },
            maxLength: 40,
            dropdown: 'dropdown_with_none',
        }),
        // The pipeline-run number for this article: 1 on the first run, 2 on
        // the second, etc. Computed once per run (counting this Analysis'
        // prior 'raw' Snapshots) and shared by the raw/converted/enriched
        // trio that run produces -- see
        // RefineryOrchestrator._nextSnapshotVersion/_currentSnapshotVersion.
        version: IntegerColumn({ label: 'Version', maxLength: 40 }),
        content: StringColumn({ label: 'Content', maxLength: 4000000 }),
        // Mechanical/structural score (AIReadabilityScorer) -- computed the same
        // way for every type (raw/converted/enriched), so these three numbers are
        // genuinely comparable. Kept separate from the LLM's own semantic
        // assessment (llm_score) since the two rubrics aren't interchangeable --
        // see docs/plan.md and docs/architecture.md.
        score: IntegerColumn({ label: 'Score', maxLength: 40 }),
        // The LLM's own quality_score for this stage: the literal
        // kb_article_analysis prompt (Call 1), dispatched three times per
        // article -- against raw (RefineryOrchestrator._buildRawScoringItem),
        // converted (the "real" invocation), and enriched
        // (_buildEnrichedScoringItem, its own scoring_enriched phase) -- not
        // three separately-worded prompts. Deliberately the same prompt every
        // time so the three scores are genuinely comparable; see
        // .claude/rules/kb-refinery-domain.md and docs/plan.md's Re-scoring
        // Pass section for why two earlier, narrower-prompt designs were
        // rejected.
        llm_score: IntegerColumn({ label: 'LLM Score', maxLength: 40 }),
        word_count: IntegerColumn({ label: 'Word Count', maxLength: 40 }),
        // Computed via sn_generative_ai.TokenCalculator.getTokenCount(content) at
        // each of the 3 write sites (raw/converted/enriched) -- see
        // RefineryOrchestrator._writeSnapshot.
        token_count: IntegerColumn({ label: 'Token Count', maxLength: 40 }),
        image_count: IntegerColumn({ label: 'Image Count', maxLength: 40 }),
        link_count: IntegerColumn({ label: 'Link Count', maxLength: 40 }),
        broken_link_count: IntegerColumn({ label: 'Broken Link Count', maxLength: 40 }),
        // Per-stage outcome for this one article: a hard failure, or a legitimate
        // "couldn't proceed" result (e.g. "enrichment skipped: insufficient
        // incident coverage") -- not always an error.
        processing_message: StringColumn({ label: 'Processing Message', maxLength: 4000 }),
        processed_at: DateTimeColumn({ label: 'Processed At', maxLength: 40 }),
        last_job: ReferenceColumn({ label: 'Job', referenceTable: 'x_snc_kb_refinery_job', maxLength: 32 }),
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
            element: 'last_job',
        },
        {
            name: 'index2',
            unique: false,
            element: 'parent',
        },
    ],
})

Form({
    table: 'x_snc_kb_refinery_snapshot',
    view: default_view,
    sections: [
        {
            caption: 'Snapshot Details',
            content: [
                {
                    layout: 'two-column',
                    leftElements: [
                        { field: 'number', type: 'table_field' },
                        { field: 'parent', type: 'table_field' },
                        { field: 'type', type: 'table_field' },
                        { field: 'version', type: 'table_field' },
                        { field: 'score', type: 'table_field' },
                        { field: 'llm_score', type: 'table_field' },
                        { field: 'processed_at', type: 'table_field' },
                        { field: 'last_job', type: 'table_field' },
                    ],
                    rightElements: [
                        { field: 'word_count', type: 'table_field' },
                        { field: 'token_count', type: 'table_field' },
                        { field: 'image_count', type: 'table_field' },
                        { field: 'link_count', type: 'table_field' },
                        { field: 'broken_link_count', type: 'table_field' },
                    ],
                },
                {
                    layout: 'one-column',
                    elements: [
                        { field: 'content', type: 'table_field' },
                        { field: 'processing_message', type: 'table_field' },
                    ],
                },
            ],
        },
    ],
})
