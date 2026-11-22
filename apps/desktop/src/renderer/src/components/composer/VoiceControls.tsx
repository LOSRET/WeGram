import { useState } from 'react'

import { formatDuration } from '../../lib/format'

/** Dots either side of 发送 once the bar is expanded, as many as the client prints. */
const DOTS_IN_PILL = 6
const DOTS_AROUND_LABEL = 4

/**
 * 语音消息's in-card recording bar.
 *
 * Pressed state (WeChat 4.x): a cancel cross, a grey pill with the green dots
 * travelling across it and a green circle holding the send arrow at the pill's
 * right end. The animation starts only when the pointer reaches that circle: the
 * green expands out of it over the whole pill — a `clip-path` circular reveal,
 * quick — where 发送 and its dots appear; clicking it sends. Both layers live in
 * one button, so the reveal cannot swallow the click; it stays open while the
 * pointer is anywhere on the bar and collapses when it leaves.
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
  // Starts on the circle, not on the whole bar: leaving the bar collapses it.
  const [revealed, setRevealed] = useState(false)
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
        className={`wx-voice-ctl__send${revealed ? ' wx-voice-ctl__send--revealed' : ''}`}
        onClick={onSend}
        onMouseLeave={() => setRevealed(false)}
        onBlur={() => setRevealed(false)}
        title={`发送语音 · 录音中 ${elapsed}`}
        aria-label="发送语音"
      >
        <span className="wx-voice-ctl__dots" aria-hidden>
          {Array.from({ length: DOTS_IN_PILL }, (_, index) => (
            <span key={index} style={{ animationDelay: `${index * 110}ms` }} />
          ))}
        </span>
        <span className="wx-voice-ctl__expand" aria-hidden>
          <span className="wx-voice-ctl__dots">
            {Array.from({ length: DOTS_AROUND_LABEL }, (_, index) => (
              <span key={index} style={{ animationDelay: `${index * 110}ms` }} />
            ))}
          </span>
          <span className="wx-voice-ctl__label">发送</span>
          <span className="wx-voice-ctl__dots">
            {Array.from({ length: DOTS_AROUND_LABEL }, (_, index) => (
              <span
                key={index}
                style={{ animationDelay: `${(DOTS_AROUND_LABEL - index) * 110}ms` }}
              />
            ))}
          </span>
        </span>
        <span
          className="wx-voice-ctl__circle"
          aria-hidden
          onMouseEnter={() => setRevealed(true)}
        >
          <svg width="15" height="15" viewBox="0 0 14 14">
            <path
              d="M7 11.4V3.2M3.4 6.8 7 3.2l3.6 3.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
    </div>
  )
}
