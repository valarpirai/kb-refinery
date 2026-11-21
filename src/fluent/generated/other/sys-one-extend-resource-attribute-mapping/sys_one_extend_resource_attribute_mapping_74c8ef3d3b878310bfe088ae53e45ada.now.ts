import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['74c8ef3d3b878310bfe088ae53e45ada'],
    table: 'sys_one_extend_resource_attribute_mapping',
    data: {
        attribute_value_script: `(function execute(currentInputs, context) {
 return new global.OneExtendEvaluationServiceUtil().getSkillContext(currentInputs); 
})(currentInputs, context);`,
        attribute_value_type: 'script',
        resource_attribute_name: '7d61dfba7f82d21071cab6257d86653e',
        resource_mapping: 'b4c8ef3d3b878310bfe088ae53e45acd',
        sys_domain: 'global',
        sys_domain_path: '/',
        truncate: 'false',
        type: 'input',
    },
})
