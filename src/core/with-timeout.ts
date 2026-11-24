/** Settles as `promise` does, or rejects with `new Error(message)` once `ms` pass first. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    // then(onValue, onError) leaves no derived promise without a rejection
    // handler, so a losing promise that rejects later is never unhandled.
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}
