/**
 * Modules provided by the Vite configs rather than by a package on disk.
 *
 * This file must stay a *script* (no imports/exports): `declare module '...'`
 * only declares an ambient module there; inside a module it would be an
 * augmentation of a module TypeScript cannot find.
 */

/** The ThorVG wasm as a `data:` URL, emitted by apps/desktop/vite-thorvg-wasm.ts. */
declare module 'virtual:thorvg-wasm' {
  const url: string
  export default url
}
