import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['e021c6ea3b03c3106479ff7e53e45a73'],
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
        feature: '2c21c6ea3b03c3106479ff7e53e45a6f',
        return_request: 'false',
        service_plan: '6821c6ea3b03c3106479ff7e53e45a72',
        timeout_policy: 'continue_service_plan_execution',
        timeout_sec: '60',
    },
})
