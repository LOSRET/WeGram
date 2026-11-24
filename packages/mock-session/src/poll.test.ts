import { describe, expect, it } from 'vitest'

import {
  applyPollVote,
  copyPoll,
  newPollOption,
  pollOptionTarget,
  pollVoteRejection,
  type FakePoll,
} from './poll'

function poll(overrides: Partial<FakePoll> = {}): FakePoll {
  return {
    options: [
      { voterCount: 0, votePercentage: 0, chosen: false },
      { voterCount: 0, votePercentage: 0, chosen: false },
      { voterCount: 0, votePercentage: 0, chosen: false },
    ],
    totalVoterCount: 0,
    allowsMultipleAnswers: false,
    canSeeResults: false,
    quiz: false,
    closed: false,
    answered: false,
    ...overrides,
  }
}

describe('applyPollVote', () => {
  it('counts the first answer once and reveals the results', () => {
    const target = poll()
    expect(applyPollVote(target, [1])).toBeNull()
    expect(target.totalVoterCount).toBe(1)
    expect(target.options[1]).toMatchObject({ chosen: true, voterCount: 1, votePercentage: 100 })
    expect(target.answered).toBe(true)
    expect(target.canSeeResults).toBe(true)
  })

  it('moves a single answer without adding a voter', () => {
    const target = poll()
    applyPollVote(target, [0])
    applyPollVote(target, [2])
    expect(target.totalVoterCount).toBe(1)
    expect(target.options[0]).toMatchObject({ chosen: false, voterCount: 0 })
    expect(target.options[2]).toMatchObject({ chosen: true, voterCount: 1 })
  })

  it('retracts an answer with an empty list', () => {
    const target = poll()
    applyPollVote(target, [1])
    expect(applyPollVote(target, [])).toBeNull()
    expect(target.totalVoterCount).toBe(0)
    expect(target.options.map((option) => option.chosen)).toEqual([false, false, false])
    expect(target.answered).toBe(false)
  })

  it('accepts several answers only when the poll allows them', () => {
    expect(applyPollVote(poll(), [0, 1])).toBe('single-answer')
    const multiple = poll({ allowsMultipleAnswers: true })
    expect(applyPollVote(multiple, [0, 1])).toBeNull()
    expect(multiple.totalVoterCount).toBe(1)
    expect(multiple.options.map((option) => option.votePercentage)).toEqual([100, 100, 0])
  })

  it('refuses a closed poll, a restricted one and an answered quiz', () => {
    expect(applyPollVote(poll({ closed: true }), [0])).toBe('closed')
    expect(applyPollVote(poll({ restriction: 'membershipRequired' }), [0])).toBe('restricted')
    expect(applyPollVote(poll({ quiz: true, answered: true }), [0])).toBe('quiz-locked')
  })

  it('rejects an option position outside the poll', () => {
    expect(applyPollVote(poll(), [3])).toBe('invalid-option')
    expect(applyPollVote(poll(), [-1])).toBe('invalid-option')
  })
})

describe('copyPoll', () => {
  it('copies the options so the stored row survives a refused vote', () => {
    const stored = poll()
    const copy = copyPoll(stored)
    copy.options[0]!.chosen = true
    copy.totalVoterCount = 5
    expect(stored.options[0]?.chosen).toBe(false)
    expect(stored.totalVoterCount).toBe(0)
  })
})

describe('pollVoteRejection', () => {
  it('maps a refusal to the code and words the renderer shows', () => {
    expect(pollVoteRejection('quiz-locked')).toEqual({
      code: 'poll_answered',
      message: '这道题已经答过了',
    })
    expect(pollVoteRejection('closed')).toEqual({ code: 'forbidden', message: '投票已结束' })
    expect(pollVoteRejection('invalid-option')).toEqual({
      code: 'invalid_payload',
      message: '选项不存在',
    })
  })
})

describe('pollOptionTarget', () => {
  it('hands back the poll and the trimmed text', () => {
    const stored = poll({ canAddOption: true })
    expect(pollOptionTarget(stored, '  c  ')).toEqual({ poll: stored, text: 'c' })
  })

  it('refuses a closed poll, a row that is not one, and an empty box', () => {
    const missing = { rejection: { code: 'forbidden', message: '这个投票不能添加选项' } }
    expect(pollOptionTarget(undefined, 'c')).toEqual(missing)
    expect(pollOptionTarget(poll({ canAddOption: false }), 'c')).toEqual(missing)
    expect(pollOptionTarget(poll({ canAddOption: true, closed: true }), 'c')).toEqual(missing)
    expect(pollOptionTarget(poll({ canAddOption: true }), '   ')).toEqual({
      rejection: { code: 'invalid_payload', message: '选项内容不能为空' },
    })
  })
})

describe('newPollOption', () => {
  it('builds the unvoted row at the end of the list', () => {
    expect(newPollOption(10, 3, 'c')).toEqual({
      index: 3,
      id: 'option-10-3',
      text: 'c',
      voterCount: 0,
      votePercentage: 0,
      chosen: false,
    })
  })
})
