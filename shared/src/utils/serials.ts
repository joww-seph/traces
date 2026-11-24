export function withSerials(description: string, serials: (string | null | undefined)[]): string {
  const s = serials.map((x) => x?.trim() || null)
  const shown = s.every((x) => !x) ? 'N/A' : s.map((x) => x ?? 'N/A').join(', ')
  return `${description} (S/N: ${shown})`
}
