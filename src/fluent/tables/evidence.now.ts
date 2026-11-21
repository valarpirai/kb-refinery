import '@servicenow/sdk/global'
import { Table, Form, default_view, ReferenceColumn, StringColumn, BooleanColumn } from '@servicenow/sdk/core'

// Findings <-> Incidents: links a finding to the resolved incidents that
// support/explain it. A plain join table (not the SDK's ReferenceColumn
// `mtom`/sys_collection mechanism) because it carries its own payload per
// link (new_information, contradicts_article) -- a pure membership relation
// wouldn't need a table of its own, but this one does.
export const x_snc_kb_refinery_evidence = Table({
    name: 'x_snc_kb_refinery_evidence',
    label: 'Evidence',
    allowWebServiceAccess: true,
    schema: {
        finding: ReferenceColumn({
            label: 'Finding',
            referenceTable: 'x_snc_kb_refinery_finding',
            mandatory: true,
            maxLength: 32,
        }),
        incident: ReferenceColumn({
            label: 'Incident',
            referenceTable: 'incident',
            mandatory: true,
            maxLength: 32,
        }),
        new_information: StringColumn({ label: 'New Information', maxLength: 4000 }),
        contradicts_article: BooleanColumn({ label: 'Contradicts Article', default: false, maxLength: 40 }),
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
            element: 'incident',
        },
        {
            name: 'index2',
            unique: false,
            element: 'finding',
        },
    ],
})

Form({
    table: 'x_snc_kb_refinery_evidence',
    view: default_view,
    sections: [
        {
            caption: 'Evidence Details',
            content: [
                {
                    layout: 'one-column',
                    elements: [
                        { field: 'finding', type: 'table_field' },
                        { field: 'incident', type: 'table_field' },
                        { field: 'contradicts_article', type: 'table_field' },
                        { field: 'new_information', type: 'table_field' },
                    ],
                },
            ],
        },
    ],
})
