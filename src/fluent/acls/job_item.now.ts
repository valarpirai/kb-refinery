import { Acl } from '@servicenow/sdk/core'
import { userRole } from '../roles/user.now'

Acl({
    $id: Now.ID['x_snc_kb_refinery_job_item-create-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_job_item',
    operation: 'create',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_job_item-read-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_job_item',
    operation: 'read',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_job_item-write-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_job_item',
    operation: 'write',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_job_item-delete-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_job_item',
    operation: 'delete',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})
