import { useState, type FormEvent } from 'react'
import type { AgentPolishPublic } from '../../types/ticket.ts'
import { withMockLabel } from '../../utils/mockFlag.ts'

type PolishCompareProps = {
  result: AgentPolishPublic | null
  feedbackDone: boolean
  feedbackError: string
  feedbackSending: boolean
  onAdopt: () => void
  onEdit: () => void
  onDiscard: () => void
  onFeedback: (rating: 'useful' | 'useless', comment: string) => Promise<void>
}

export function PolishCompare({
  result,
  feedbackDone,
  feedbackError,
  feedbackSending,
  onAdopt,
  onEdit,
  onDiscard,
  onFeedback,
}: PolishCompareProps) {
  const [rating, setRating] = useState<'useful' | 'useless'>('useless')
  const [comment, setComment] = useState('')

  if (!result) return null

  function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void onFeedback(rating, comment)
  }

  return (
    <section className="polish-compare" aria-label="润色对比">
      {result.can_adopt ? (
        <div className="polish-grid">
          <article>
            <h3>{withMockLabel('原稿')}</h3>
            <p>{result.original_content}</p>
          </article>
          <article>
            <h3>{withMockLabel('润色稿')}</h3>
            <p>{result.polished_content}</p>
          </article>
        </div>
      ) : (
        <div className="polish-risk" role="alert">
          <p>{withMockLabel('合规未通过，不能直接采用润色稿。')}</p>
          <ul>
            {result.risk_reasons.map((reason) => (
              <li key={reason}>{withMockLabel(reason)}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="polish-actions">
        {result.can_adopt ? (
          <>
            <button className="btn btn-primary" type="button" onClick={onAdopt}>
              采用
            </button>
            <button className="btn btn-secondary" type="button" onClick={onEdit}>
              修改
            </button>
          </>
        ) : null}
        <button className="btn btn-secondary" type="button" onClick={onDiscard}>
          放弃
        </button>
      </div>
      <form className="polish-feedback" onSubmit={submitFeedback}>
        <p className="hint">{withMockLabel('当次结果反馈，不会保存为模板。')}</p>
        <div className="polish-feedback-row">
          <label>
            <input
              type="radio"
              name="polish-feedback-rating"
              checked={rating === 'useful'}
              onChange={() => setRating('useful')}
            />
            有用
          </label>
          <label>
            <input
              type="radio"
              name="polish-feedback-rating"
              checked={rating === 'useless'}
              onChange={() => setRating('useless')}
            />
            无用
          </label>
        </div>
        <label htmlFor="polish-feedback-comment">说明</label>
        <input
          id="polish-feedback-comment"
          value={comment}
          maxLength={500}
          onChange={(event) => setComment(event.target.value)}
        />
        <button className="btn btn-secondary" type="submit" disabled={feedbackSending || feedbackDone}>
          {feedbackDone ? '已提交反馈' : feedbackSending ? '提交中…' : '提交反馈'}
        </button>
        {feedbackError ? (
          <p className="error-text" role="alert">
            {feedbackError}
          </p>
        ) : null}
      </form>
    </section>
  )
}
