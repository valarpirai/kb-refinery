import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['0fa663c63bc38310bfe088ae53e45a65'],
    table: 'one_api_service_plan_feature',
    data: {
        active: 'true',
        applicability_script: `(function(currentInputs, context) {
    /* @param {Object} currentInputs - Inputs provided for the current step.*/
    /* @param {Object} context - Execution context, which may include:*/
    /*						   - Previous tool outputs/inputs (e.g., context['ToolName.attributeName'] or context.getValue('ToolName.attributeName')).*/
    /*						   - Additional context information (e.g., context.getAllValues()).*/
    /* @returns {Boolean} - Return 'true' if the condition is met; otherwise 'false'.*/
    return true;
})(currentInputs, context);`,
        applicability_type: 'script',
        delay_output_processing: 'false',
        error_policy: 'continue_service_plan_execution',
        feature: '36a663c63bc38310bfe088ae53e45a0e',
        return_request: 'false',
        service_plan: '87a663c63bc38310bfe088ae53e45a63',
        timeout_policy: 'continue_service_plan_execution',
        timeout_sec: '60',
    },
})
