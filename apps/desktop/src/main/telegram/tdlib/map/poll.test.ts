import { describe, expect, it } from 'vitest'

import { mapPoll } from './poll'

describe('mapPoll', () => {
  it('maps options, counters and the answered flag', () => {
    const poll = mapPoll({
      _: 'messagePoll',
      poll: {
        id: '42',
        question: { text: 'which one?' },
        options: [
          { text: { text: 'a' }, voter_count: 6, vote_percentage: 60, is_chosen: true },
          { id: '7', text: { text: 'b' }, voter_count: 4, vote_percentage: 40 },
        ],
        total_voter_count: 10,
        is_anonymous: true,
        allows_multiple_answers: false,
        can_see_results: true,
        is_closed: false,
        type: { _: 'pollTypeRegular' },
      },
    })

    expect(poll).toMatchObject({
      id: '42',
      question: 'which one?',
      totalVoterCount: 10,
      anonymous: true,
      allowsMultipleAnswers: false,
      canSeeResults: true,
      quiz: false,
      closed: false,
      answered: true,
    })
    expect(poll?.options).toEqual([
      { index: 0, text: 'a', voterCount: 6, votePercentage: 60, chosen: true },
      { index: 1, id: '7', text: 'b', voterCount: 4, votePercentage: 40, chosen: false },
    ])
  })

  it('draws options in option_order but keeps their vote positions', () => {
    const poll = mapPoll({
      _: 'messagePoll',
      poll: {
        id: '1',
        question: { text: 'q' },
        options: [{ text: { text: 'a' } }, { text: { text: 'b' } }, { text: { text: 'c' } }],
        option_order: [2, 0, 1],
        type: { _: 'pollTypeRegular' },
      },
    })
    expect(poll?.options.map((option) => [option.text, option.index])).toEqual([
      ['c', 2],
      ['a', 0],
      ['b', 1],
    ])
  })

  it('maps a quiz with its correct answer, explanation and add-option flag', () => {
    const poll = mapPoll({
      _: 'messagePoll',
      can_add_option: true,
      description: { text: 'answer carefully' },
      poll: {
        id: '9',
        question: { text: '2 + 2?' },
        options: [{ text: { text: '3' } }, { text: { text: '4' } }],
        total_voter_count: 0,
        is_anonymous: false,
        allows_multiple_answers: false,
        can_see_results: false,
        is_closed: false,
        type: {
          _: 'pollTypeQuiz',
          correct_option_ids: [1],
          explanation: { text: 'basic arithmetic' },
        },
      },
    })
    expect(poll).toMatchObject({
      quiz: true,
      correctOptionIds: [1],
      explanation: 'basic arithmetic',
      description: 'answer carefully',
      canAddOption: true,
      canSeeResults: false,
      anonymous: false,
    })
  })

  it('reads the vote restriction and treats it as closed when TDLib says so', () => {
    const poll = mapPoll({
      _: 'messagePoll',
      poll: {
        id: '3',
        question: { text: 'q' },
        options: [{ text: { text: 'a' } }],
        type: { _: 'pollTypeRegular' },
        vote_restriction_reason: { _: 'pollVoteRestrictionReasonClosed' },
      },
    })
    expect(poll).toMatchObject({ closed: true, restriction: 'closed' })
  })

  it('answers undefined for content without a poll', () => {
    expect(mapPoll({ _: 'messagePoll' })).toBeUndefined()
    expect(mapPoll(undefined)).toBeUndefined()
  })
})
