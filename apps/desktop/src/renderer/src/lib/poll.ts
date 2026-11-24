import type { Poll, PollOption } from '@wegram/protocol'

/**
 * The rules behind a poll card (design doc §9.10).
 *
 * TDLib decides whether the counters may be seen and whether a vote is allowed;
 * these helpers only read those flags so the component and the tests agree on
 * one interpretation.
 */

/** Whether the card draws vote counts / bars / percentages. */
export function pollResultsVisible(poll: Poll): boolean {
  // A quiz keeps its answer secret until the reader answers; a hide-until-close
  // poll reports canSeeResults false until it closes.
  if (poll.closed) return true
  if (poll.quiz && !poll.answered) return false
  return poll.canSeeResults
}

/**
 * Whether the card offers ＋ 添加选项.
 *
 * TDLib's messagePoll.can_add_option is already per-account permission (the server
 * decides who may add), so this only adds the local "a closed poll takes no new
 * options" guard around it.
 */
export function pollCanAddOption(poll: Poll): boolean {
  return poll.canAddOption === true && !poll.closed
}

/** Whether an option click should send an answer. */
export function pollVotable(poll: Poll): boolean {
  if (poll.closed) return false
  if (poll.restriction) return false
  if (poll.quiz && poll.answered) return false
  return true
}

/**
 * Whether an answer already given may still be changed — switched or retracted.
 *
 * TDLib refuses both as soon as the poll's allows_revoting is false ("Can't retract
 * vote in the poll" / "Can't revote in the poll"), so the card must not offer the
 * tap at all: the request could only bounce, and the refresh the refusal triggers
 * replaced the poll object the hint was pinned to (design doc §9.10). A first vote
 * is unaffected, and a quiz is final once answered.
 */
export function pollCanChangeAnswer(poll: Poll): boolean {
  if (!poll.answered) return true
  if (poll.quiz) return false
  return poll.allowsRevoting === true
}

/** Positions this account picked, sorted so two selections compare cheaply. */
export function pollChosen(poll: Poll): number[] {
  return poll.options
    .filter((option) => option.chosen)
    .map((option) => option.index)
    .sort((a, b) => a - b)
}

/** The selection after clicking one option; a single-answer poll replaces it. */
export function pollToggleSelection(poll: Poll, selected: number[], index: number): number[] {
  if (!poll.allowsMultipleAnswers) return [index]
  const next = selected.includes(index)
    ? selected.filter((item) => item !== index)
    : [...selected, index]
  return next.sort((a, b) => a - b)
}

/**
 * Keeps staged ticks across count-only refreshes. A five-second poll heartbeat
 * replaces the message object even when only the cache was touched; keying the
 * draft by object identity would erase a half-finished multiple-answer vote.
 * A changed server answer, option set or closed state still discards it.
 */
export function pollDraftSelection(
  draft: { poll: Poll; selection: number[] } | null,
  poll: Poll,
): number[] {
  if (!draft || draft.poll.id !== poll.id || draft.poll.closed !== poll.closed) {
    return pollChosen(poll)
  }
  if (
    draft.poll.allowsMultipleAnswers !== poll.allowsMultipleAnswers ||
    pollChosen(draft.poll).join(',') !== pollChosen(poll).join(',')
  ) {
    return pollChosen(poll)
  }
  const optionKeys = (value: Poll): string[] =>
    value.options.map((option) => option.id ?? String(option.index))
  if (optionKeys(draft.poll).join(',') !== optionKeys(poll).join(',')) return pollChosen(poll)
  const valid = new Set(poll.options.map((option) => option.index))
  return draft.selection.filter((index) => valid.has(index))
}

export function pollSelectionChanged(poll: Poll, selected: number[]): boolean {
  const chosen = pollChosen(poll)
  const next = [...selected].sort((a, b) => a - b)
  return chosen.length !== next.length || chosen.some((id, index) => id !== next[index])
}

/**
 * Why this account may not vote, in the card's own words.
 *
 * TDLib already disables the options when it sets a vote restriction, but a card
 * whose options are simply dead is indistinguishable from a broken one — the
 * reader clicks and nothing happens, with no request and no error. The reason is
 * therefore drawn under the options. `closed` is skipped on purpose: the footer
 * already carries 已结束 for it.
 */
export function pollRestrictionText(poll: Poll): string | null {
  switch (poll.restriction) {
    case undefined:
    case 'closed':
      return null
    case 'yetUnsent':
      return '消息还在发送，暂时不能投票'
    case 'scheduled':
      return '定时消息不能提前投票'
    case 'countryRestricted':
      return '所在地区不支持参与这个投票'
    case 'membershipRequired':
      return '需要加入后才能投票'
    case 'other':
      return '当前账号不能参与这个投票'
    default:
      return null
  }
}

/** 无人投票 / N 人参与, the card's footer line. */
export function pollFooter(poll: Poll): string {
  return poll.totalVoterCount === 0 ? '无人投票' : `${poll.totalVoterCount} 人参与`
}

export function pollOptionCorrect(poll: Poll, option: PollOption): boolean {
  if (!poll.quiz || !pollResultsVisible(poll)) return false
  return poll.correctOptionIds?.includes(option.index) === true
}

export function pollOptionWrong(poll: Poll, option: PollOption): boolean {
  return poll.quiz && pollResultsVisible(poll) && option.chosen && !pollOptionCorrect(poll, option)
}

/** The correct answer's text, for the solution block a quiz shows after answering. */
export function pollCorrectAnswer(poll: Poll): string | null {
  if (!poll.quiz || !pollResultsVisible(poll)) return null
  const correct = poll.options.find((option) => pollOptionCorrect(poll, option))
  return correct?.text ?? null
}
