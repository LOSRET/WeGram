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
  onAttach: (kind: 'photo' | 'file') => void
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
  /** 语音消息 mode: the input shows 开始说话 and the mic stays active. */
  const [voiceMode, setVoiceMode] = useState(false)
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
  const voiceActive = voiceMode && Boolean(onSendVoice) && !editing
  // In voice mode the card sends through the mic's own controls, so 发送 must not
  // invite an empty send there.
  const sendReady = !busy && !sendBlocked && !voiceActive && value.trim().length > 0

  // Losing the voice surface (an edit opens, the tool is switched off) must drop
  // the clip instead of leaving the microphone open behind the textarea.
  const { recording: voiceRecording, cancel: cancelVoice } = voice
  useEffect(() => {
    if (!voiceActive && voiceRecording) cancelVoice()
  }, [voiceActive, voiceRecording, cancelVoice])

  return (
    <>
      <div className="wx-composer__card">
        {voiceActive ? (
          <button
            type="button"
            className={`wx-composer__voice${voice.recording ? ' wx-composer__voice--live' : ''}`}
            onClick={() => {
              if (!voice.recording) voice.start()
            }}
            disabled={busy || !voice.supported || voice.recording}
            title={voice.recording ? '正在录音，点右下角发送或取消' : '点击麦克风开始说话'}
          >
            {voice.recording ? '正在说话…' : voice.supported ? '开始说话' : '无法录音'}
          </button>
        ) : (
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
        )}

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
              sets live as tabs inside the 表情 panel (docs/UI-HANDOFF.md, §5 delta 1).
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
            <button
              className={`wx-tool-button${voiceActive ? ' wx-tool-button--voice' : ''}`}
              onClick={() => {
                if (!onSendVoice) {
                  onNotice('语音消息')
                  return
                }
                if (voice.recording) voice.cancel()
                setPickerOpen(false)
                setAttachAnchor(null)
                setVoiceMode((current) => !current)
              }}
              disabled={toolsDisabled}
              title={voiceActive ? '退出语音输入' : '语音消息'}
              aria-label={voiceActive ? '退出语音输入' : '语音消息'}
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
              level={voice.level}
              seconds={voice.seconds}
              onCancel={voice.cancel}
              onSend={voice.send}
            />
          ) : (
            <button
              className={`wx-send-button${sendReady ? ' wx-send-button--ready' : ''}`}
              onClick={onSend}
              disabled={!sendReady}
            >
              {sendLabel}
            </button>
          )}
        </div>
      </div>

      {attachAnchor ? (
        <AnchoredPopup anchor={attachAnchor} placement={{ side: 'above' }} onClose={closeAttach}>
          <button
            className="wx-context-menu__item"
            onClick={() => {
              closeAttach()
              onAttach('photo')
            }}
          >
            发送图片
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
