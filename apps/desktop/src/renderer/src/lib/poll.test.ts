import type { Poll } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import {
  pollCanAddOption,
  pollChosen,
  pollCorrectAnswer,
  pollFooter,
  pollOptionCorrect,
  pollOptionWrong,
  pollResultsVisible,
  pollSelectionChanged,
  pollToggleSelection,
  pollVotable,
} from './poll'

function poll(overrides: Partial<Poll> = {}): Poll {
  return {
    id: '1',
    question: 'where?',
    options: [
      { index: 0, text: 'a', voterCount: 3, votePercentage: 60, chosen: false },
      { index: 1, text: 'b', voterCount: 2, votePercentage: 40, chosen: false },
    ],
    totalVoterCount: 5,
    anonymous: true,
    allowsMultipleAnswers: false,
    canSeeResults: true,
    quiz: false,
    closed: false,
    answered: false,
    ...overrides,
  }
}

describe('poll rules', () => {
  it('hides an unanswered quiz and shows a closed poll', () => {
    expect(pollResultsVisible(poll({ quiz: true }))).toBe(false)
    expect(pollResultsVisible(poll({ quiz: true, answered: true }))).toBe(true)
    expect(pollResultsVisible(poll({ closed: true }))).toBe(true)
  })

  it('refuses a vote on a closed, restricted or answered quiz', () => {
    expect(pollVotable(poll())).toBe(true)
    expect(pollVotable(poll({ closed: true }))).toBe(false)
    expect(pollVotable(poll({ restriction: 'membershipRequired' }))).toBe(false)
    expect(pollVotable(poll({ quiz: true, answered: true }))).toBe(false)
  })

  it('replaces a single answer but toggles a multiple one', () => {
    expect(pollToggleSelection(poll(), [0], 1)).toEqual([1])
    const multiple = poll({ allowsMultipleAnswers: true })
    expect(pollToggleSelection(multiple, [0], 1)).toEqual([0, 1])
    expect(pollToggleSelection(multiple, [0, 1], 0)).toEqual([1])
  })

  it('knows when a staged selection differs from the server answer', () => {
    const answered = poll({
      options: [
        { index: 0, text: 'a', voterCount: 3, votePercentage: 60, chosen: true },
        { index: 1, text: 'b', voterCount: 2, votePercentage: 40, chosen: false },
      ],
      answered: true,
    })
    expect(pollChosen(answered)).toEqual([0])
    expect(pollSelectionChanged(answered, [0])).toBe(false)
    expect(pollSelectionChanged(answered, [1])).toBe(true)
  })

  it('offers adding an option only when the server allows it and the poll is open', () => {
    expect(pollCanAddOption(poll())).toBe(false)
    expect(pollCanAddOption(poll({ canAddOption: true }))).toBe(true)
    expect(pollCanAddOption(poll({ canAddOption: true, closed: true }))).toBe(false)
  })

  it('labels the footer', () => {
    expect(pollFooter(poll({ totalVoterCount: 0 }))).toBe('无人投票')
    expect(pollFooter(poll())).toBe('5 人参与')
  })

  it('marks the quiz answer right or wrong and reads its solution', () => {
    const quiz = poll({
      quiz: true,
      answered: true,
      correctOptionIds: [1],
      options: [
        { index: 0, text: 'a', voterCount: 3, votePercentage: 60, chosen: true },
        { index: 1, text: 'b', voterCount: 2, votePercentage: 40, chosen: false },
      ],
    })
    expect(quiz.options.map((option) => pollOptionCorrect(quiz, option))).toEqual([false, true])
    expect(quiz.options.map((option) => pollOptionWrong(quiz, option))).toEqual([true, false])
    expect(pollCorrectAnswer(quiz)).toBe('b')
  })
})
