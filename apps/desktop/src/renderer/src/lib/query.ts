import { QueryClient } from '@tanstack/react-query'

/**
 * The renderer's one query client.
 *
 * Every query here is a *fetch of something the main process owns*, and the live
 * updates for that same data arrive as `evt:*` events, which write into the zustand
 * store instead. That is why the defaults disable the browser-tab reflexes: a desktop
 * window is not a tab, "the user came back to it" is not a reason to refetch a
 * transcript, and a refetch would race the event stream that already keeps the store
 * current. What *is* wanted from the library is the per-key request state machine:
 * in-flight de-duplication (StrictMode mounts every effect twice), retries with a
 * delay, cancellation when the reader switches chats, and pending/fetching flags
 * without a parallel record per chat.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Fetched once per chat and then kept for the session; `reload` refetches
      // explicitly. A background refetch would overwrite messages the events have
      // since changed.
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      // Opt in per query: only the transcript knows how soon a retry is worth it.
      retry: false,
    },
    mutations: { retry: false },
  },
})
