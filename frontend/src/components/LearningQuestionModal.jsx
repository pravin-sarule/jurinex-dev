import React, { useCallback, useMemo, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { DOCS_BASE_URL } from '../config/apiConfig';

function getAuthToken() {
  const tokenKeys = [
    'authToken',
    'token',
    'accessToken',
    'jwt',
    'bearerToken',
    'auth_token',
    'access_token',
    'api_token',
    'userToken',
  ];
  for (const key of tokenKeys) {
    const token = localStorage.getItem(key);
    if (token) return token;
  }
  return null;
}

export default function LearningQuestionModal({
  open,
  data,
  folderName,
  sessionId,
  authToken = null,
  onClose,
  onCompleted,
}) {
  const [selected, setSelected] = useState(null);
  const [selectedMulti, setSelectedMulti] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const startedAt = useMemo(() => Date.now(), [data?.question_id, open]);

  const options = useMemo(() => {
    if (!data || !Array.isArray(data.options)) return [];
    return data.options;
  }, [data]);
  const isMulti = useMemo(() => {
    const raw = String(data?.ui_type || data?.question_type || '').toLowerCase();
    return raw === 'options_multi' || raw === 'multi' || raw === 'checkbox' || !!data?.allow_multiple;
  }, [data]);

  const resetLocal = useCallback(() => {
    setSelected(null);
    setSelectedMulti([]);
    setSubmitting(false);
    setResult(null);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    resetLocal();
    onClose?.();
  }, [onClose, resetLocal]);

  if (!open || !data) return null;

  const submit = async () => {
    const selectedAnswer = isMulti ? selectedMulti.join(',') : selected;
    if (!selectedAnswer || !sessionId || !data.question_id) {
      setError('Select an answer and ensure the session is active.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const token = authToken || getAuthToken();
    const seg = encodeURIComponent(String(folderName || '').trim());
    const url = `${String(DOCS_BASE_URL || '').replace(/\/$/, '')}/${seg}/learning/questions/answer`;
    const timeTaken = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          question_id: data.question_id,
          selected_answer: selectedAnswer,
          session_id: sessionId,
          time_taken: timeTaken,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof body?.detail === 'string' ? body.detail : body?.message || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setResult(body);
    } catch (e) {
      setError(e?.message || 'Could not submit your answer.');
    } finally {
      setSubmitting(false);
    }
  };

  const pageRef = data.page_reference;
  const pageLabel =
    pageRef != null && pageRef !== ''
      ? Array.isArray(pageRef)
        ? `Pages ${pageRef.join(', ')}`
        : `Page ${pageRef}`
      : null;

  return (
    <div className="learning-question-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="learning-q-title">
      <div className="learning-question-modal">
        <div className="learning-question-modal-header">
          <div className="learning-question-modal-title-row">
            <BookOpen className="learning-question-modal-icon" aria-hidden />
            <h2 id="learning-q-title">Check your understanding</h2>
          </div>
          <button type="button" className="learning-question-modal-close" onClick={handleClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {data.difficulty ? (
          <div className="learning-question-meta">
            <span className="learning-question-pill">{String(data.difficulty)}</span>
            {data.concept ? <span className="learning-question-pill subtle">{String(data.concept)}</span> : null}
            {pageLabel ? <span className="learning-question-pill subtle">{pageLabel}</span> : null}
          </div>
        ) : null}

        <p className="learning-question-text">{String(data.question_text || '').trim()}</p>

        <div
          className="learning-question-options"
          role={isMulti ? 'group' : 'radiogroup'}
          aria-label={isMulti ? 'Select one or more answer choices' : 'Select one answer choice'}
        >
          {options.map((opt) => {
            const id = String(opt.id || '').toUpperCase();
            const label = String(opt.text || '').trim();
            const active = isMulti ? selectedMulti.includes(id) : selected === id;
            return (
              <button
                key={id}
                type="button"
                className={`learning-question-option ${active ? 'selected' : ''}`}
                onClick={() => {
                  if (result) return;
                  if (isMulti) {
                    setSelectedMulti((prev) =>
                      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                    );
                    return;
                  }
                  setSelected(id);
                }}
                disabled={!!result || submitting}
              >
                <span className="learning-question-option-id">{id}</span>
                <span className="learning-question-option-text">{label}</span>
              </button>
            );
          })}
        </div>

        {error ? <div className="learning-question-error">{error}</div> : null}

        {result ? (
          <div className={`learning-question-feedback ${result.correct ? 'ok' : 'bad'}`}>
            <strong>{result.correct ? 'Correct' : 'Not quite'}</strong>
            <p>{result.explanation}</p>
            {result.follow_up_message ? <p className="learning-question-followup">{result.follow_up_message}</p> : null}
            <button
              type="button"
              className="learning-question-primary"
              onClick={() => {
                const r = result;
                resetLocal();
                onCompleted?.(r);
              }}
            >
              Continue
            </button>
          </div>
        ) : (
          <div className="learning-question-actions">
            <button type="button" className="learning-question-secondary" onClick={handleClose}>
              Skip for now
            </button>
            <button
              type="button"
              className="learning-question-primary"
              onClick={submit}
              disabled={submitting || (isMulti ? selectedMulti.length === 0 : !selected)}
            >
              {submitting ? 'Submitting…' : 'Submit answer'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
