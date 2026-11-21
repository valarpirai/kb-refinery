# Notifications

This is how the app tells you that something finished or went wrong.

## What you see

A **Notifications** button sits in the top bar. A blue count shows how many you have not read. Click it for the list. Click an item to open what it is about. **Mark all read** clears the count.

A toast also pops up in the corner when a new notification arrives while the page is open. It has an **Open** button.

The server pushes a signal the moment a notification is saved, and the page fetches the list. See `live-updates.md`. The first fetch after load only records what already exists, so you are not hit with a pile of old toasts.

## What triggers one

| Event | Who is told | Level |
|---|---|---|
| A refine job finishes | The person who started it | Done, Heads up (some failed) or Problem (all failed) |
| A scheduled pull finishes | The person who created the source | Done or Heads up |
| A scheduled pull fails | The same person | Problem |
| An article stopped responding too many times | The job's owner | Problem |

A job notifies once. If you restart a failed article, the job finishes again and you are told again.

Each notification carries a level word (Done, Heads up, Problem), so the meaning never depends on color alone.

## Where the code is

| File | Job |
|---|---|
| `src/lib/notify.ts` | `notify(userId, {…})`. Never throws. |
| `src/app/api/notifications/` | List, and mark read |
| `src/components/notification-center.tsx` | The bell, popover and toasts |

Toasts use Sonner. The popover uses Base UI.
