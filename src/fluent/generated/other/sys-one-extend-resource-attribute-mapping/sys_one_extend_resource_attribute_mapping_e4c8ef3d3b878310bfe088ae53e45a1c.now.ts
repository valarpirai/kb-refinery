import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['e4c8ef3d3b878310bfe088ae53e45a1c'],
    table: 'sys_one_extend_resource_attribute_mapping',
    data: {
        attribute_value_script: `(function execute(currentInputs, context) {
 return new global.OneExtendEvaluationServiceUtil().getProcessedResponse(currentInputs); 
})(currentInputs, context);`,
        attribute_value_type: 'script',
        resource_attribute_name: '0dfb85d97f14121071cab6257d8665de',
        resource_mapping: '6cc8af3d3b878310bfe088ae53e45ae3',
        sys_domain: 'global',
        sys_domain_path: '/',
        truncate: 'false',
        type: 'input',
    },
})
