import {
    Table,
    Form,
    default_view,
    StringColumn,
    ChoiceColumn,
    IntegerColumn,
    ReferenceColumn,
} from '@servicenow/sdk/core'

export const x_snc_kb_refinery_product = Table({
    name: 'x_snc_kb_refinery_product',
    label: 'Product Index',
    display: 'name',
    allowWebServiceAccess: true,
    schema: {
        name: StringColumn({ label: 'Name', maxLength: 200, mandatory: true }),
        aliases: StringColumn({ label: 'Aliases', maxLength: 1000 }),
        type: ChoiceColumn({
            label: 'Type',
            choices: {
                internal: { label: 'Internal' },
                external: { label: 'External' },
                vendor: { label: 'Vendor' },
                platform: { label: 'Platform' },
            },
            maxLength: 40,
            dropdown: 'dropdown_with_none',
        }),
        // Maintained counter for fast dashboard tiles; x_snc_kb_refinery_mention
        // is the queryable join for "which articles" drill-down.
        article_count: IntegerColumn({ label: 'Article Count', default: 0, maxLength: 40 }),
        // Populated reference = has a dedicated article; null = it doesn't.
        // No separate boolean, to avoid the two ever drifting out of sync.
        dedicated_article: ReferenceColumn({
            label: 'Dedicated Article',
            referenceTable: 'x_snc_kb_refinery_analysis',
            maxLength: 32,
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
            element: 'dedicated_article',
        },
    ],
})

Form({
    table: 'x_snc_kb_refinery_product',
    view: default_view,
    sections: [
        {
            caption: 'Product Details',
            content: [
                {
                    layout: 'two-column',
                    leftElements: [
                        { field: 'name', type: 'table_field' },
                        { field: 'type', type: 'table_field' },
                    ],
                    rightElements: [
                        { field: 'article_count', type: 'table_field' },
                        { field: 'dedicated_article', type: 'table_field' },
                    ],
                },
                {
                    layout: 'one-column',
                    elements: [{ field: 'aliases', type: 'table_field' }],
                },
            ],
        },
    ],
})
