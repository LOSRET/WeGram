/** The command the first-open bot screen sends through the ordinary send path. */
export function botStartText(startParameter?: string): string {
  return startParameter ? `/start ${startParameter}` : '/start'
}
