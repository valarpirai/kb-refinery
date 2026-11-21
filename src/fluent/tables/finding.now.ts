import { Table, Form, default_view, ReferenceColumn, ChoiceColumn, StringColumn } from '@servicenow/sdk/core'

export const x_snc_kb_refinery_finding = Table({
    name: 'x_snc_kb_refinery_finding',
    label: 'Finding',
    display: 'type',
    allowWebServiceAccess: true,
    schema: {
        parent: ReferenceColumn({
            label: 'Analysis',
            referenceTable: 'x_snc_kb_refinery_analysis',
            mandatory: true,
            maxLength: 32,
        }),
        type: ChoiceColumn({
            label: 'Type',
            mandatory: true,
            // Grouped by the five AI-readability criteria the
            // kb_article_analysis prompt scores against (and that
            // AIReadabilityScorer measures). Every value here must exist in
            // that prompt's own `type` enum and vice versa -- Call 1 writes
            // this field straight from the model's response.
            choices: {
                // Content gaps -- the only types incident enrichment can
                // close, mirrored in RefineryOrchestrator.CONTENT_GAP_FINDING_TYPES.
                outdated: { label: 'Outdated' },
                incomplete: { label: 'Incomplete' },
                no_resolution_steps: { label: 'No Resolution Steps' },
                missing_context: { label: 'Missing Context' },
                no_error_guidance: { label: 'No Error Guidance' },
                missing_prerequisites: { label: 'Missing Prerequisites' },
                too_vague: { label: 'Too Vague' },
                audience_mismatch: { label: 'Audience Mismatch' },
                // Self-containedness (C1)
                dangling_reference: { label: 'Dangling Reference' },
                unexpanded_acronym: { label: 'Unexpanded Acronym' },
                weak_section_title: { label: 'Weak Section Title' },
                // Chunk geometry (C2)
                weak_heading_structure: { label: 'Weak Heading Structure' },
                oversized_section: { label: 'Oversized Section' },
                layout_table: { label: 'Layout Table' },
                // Cleanliness (C3)
                markup_junk: { label: 'Markup Junk' },
                // Completeness in text (C4)
                image_dependent: { label: 'Image Dependent' },
                media_dependent: { label: 'Media Dependent' },
                attachment_dependent: { label: 'Attachment Dependent' },
                table_structure_lost: { label: 'Table Structure Lost' },
                // Reference integrity (C5)
                weak_anchor_text: { label: 'Weak Anchor Text' },
                unlinked_product: { label: 'Unlinked Product' },
                broken_link: { label: 'Broken Link' },
                // Cross-article
                duplicate: { label: 'Duplicate' },
            },
            maxLength: 40,
            dropdown: 'dropdown_with_none',
        }),
        severity: ChoiceColumn({
            label: 'Severity',
            choices: {
                high: { label: 'High' },
                medium: { label: 'Medium' },
                low: { label: 'Low' },
            },
            maxLength: 40,
            dropdown: 'dropdown_with_none',
        }),
        detail: StringColumn({ label: 'Detail', maxLength: 4000 }),
        state: ChoiceColumn({
            label: 'State',
            default: 'new',
            choices: {
                new: { label: 'New' },
                acknowledged: { label: 'Acknowledged' },
                remediated: { label: 'Remediated' },
                // Set on every Finding left over from a previous run of the
                // same Analysis once a new run starts -- see
                // RefineryOrchestrator._cancelPriorFindings. Distinct from
                // remediated: this doesn't claim the underlying issue was
                // fixed, only that the row itself is stale/superseded.
                cancelled: { label: 'Cancelled' },
            },
            maxLength: 40,
            dropdown: 'dropdown_without_none',
        }),
        // For duplicate findings: the other article in the pair.
        related_article: ReferenceColumn({
            label: 'Related Article',
            referenceTable: 'x_snc_kb_refinery_analysis',
            maxLength: 32,
        }),
        // For duplicate findings: which of the pair should absorb the other.
        recommended_primary: ReferenceColumn({
            label: 'Recommended Primary',
            referenceTable: 'x_snc_kb_refinery_analysis',
            maxLength: 32,
        }),
        // Plain string, not UrlColumn -- UrlColumn's http(s):// validation would
        // reject exactly the malformed links this field exists to capture.
        broken_url: StringColumn({ label: 'Broken URL', maxLength: 1000 }),
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
            element: 'parent',
        },
        {
            name: 'index2',
            unique: false,
            element: 'recommended_primary',
        },
        {
            name: 'index3',
            unique: false,
            element: 'related_article',
        },
        {
            name: 'index4',
            unique: false,
            element: 'last_job',
        },
    ],
})

Form({
    table: 'x_snc_kb_refinery_finding',
    view: default_view,
    sections: [
        {
            caption: 'Finding Details',
            content: [
                {
                    layout: 'two-column',
                    leftElements: [
                        { field: 'parent', type: 'table_field' },
                        { field: 'type', type: 'table_field' },
                        { field: 'severity', type: 'table_field' },
                        { field: 'state', type: 'table_field' },
                    ],
                    rightElements: [
                        { field: 'related_article', type: 'table_field' },
                        { field: 'recommended_primary', type: 'table_field' },
                        { field: 'broken_url', type: 'table_field' },
                        { field: 'last_job', type: 'table_field' },
                    ],
                },
                {
                    layout: 'one-column',
                    elements: [{ field: 'detail', type: 'table_field' }],
                },
            ],
        },
    ],
})
