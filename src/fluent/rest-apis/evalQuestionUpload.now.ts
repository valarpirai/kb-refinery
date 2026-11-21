import { RestApi } from '@servicenow/sdk/core'

// One-time bulk-upload endpoint for x_snc_kb_refinery_eval_question (see
// scripts/eval-question-upload/ for the Node script that calls this).
// Deliberately open (no auth/authorization/ACL enforcement, no internal-role
// requirement) so a local script can call it without a session -- this is
// meant to be used once and then turned off: after the upload is done, flip
// `active: false` below (on the route, or the whole API) and redeploy.
export const x_snc_kb_refinery_eval_question_upload_api = RestApi({
    $id: Now.ID['x_snc_kb_refinery_eval_question_upload-rest-api'],
    name: 'Eval Question Upload',
    serviceId: 'eval_question_upload',
    // shortDescription capped at 80 chars by the underlying platform field's
    // max_length -- a longer value here deploys fine but gets silently
    // truncated mid-word on the instance (confirmed: transform-sync pulled
    // back a value cut off at exactly 80 chars). Keep this under 80.
    shortDescription: 'One-time bulk import of eval questions, resolving KB numbers to kb_knowledge.',
    active: true,
    routes: [
        {
            $id: Now.ID['x_snc_kb_refinery_eval_question_upload-rest-route'],
            name: 'Batch Upload',
            method: 'POST',
            path: '/batch',
            consumes: 'application/json',
            produces: 'application/json',
            script: Now.include('./evalQuestionUpload.server.js'),
            active: true,
            authentication: false,
            authorization: false,
            internalRole: false,
            enforceAcl: [],
        },
    ],
})
