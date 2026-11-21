import { RestApi } from '@servicenow/sdk/core'

RestApi({
    $id: Now.ID['9823d7ad2b4f0f10ba6df7ddfe91bfe7'],
    name: 'AI Readability',
    serviceId: 'ai_readability',
    shortDescription: 'Scores a Knowledge Article on its AI readbility',
    routes: [
        {
            $id: Now.ID['e7535bed2b4f0f10ba6df7ddfe91bff0'],
            name: 'Score',
            consumes: 'application/json,application/xml,text/xml',
            method: 'POST',
            script: Now.include('./sys_ws_operation_e7535bed2b4f0f10ba6df7ddfe91bff0.js'),
            produces: 'application/json,application/xml,text/xml',
            path: '/score',
            enforceAcl: [],
            internalRole: false,
        },
    ],
})
