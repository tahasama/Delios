import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Restating a document — writing back what its newest revision says — happens
 * on the client that wrote the revision. Inside a transaction that client holds
 * the write lock, so restating on another connection waits for a lock held by
 * the thing waiting for it: the database simply stops.
 *
 * So a write inside a transaction only remembers which documents to restate,
 * and they are restated the moment the transaction has committed.
 */
const pending = new AsyncLocalStorage<{ documents: Set<string>; actions: Set<string> }>();

/** The documents to remember, when a transaction is running. */
export function deferred(): Set<string> | undefined {
  return pending.getStore()?.documents;
}

/** The actions to remember, when a transaction is running. */
export function deferredActions(): Set<string> | undefined {
  return pending.getStore()?.actions;
}

/** Run a transaction, then restate everything it touched. */
export async function withDeferredRestate<T>(
  run: () => Promise<T>,
  restate: (documentId: string) => Promise<unknown>,
): Promise<T> {
  const waiting = { documents: new Set<string>(), actions: new Set<string>() };
  const result = await pending.run(waiting, run);
  // Restating a document restates the actions waiting on it, so the documents
  // go first and whatever is left is an action nothing else covered.
  for (const documentId of waiting.documents) await restate(documentId);
  return result;
}
