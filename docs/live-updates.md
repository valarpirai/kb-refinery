# Live updates

This is how the pages learn that something changed, without you reloading.

## What you see

Job progress, the article pipeline view, the Home rings and the notification bell all update on their own. Nothing polls on a timer.

## How it works

The worker writes progress to Postgres. The web server never sees those writes directly. They are two processes.

1. A database trigger, `kb_notify_change`, runs after a row changes. It calls `pg_notify` on the channel `kb_changes`. The message holds the table name and ids only.
2. The web server keeps one `LISTEN` connection open (`src/lib/events.ts`). It reconnects if the connection drops.
3. `GET /api/events` is a server-sent event stream (`src/app/api/events/route.ts`). It checks the session. It forwards each change as a small message. A burst of writes becomes one message per row, sent at most every 250 ms.
4. The browser opens one `EventSource` per tab (`src/lib/use-live.ts`). Each component asks for the changes it cares about.
5. On a message, the component fetches its data from its normal endpoint. That endpoint checks access again.

A message never carries row data. A notification message reaches only the user it belongs to.

## Which tables send

| Table | Why |
|---|---|
| `Job`, `JobItem`, `StageRun` | Job progress and the stage view |
| `Analysis`, `Article` | Home counts and rings |
| `Notification` | The bell and toasts |
| `ChatMessage` | An agent reply that is being written |

A worker heartbeat on `JobItem` changes nothing you can see, so the trigger skips it.

## When the connection drops

The browser reconnects by itself. After a reconnect, each component fetches once, so nothing is missed while the stream was down.

## Adding a table

Add a trigger in a new migration that runs `kb_notify_change()`. The function reads `id`, `jobId`, `articleId` and `userId` when the row has them.

## Where the code is

| File | Job |
|---|---|
| `prisma/migrations/20261121090000_change_notify/` | The trigger and its function |
| `src/lib/events.ts` | The `LISTEN` connection |
| `src/app/api/events/route.ts` | The stream |
| `src/lib/use-live.ts` | The browser hook |
