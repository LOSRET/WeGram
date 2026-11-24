/**
 * The vote arithmetic both fakes share (design doc §9.10).
 *
 * It is structural on purpose: this package imports nothing (not even the
 * protocol), so the mock adapter and the browser preview hand it their own poll
 * object. The fake account is one voter among the total_voter_count the fixture
 * reports, so changing an answer moves the account's vote without inventing a
 * second voter.
 */
export interface FakePollOption {
  /** Present once an option was added in this session (TDLib sends them for real). */
  id?: string
  index?: number
  text?: string
  voterCount: number
  votePercentage: number
  chosen: boolean
}

export interface FakePoll {
  options: FakePollOption[]
  totalVoterCount: number
  allowsMultipleAnswers: boolean
  canSeeResults: boolean
  quiz: boolean
  closed: boolean
  /** 添加选项 is a TDLib poll right (`can_add_option`). */
  canAddOption?: boolean
  restriction?: string
  answered: boolean
}

export type PollVoteRejection =
  'closed' | 'restricted' | 'single-answer' | 'invalid-option' | 'quiz-locked'

/**
 * Applies an answer to a fake poll. Returns null on success, or why TDLib would
 * have refused it. An empty list retracts this account's answer.
 */
export function applyPollVote(poll: FakePoll, optionIds: number[]): PollVoteRejection | null {
  if (poll.closed) return 'closed'
  if (poll.restriction) return 'restricted'
  if (poll.quiz && poll.answered) return 'quiz-locked'
  const ids = [...new Set(optionIds)]
  if (!ids.every((id) => Number.isInteger(id) && id >= 0 && id < poll.options.length)) {
    return 'invalid-option'
  }
  if (ids.length > 1 && !poll.allowsMultipleAnswers) return 'single-answer'
  const wasAnswered = poll.options.some((option) => option.chosen)
  if (ids.length === 0) {
    if (!wasAnswered) return null
    for (const option of poll.options) {
      if (!option.chosen) continue
      option.chosen = false
      option.voterCount = Math.max(0, option.voterCount - 1)
    }
    poll.totalVoterCount = Math.max(0, poll.totalVoterCount - 1)
  } else {
    if (wasAnswered) {
      // Changing an answer: the account is already counted among the voters.
      for (const option of poll.options) {
        if (!option.chosen) continue
        option.chosen = false
        option.voterCount = Math.max(0, option.voterCount - 1)
      }
    } else {
      poll.totalVoterCount += 1
    }
    for (const id of ids) {
      const option = poll.options[id]
      if (!option) continue
      option.chosen = true
      option.voterCount += 1
    }
  }
  poll.answered = poll.options.some((option) => option.chosen)
  for (const option of poll.options) {
    option.votePercentage = poll.totalVoterCount
      ? Math.max(0, Math.min(100, Math.round((option.voterCount / poll.totalVoterCount) * 100)))
      : 0
  }
  // Voting reveals the counters; a hide-until-close poll would keep them hidden
  // until the fixture closes, which this fake does not model yet.
  poll.canSeeResults = true
  return null
}

/** One refused vote / add-option, as the renderer receives it. */
export interface PollRejection {
  code: 'forbidden' | 'poll_answered' | 'invalid_payload'
  message: string
}

const VOTE_REJECTION_CODES: Record<PollVoteRejection, PollRejection['code']> = {
  closed: 'forbidden',
  restricted: 'forbidden',
  'quiz-locked': 'poll_answered',
  'single-answer': 'invalid_payload',
  'invalid-option': 'invalid_payload',
}

/**
 * The fake server's words for a refused vote. Both fakes show them, so this is
 * the one copy: a quiz that was already answered is `poll_answered` (what the
 * real adapter maps TDLib's POLL_ANSWERED to), the rest split between forbidden
 * and a bad payload exactly like the TDLib adapter.
 */
export function pollVoteRejection(reason: PollVoteRejection): PollRejection {
  return { code: VOTE_REJECTION_CODES[reason], message: voteRejectionText(reason) }
}

function voteRejectionText(reason: PollVoteRejection): string {
  switch (reason) {
    case 'closed':
      return '投票已结束'
    case 'restricted':
      return '当前账号不能参与这个投票'
    case 'quiz-locked':
      return '这道题已经答过了'
    case 'single-answer':
      return '这个投票只能选一项'
    case 'invalid-option':
      return '选项不存在'
  }
}

/** A poll write: the refreshed row, or why the fake refused it. */
export type PollWrite = { poll: FakePoll } | { rejection: PollRejection }

/**
 * 投票: a copy of the poll with this account's answer applied. The copy matters —
 * `applyPollVote` mutates, and a refused vote must leave the stored row alone.
 */
export function castPollVote(poll: FakePoll, optionIds: number[]): PollWrite {
  const next: FakePoll = { ...poll, options: poll.options.map((option) => ({ ...option })) }
  const rejection = applyPollVote(next, optionIds)
  return rejection ? { rejection: pollVoteRejection(rejection) } : { poll: next }
}

/**
 * 添加选项: the new option goes at the end with no votes, so the other rows keep
 * their counters. A closed poll and an empty box are refused the fake's own way.
 */
export function appendPollOption(
  poll: FakePoll,
  input: { messageId: number; text: string },
): PollWrite {
  if (!poll.canAddOption || poll.closed) {
    return { rejection: { code: 'forbidden', message: '这个投票不能添加选项' } }
  }
  const text = input.text.trim()
  if (!text) return { rejection: { code: 'invalid_payload', message: '选项内容不能为空' } }
  const index = poll.options.length
  return {
    poll: {
      ...poll,
      options: [
        ...poll.options,
        {
          index,
          id: `option-${input.messageId}-${index}`,
          text,
          voterCount: 0,
          votePercentage: 0,
          chosen: false,
        },
      ],
    },
  }
}

