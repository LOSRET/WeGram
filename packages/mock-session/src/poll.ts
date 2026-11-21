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
