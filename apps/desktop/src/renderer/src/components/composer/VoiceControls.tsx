import { formatDuration } from '../../lib/format'

/** Dots either side of 发送, as many as the client prints. */
const DOTS_PER_SIDE = 4

/**
 * 语音消息's in-card recording controls.
 *
 * WeChat does not put a dot meter and an arrow here: the 发送 button *grows* into
 * a green pill with 发送 in the middle and animated dots on both sides, and a
 * cancel cross appears to its left. Clicking the pill stops and sends. The whole
 * row lives inside the composer card.
 */
export function VoiceControls({
  seconds,
  onCancel,
  onSend,
}: {
  seconds: number
  onCancel: () => void
  onSend: () => void
}) {
  const elapsed = formatDuration(Math.floor(seconds))
  return (
    <div className="wx-voice-ctl">
      <button
        type="button"
        className="wx-voice-ctl__cancel"
        onClick={onCancel}
        title="取消录音"
        aria-label="取消录音"
      >
        ×
      </button>
      <button
        type="button"
        className="wx-voice-ctl__send"
        onClick={onSend}
        title={`发送语音 · 录音中 ${elapsed}`}
        aria-label="发送语音"
      >
        <span className="wx-voice-ctl__dots" aria-hidden>
          {Array.from({ length: DOTS_PER_SIDE }, (_, index) => (
            <span key={index} style={{ animationDelay: `${index * 120}ms` }} />
          ))}
        </span>
        <span className="wx-voice-ctl__label">发送</span>
        <span className="wx-voice-ctl__dots" aria-hidden>
          {Array.from({ length: DOTS_PER_SIDE }, (_, index) => (
            <span key={index} style={{ animationDelay: `${(DOTS_PER_SIDE - index) * 120}ms` }} />
          ))}
        </span>
      </button>
    </div>
  )
}
