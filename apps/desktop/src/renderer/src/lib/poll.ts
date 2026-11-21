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

export function pollSelectionChanged(poll: Poll, selected: number[]): boolean {
  const chosen = pollChosen(poll)
  const next = [...selected].sort((a, b) => a - b)
  return chosen.length !== next.length || chosen.some((id, index) => id !== next[index])
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
