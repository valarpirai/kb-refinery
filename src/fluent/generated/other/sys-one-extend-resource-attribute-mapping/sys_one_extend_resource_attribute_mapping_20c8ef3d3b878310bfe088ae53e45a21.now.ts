import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['20c8ef3d3b878310bfe088ae53e45a21'],
    table: 'sys_one_extend_resource_attribute_mapping',
    data: {
        attribute_value_script: `(function execute(currentInputs, context) {
    /* @param {Object} currentInputs - Inputs provided for the current step.*/
    /* @param {Object} context - Execution context, which may include:*/
    /*						   - Previous tool outputs/inputs (e.g., context['ToolName.attributeName'] or context.getValue('ToolName.attributeName')).*/
    /*						   - Additional context information (e.g., context.getAllValues()).*/
    /* @returns {Object} - The computed value for the attribute.*/
    return '';
})(currentInputs, context);`,
        attribute_value_type: 'script',
        resource_attribute_name: '2d7b81d97f14121071cab6257d86654c',
        resource_mapping: '6cc8af3d3b878310bfe088ae53e45ae3',
        sys_domain: 'global',
        sys_domain_path: '/',
        truncate: 'false',
        type: 'input',
    },
})
