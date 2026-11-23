import type { Poll } from '@wegram/protocol'
import { useState, type FormEvent } from 'react'

import { errorMessage, invoke, isAppErrorShape } from '../../lib/ipc'
import {
  pollCanAddOption,
  pollChosen,
  pollCorrectAnswer,
  pollFooter,
  pollOptionCorrect,
  pollOptionWrong,
  pollRestrictionText,
  pollResultsVisible,
  pollSelectionChanged,
  pollToggleSelection,
  pollVotable,
} from '../../lib/poll'
import { useAppStore } from '../../store/useAppStore'

/**
 * A Telegram poll's card (design doc §9.10).
 *
 * The bubble around it keeps WeChat's green/grey fill; the card itself is the
 * poll, like WeChat's own vote card: question, options, and the counters once
 * TDLib lets the reader see them. Voting is one request — a single-answer poll
 * sends on the tap, a multiple-answer one stages the ticks and offers 投票.
 *
 * A server-side vote change arrives as a message replace, and the new poll
 * object is what resets the staged selection: draft remembers the poll it was
 * made against, so a fresh object ignores it without an effect.
 */
export function PollBubble({
  chatId,
  messageId,
  poll,
}: {
  chatId: number
  messageId: number
  poll: Poll
}) {
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<{ poll: Poll; selection: number[] } | null>(null)
  /** The poll the server refused an answer for: this account already answered it. */
  const [lockedFor, setLockedFor] = useState<Poll | null>(null)
  const [adding, setAdding] = useState(false)
  const [optionText, setOptionText] = useState('')

  const selection = draft?.poll === poll ? draft.selection : pollChosen(poll)
  const results = pollResultsVisible(poll)
  // A refreshed poll arrives as a new object, which releases the lock by itself.
  const locked = lockedFor === poll
  const votable = pollVotable(poll) && !busy && !locked
  const solution = pollCorrectAnswer(poll)
  const canAddOption = pollCanAddOption(poll)
  const restriction = pollRestrictionText(poll)

  const fail = (cause: unknown): void => {
    useAppStore.getState().setError(errorMessage(cause))
  }

  const vote = (optionIds: number[]): void => {
    if (busy) return
    setBusy(true)
    void invoke('messages:vote', { chatId, messageId, optionIds })
      .catch((cause) => {
        // Already answered (possibly on another client): lock the card instead of
        // raising the banner, which would only invite another tap (§9.10).
        if (isAppErrorShape(cause) && cause.code === 'poll_answered') {
          setLockedFor(poll)
          return
        }
        fail(cause)
      })
      .finally(() => setBusy(false))
  }

  const choose = (index: number): void => {
    if (!votable) return
    if (poll.allowsMultipleAnswers) {
      setDraft({ poll, selection: pollToggleSelection(poll, selection, index) })
      return
    }
    // Tapping the answer you already gave takes it back; a quiz is final.
    if (pollChosen(poll).includes(index)) {
      if (!poll.quiz) vote([])
      return
    }
    vote([index])
  }

  const addOption = (event: FormEvent): void => {
    event.preventDefault()
    const text = optionText.trim()
    if (!text || busy) return
    setBusy(true)
    void invoke('messages:addPollOption', { chatId, messageId, text })
      .then(() => {
        setAdding(false)
        setOptionText('')
      })
      .catch(fail)
      .finally(() => setBusy(false))
  }

  const staged = poll.allowsMultipleAnswers && pollSelectionChanged(poll, selection)

  return (
    <div className="wx-poll">
      <div className="wx-poll__head">
        <div className="wx-poll__question">{poll.question}</div>
        {poll.description ? <div className="wx-poll__description">{poll.description}</div> : null}
      </div>
      <div className="wx-poll__options">
        {poll.options.map((option) => {
          const selected = selection.includes(option.index)
          const correct = pollOptionCorrect(poll, option)
          const wrong = pollOptionWrong(poll, option)
          const classes = ['wx-poll__option']
          if (selected) classes.push('wx-poll__option--chosen')
          if (correct) classes.push('wx-poll__option--correct')
          if (wrong) classes.push('wx-poll__option--wrong')
          const markClasses = ['wx-poll__mark']
          if (!poll.allowsMultipleAnswers) markClasses.push('wx-poll__mark--round')
          if (selected) markClasses.push('wx-poll__mark--on')
          return (
            <button
              key={option.id ?? option.index}
              type="button"
              className={classes.join(' ')}
              disabled={!votable}
              aria-pressed={selected}
              onClick={() => choose(option.index)}
            >
              {results ? (
                <span
                  className="wx-poll__fill"
                  style={{ width: option.votePercentage + '%' }}
                  aria-hidden
                />
              ) : null}
              <span className={markClasses.join(' ')} aria-hidden>
                {selected ? (wrong ? '✕' : '✓') : ''}
              </span>
              <span className="wx-poll__label">{option.text}</span>
              {correct ? <span className="wx-poll__tag">正确答案</span> : null}
              {results ? <span className="wx-poll__pct">{option.votePercentage}%</span> : null}
            </button>
          )
        })}
      </div>
      {restriction ? <div className="wx-poll__hint">{restriction}</div> : null}
      {locked ? <div className="wx-poll__hint">你的答案已经提交，不能修改</div> : null}
      {staged ? (
        <div className="wx-poll__actions">
          <button type="button" className="wx-poll__submit" onClick={() => vote(selection)}>
            投票
          </button>
        </div>
      ) : null}
      {adding && canAddOption ? (
        <form className="wx-poll__add-form" onSubmit={addOption}>
          <input
            className="wx-poll__add-input"
            value={optionText}
            maxLength={255}
            placeholder="新选项"
            autoFocus
            onChange={(event) => setOptionText(event.target.value)}
          />
          <button
            type="submit"
            className="wx-poll__add-submit"
            disabled={busy || !optionText.trim()}
          >
            添加
          </button>
        </form>
      ) : canAddOption ? (
        <button type="button" className="wx-poll__add" onClick={() => setAdding(true)}>
          ＋ 添加选项
        </button>
      ) : null}
      {solution ? (
        <div className="wx-poll__solution">
          <span className="wx-poll__solution-title">正确答案：{solution}</span>
          {poll.explanation ? (
            <span className="wx-poll__solution-text">{poll.explanation}</span>
          ) : null}
        </div>
      ) : null}
      <div className="wx-poll__footer">
        <span>{pollFooter(poll)}</span>
        {poll.closed ? <span className="wx-poll__closed">已结束</span> : null}
      </div>
    </div>
  )
}
