import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['a4c8ef3d3b878310bfe088ae53e45a6f'],
    table: 'sys_one_extend_resource_mapping',
    data: {
        active: 'true',
        applicability_script: `(function(currentInputs, context) {
 /* customize condition logic here, return true or false */
  var featureInput = currentInputs; 
  if (typeof featureInput === "string") {
 featureInput = JSON.parse(featureInput);
    }

    var metrics = featureInput && featureInput._meta && featureInput._meta.evaluationDetails && featureInput._meta.evaluationDetails.metrics;

    return metrics && metrics.indexOf("a28f0e067f0202105bc49fbefc8665ec") !== -1; //check for capability id of the metric
})(currentInputs, context);`,
        applicability_type: 'script',
        depends_on_list: '17b8ef393b8f83106479ff7e53e45aa8',
        error_handler_script: `(function handleError() {  
	// customize condition logic here,  
	return ;
})();`,
        metadata: '{}',
        parent_capability: 'c2b82f393b8f83106479ff7e53e45aa0',
        resource_capability: 'a28f0e067f0202105bc49fbefc8665ec',
        resource_name: 'Correctness Metric',
        sys_domain: 'global',
        sys_domain_path: '/',
    },
})
