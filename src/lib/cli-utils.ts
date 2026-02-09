/**
 * CLI Utilities
 *
 * Helper functions for parsing command line arguments in scripts.
 */

/**
 * Parse a numeric limit argument with support for "no limit" values
 *
 * @param arg - The argument string to parse
 * @param defaultLimit - Default value if arg is undefined
 * @returns The parsed limit number, or null for no limit
 * @throws Error if the argument is invalid
 *
 * @example
 * parseLimit('10', 5)        // => 10
 * parseLimit('all', 5)       // => null (no limit)
 * parseLimit('0', 5)         // => null (no limit)
 * parseLimit(undefined, 5)   // => 5 (default)
 */
export function parseLimit(
  arg: string | undefined,
  defaultLimit: number
): number | null {
  if (!arg) {
    return defaultLimit
  }

  // Special values for "no limit"
  if (arg === 'all' || arg === 'unlimited' || arg === '0') {
    return null
  }

  const parsed = parseInt(arg, 10)
  if (isNaN(parsed) || parsed < 1) {
    throw new Error(
      `Invalid limit: ${arg}. Use a positive number, "all", "unlimited", or "0"`
    )
  }

  return parsed
}
