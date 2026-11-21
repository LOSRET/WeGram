import type { Poll, PollOption, PollVoteRestriction } from '@wegram/protocol'

import type { TdObject } from '../client'

const RESTRICTIONS: Record<string, PollVoteRestriction> = {
  pollVoteRestrictionReasonClosed: 'closed',
  pollVoteRestrictionReasonYetUnsent: 'yetUnsent',
  pollVoteRestrictionReasonScheduled: 'scheduled',
  pollVoteRestrictionReasonCountryRestricted: 'countryRestricted',
  pollVoteRestrictionReasonMembershipRequired: 'membershipRequired',
  pollVoteRestrictionReasonOther: 'other',
}

/**
 * Maps TDLib's messagePoll content into the transcript's poll DTO (design doc
 * §9.10).
 *
 * The one subtlety is option_order: TDLib may ask the client to draw the options
 * in another order, while setPollAnswer still speaks positions in its own array.
 * Every option therefore carries its original index, and the list handed to the
 * renderer is the requested display order.
 */
export function mapPoll(content: TdObject | undefined): Poll | undefined {
  const raw: TdObject | undefined = content?.poll
  if (!raw || typeof raw !== 'object') return undefined
  const rawOptions: TdObject[] = Array.isArray(raw.options) ? raw.options : []
  const options: PollOption[] = rawOptions.map((option, index) => ({
    index,
    ...(option?.id !== undefined && option?.id !== null && String(option.id)
      ? { id: String(option.id) }
      : {}),
    text: typeof option?.text?.text === 'string' ? option.text.text : '',
    voterCount: count(option?.voter_count),
    votePercentage: percentage(option?.vote_percentage),
    chosen: option?.is_chosen === true,
  }))
  const order: number[] = Array.isArray(raw.option_order)
    ? raw.option_order.map(Number).filter((index: number) => Number.isInteger(index))
    : []
  const displayed =
    order.length > 0
      ? order
          .map((index: number) => options[index])
          .filter((option: PollOption | undefined): option is PollOption => Boolean(option))
      : options
  const restriction = RESTRICTIONS[raw.vote_restriction_reason?._]
  const correctIds = correctOptionIds(raw)
  const question = raw.question?.text
  const description = content?.description?.text
  const explanation = raw.type?.explanation?.text
  const closeDate = Number(raw.close_date ?? 0)
  return {
    id: String(raw.id ?? ''),
    question: typeof question === 'string' ? question : '',
    ...(typeof description === 'string' && description ? { description } : {}),
    options: displayed,
    totalVoterCount: count(raw.total_voter_count),
    anonymous: raw.is_anonymous === true,
    // Older TDLib kept the flag on pollTypeRegular; newer builds moved it here.
    allowsMultipleAnswers:
      raw.allows_multiple_answers === true || raw.type?.allows_multiple_answers === true,
    ...(raw.allows_revoting === true ? { allowsRevoting: true } : {}),
    canSeeResults: raw.can_see_results !== false,
    quiz: raw.type?._ === 'pollTypeQuiz',
    ...(correctIds.length > 0 ? { correctOptionIds: correctIds } : {}),
    ...(typeof explanation === 'string' && explanation ? { explanation } : {}),
    closed: raw.is_closed === true || restriction === 'closed',
    ...(Number.isFinite(closeDate) && closeDate > 0 ? { closeDate } : {}),
    ...(restriction ? { restriction } : {}),
    ...(content?.can_add_option === true ? { canAddOption: true } : {}),
    answered: options.some((option) => option.chosen),
  }
}

/** 0-based positions of the correct answers, from either TDLib spelling. */
function correctOptionIds(raw: TdObject): number[] {
  const quiz = raw.type
  if (quiz?._ !== 'pollTypeQuiz') return []
  const values: unknown[] = Array.isArray(quiz.correct_option_ids)
    ? quiz.correct_option_ids
    : quiz.correct_option_id === undefined
      ? []
      : [quiz.correct_option_id]
  return values.map(Number).filter((value: number) => Number.isInteger(value) && value >= 0)
}

function count(value: unknown): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

function percentage(value: unknown): number {
  const number = Number(value ?? 0)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.min(100, Math.round(number)))
}
