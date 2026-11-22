import { z } from 'zod'

/**
 * 表情回应 (Telegram reactions) — display only for now.
 *
 * TDLib keeps them on `message.interaction_info.reactions` (`messageReactions`
 * with `reactions[]`, `are_tags`, `can_get_added_reactions`) and announces every
 * change with `updateMessageReactions`. WeChat has no reactions at all, so this
 * client draws the ones received and does not offer a picker yet — a product
 * decision that needs the owner's sign-off, while showing other people's
 * reactions costs nothing and is part of reading a chat.
 *
 * A reaction is either a standard emoji (`reactionTypeEmoji`) or a Telegram
 * Premium custom emoji (`reactionTypeCustomEmoji`) whose art is a sticker id.
 * That id is an int64 beyond `Number.MAX_SAFE_INTEGER`, so it travels as a
 * string — the same rule as a custom emoji text entity.
 */
export const messageReactionSchema = z.object({
  /** Standard emoji; absent for a custom reaction. */
  emoji: z.string().optional(),
  /** Custom reaction's sticker id, as a string; absent for a standard emoji. */
  customEmojiId: z.string().optional(),
  /** How many people chose it. */
  count: z.number().int().nonnegative(),
  /** This account is one of them (TDLib `is_chosen`). */
  chosen: z.boolean().optional(),
})
export type MessageReaction = z.infer<typeof messageReactionSchema>
