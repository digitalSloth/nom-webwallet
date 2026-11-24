/** Narrows a value a test knows is set, and fails the test with a clear error when it is not. */
export function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`${what} is not set`)
  return value
}
