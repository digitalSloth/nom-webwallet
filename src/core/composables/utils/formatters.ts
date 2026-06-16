/**
 * Truncate an address for display
 * @param address - Full address string
 * @param startChars - Number of characters to show at start (default: 8)
 * @param endChars - Number of characters to show at end (default: 6)
 * @returns Truncated address
 */
export function truncateAddress(
  address: string,
  startChars: number = 8,
  endChars: number = 6
): string {
  if (address.length <= startChars + endChars) {
    return address
  }
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`
}

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

/**
 * Format a number with thousands separators and optional compact notation
 * @param value - Number or string to format
 * @param options - Formatting options
 * @param options.decimals - Number of decimal places (default: 2)
 * @param options.compact - Use compact notation for large numbers (10k, 1.5M) (default: false)
 * @param options.locale - Locale string (default: 'en-US')
 * @returns Formatted number string
 */
export function formatNumber(
  value: number | string,
  options: {
    decimals?: number
    compact?: boolean
    locale?: string
  } = {}
): string {
  const { decimals = 2, compact = false, locale = 'en-US' } = options
  const num = typeof value === 'string' ? parseFloat(value) : value

  if (isNaN(num)) return '0'

  // Use compact notation for numbers >= 10,000
  if (compact && Math.abs(num) >= 10000) {
    return new Intl.NumberFormat(locale, {
      notation: 'compact',
      maximumFractionDigits: 1,
      minimumFractionDigits: 0,
    }).format(num)
  }

  // Regular formatting with fixed decimals
  return num.toFixed(decimals)
}

/**
 * Format a token amount (already converted to a decimal string, e.g. via
 * `addNumberDecimals`) for compact display. Rounds to `maxDecimals`, strips
 * trailing zeros, and adds thousands separators. If the value is non-zero but
 * would round down to zero, a "< 0.0001" style threshold is shown instead of a
 * misleading "0".
 * @param value - Decimal amount string
 * @param maxDecimals - Maximum decimal places to show (default: 4)
 * @returns Formatted amount string
 */
export function formatTokenDisplay(value: string, maxDecimals: number = 4): string {
  const num = parseFloat(value)
  if (isNaN(num) || num === 0) return '0'

  const threshold = Math.pow(10, -maxDecimals)
  if (Math.abs(num) < threshold) {
    return `${num < 0 ? '> -' : '< '}${threshold.toFixed(maxDecimals)}`
  }

  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  })
}

/**
 * Format a balance with symbol
 * @param balance - Balance string
 * @param symbol - Token symbol
 * @param decimals - Number of decimal places to show (default: 2)
 * @returns Formatted balance with symbol
 */
export function formatBalance(balance: string, symbol: string, decimals: number = 2): string {
  const num = parseFloat(balance)
  if (isNaN(num)) return `0 ${symbol}`

  const formatted = num.toFixed(decimals)
  return `${formatted} ${symbol}`
}
