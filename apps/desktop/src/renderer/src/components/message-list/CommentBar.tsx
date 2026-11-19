import type { MessageInteraction } from '@wegram/protocol'

import { commentBarLabel } from '../../lib/comments'
import { MessageOutlineIcon } from '../WechatIcons'

/**
 * 评论 N 条 under a message (design doc §9.8). WeChat draws the comments inline;
 * this client opens Telegram's discussion view instead, so the bar is only the
 * handle — the thread lives in `CommentPanel`, a full-pane view that slides in
 * from the right.
 */
export function CommentBar({
  interaction,
  onOpen,
}: {
  interaction: MessageInteraction
  onOpen: () => void
}) {
  return (
    <button
      className="wx-comment-bar"
      onClick={onOpen}
      title={interaction.comments > 0 ? `查看这 ${interaction.comments} 条评论` : '写评论'}
    >
      <MessageOutlineIcon size={14} />
      <span>{commentBarLabel(interaction)}</span>
      <span className="wx-comment-bar__chevron" aria-hidden="true">
        ›
      </span>
    </button>
  )
}
