/**
 * The byte pump behind `wx-media://` for a file TDLib is still downloading.
 *
 * TDLib writes the parts it has into the file on disk as they arrive, and the
 * *downloaded prefix* is the contiguous run from an offset that is safe to read
 * (`getFileDownloadedPrefixSize`). A `<video>` element asks for a Range and
 * expects the bytes in order, so the pump tails the file: read what is there,
 * wait for more, read again. When nothing moves it nudges the downloader, which
 * is also what the first Range after a seek does.
 *
 * The pump is deliberately free of Electron and TDLib: it is a plain
 * `ReadableStream` over a `StreamFeed`, so the range maths, the stall policy
 * and the abort path are unit-tested (`stream.test.ts`) without a protocol.
 */

export interface StreamFeed {
  /** Full size of the file, known before it has arrived. */
  size: number
  /** Contiguous bytes on disk starting at `offset` right now. */
  available(offset: number): Promise<number>
  /** Up to `length` bytes at `offset`; fewer only when the file ends. */
  read(offset: number, length: number): Promise<Uint8Array>
  /** Asks the downloader for more bytes from `offset` (`downloadFile` at it). */
  nudge(offset: number): Promise<void>
}

export interface StreamOptions {
  /** Bytes handed to the element per read; it buffers them as they come. */
  chunkBytes?: number
  /** Silent polls before the feed is nudged (and between two nudges). */
  pollMs?: number
  /** Empty polls in a row before the stream fails — TDLib may be offline. */
  maxStalls?: number
  /** Called once, however the pump ends (closed, failed, cancelled). */
  onDone?: () => void
}

const DEFAULT_CHUNK_BYTES = 256 * 1024
const DEFAULT_POLL_MS = 40
/** ~36 s of silence before the element is told the stream failed. */
const DEFAULT_MAX_STALLS = 900

/**
 * One Range of a file whose bytes arrive over time.
 *
 * `start`/`end` are inclusive, like an HTTP byte range; `signal` is the
 * request's, so closing the video window (or the element dropping the
 * connection) stops the pump instead of leaving it polling.
 */
export function createRangeStream(
  feed: StreamFeed,
  start: number,
  end: number,
  signal: AbortSignal,
  options: StreamOptions = {},
): ReadableStream<Uint8Array> {
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const maxStalls = options.maxStalls ?? DEFAULT_MAX_STALLS

  let stopped = signal.aborted
  const stop = (): void => {
    stopped = true
  }
  signal.addEventListener('abort', stop)

  const pump = async (controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> => {
    let position = start
    let stalls = 0
    try {
      while (position <= end && !stopped) {
        const left = end - position + 1
        const ready = Math.min(await feed.available(position), left)
        if (ready > 0) {
          const bytes = await feed.read(position, Math.min(ready, chunkBytes))
          if (bytes.length > 0) {
            controller.enqueue(bytes)
            position += bytes.length
            stalls = 0
            continue
          }
        }
        stalls += 1
        if (stalls >= maxStalls) throw new Error(`media stream stalled at byte ${position}`)
        // The first empty read is a seek (or a slow start): ask TDLib for the
        // bytes at this offset, then only every second of silence.
        if (stalls === 1 || stalls % 20 === 0) await feed.nudge(position)
        await new Promise((resolve) => setTimeout(resolve, pollMs))
      }
      controller.close()
    } catch (error) {
      try {
        if (!stopped) controller.error(error)
      } catch {
        // Already torn down by the element; there is nobody to report to.
      }
    } finally {
      signal.removeEventListener('abort', stop)
      options.onDone?.()
    }
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      void pump(controller)
    },
    cancel() {
      stopped = true
    },
  })
}
