import type { Poll } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import {
  pollCanAddOption,
  pollCanChangeAnswer,
  pollChosen,
  pollCorrectAnswer,
  pollDraftSelection,
  pollFooter,
  pollOptionCorrect,
  pollOptionWrong,
  pollRestrictionText,
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

  it('refuses to change an answer the poll will not take back', () => {
    const answered = poll({
      answered: true,
      options: [
        { index: 0, text: 'a', voterCount: 3, votePercentage: 60, chosen: true },
        { index: 1, text: 'b', voterCount: 2, votePercentage: 40, chosen: false },
      ],
    })
    // Unanswered: the first vote is always on offer.
    expect(pollCanChangeAnswer(poll())).toBe(true)
    // Answered, no allows_revoting: TDLib would refuse both a retract and a switch.
    expect(pollCanChangeAnswer(answered)).toBe(false)
    expect(pollCanChangeAnswer({ ...answered, allowsRevoting: true })).toBe(true)
    // A quiz is final whatever the flag says.
    expect(pollCanChangeAnswer({ ...answered, quiz: true, allowsRevoting: true })).toBe(false)
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

  it('keeps staged ticks across a count-only poll refresh', () => {
    const multiple = poll({ allowsMultipleAnswers: true })
    const refreshed = {
      ...multiple,
      totalVoterCount: 9,
      options: multiple.options.map((option) => ({
        ...option,
        voterCount: option.voterCount + 2,
      })),
    }
    expect(pollDraftSelection({ poll: multiple, selection: [0, 1] }, refreshed)).toEqual([0, 1])
  })

  it('drops staged ticks when the server answer, options or closed state changes', () => {
    const multiple = poll({ allowsMultipleAnswers: true })
    const answered = {
      ...multiple,
      answered: true,
      options: multiple.options.map((option) => ({ ...option, chosen: option.index === 1 })),
    }
    expect(pollDraftSelection({ poll: multiple, selection: [0] }, answered)).toEqual([1])
    expect(
      pollDraftSelection({ poll: multiple, selection: [0] }, { ...multiple, closed: true }),
    ).toEqual([])
    expect(
      pollDraftSelection(
        { poll: multiple, selection: [0] },
        {
          ...multiple,
          options: [
            ...multiple.options,
            { index: 2, text: 'c', voterCount: 0, votePercentage: 0, chosen: false },
          ],
        },
      ),
    ).toEqual([])
  })

  it('offers adding an option only when the server allows it and the poll is open', () => {
    expect(pollCanAddOption(poll())).toBe(false)
    expect(pollCanAddOption(poll({ canAddOption: true }))).toBe(true)
    expect(pollCanAddOption(poll({ canAddOption: true, closed: true }))).toBe(false)
  })

  it('explains a vote restriction and stays quiet without one', () => {
    expect(pollRestrictionText(poll())).toBeNull()
    expect(pollRestrictionText(poll({ closed: true, restriction: 'closed' }))).toBeNull()
    expect(pollRestrictionText(poll({ restriction: 'yetUnsent' }))).toBe(
      '消息还在发送，暂时不能投票',
    )
    expect(pollRestrictionText(poll({ restriction: 'scheduled' }))).toBe('定时消息不能提前投票')
    expect(pollRestrictionText(poll({ restriction: 'countryRestricted' }))).toBe(
      '所在地区不支持参与这个投票',
    )
    expect(pollRestrictionText(poll({ restriction: 'membershipRequired' }))).toBe(
      '需要加入后才能投票',
    )
    expect(pollRestrictionText(poll({ restriction: 'other' }))).toBe('当前账号不能参与这个投票')
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
