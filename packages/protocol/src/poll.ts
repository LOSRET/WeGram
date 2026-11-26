import { z } from 'zod'

/**
 * A Telegram poll (TDLib messagePoll, design doc §9.10).
 *
 * Only the fields the transcript needs cross IPC: the question, the options with
 * the numbers the server reports, and the flags that decide whether the reader may
 * vote and whether results are visible yet. Option *positions* are kept apart from
 * their display order: TDLib's option_order may shuffle the list, but
 * setPollAnswer takes positions in its own options array.
 */
export const pollOptionSchema = z.object({
  /** 0-based position in TDLib's options array; what a vote sends. */
  index: z.number().int().nonnegative(),
  /** TDLib option id (int64 as a string); absent until the server assigns one. */
  id: z.string().optional(),
  text: z.string(),
  voterCount: z.number().int().nonnegative(),
  votePercentage: z.number().int().min(0).max(100),
  /** This account picked this option. */
  chosen: z.boolean(),
})
export type PollOption = z.infer<typeof pollOptionSchema>

/** Why TDLib refuses this account's vote (poll.vote_restriction_reason). */
export const pollVoteRestrictionSchema = z.enum([
  'closed',
  'yetUnsent',
  'scheduled',
  'countryRestricted',
  'membershipRequired',
  'other',
])
export type PollVoteRestriction = z.infer<typeof pollVoteRestrictionSchema>

export const pollSchema = z.object({
  /** TDLib poll id (int64 as a string). */
  id: z.string(),
  question: z.string(),
  /** Optional description shown under the question (newer TDLib polls). */
  description: z.string().optional(),
  /** Options in the order the client must draw them; index keeps the vote key. */
  options: z.array(pollOptionSchema).min(1),
  totalVoterCount: z.number().int().nonnegative(),
  anonymous: z.boolean(),
  allowsMultipleAnswers: z.boolean(),
  allowsRevoting: z.boolean().optional(),
  /**
   * TDLib can_see_results: false while a poll hides its counters (a quiz before
   * answering, a channel poll that reveals results only after it closes).
   */
  canSeeResults: z.boolean(),
  /** Quiz mode: one correct answer, shown together with its explanation. */
  quiz: z.boolean(),
  /** 0-based positions of the correct answers, once TDLib reveals them. */
  correctOptionIds: z.array(z.number().int().nonnegative()).optional(),
  explanation: z.string().optional(),
  closed: z.boolean(),
  /** Unix seconds; the poll closes by itself at this point. */
  closeDate: z.number().int().optional(),
  /** Set when TDLib says this account may not vote; 'closed' repeats closed. */
  restriction: pollVoteRestrictionSchema.optional(),
  /** The message says a new option may be added (messagePoll.can_add_option). */
  canAddOption: z.boolean().optional(),
  /** This account has answered (any option is chosen). */
  answered: z.boolean(),
})
export type Poll = z.infer<typeof pollSchema>

/**
 * Poll commands. They live beside the DTO for the same reason the comment
 * contract does: the channel table is at its size budget, and these commands
 * only make sense next to the shape they mutate.
 */
export const pollInvokeChannels = [
  'messages:vote',
  'messages:addPollOption',
  'messages:refreshPoll',
] as const

export const pollInvokeSchemas = {
  /** optionIds are positions in the poll's options, not option ids. */
  'messages:vote': {
    request: z.object({
      chatId: z.number().int(),
      messageId: z.number().int(),
      optionIds: z.array(z.number().int().nonnegative()).max(100),
    }),
    response: z.void(),
  },
  /** Adds an answer option, when poll.canAddOption is set. */
  'messages:addPollOption': {
    request: z.object({
      chatId: z.number().int(),
      messageId: z.number().int(),
      text: z.string().min(1).max(255),
    }),
    response: z.void(),
  },
  /**
   * Re-reads a visible poll's counters.
   *
   * A poll drawn inside a comment thread carries that thread's anchor: TDLib drops
   * the discussion group's messages (and the poll's result registration) while the
   * thread is still on screen, and `getMessage` then answers from the local store.
   * The anchor lets main re-read the row through `getMessageThreadHistory` — a
   * server request that both re-registers the poll and returns the current results.
   * Without an anchor the read is the local `getMessage` touch.
   *
   * False means the message/poll is no longer available; a background refresh must
   * not raise the renderer's error banner.
   */
  'messages:refreshPoll': {
    request: z.object({
      chatId: z.number().int(),
      messageId: z.number().int(),
      /** The commented post (channel chat + id) when the row is in a comment pane. */
      thread: z
        .object({ chatId: z.number().int(), messageId: z.number().int() })
        .optional(),
    }),
    response: z.boolean(),
  },
} as const
