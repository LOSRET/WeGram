import { readFileSync } from 'node:fs'

/**
 * Loads `KEY=value` lines from a `.env` file without overriding what the shell
 * already exported. Shared by the headless TDLib scripts; neither wants a
 * dependency for this.
 */
export function loadDotEnv(file: string): void {
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
      if (!match?.[1]) continue
      if (process.env[match[1]]) continue
      process.env[match[1]] = (match[2] ?? '').replace(/^["']|["']$/g, '')
    }
  } catch {
    // A missing file is reported by the caller's credential check.
  }
}

/** The dev switches accept 1/true/yes/on. */
export function isOn(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? '')
}
