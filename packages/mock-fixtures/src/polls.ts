import type { Message } from '@wegram/protocol'

/**
 * Poll messages for the fake account (design doc §9.10), kept beside the dataset
 * because poll fixtures are the longest single message shape and data.ts is at
 * its size budget.
 *
 * One builder for all three cases: the open poll (no votes yet, an option may be
 * added), the closed poll with results, and an unanswered quiz.
 */
export interface PollMessageOptions {
  chatId: number
  id: number
  date: number
  senderId: number
  senderName: string
  outgoing: boolean
  question: string
  options: string[]
  description?: string
  anonymous?: boolean
  multiple?: boolean
  canAddOption?: boolean
  closed?: boolean
  /** Options this account picked, by position. */
  chosen?: number[]
  /** Votes per option as the fixture reports them. */
  votes?: number[]
  totalVoterCount?: number
  quiz?: boolean
  correct?: number[]
  explanation?: string
}

export function pollMessage(input: PollMessageOptions): Message {
  const total = input.totalVoterCount ?? Math.max(0, ...(input.votes ?? []))
  const chosen = input.chosen ?? []
  const votes = input.votes ?? []
  const closed = input.closed === true
  return {
    id: input.id,
    chatId: input.chatId,
    senderId: input.senderId,
    senderName: input.senderName,
    outgoing: input.outgoing,
    date: input.date,
    kind: 'poll',
    text: input.question,
    poll: {
      id: String(900_000 + input.id),
      question: input.question,
      ...(input.description ? { description: input.description } : {}),
      options: input.options.map((text, index) => ({
        index,
        id: `option-${input.id}-${index}`,
        text,
        voterCount: votes[index] ?? 0,
        votePercentage: total > 0 ? Math.round(((votes[index] ?? 0) / total) * 100) : 0,
        chosen: chosen.includes(index),
      })),
      totalVoterCount: total,
      anonymous: input.anonymous !== false,
      allowsMultipleAnswers: input.multiple === true,
      canSeeResults: closed || chosen.length > 0,
      quiz: input.quiz === true,
      ...(input.correct?.length ? { correctOptionIds: input.correct } : {}),
      ...(input.explanation ? { explanation: input.explanation } : {}),
      closed,
      ...(input.canAddOption ? { canAddOption: true } : {}),
      answered: chosen.length > 0,
    },
  }
}
/**
 * The two polls in the WeGram group: one open poll (nobody voted, an option may
 * be added) and one unanswered quiz. Kept here so data.ts stays inside its line
 * budget; the chat id and sender are the fixture's own.
 */
export function groupPollMessages(at: (minutesAgo: number) => number): Message[] {
  return [
    pollMessage({
      chatId: 2,
      id: 209,
      date: at(3),
      senderId: 27,
      senderName: '成员2',
      outgoing: false,
      question: '周五团建去哪？',
      options: ['爬山', '桌游', '火锅'],
      anonymous: false,
      multiple: true,
      canAddOption: true,
    }),
    pollMessage({
      chatId: 2,
      id: 210,
      date: at(4),
      senderId: 27,
      senderName: '成员2',
      outgoing: false,
      question: 'TDLib 的 setPollAnswer 用什么定位投票？',
      options: ['poll_id', 'chat_id + message_id', 'user_id'],
      quiz: true,
      correct: [1],
      explanation: 'setPollAnswer 用 chat_id / message_id 定位消息，option_ids 是选项位置。',
    }),
  ]
}
