import type { Sticker } from '@wegram/protocol'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from 'react'

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
  onNotice,
  onCollapse,
  onBlur,
}: ComposerCardProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
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
  const sendReady = !busy && !sendBlocked && value.trim().length > 0

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
              className="wx-tool-button"
              onClick={() => onNotice('语音消息')}
              disabled={toolsDisabled}
              title="语音消息"
              aria-label="语音消息"
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

          <button
            className={`wx-send-button${sendReady ? ' wx-send-button--ready' : ''}`}
            onClick={onSend}
            disabled={!sendReady}
          >
            {sendLabel}
          </button>
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
