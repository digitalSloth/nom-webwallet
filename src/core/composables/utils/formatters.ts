/**
 * Format a Unix timestamp to a locale date string
 * @param timestamp - Unix timestamp (seconds)
 * @param locale - Locale string (default: current locale)
 * @returns Formatted date string
 */
export function formatDate(timestamp: number, locale?: string): string {
  return new Date(timestamp * 1000).toLocaleString(locale)
}

/**
 * Format a Unix timestamp to a relative time string (e.g., "2 hours ago")
 * @param timestamp - Unix timestamp (seconds)
 * @returns Relative time string
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const date = new Date(timestamp * 1000)
  const seconds = Math.floor((now - date.getTime()) / 1000)

  if (seconds < 60) {
    return 'just now'
  }

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }

  const days = Math.floor(hours / 24)
  if (days < 30) {
    return `${days} day${days === 1 ? '' : 's'} ago`
  }

  const months = Math.floor(days / 30)
  if (months < 12) {
    return `${months} month${months === 1 ? '' : 's'} ago`
  }

  const years = Math.floor(months / 12)
  return `${years} year${years === 1 ? '' : 's'} ago`
}
