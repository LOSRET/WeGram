import { formatDuration } from '../../lib/format'

/** Dots in the live meter, as many as the client's own bar. */
const DOT_COUNT = 9

/**
 * 语音消息's in-card recording controls: cancel, the live dot meter, send.
 *
 * This is WeChat 4.x's layout — the three pieces sit where 发送 was, inside the
 * composer card, rather than in a floating panel. The dots travel with the
 * clock and grow with the input level, so a silent microphone still looks alive
 * while a loud one visibly reacts.
 */
export function VoiceControls({
  level,
  seconds,
  onCancel,
  onSend,
}: {
  level: number
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
      <span className="wx-voice-ctl__meter" title={`录音中 ${elapsed}`} aria-label={`录音中 ${elapsed}`}>
        {Array.from({ length: DOT_COUNT }, (_, index) => {
          // A travelling wave; the level sets the dot's size, the clock its phase.
          const phase = Math.abs(Math.sin(seconds * 3 + index * 0.62))
          return (
            <span
              // The dot's identity is its slot in the meter, not its size.
              key={index}
              style={{
                opacity: 0.35 + phase * 0.65,
                transform: `scale(${0.8 + level * 0.45})`,
              }}
            />
          )
        })}
      </span>
      <button
        type="button"
        className="wx-voice-ctl__send"
        onClick={onSend}
        title="发送语音"
        aria-label="发送语音"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M7 11.4V3.2M3.4 6.8 7 3.2l3.6 3.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}
