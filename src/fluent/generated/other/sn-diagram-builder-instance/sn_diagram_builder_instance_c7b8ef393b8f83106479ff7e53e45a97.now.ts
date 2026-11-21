import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['c7b8ef393b8f83106479ff7e53e45a97'],
    table: 'sn_diagram_builder_instance',
    data: {
        builder_configuration: '24fef3e67f8c1210ce7cc46adc8665a9',
        diagram_json:
            '{"start":"start","variables":[],"node_arguments":[],"edge_arguments":[],"nodes":[{"name":"Knowledge Refinery","node_id":"393a329f7fc012103f41c20e1f866555","key":"17b8ef393b8f83106479ff7e53e45aa8","resourceMappingId":"17b8ef393b8f83106479ff7e53e45aa8","resourceMapping":{"scope":null,"active":true,"resourceName":"Knowledge Refinery","applicabilityConditionExpression":"","incomingResourceEdges":[],"applicabilityFailedPolicy":"","metadata":{"diagramInstanceId":"c7b8ef393b8f83106479ff7e53e45a97"},"condition":"","conditionScript":"(function(currentInputs, context) {\\n    /* @param {Object} currentInputs - Inputs provided for the current step.*/\\n    /* @param {Object} context - Execution context, which may include:*/\\n    /*\\t\\t\\t\\t\\t\\t   - Previous tool outputs/inputs (e.g., context[\'ToolName.attributeName\'] or context.getValue(\'ToolName.attributeName\')).*/\\n    /*\\t\\t\\t\\t\\t\\t   - Additional context information (e.g., context.getAllValues()).*/\\n    /* @returns {Boolean} - Return \'true\' if the condition is met; otherwise \'false\'.*/\\n    return true;\\n})(currentInputs, context);","outgoingResourceEdges":[],"errorPolicy":null,"dependsOnList":[],"applicabilityType":"","resourceCapability":"c2b82f393b8f83106479ff7e53e45aa0","parentCapability":"c2b82f393b8f83106479ff7e53e45aa0","errorHandlerScript":null,"applicabilityTable":"","mappingId":"17b8ef393b8f83106479ff7e53e45aa8","resourceType":"SKILL"}},{"key":"start","name":"Start","node_id":"6ba9765f7fc012103f41c20e1f866518"},{"key":"end","name":"End","node_id":"901af65f7fc012103f41c20e1f866591"}],"edges":[{"edge_id":"242cb6137f0412103f41c20e1f866546","from":"17b8ef393b8f83106479ff7e53e45aa8","to":"end","add_button_visible":false},{"edge_id":"242cb6137f0412103f41c20e1f866546","from":"start","to":"17b8ef393b8f83106479ff7e53e45aa8"}]}',
        name: 'Knowledge Refinery',
        read_only: 'false',
        state: 'draft',
        sys_domain: 'global',
        sys_domain_path: '/',
    },
})
