import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getSemesterReport } from '../utils/coursesApi';
import './SemesterReportPage.css';

const ymd = (d) => {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
};
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const pct = (v) => (v == null ? '—' : `${v}%`);

function readCollegeName() {
  try {
    return window.localStorage.getItem('portiq_report_college') || '';
  } catch (e) {
    return '';
  }
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function SemesterReportPage() {
  const { courseId, semId } = useParams();
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(ymd(new Date(today.getTime() - 183 * 86400000)));
  const [to, setTo] = useState(ymd(today));
  const [college, setCollege] = useState(readCollegeName);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getSemesterReport(courseId, semId, { from, to }));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load the report.');
    } finally {
      setLoading(false);
    }
  }, [courseId, semId, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const saveCollege = (v) => {
    setCollege(v);
    try {
      window.localStorage.setItem('portiq_report_college', v);
    } catch (e) {
      /* ignore */
    }
  };

  const downloadCsv = () => {
    if (!data) return;
    const head = ['Date', 'Lecture', 'Subject', 'Faculty', 'Minutes', 'Notes published', 'Sent to students',
      'Board pages', 'Quiz questions', 'Quiz attempts', 'Students who took quiz', 'Quiz average %',
      'Students reached', 'Questions asked', 'Questions to teacher'];
    const rows = data.lectures.map((l) => [fmtDate(l.date), l.title, l.subject, l.faculty, l.minutes,
      l.notesPublished ? 'Yes' : 'No', l.sentToStudents ? 'Yes' : 'No', l.boardPages, l.quizQuestions,
      l.quizAttempts, l.quizStudents, l.quizAvgPct ?? '', l.studentsReached, l.questionsAsked, l.questionsToTeacher]);
    const csv = [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${data.course.name} - ${data.semester.name} - semester report.csv`.replace(/[\\/:*?"<>|]/g, '-');
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const t = data?.totals;
  const groupTable = (rows, label) => (
    <table className="sr-table">
      <thead>
        <tr>
          <th>{label}</th><th>Lectures</th><th>Hours</th><th>Notes published</th><th>Sent to students</th>
          <th>Quizzes</th><th>Quiz attempts</th><th>Quiz avg</th><th>Avg students reached</th><th>Questions asked</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <td>{r.name}</td><td>{r.lectures}</td><td>{r.hours}</td><td>{r.notesPublished}</td><td>{r.sentToStudents}</td>
            <td>{r.quizzes}</td><td>{r.quizAttempts}</td><td>{pct(r.quizAvgPct)}</td><td>{r.avgStudentsReached}</td><td>{r.questionsAsked}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="sr-page">
      <div className="sr-controls no-print">
        <Link to={`/courses/${courseId}`} className="sr-back">← Back to course</Link>
        <label>From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="sr-college">College name
          <input value={college} onChange={(e) => saveCollege(e.target.value)} placeholder="Shown on the report" />
        </label>
        <button type="button" onClick={() => window.print()} disabled={!data}>Save as PDF</button>
        <button type="button" className="secondary" onClick={downloadCsv} disabled={!data}>Download spreadsheet</button>
      </div>

      {loading && <p className="sr-muted no-print">Building the report…</p>}
      {error && <p className="sr-error">{error}</p>}

      {data && !loading && (
        <article className="sr-report">
          <header className="sr-head">
            <div className="sr-brand">PortIQ <span>for Education</span></div>
            <h1>Semester Teaching &amp; Learning Report</h1>
            <p className="sr-sub">
              {college ? <strong>{college}</strong> : null}
              {college ? ' · ' : ''}{data.course.name} · {data.semester.name}
            </p>
            <p className="sr-sub">
              Period: {fmtDate(data.period.from)} – {fmtDate(data.period.to)} · Generated {fmtDate(data.generatedAt)}
              {data.semester.rosterSize ? ` · ${data.semester.rosterSize} students on the class list` : ''}
            </p>
          </header>

          <section>
            <h2>Summary</h2>
            <div className="sr-tiles">
              <div><b>{t.lectures}</b><span>Lectures recorded</span></div>
              <div><b>{t.teachingHours}</b><span>Teaching hours captured</span></div>
              <div><b>{t.subjectsCovered}</b><span>Subjects</span></div>
              <div><b>{t.facultyActive}</b><span>Faculty using PortIQ</span></div>
              <div><b>{t.notesPublished}</b><span>Lectures with published notes</span></div>
              <div><b>{t.sentToStudents}</b><span>Lectures sent to students</span></div>
              <div><b>{t.studentsReached}</b><span>Students who opened lectures</span></div>
              <div><b>{t.returningStudents}</b><span>Students who opened 2+ lectures</span></div>
              <div><b>{t.quizAttempts}</b><span>Quiz attempts</span></div>
              <div><b>{pct(t.quizAvgPct)}</b><span>Average quiz score</span></div>
              <div><b>{t.questionsAsked}</b><span>Questions asked by students</span></div>
              <div><b>{t.boardPages}</b><span>Whiteboard pages shared</span></div>
            </div>
          </section>

          <section>
            <h2>Evidence for accreditation</h2>
            <ul className="sr-evidence">
              <li><b>ICT-enabled teaching:</b> {t.lectures} lectures ({t.teachingHours} hours) were recorded with PortIQ, with digital notes, slides and whiteboard pages produced for each.</li>
              <li><b>Learning material for students:</b> {t.sentToStudents} lectures were sent to the class by email, each with notes, a recap and a practice quiz.</li>
              <li><b>Student engagement:</b> {t.studentsReached} students opened lecture material, {t.returningStudents} of them for two or more lectures; students asked {t.questionsAsked} questions about lectures.</li>
              <li><b>Continuous assessment:</b> {t.quizzes} lectures had a quiz; {t.quizStudents} students made {t.quizAttempts} attempts, with an average score of {pct(t.quizAvgPct)}.</li>
            </ul>
            <p className="sr-note">Supports documentation for NAAC Criterion II (Teaching-Learning and Evaluation) and NBA programme assessment.</p>
          </section>

          <section>
            <h2>By subject</h2>
            {data.bySubject.length ? groupTable(data.bySubject, 'Subject') : <p className="sr-muted">No lectures in this period.</p>}
          </section>

          <section>
            <h2>By faculty</h2>
            {data.byFaculty.length ? groupTable(data.byFaculty, 'Faculty') : <p className="sr-muted">No lectures in this period.</p>}
          </section>

          <section className="sr-break">
            <h2>Lecture log</h2>
            {data.lectures.length ? (
              <table className="sr-table sr-log">
                <thead>
                  <tr><th>Date</th><th>Lecture</th><th>Subject</th><th>Faculty</th><th>Min</th><th>Sent</th><th>Quiz attempts</th><th>Quiz avg</th><th>Reached</th><th>Questions</th></tr>
                </thead>
                <tbody>
                  {data.lectures.map((l) => (
                    <tr key={l.id}>
                      <td>{fmtDate(l.date)}</td><td>{l.title}</td><td>{l.subject}</td><td>{l.faculty}</td><td>{l.minutes}</td>
                      <td>{l.sentToStudents ? 'Yes' : 'No'}</td><td>{l.quizAttempts}</td><td>{pct(l.quizAvgPct)}</td><td>{l.studentsReached}</td><td>{l.questionsAsked}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="sr-muted">No lectures in this period.</p>}
          </section>

          <footer className="sr-foot">
            Generated by PortIQ. "Students reached" counts students who opened a lecture&apos;s page; views are anonymous.
            Quiz figures include attempts recorded on PortIQ.
          </footer>
        </article>
      )}
    </div>
  );
}
