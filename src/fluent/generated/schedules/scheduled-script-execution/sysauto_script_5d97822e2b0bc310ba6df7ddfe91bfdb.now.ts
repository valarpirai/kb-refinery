import { ScheduledScript } from '@servicenow/sdk/core'

ScheduledScript({
    $id: Now.ID['5d97822e2b0bc310ba6df7ddfe91bfdb'],
    name: 'Eval Run',
    runAs: 'b6a3094ddb63fa800bbaf5771d96195e',
    frequency: 'on_demand',
    dayOfWeek: 'monday',
    dayOfMonth: 1,
    executionTime: Time(
        {
            hours: 8,
            minutes: 0,
        },
        'UTC'
    ),
    executionStart: '2026-09-03 20:37:50',
    script: Now.include('./sysauto_script_5d97822e2b0bc310ba6df7ddfe91bfdb.js'),
    $meta: {
        useEsLatest: true,
    },
})
