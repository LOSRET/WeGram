/**
 * The adapter seam now lives in `@wegram/adapter-contract`, so the fake adapter
 * (`@wegram/mock-adapter`) can implement it from its own package. This re-export
 * keeps the seam's import path stable inside main; see src/main/AGENTS.md.
 */
export * from '@wegram/adapter-contract'
