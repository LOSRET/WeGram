/**
 * The adapter seam: the one interface main codes against, implemented by the
 * TDLib adapter (main/telegram/tdlib) and the fake one (@wegram/mock-adapter).
 * It lives in its own package so the mock can implement it without importing
 * app code; it depends on @wegram/protocol types only.
 */
export * from './adapter'
