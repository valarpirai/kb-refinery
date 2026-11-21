import { Table, Form, default_view, ReferenceColumn, IntegerColumn } from '@servicenow/sdk/core'

// Analysis <-> Product: which articles mention which products, and how often.
// A join table (not a list field) so a product's article_count can drill
// down into the actual articles, not just a total.
export const x_snc_kb_refinery_mention = Table({
    name: 'x_snc_kb_refinery_mention',
    label: 'Product Mention',
    allowWebServiceAccess: true,
    schema: {
        analysis: ReferenceColumn({
            label: 'Analysis',
            referenceTable: 'x_snc_kb_refinery_analysis',
            mandatory: true,
            maxLength: 32,
        }),
        product: ReferenceColumn({
            label: 'Product',
            referenceTable: 'x_snc_kb_refinery_product',
            mandatory: true,
            maxLength: 32,
        }),
        mention_count: IntegerColumn({ label: 'Mention Count', default: 1, maxLength: 40 }),
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
            element: 'analysis',
        },
        {
            name: 'index2',
            unique: false,
            element: 'product',
        },
    ],
})

Form({
    table: 'x_snc_kb_refinery_mention',
    view: default_view,
    sections: [
        {
            caption: 'Mention Details',
            content: [
                {
                    layout: 'one-column',
                    elements: [
                        { field: 'analysis', type: 'table_field' },
                        { field: 'product', type: 'table_field' },
                        { field: 'mention_count', type: 'table_field' },
                    ],
                },
            ],
        },
    ],
})
