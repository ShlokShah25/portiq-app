import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import {
  ArrowLeft,
  Download,
  Sparkles,
  CheckCircle2,
  MessageCircle,
  Puzzle,
  Code2,
  Users,
  Heart,
  User,
} from 'lucide-react';
import { formatApiError } from '../utils/apiErrorMessage';
import { editorOtpHeaders } from '../utils/meetingEditorOtp';
import {
  hiringVerdictShort,
  interviewRosterRows,
} from './interviewUtils';
import './InterviewMode.css';

function levelToScore(level) {
  const l = String(level || '').trim().toLowerCase();
  if (l === 'high') return 9.0;
  if (l === 'medium') return 7.0;
  if (l === 'low') return 5.0;
  return 6.5;
}

function formatInterviewDate(m) {
  const d = m.endTime || m.startTime || m.scheduledTime;
  if (!d) return 'Interview date not set';
  return new Date(d).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDuration(m) {
  const start = m.startTime ? new Date(m.startTime) : null;
  const end = m.endTime ? new Date(m.endTime) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return '—';
  }
  const sec = Math.floor((end - start) / 1000);
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${mm}:${String(ss).padStart(2, '0')} min`;
}

function fitBadge(recommendation) {
  const r = String(recommendation || '').toLowerCase();
  if (r.includes('strong')) return { label: 'Strong Fit', tone: 'strong' };
  if (r.includes('no hire')) return { label: 'Not a Fit', tone: 'weak' };
  if (r.includes('neutral')) return { label: 'Moderate Fit', tone: 'neutral' };
  if (r.includes('hire')) return { label: 'Good Fit', tone: 'good' };
  return { label: 'Pending review', tone: 'neutral' };
}

function buildBreakdown(signals) {
  const s = signals && typeof signals === 'object' ? signals : {};
  const comm = levelToScore(s.communicationClarity?.level);
  const depth = levelToScore(s.depthOfAnswers?.level);
  const own = levelToScore(s.ownershipSignals?.level);
  const conf = levelToScore(s.confidenceLevel?.level);
  return [
    { key: 'communication', label: 'Communication', score: comm, icon: MessageCircle },
    { key: 'problem', label: 'Problem Solving', score: depth, icon: Puzzle },
    { key: 'technical', label: 'Technical Knowledge', score: Math.max(5, Math.min(10, depth - 0.5)), icon: Code2 },
    { key: 'leadership', label: 'Leadership Potential', score: own, icon: Users },
    { key: 'culture', label: 'Cultural Fit', score: conf, icon: Heart },
  ];
}

function topicSlices(breakdown) {
  const pick = (label) => breakdown.find((b) => b.label === label)?.score || 7;
  const raw = [
    { label: 'Product Sense', weight: pick('Communication') * 1.1 },
    { label: 'Problem Solving', weight: pick('Problem Solving') },
    { label: 'Technical', weight: pick('Technical Knowledge') },
    { label: 'Leadership', weight: pick('Leadership Potential') * 0.85 },
    { label: 'Others', weight: pick('Cultural Fit') * 0.7 },
  ];
  const total = raw.reduce((sum, r) => sum + r.weight, 0) || 1;
  return raw.map((r) => ({ label: r.label, pct: Math.round((r.weight / total) * 100) }));
}

function donutStyleFromTopics(topics) {
  const colors = ['#6366f1', '#f59e0b', '#22c55e', '#3b82f6', '#9ca3af'];
  let deg = 0;
  const stops = topics.map((t, i) => {
    const span = (t.pct / 100) * 360;
    const start = deg;
    deg += span;
    return `${colors[i % colors.length]} ${start}deg ${deg}deg`;
  });
  return { background: `conic-gradient(${stops.join(', ')})` };
}

function candidateInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default function InterviewSummaryReport() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [exportBusy, setExportBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await axios.get(`/meetings/${id}`, { headers: editorOtpHeaders(id) });
      setMeeting(res.data.meeting);
      setError('');
    } catch (err) {
      setError(formatApiError(err, 'Could not load interview report.'));
      setMeeting(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    if (meeting?.transcriptionStatus !== 'Processing') return;
    const t = setInterval(() => load(), 4000);
    return () => clearInterval(t);
  }, [meeting?.transcriptionStatus, load]);

  const roster = useMemo(() => (meeting ? interviewRosterRows(meeting) : []), [meeting]);
  const candidate = roster[0] || { name: meeting?.title || 'Candidate', role: meeting?.interviewRole || '' };

  const hiringRecommendation = String(
    meeting?.pendingHiringRecommendation || meeting?.hiringRecommendation || ''
  ).trim();
  const hiringReason = String(
    meeting?.pendingHiringRecommendationReason || meeting?.hiringRecommendationReason || ''
  ).trim();
  const evaluationSignals =
    meeting?.pendingEvaluationSignals != null
      ? meeting.pendingEvaluationSignals
      : meeting?.evaluationSignals;

  const keyHighlights = useMemo(() => {
    const pts = meeting?.pendingKeyPoints || meeting?.keyPoints || [];
    if (Array.isArray(pts) && pts.length) return pts.filter(Boolean).slice(0, 6);
    const notes = meeting?.pendingImportantNotes || meeting?.importantNotes || [];
    return Array.isArray(notes) ? notes.filter(Boolean).slice(0, 4) : [];
  }, [meeting]);

  const summaryText = String(meeting?.pendingSummary || meeting?.summary || '').trim();
  const breakdown = useMemo(() => buildBreakdown(evaluationSignals), [evaluationSignals]);
  const overallScore = useMemo(() => {
    if (!breakdown.length) return null;
    const avg = breakdown.reduce((s, b) => s + b.score, 0) / breakdown.length;
    return Math.round(avg * 10) / 10;
  }, [breakdown]);

  const fit = fitBadge(hiringRecommendation);
  const topics = useMemo(() => topicSlices(breakdown), [breakdown]);
  const topicDonut = useMemo(() => donutStyleFromTopics(topics), [topics]);

  const canFinalize = meeting?.summaryStatus !== 'Sent' && (summaryText || hiringRecommendation);
  const processing =
    meeting?.transcriptionStatus === 'Processing' ||
    (meeting?.status === 'Completed' && meeting?.transcriptionStatus !== 'Completed' && meeting?.transcriptionStatus !== 'Failed');

  const handleExport = async () => {
    if (!meeting?._id) return;
    setExportBusy(true);
    try {
      const response = await axios.get(`/admin/meetings/${meeting._id}/summary-pdf`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      const safeTitle = String(meeting.title || 'interview').replace(/[^\w\-]+/g, '-').slice(0, 40);
      link.setAttribute('download', `interview-report-${safeTitle}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setActionError(formatApiError(err, 'Could not export PDF.'));
    } finally {
      setExportBusy(false);
    }
  };

  const handleFinalize = async () => {
    setSaving(true);
    setActionError('');
    try {
      await axios.post(`/meetings/${id}/approve-and-send`, { additionalParticipants: [] }, {
        headers: editorOtpHeaders(id),
      });
      navigate('/interview');
    } catch (err) {
      setActionError(formatApiError(err, 'Could not finalize decision.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="iv-report-v2">
        <div className="iv-report-v2__loading">Loading interview summary…</div>
      </div>
    );
  }

  if (error || !meeting) {
    return (
      <div className="iv-report-v2">
        <Link to="/interview" className="iv-report-v2__back">
          <ArrowLeft size={16} /> Back
        </Link>
        <p className="iv-report-v2__error">{error || 'Interview not found.'}</p>
      </div>
    );
  }

  const verdict = hiringVerdictShort({ hiringRecommendation }) || 'Pending';
  const hirePositive = /hire/i.test(hiringRecommendation) && !/no hire/i.test(hiringRecommendation);

  return (
    <div className="iv-report-v2">
      <header className="iv-report-v2__header">
        <div>
          <Link to="/interview" className="iv-report-v2__back">
            <ArrowLeft size={16} aria-hidden /> Back
          </Link>
          <h1 className="iv-report-v2__title">Interview Summary</h1>
        </div>
        <button
          type="button"
          className="iv-report-v2__export"
          onClick={handleExport}
          disabled={exportBusy || processing}
        >
          <Download size={16} aria-hidden />
          {exportBusy ? 'Exporting…' : 'Export Report'}
        </button>
      </header>

      {processing ? (
        <p className="iv-report-v2__processing">Still processing the interview recording…</p>
      ) : null}

      {actionError ? (
        <p className="iv-report-v2__error" role="alert">
          {actionError}
        </p>
      ) : null}

      <div className="iv-report-v2__grid">
        <div className="iv-report-v2__col iv-report-v2__col--profile">
          <section className="iv-report-v2-card iv-report-v2-card--profile">
            <span className="iv-report-v2-avatar" aria-hidden>
              {candidateInitials(candidate.name)}
            </span>
            <h2 className="iv-report-v2-candidate">{candidate.name}</h2>
            <p className="iv-report-v2-role">{candidate.role || 'Interview candidate'}</p>
            <p className="iv-report-v2-meta">
              Interview on {formatInterviewDate(meeting)} · {formatDuration(meeting)}
            </p>
          </section>

          <section className="iv-report-v2-card">
            <p className="iv-report-v2-card__label">Overall Score</p>
            <div className="iv-report-v2-score-row">
              <strong className="iv-report-v2-score">
                {overallScore != null ? overallScore : '—'}
                <span>/ 10</span>
              </strong>
              <span className={`iv-report-v2-fit iv-report-v2-fit--${fit.tone}`}>{fit.label}</span>
            </div>
            <div className="iv-report-v2-score-bar" aria-hidden>
              <span
                className="iv-report-v2-score-bar__fill"
                style={{ width: overallScore != null ? `${(overallScore / 10) * 100}%` : '0%' }}
              />
            </div>
          </section>

          <section className="iv-report-v2-card">
            <p className="iv-report-v2-card__label">Hiring Recommendation</p>
            <div className={`iv-report-v2-verdict${hirePositive ? ' iv-report-v2-verdict--positive' : ''}`}>
              {hirePositive ? <CheckCircle2 size={20} aria-hidden /> : <User size={20} aria-hidden />}
              <strong>{verdict}</strong>
            </div>
            <p className="iv-report-v2-verdict__reason">
              {hiringReason ||
                summaryText ||
                'Review the evaluation below and finalize your hiring decision.'}
            </p>
          </section>
        </div>

        <section className="iv-report-v2-card iv-report-v2__col iv-report-v2__col--scores">
          <h2 className="iv-report-v2-card__title">Score Breakdown</h2>
          <ul className="iv-report-v2-breakdown">
            {breakdown.map((row) => {
              const Icon = row.icon;
              return (
                <li key={row.key} className="iv-report-v2-breakdown__row">
                  <span className="iv-report-v2-breakdown__icon" aria-hidden>
                    <Icon size={16} />
                  </span>
                  <span className="iv-report-v2-breakdown__label">{row.label}</span>
                  <span className="iv-report-v2-breakdown__score">
                    {row.score.toFixed(1)} <span>/ 10</span>
                  </span>
                  <span className="iv-report-v2-breakdown__bar" aria-hidden>
                    <span style={{ width: `${(row.score / 10) * 100}%` }} />
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="iv-report-v2__col iv-report-v2__col--side">
          <section className="iv-report-v2-card">
            <h2 className="iv-report-v2-card__title">Key Highlights</h2>
            {keyHighlights.length ? (
              <ul className="iv-report-v2-highlights">
                {keyHighlights.map((line, idx) => (
                  <li key={idx}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="iv-report-v2-muted">Strengths will appear here after the interview is processed.</p>
            )}
          </section>

          <section className="iv-report-v2-card">
            <h2 className="iv-report-v2-card__title">Topic Distribution</h2>
            <div className="iv-report-v2-topic-wrap">
              <div className="iv-report-v2-topic-donut" style={topicDonut} aria-hidden>
                <span className="iv-report-v2-topic-donut__hole" />
              </div>
              <ul className="iv-report-v2-topic-legend">
                {topics.map((t) => (
                  <li key={t.label}>
                    <span>{t.label}</span>
                    <strong>{t.pct}%</strong>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </div>

      {summaryText ? (
        <section className="iv-report-v2-card iv-report-v2-summary">
          <h2 className="iv-report-v2-card__title">Interview summary</h2>
          <p className="iv-report-v2-summary__body">{summaryText}</p>
        </section>
      ) : null}

      <footer className="iv-report-v2-insight">
        <Sparkles size={18} aria-hidden />
        <p>
          <strong>AI Insight:</strong>{' '}
          {hiringReason ||
            summaryText ||
            'Complete the interview recording to generate AI evaluation signals and a hiring recommendation.'}
        </p>
      </footer>

      {canFinalize ? (
        <div className="iv-report-v2-actions">
          <button
            type="button"
            className="iv-report-v2__finalize"
            onClick={handleFinalize}
            disabled={saving || processing}
          >
            {saving ? 'Finalizing…' : 'Finalize Decision'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
