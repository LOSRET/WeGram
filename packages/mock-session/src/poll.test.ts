import { describe, expect, it } from 'vitest'

import { applyPollVote, appendPollOption, castPollVote, type FakePoll } from './poll'

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

describe('castPollVote', () => {
  it('answers a copy and leaves the stored poll untouched', () => {
    const stored = poll()
    const result = castPollVote(stored, [1])
    if ('rejection' in result) throw new Error('vote was refused')
    expect(result.poll.options[1]).toMatchObject({ chosen: true, voterCount: 1 })
    expect(stored.options[1]).toMatchObject({ chosen: false, voterCount: 0 })
    expect(stored.totalVoterCount).toBe(0)
  })

  it('maps a refused vote to the code and words the renderer shows', () => {
    const quiz = castPollVote(poll({ quiz: true, answered: true }), [0])
    expect(quiz).toEqual({
      rejection: { code: 'poll_answered', message: '这道题已经答过了' },
    })
    const closed = castPollVote(poll({ closed: true }), [0])
    expect(closed).toEqual({ rejection: { code: 'forbidden', message: '投票已结束' } })
    const bad = castPollVote(poll(), [9])
    expect(bad).toEqual({ rejection: { code: 'invalid_payload', message: '选项不存在' } })
  })
})

describe('appendPollOption', () => {
  it('appends an unvoted option at the end', () => {
    const stored = poll({ canAddOption: true })
    const result = appendPollOption(stored, { messageId: 10, text: '  c  ' })
    if ('rejection' in result) throw new Error('option was refused')
    expect(result.poll.options).toHaveLength(4)
    expect(result.poll.options[3]).toEqual({
      index: 3,
      id: 'option-10-3',
      text: 'c',
      voterCount: 0,
      votePercentage: 0,
      chosen: false,
    })
    expect(stored.options).toHaveLength(3)
  })

  it('refuses a closed poll and an empty box', () => {
    expect(appendPollOption(poll({ canAddOption: false }), { messageId: 1, text: 'x' })).toEqual({
      rejection: { code: 'forbidden', message: '这个投票不能添加选项' },
    })
    expect(appendPollOption(poll({ canAddOption: true, closed: true }), {
      messageId: 1,
      text: 'x',
    })).toEqual({ rejection: { code: 'forbidden', message: '这个投票不能添加选项' } })
    expect(appendPollOption(poll({ canAddOption: true }), { messageId: 1, text: '  ' })).toEqual({
      rejection: { code: 'invalid_payload', message: '选项内容不能为空' },
    })
  })
})

