const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Course = require('../models/Course');
const { authenticateAdmin } = require('../middleware/auth');

const MAX_COURSES = 12;
const MAX_SEMESTERS_PER_COURSE = 12;
const MAX_SUBJECTS_PER_SEMESTER = 15;
const MAX_STUDENTS_PER_SEMESTER = 120;

function isEducationUser(admin) {
  if (!admin) return false;
  return String(admin.productType || '').toLowerCase() === 'education';
}

function canManageCourses(admin) {
  if (!isEducationUser(admin)) return false;
  const role = String(admin.role || '').toLowerCase();
  return role === 'admin' || role === 'super_admin';
}

/** The admin/"college" whose courses this user should see. Faculty inherit their managing admin's courses. */
function ownerAdminIdFor(admin) {
  const role = String(admin.role || '').toLowerCase();
  if (role === 'faculty') {
    return admin.managedByAdminId || admin._id;
  }
  return admin._id;
}

function normalizeSubjects(input) {
  const arr = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\n,;]+/) : [];
  const out = [];
  const seen = new Set();
  for (const raw of arr) {
    const s = String(raw || '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_SUBJECTS_PER_SEMESTER) break;
  }
  return out;
}

function normalizeRoster(input) {
  const arr = Array.isArray(input) ? input : [];
  const out = [];
  const seen = new Set();
  for (const raw of arr) {
    const email = String(raw?.email || '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({ name: String(raw?.name || '').trim(), email });
    if (out.length >= MAX_STUDENTS_PER_SEMESTER) break;
  }
  return out;
}

function normalizeFacultyIds(input) {
  const arr = Array.isArray(input) ? input : [];
  const out = [];
  const seen = new Set();
  for (const raw of arr) {
    const id = String(raw || '').trim();
    if (!id || !mongoose.Types.ObjectId.isValid(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeSemesters(input) {
  const arr = Array.isArray(input) ? input : [];
  const out = [];
  for (const raw of arr) {
    const name = String(raw?.name || '').trim();
    if (!name) continue;
    out.push({
      name,
      subjects: normalizeSubjects(raw?.subjects),
      studentRoster: normalizeRoster(raw?.studentRoster),
      assignedFacultyIds: normalizeFacultyIds(raw?.assignedFacultyIds),
    });
    if (out.length >= MAX_SEMESTERS_PER_COURSE) break;
  }
  return out;
}

/**
 * Faculty (not admin/super_admin) only see semesters they're assigned to teach —
 * otherwise every teacher at the college would see the whole department's catalog.
 * Admin/super_admin always see everything unfiltered (they manage assignments).
 */
function filterCourseForViewer(course, admin) {
  const role = String(admin.role || '').toLowerCase();
  if (role !== 'faculty') return course;
  const facultyId = String(admin._id);
  const semesters = (course.semesters || []).filter((s) =>
    (s.assignedFacultyIds || []).some((id) => String(id) === facultyId)
  );
  return { ...course, semesters };
}

/**
 * List courses visible to this user (any authenticated education admin/faculty).
 * Faculty see the courses their managing admin created; an admin sees their own;
 * a super_admin sees everything (mirrors GET /admin/teachers scoping).
 */
router.get('/', authenticateAdmin, async (req, res) => {
  try {
    if (!isEducationUser(req.admin)) {
      return res.status(403).json({ error: 'Only education accounts can access courses.' });
    }
    const query = { isActive: true };
    if (String(req.admin.role || '').toLowerCase() !== 'super_admin') {
      query.createdByAdminId = ownerAdminIdFor(req.admin);
    }
    const rawCourses = await Course.find(query).sort({ name: 1 }).lean();
    const courses = rawCourses
      .map((c) => filterCourseForViewer(c, req.admin))
      // Faculty shouldn't see a course they have zero assigned semesters in.
      .filter((c) => String(req.admin.role || '').toLowerCase() !== 'faculty' || c.semesters.length > 0);
    res.json({ courses, limits: { MAX_COURSES, MAX_SEMESTERS_PER_COURSE, MAX_SUBJECTS_PER_SEMESTER, MAX_STUDENTS_PER_SEMESTER } });
  } catch (error) {
    console.error('Error listing courses:', error);
    res.status(500).json({ error: 'Failed to fetch courses.' });
  }
});

/** Fetch a single course (any authenticated education admin/faculty who can see it). */
router.get('/:id', authenticateAdmin, async (req, res) => {
  try {
    if (!isEducationUser(req.admin)) {
      return res.status(403).json({ error: 'Only education accounts can access courses.' });
    }
    const course = await Course.findOne({ _id: req.params.id, isActive: true }).lean();
    if (!course) return res.status(404).json({ error: 'Course not found.' });
    if (
      String(req.admin.role || '').toLowerCase() !== 'super_admin' &&
      String(course.createdByAdminId) !== String(ownerAdminIdFor(req.admin))
    ) {
      return res.status(403).json({ error: 'You do not have access to this course.' });
    }
    const visible = filterCourseForViewer(course, req.admin);
    if (String(req.admin.role || '').toLowerCase() === 'faculty' && visible.semesters.length === 0) {
      return res.status(403).json({ error: 'You are not assigned to any semester in this course.' });
    }
    res.json({ course: visible, limits: { MAX_COURSES, MAX_SEMESTERS_PER_COURSE, MAX_SUBJECTS_PER_SEMESTER, MAX_STUDENTS_PER_SEMESTER } });
  } catch (error) {
    console.error('Error fetching course:', error);
    res.status(500).json({ error: 'Failed to fetch course.' });
  }
});

/** Create a course. Admin/super_admin only. */
router.post('/', authenticateAdmin, async (req, res) => {
  try {
    if (!canManageCourses(req.admin)) {
      return res.status(403).json({ error: 'Only education admins can create courses.' });
    }
    const name = String(req.body?.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Course name is required.' });
    }
    const existingCount = await Course.countDocuments({ createdByAdminId: req.admin._id, isActive: true });
    if (existingCount >= MAX_COURSES) {
      return res.status(400).json({ error: `Course limit reached (${MAX_COURSES}).` });
    }
    const course = await Course.create({
      name,
      createdByAdminId: req.admin._id,
      semesters: normalizeSemesters(req.body?.semesters),
    });
    res.status(201).json({ course });
  } catch (error) {
    console.error('Error creating course:', error);
    res.status(500).json({ error: 'Failed to create course.' });
  }
});

/** Update a course (rename, and/or replace its semesters/subjects/roster as a whole). Admin/super_admin only, own courses. */
router.put('/:id', authenticateAdmin, async (req, res) => {
  try {
    if (!canManageCourses(req.admin)) {
      return res.status(403).json({ error: 'Only education admins can edit courses.' });
    }
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found.' });
    if (
      String(req.admin.role || '').toLowerCase() !== 'super_admin' &&
      String(course.createdByAdminId) !== String(req.admin._id)
    ) {
      return res.status(403).json({ error: 'You do not manage this course.' });
    }
    if (req.body?.name !== undefined) {
      const name = String(req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Course name is required.' });
      course.name = name;
    }
    if (req.body?.semesters !== undefined) {
      course.semesters = normalizeSemesters(req.body.semesters);
    }
    await course.save();
    res.json({ course });
  } catch (error) {
    console.error('Error updating course:', error);
    res.status(500).json({ error: 'Failed to update course.' });
  }
});

/** Soft-delete a course. Admin/super_admin only, own courses. */
router.delete('/:id', authenticateAdmin, async (req, res) => {
  try {
    if (!canManageCourses(req.admin)) {
      return res.status(403).json({ error: 'Only education admins can delete courses.' });
    }
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found.' });
    if (
      String(req.admin.role || '').toLowerCase() !== 'super_admin' &&
      String(course.createdByAdminId) !== String(req.admin._id)
    ) {
      return res.status(403).json({ error: 'You do not manage this course.' });
    }
    course.isActive = false;
    await course.save();
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting course:', error);
    res.status(500).json({ error: 'Failed to delete course.' });
  }
});


/**
 * Semester report for accreditation (NAAC / NBA): everything PortIQ recorded for one
 * course semester in a date range — lectures and teaching hours, learning material
 * shared, student reach, quiz participation and scores, and student questions —
 * per subject, per faculty member and per lecture. Admin/super_admin only.
 * GET /api/courses/:id/semesters/:semId/report?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
router.get('/:id/semesters/:semId/report', authenticateAdmin, async (req, res) => {
  try {
    if (!canManageCourses(req.admin)) {
      return res.status(403).json({ error: 'Only college admins can download semester reports.' });
    }
    const course = await Course.findOne({ _id: req.params.id, isActive: true }).lean();
    if (!course) return res.status(404).json({ error: 'Course not found.' });
    const ownerId = ownerAdminIdFor(req.admin);
    if (String(req.admin.role || '').toLowerCase() !== 'super_admin' && String(course.createdByAdminId) !== String(ownerId)) {
      return res.status(403).json({ error: 'You do not have access to this course.' });
    }
    const semester = (course.semesters || []).find((s) => String(s._id) === String(req.params.semId));
    if (!semester) return res.status(404).json({ error: 'Semester not found.' });

    const parseDate = (v, end) => {
      if (!v) return null;
      const d = new Date(`${v}T${end ? '23:59:59' : '00:00:00'}+05:30`);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const to = parseDate(req.query.to, true) || new Date();
    const from = parseDate(req.query.from, false) || new Date(to.getTime() - 183 * 24 * 3600 * 1000);

    const Meeting = require('../models/Meeting');
    const Admin = require('../models/Admin');
    const owner = course.createdByAdminId;
    const faculty = await Admin.find({ managedByAdminId: owner }).select('_id username email').lean();
    const facultyIds = [owner, ...faculty.map((f) => f._id)];

    const meetings = await Meeting.find({
      adminId: { $in: facultyIds },
      educationClassroomId: `${course._id}:${semester._id}`,
      $or: [{ startTime: { $gte: from, $lte: to } }, { startTime: null, createdAt: { $gte: from, $lte: to } }],
    })
      .select('title educationSubject educationTeacherName educationTeacherEmail startTime endTime createdAt status summary educationSummaryTeacherReviewedAt recapSentAt whiteboard.pages quiz studentQuestions recapViews.opens recapViews.visitors participants')
      .sort({ startTime: 1, createdAt: 1 })
      .lean();

    const roster = new Set((semester.studentRoster || []).map((s) => s.email));
    const rosterSize = roster.size;
    const lecturesPerVisitor = new Map();
    const quizTakersAll = new Set();
    const round1 = (n) => Math.round(n * 10) / 10;

    const lectures = meetings.map((m) => {
      const start = m.startTime || m.createdAt;
      const mins = m.startTime && m.endTime ? Math.max(0, (new Date(m.endTime) - new Date(m.startTime)) / 60000) : 0;
      const visitors = new Set((m.recapViews?.visitors || []).map((x) => x.v));
      visitors.forEach((v) => lecturesPerVisitor.set(v, (lecturesPerVisitor.get(v) || 0) + 1));
      const attempts = m.quiz?.attempts || [];
      const takers = new Set(attempts.map((a) => a.studentEmail || a.studentName).filter(Boolean));
      takers.forEach((t) => quizTakersAll.add(t));
      const pct = attempts.length
        ? attempts.reduce((s, a) => s + (a.total ? a.score / a.total : 0), 0) / attempts.length * 100
        : null;
      const qs = m.studentQuestions || [];
      return {
        id: m._id,
        date: start,
        title: m.title || '',
        subject: m.educationSubject || 'Unassigned',
        faculty: m.educationTeacherName || m.educationTeacherEmail || '',
        minutes: Math.round(mins),
        notesPublished: Boolean(String(m.summary || '').trim()) && Boolean(m.educationSummaryTeacherReviewedAt || m.recapSentAt),
        sentToStudents: Boolean(m.recapSentAt),
        boardPages: (m.whiteboard?.pages || []).length,
        quizQuestions: (m.quiz?.questions || []).length,
        quizAttempts: attempts.length,
        quizStudents: takers.size,
        quizAvgPct: pct == null ? null : round1(pct),
        studentsReached: visitors.size,
        questionsAsked: qs.length,
        questionsToTeacher: qs.filter((q) => q.escalated).length,
      };
    });

    const group = (key) => {
      const map = new Map();
      lectures.forEach((l) => {
        const k = l[key] || '—';
        const g = map.get(k) || { name: k, lectures: 0, minutes: 0, published: 0, sent: 0, quizzes: 0, attempts: 0, pctSum: 0, pctN: 0, reached: 0, questions: 0 };
        g.lectures += 1; g.minutes += l.minutes; g.published += l.notesPublished ? 1 : 0; g.sent += l.sentToStudents ? 1 : 0;
        g.quizzes += l.quizQuestions ? 1 : 0; g.attempts += l.quizAttempts; g.questions += l.questionsAsked;
        g.reached += l.studentsReached;
        if (l.quizAvgPct != null) { g.pctSum += l.quizAvgPct * l.quizAttempts; g.pctN += l.quizAttempts; }
        map.set(k, g);
      });
      return [...map.values()].map((g) => ({
        name: g.name, lectures: g.lectures, hours: round1(g.minutes / 60), notesPublished: g.published, sentToStudents: g.sent,
        quizzes: g.quizzes, quizAttempts: g.attempts, quizAvgPct: g.pctN ? round1(g.pctSum / g.pctN) : null,
        avgStudentsReached: g.lectures ? round1(g.reached / g.lectures) : 0, questionsAsked: g.questions,
      }));
    };

    let returning = 0;
    lecturesPerVisitor.forEach((n) => { if (n >= 2) returning += 1; });
    const totalMinutes = lectures.reduce((s, l) => s + l.minutes, 0);
    const allAttempts = lectures.reduce((s, l) => s + l.quizAttempts, 0);
    const weighted = lectures.reduce((s, l) => s + (l.quizAvgPct != null ? l.quizAvgPct * l.quizAttempts : 0), 0);

    res.json({
      college: req.admin.organizationName || '',
      course: { id: course._id, name: course.name },
      semester: { id: semester._id, name: semester.name, subjects: semester.subjects || [], rosterSize },
      period: { from, to },
      generatedAt: new Date(),
      totals: {
        lectures: lectures.length,
        teachingHours: round1(totalMinutes / 60),
        subjectsCovered: new Set(lectures.map((l) => l.subject)).size,
        facultyActive: new Set(lectures.map((l) => l.faculty).filter(Boolean)).size,
        notesPublished: lectures.filter((l) => l.notesPublished).length,
        sentToStudents: lectures.filter((l) => l.sentToStudents).length,
        boardPages: lectures.reduce((s, l) => s + l.boardPages, 0),
        quizzes: lectures.filter((l) => l.quizQuestions).length,
        quizAttempts: allAttempts,
        quizStudents: quizTakersAll.size,
        quizAvgPct: allAttempts ? round1(weighted / allAttempts) : null,
        studentsReached: lecturesPerVisitor.size,
        returningStudents: returning,
        questionsAsked: lectures.reduce((s, l) => s + l.questionsAsked, 0),
        questionsToTeacher: lectures.reduce((s, l) => s + l.questionsToTeacher, 0),
      },
      bySubject: group('subject'),
      byFaculty: group('faculty'),
      lectures,
    });
  } catch (error) {
    console.error('Error building semester report:', error);
    res.status(500).json({ error: 'Failed to build the semester report.' });
  }
});

module.exports = router;
module.exports.MAX_COURSES = MAX_COURSES;
module.exports.MAX_SEMESTERS_PER_COURSE = MAX_SEMESTERS_PER_COURSE;
module.exports.MAX_SUBJECTS_PER_SEMESTER = MAX_SUBJECTS_PER_SEMESTER;
module.exports.MAX_STUDENTS_PER_SEMESTER = MAX_STUDENTS_PER_SEMESTER;
