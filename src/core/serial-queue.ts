/**
 * Runs async tasks one at a time, in call order. chrome.storage has no
 * transactions, so every read-modify-write of one key has to go through the
 * same queue, or a write based on a stale read can overwrite a newer one.
 * A failed task rejects its own caller and never blocks the tasks after it.
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task)
    tail = run.catch(() => undefined)
    return run
  }
}
