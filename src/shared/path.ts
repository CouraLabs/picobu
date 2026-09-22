export const collapseHome = (value: string, home: string): string => {
  const normalizedHome = home.endsWith('/') ? home.slice(0, -1) : home
  if (normalizedHome.length === 0) return value
  if (value === normalizedHome) return '~'
  if (value.startsWith(`${normalizedHome}/`)) return `~${value.slice(normalizedHome.length)}`
  return value
}
