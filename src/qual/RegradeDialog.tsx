import { useState } from 'react';
import type { FormEvent } from 'react';
import type { TrackId, TrackQuestion } from '../qualCore';
import { TRACK_LABELS } from '../qualCore';

export type RegradeMode = 'normal' | 'accepted_answers' | 'full_credit' | 'excluded';
export interface RegradeOverride { mode: RegradeMode; answers?: number[] }
export type RegradeOverrides = Record<string, RegradeOverride>;

export interface RegradeTrack {
  trackId: TrackId;
  questions: TrackQuestion[];
  overrides: RegradeOverrides;
}

const keyOf = (question: TrackQuestion) => `${question.section}${question.no}`;

export function RegradeDialog({ examName, tracks, onClose, onApply }: {
  examName: string;
  tracks: RegradeTrack[];
  onClose: () => void;
  onApply: (overrides: Partial<Record<TrackId, RegradeOverrides>>) => Promise<void>;
}) {
  const [modes, setModes] = useState<Record<string, RegradeMode>>(() => Object.fromEntries(
    tracks.flatMap((track) => track.questions.map((question) => [
      `${track.trackId}:${keyOf(question)}`, track.overrides[keyOf(question)]?.mode ?? 'normal',
    ])),
  ));
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(
    tracks.flatMap((track) => track.questions.map((question) => {
      const override = track.overrides[keyOf(question)];
      return [`${track.trackId}:${keyOf(question)}`, override?.mode === 'accepted_answers' ? (override.answers ?? []).join('\n') : String(question.key)];
    })),
  ));
  const [activeTrack, setActiveTrack] = useState<TrackId>(tracks[0].trackId);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const current = tracks.find((track) => track.trackId === activeTrack) ?? tracks[0];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const result: Partial<Record<TrackId, RegradeOverrides>> = {};
    for (const track of tracks) {
      const overrides: RegradeOverrides = {};
      for (const question of track.questions) {
        const id = `${track.trackId}:${keyOf(question)}`;
        const mode = modes[id] ?? 'normal';
        if (mode === 'normal') continue;
        if (mode === 'accepted_answers') {
          const values = (answers[id] ?? '').split('\n').map((value) => value.trim()).filter(Boolean).map(Number);
          if (values.length === 0 || values.some((value) => !Number.isInteger(value) || value < 1 || value > 4)) {
            setError(`${TRACK_LABELS[track.trackId]} ${question.subject} ${keyOf(question)} の正答候補は1〜4の数字を1行に1つずつ入力してください`);
            return;
          }
          overrides[keyOf(question)] = { mode, answers: values };
        } else {
          overrides[keyOf(question)] = { mode };
        }
      }
      result[track.trackId] = overrides;
    }
    if (!window.confirm(`「${examName}」の採点設定を保存し、全員分を再集計します。続けますか？`)) return;
    setSaving(true);
    try {
      await onApply(result);
      onClose();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : '採点設定を保存できませんでした');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div role="presentation" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <section role="dialog" aria-modal="true" aria-labelledby="regrade-title" onClick={(event) => event.stopPropagation()} style={{ background: '#fff', borderRadius: 10, width: 'min(100%, 1000px)', maxHeight: '92vh', overflow: 'auto', padding: 24, boxShadow: '0 12px 36px rgba(0,0,0,0.3)' }}>
        <h2 id="regrade-title" style={{ margin: '0 0 8px' }}>採点訂正・再集計</h2>
        <p style={{ margin: '0 0 16px', color: '#555' }}>{examName}：設問ごとに採点方法を変更できます。採点除外は満点からも除外されます。</p>
        {tracks.length > 1 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {tracks.map((track) => (
              <button key={track.trackId} type="button" onClick={() => setActiveTrack(track.trackId)} style={{ padding: '8px 14px', border: '1px solid #283593', borderRadius: 5, cursor: 'pointer', background: track.trackId === activeTrack ? '#283593' : '#fff', color: track.trackId === activeTrack ? '#fff' : '#283593' }}>
                {TRACK_LABELS[track.trackId]}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={submit}>
          <div style={{ maxHeight: '60vh', overflow: 'auto', border: '1px solid #ddd', borderRadius: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, background: '#f4f6f8', textAlign: 'left' }}>
                  <th style={{ padding: 10 }}>科目・設問</th>
                  <th style={{ padding: 10 }}>現在の模範解答</th>
                  <th style={{ padding: 10, minWidth: 180 }}>採点方法</th>
                  <th style={{ padding: 10 }}>正答候補（複数は改行）</th>
                </tr>
              </thead>
              <tbody>
                {current.questions.map((question) => {
                  const id = `${current.trackId}:${keyOf(question)}`;
                  return (
                    <tr key={id} style={{ borderTop: '1px solid #eee' }}>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{question.subject} {keyOf(question)}</td>
                      <td style={{ padding: '8px 10px' }}>{question.key}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <select value={modes[id] ?? 'normal'} onChange={(event) => setModes((previous) => ({ ...previous, [id]: event.target.value as RegradeMode }))} style={{ padding: 7, width: '100%' }}>
                          <option value="normal">通常採点</option>
                          <option value="accepted_answers">正答候補を変更</option>
                          <option value="full_credit">全員に加点</option>
                          <option value="excluded">採点除外</option>
                        </select>
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        {modes[id] === 'accepted_answers' && (
                          <textarea value={answers[id] ?? ''} rows={2} onChange={(event) => setAnswers((previous) => ({ ...previous, [id]: event.target.value }))} style={{ width: '100%', minWidth: 120, boxSizing: 'border-box', padding: 7 }} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {error && <div role="alert" style={{ marginTop: 12, padding: 10, background: '#ffebee', color: '#b71c1c', borderRadius: 5 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <button type="button" onClick={onClose} disabled={saving} style={{ padding: '10px 16px' }}>キャンセル</button>
            <button type="submit" disabled={saving} style={{ padding: '10px 16px', background: saving ? '#aaa' : '#283593', color: '#fff', border: 0, borderRadius: 5, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? '再集計中...' : '保存して全員分を再集計'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
