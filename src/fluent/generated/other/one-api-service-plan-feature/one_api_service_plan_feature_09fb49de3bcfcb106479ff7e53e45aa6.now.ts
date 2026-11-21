import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['09fb49de3bcfcb106479ff7e53e45aa6'],
    table: 'one_api_service_plan_feature',
    data: {
        active: 'true',
        applicability_script: `(function(currentInputs, context) {
    /* @param {Object} currentInputs - Inputs provided for the current step.*/
    /* @param {Object} context - Execution context, which may include:*/
    /*                         - Previous tool outputs/inputs (e.g., context['ToolName.attributeName'] or context.getValue('ToolName.attributeName')).*/
    /*                         - Additional context information (e.g., context.getAllValues()).*/
    /* @returns {Boolean} - Return 'true' if the condition is met; otherwise 'false'.*/
    return true;
})(currentInputs, context);`,
        applicability_type: 'script',
        delay_output_processing: 'false',
        error_policy: 'continue_service_plan_execution',
        feature: 'c1fb49de3bcfcb106479ff7e53e45a84',
        return_request: 'false',
        service_plan: 'cdfb49de3bcfcb106479ff7e53e45aa4',
        timeout_policy: 'continue_service_plan_execution',
        timeout_sec: '60',
    },
})
