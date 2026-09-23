const express = require('express');
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
    });
    if (out.length >= MAX_SEMESTERS_PER_COURSE) break;
  }
  return out;
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
    const courses = await Course.find(query).sort({ name: 1 }).lean();
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
    res.json({ course, limits: { MAX_COURSES, MAX_SEMESTERS_PER_COURSE, MAX_SUBJECTS_PER_SEMESTER, MAX_STUDENTS_PER_SEMESTER } });
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

module.exports = router;
module.exports.MAX_COURSES = MAX_COURSES;
module.exports.MAX_SEMESTERS_PER_COURSE = MAX_SEMESTERS_PER_COURSE;
module.exports.MAX_SUBJECTS_PER_SEMESTER = MAX_SUBJECTS_PER_SEMESTER;
module.exports.MAX_STUDENTS_PER_SEMESTER = MAX_STUDENTS_PER_SEMESTER;
