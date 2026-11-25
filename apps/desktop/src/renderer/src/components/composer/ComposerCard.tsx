import type { Sticker } from '@wegram/protocol'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from 'react'

import type { RecordedVoice } from '../../lib/voice/recorder'
import type { useComposerInput } from '../../lib/useComposerInput'
import { anchorOf, type PopupAnchor } from '../../lib/popupPlacement'
import { AnchoredPopup } from '../ContextMenu'
import { ExpressionPicker } from '../ExpressionPicker'
import {
  ChevronDownIcon,
  CubeTabIcon,
  EmojiIcon,
  FolderIcon,
  MicIcon,
  ScissorsIcon,
  VoiceMessageIcon,
} from '../Icon'
import { VoiceControls } from './VoiceControls'
import { useVoiceRecording } from './useVoiceRecording'

export interface ComposerCardProps {
  value: string
  onChange: (text: string) => void
  /** The caller keeps the ref: it focuses the box and reads the caret. */
  textareaRef: RefObject<HTMLTextAreaElement | null>
  placeholder: string
  /** Enter / Shift+Enter / IME handlers from `useComposerInput` (§8.4). */
  inputHandlers: ReturnType<typeof useComposerInput>['inputHandlers']
  busy: boolean
  /** Editing an existing message: the picker and the attach menu are unavailable. */
  editing: boolean
  sendLabel: string
  /** A reason outside the card that keeps 发送 disabled (a comment's slow mode). */
  sendBlocked?: boolean
  onSend: () => void
  onSendSticker: (sticker: Sticker) => void
  onAttach: (kind: 'media' | 'file') => void
  /**
   * 语音消息's send path. Absent where a recording has nowhere to go (the comment
   * composer), which leaves the mic tool reporting "还没有接入" like before.
   */
  onSendVoice?: (voice: RecordedVoice) => Promise<void> | void
  /** True while the microphone is live; the caller forwards it as a chat action. */
  onRecordingChange?: (recording: boolean) => void
  /** A toolbar entry with no protocol behind it yet (收藏 / 截图 / 语音). */
  onNotice: (label: string) => void
  /** A channel's way back to the 服务号 bar; absent everywhere else. */
  onCollapse?: () => void
  /** The box lost focus: a chat cancels its 对方正在输入 ping here. */
  onBlur?: () => void
}

/**
 * The bordered input card every composer draws: the text, the tool row under it
 * (表情 / 收藏 / 文件 / 截图 / 语音), 发送 inside the card, plus the two popovers
 * those tools open (the attach menu and the 表情 panel).
 *
 * One card, two call sites (§9.8): the chat's `Composer` and the comment box in
 * the discussion view both render it, so a comment's input is not a cut-down
 * copy of a chat's. What differs is where a send goes, and that is the caller's
 * business — this component only reports the gesture.
 */
