import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

/** Identifies this worker process. It is how an item records who holds it. */
export const WORKER_ID = `${hostname()}-${process.pid}-${randomUUID().slice(0, 6)}`;

/** How often a worker proves it is alive while it processes an item. */
export const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS ?? 15_000);

/** An item with no heartbeat for this long is treated as abandoned. */
export const HEARTBEAT_TIMEOUT_MS = Number(process.env.HEARTBEAT_TIMEOUT_MS ?? 90_000);

/** A worker may claim the same item this many times before it is marked failed. */
export const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS ?? 3);

/** Thrown when this worker no longer holds the item, for example after the reconciler gave it to another worker. */
export class ClaimLostError extends Error {
  constructor() {
    super("This worker no longer holds the item");
  }
}
