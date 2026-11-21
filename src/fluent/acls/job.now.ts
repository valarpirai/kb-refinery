import { Acl } from '@servicenow/sdk/core'
import { userRole } from '../roles/user.now'

Acl({
    $id: Now.ID['x_snc_kb_refinery_job-create-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_job',
    operation: 'create',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_job-read-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_job',
    operation: 'read',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_job-write-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_job',
    operation: 'write',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_job-delete-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_job',
    operation: 'delete',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})