export function ComposerCard({
  value,
  onChange,
  textareaRef,
  placeholder,
  inputHandlers,
  busy,
  editing,
  sendLabel,
  sendBlocked = false,
  onSend,
  onSendSticker,
  onAttach,
  onSendVoice,
  onRecordingChange,
  onNotice,
  onCollapse,
  onBlur,
}: ComposerCardProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const voice = useVoiceRecording({
    onSend: (clip) => {
      void onSendVoice?.(clip)
    },
    ...(onRecordingChange ? { onRecordingChange } : {}),
  })
  const [attachAnchor, setAttachAnchor] = useState<PopupAnchor | null>(null)
  /** Where the next render should put the caret after an emoji pick. */
  const pendingCaret = useRef<number | null>(null)

  // The textarea may have lost focus to the picker's button, so the caret is
  // restored after the controlled value lands.
  useEffect(() => {
    const caret = pendingCaret.current
    if (caret === null) return
    pendingCaret.current = null
    const node = textareaRef.current
    if (!node) return
    node.focus()
    node.setSelectionRange(caret, caret)
  }, [value, textareaRef])

  /**
   * Picking an emoji inserts at the caret and keeps the panel open, the way the
   * client does.
   */
  const insertEmoji = (emoji: string): void => {
    const node = textareaRef.current
    const start = node?.selectionStart ?? value.length
    const end = node?.selectionEnd ?? start
    onChange(value.slice(0, start) + emoji + value.slice(end))
    pendingCaret.current = start + emoji.length
  }

  const openAttach = (event: MouseEvent<HTMLButtonElement>): void => {
    setPickerOpen(false)
    setAttachAnchor(anchorOf(event.currentTarget.getBoundingClientRect()))
  }

  const closePicker = useCallback(() => setPickerOpen(false), [])
  const closeAttach = useCallback(() => setAttachAnchor(null), [])

  const toolsDisabled = busy || editing
  /**
   * 语音消息 mode is only reachable where a recording can be sent, and an edit
   * (which owns the textarea) always wins over it.
   */
  // A running clip takes the right cluster, so 发送 must not invite an empty send.
  const sendReady = !busy && !sendBlocked && !voice.recording && value.trim().length > 0

  // An edit takes the textarea and the send button: drop the clip rather than
  // leave the microphone open behind the edit banner.
  const { recording: voiceRecording, cancel: cancelVoice } = voice
  useEffect(() => {
    if (editing && voiceRecording) cancelVoice()
  }, [editing, voiceRecording, cancelVoice])

  return (
    <>
      <div className="wx-composer__card">
        <textarea
          ref={textareaRef}
          className="wx-composer__input"
          placeholder={placeholder}
          title="Enter 发送 · Shift+Enter 换行"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          {...inputHandlers}
        />

        <div className="wx-composer__actions">
          <div className="wx-composer__tools">
            <button
              className={`wx-tool-button${pickerOpen ? ' wx-tool-button--active' : ''}`}
              onClick={() => setPickerOpen((current) => !current)}
              disabled={toolsDisabled}
              title="表情"
              aria-label="表情"
            >
              <EmojiIcon size={21} />
            </button>
            {/*
              The client's cube is 收藏, not a second expression entry: the sticker
              sets live as tabs inside the 表情 panel (docs/HANDOFF.md §5.13, delta 1).
              Favourites have no protocol source yet, so this reports that like the
              other unwired toolbar entries do.
            */}
            <button
              className="wx-tool-button"
              onClick={() => onNotice('收藏')}
              disabled={toolsDisabled}
              title="收藏"
              aria-label="收藏"
            >
              <CubeTabIcon size={21} />
            </button>
            <button
              className="wx-tool-button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={openAttach}
              disabled={toolsDisabled}
              title="发送文件"
              aria-label="发送图片或文件"
            >
              <FolderIcon size={21} />
            </button>
            <button
              className="wx-tool-button wx-tool-button--split"
              onClick={() => onNotice('截图')}
              disabled={toolsDisabled}
              title="截图"
              aria-label="截图"
            >
              <ScissorsIcon size={20} />
              <ChevronDownIcon size={9} className="wx-tool-button__chevron" />
            </button>
            {/*
              In the client this tool is 语音转文字 (dictation, hold the mouse and
              speak): the transcript lands in the box. There is no ASR behind it
              here — TDLib only transcribes a voice note that was *received* — so
              it stays the honest placeholder. 发语音 is the circled glyph beside
              发送, like the client's.
            */}
            <button
              className="wx-tool-button"
              onClick={() => onNotice('语音转文字')}
              disabled={toolsDisabled}
              title="语音转文字"
              aria-label="语音转文字"
            >
              <MicIcon size={20} />
            </button>
          </div>

          {onCollapse ? (
            // The channel composer's way back to the 服务号 bar. Labelled, because
            // an icon alone sat in the tool row and nobody found the way out.
            <button
              className="wx-composer__collapse"
              onClick={onCollapse}
              title="收起输入框，回到频道菜单"
              aria-label="收起输入框"
            >
              <ChevronDownIcon size={15} />
              收起
            </button>
          ) : null}

          {voice.recording ? (
            <VoiceControls
              seconds={voice.seconds}
              onCancel={voice.cancel}
              onSend={voice.send}
            />
          ) : (
            <>
              {/* 发语音: only where a clip has somewhere to go (not the comment box). */}
              {onSendVoice ? (
                <button
                  type="button"
                  className="wx-voice-message"
                  onClick={voice.start}
                  disabled={toolsDisabled || !voice.supported}
                  title={voice.supported ? '发语音' : '这台设备不支持录音'}
                  aria-label="发语音"
                >
                  <VoiceMessageIcon size={21} />
                </button>
              ) : null}
              <button
                className={`wx-send-button${sendReady ? ' wx-send-button--ready' : ''}`}
                onClick={onSend}
                disabled={!sendReady}
              >
                {sendLabel}
              </button>
            </>
          )}
        </div>
      </div>

      {attachAnchor ? (
        <AnchoredPopup anchor={attachAnchor} placement={{ side: 'above' }} onClose={closeAttach}>
          <button
            className="wx-context-menu__item"
            onClick={() => {
              closeAttach()
              onAttach('media')
            }}
          >
            发送图片或视频
          </button>
          <button
            className="wx-context-menu__item"
            onClick={() => {
              closeAttach()
              onAttach('file')
            }}
          >
            发送文件
          </button>
        </AnchoredPopup>
      ) : null}

      {pickerOpen ? (
        <ExpressionPicker
          onPickEmoji={insertEmoji}
          onSendSticker={onSendSticker}
          onClose={closePicker}
        />
      ) : null}
    </>
  )
}
