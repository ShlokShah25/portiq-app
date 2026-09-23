import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { listCourses, createCourse, deleteCourse, updateCourse } from '../utils/coursesApi';
import { useTrialExperience } from './TrialExperienceProvider';
import OnboardingTour, { hasSeenTour } from './OnboardingTour';
import './ClassesPage.css';

const DEFAULT_LIMITS = {
  MAX_COURSES: 12,
  MAX_SEMESTERS_PER_COURSE: 12,
  MAX_SUBJECTS_PER_SEMESTER: 15,
  MAX_STUDENTS_PER_SEMESTER: 120,
};

/** Admin onboarding, scoped to this page — distinct key from the dashboard's own tour. */
function adminCoursesTourKey(uid) {
  return `portiq_admin_onboarding_v1_${uid}_courses`;
}

const CoursesPage = () => {
  const trial = useTrialExperience();
  const profile = trial?.profile;
  const [courses, setCourses] = useState([]);
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const nameFieldRef = useRef(null);
  const createButtonRef = useRef(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { courses: list, limits: lim } = await listCourses();
      setCourses(list);
      if (lim && Object.keys(lim).length) setLimits(lim);
    } catch (err) {
      setError(
        err.response?.data?.error || err.message || 'Could not load courses.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const adminUid = String(profile?.id || profile?._id || profile?.email || '').trim();

  useEffect(() => {
    if (!adminUid) return;
    if (!hasSeenTour(adminCoursesTourKey(adminUid))) {
      setTourOpen(true);
      setTourStep(0);
    }
  }, [adminUid]);

  const tourSteps = useMemo(
    () => [
      {
        id: 'name',
        title: 'Set up your academic structure',
        body: 'Name a course (e.g. MBA Tech AI). Once created, you add semesters, subjects, and student rosters inside it.',
        target: nameFieldRef,
        icon: GraduationCap,
      },
      {
        id: 'create',
        title: 'Faculty pick from this',
        body: 'Teachers select course, semester, and subject from what you set up here when they start a lecture — no duplicate data entry.',
        target: createButtonRef,
        icon: GraduationCap,
      },
    ],
    []
  );

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    const name = newName.trim();
    if (!name) {
      setError('Enter a course name.');
      return;
    }
    if (courses.length >= limits.MAX_COURSES) {
      setError(`Course limit reached (${limits.MAX_COURSES}).`);
      return;
    }
    setSaving(true);
    try {
      await createCourse(name);
      setNewName('');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not create course.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (course) => {
    if (!window.confirm(`Delete course "${course.name}"? This cannot be undone.`)) return;
    try {
      await deleteCourse(course._id);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not delete course.');
    }
  };

  const startRename = (course) => {
    setRenamingId(course._id);
    setRenameValue(course.name);
  };

  const submitRename = async (course) => {
    const name = renameValue.trim();
    if (!name) return;
    try {
      await updateCourse(course._id, { name });
      setRenamingId(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not rename course.');
    }
  };

  const filteredCourses = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter((c) => String(c.name || '').toLowerCase().includes(q));
  }, [courses, query]);

  const semesterCount = (c) => (Array.isArray(c.semesters) ? c.semesters.length : 0);
  const subjectCount = (c) =>
    Array.isArray(c.semesters)
      ? c.semesters.reduce((sum, s) => sum + (Array.isArray(s.subjects) ? s.subjects.length : 0), 0)
      : 0;
  const studentCount = (c) =>
    Array.isArray(c.semesters)
      ? c.semesters.reduce((sum, s) => sum + (Array.isArray(s.studentRoster) ? s.studentRoster.length : 0), 0)
      : 0;

  return (
    <div className="classes-page">
      <div className="classes-wrapper">
        <div className="classes-header">
          <h1>Courses</h1>
          <p>
            Set up your college's academic structure: Course → Semester → Subjects. Faculty pick
            from this when starting a lecture. Up to {limits.MAX_COURSES} courses,{' '}
            {limits.MAX_SEMESTERS_PER_COURSE} semesters/course, {limits.MAX_SUBJECTS_PER_SEMESTER}{' '}
            subjects/semester, {limits.MAX_STUDENTS_PER_SEMESTER} students/semester.
          </p>
          <button
            type="button"
            className="classes-btn-secondary"
            style={{ marginTop: 12 }}
            onClick={() => {
              setTourStep(0);
              setTourOpen(true);
            }}
          >
            Quick help
          </button>
        </div>

        <form className="classes-form" onSubmit={handleCreate}>
          <div className="classes-form-row">
            <label>
              Course name
              <input
                ref={nameFieldRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. MBA Tech AI"
                required
              />
            </label>
          </div>
          {error ? <p className="classes-error">{error}</p> : null}
          <div className="classes-form-actions">
            <button
              ref={createButtonRef}
              type="submit"
              className="classes-btn-primary"
              disabled={saving || courses.length >= limits.MAX_COURSES}
            >
              {saving ? 'Creating…' : 'Create course'}
            </button>
          </div>
        </form>

        <div className="classes-list classes-list-panel">
          <div className="classes-list-head">
            <h2>All Courses ({courses.length}/{limits.MAX_COURSES})</h2>
            <input
              type="search"
              className="classes-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by course name"
            />
          </div>
          {loading ? (
            <p className="classes-empty">Loading courses…</p>
          ) : filteredCourses.length === 0 ? (
            <p className="classes-empty">
              {courses.length === 0 ? 'No courses yet. Create one above.' : 'No courses match this search.'}
            </p>
          ) : (
            <div className="classes-table-scroll">
              <table className="classes-table">
                <thead>
                  <tr>
                    <th className="classes-table__class">Course</th>
                    <th className="classes-table__subjects">Semesters</th>
                    <th className="classes-table__subjects">Subjects</th>
                    <th className="classes-table__students">Students</th>
                    <th className="classes-table__actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCourses.map((c) => (
                    <tr key={c._id} className="classes-table-row">
                      <td className="classes-table__class">
                        {renamingId === c._id ? (
                          <div className="classes-assignment-row">
                            <input
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              autoFocus
                            />
                            <button type="button" className="classes-btn-sm" onClick={() => submitRename(c)}>
                              Save
                            </button>
                            <button type="button" className="classes-btn-sm" onClick={() => setRenamingId(null)}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <Link to={`/courses/${c._id}`} className="classes-class-link">
                            {c.name}
                          </Link>
                        )}
                      </td>
                      <td className="classes-table__subjects">{semesterCount(c)}</td>
                      <td className="classes-table__subjects">{subjectCount(c)}</td>
                      <td className="classes-table__students">{studentCount(c)}</td>
                      <td className="classes-table__actions">
                        <div className="classes-actions-cell">
                          <Link to={`/courses/${c._id}`} className="classes-btn-sm">
                            Manage
                          </Link>
                          <button type="button" className="classes-btn-sm" onClick={() => startRename(c)}>
                            Rename
                          </button>
                          <button
                            type="button"
                            className="classes-btn-sm classes-btn-danger"
                            onClick={() => handleDelete(c)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <OnboardingTour
          steps={tourSteps}
          open={tourOpen}
          currentStep={tourStep}
          onNext={() => setTourStep((s) => Math.min(tourSteps.length - 1, s + 1))}
          onBack={() => setTourStep((s) => Math.max(0, s - 1))}
          onSkip={() => setTourOpen(false)}
          onFinish={() => setTourOpen(false)}
          storageKey={adminUid ? adminCoursesTourKey(adminUid) : undefined}
        />
      </div>
    </div>
  );
};

export default CoursesPage;
