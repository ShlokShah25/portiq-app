const mongoose = require('mongoose');

/**
 * A college's academic structure for education mode: Course (e.g. "MBA Tech AI")
 * -> Semesters (e.g. "Semester 3") -> Subjects (free-text names) + a shared student
 * roster per semester (a semester's batch usually sits together across subjects).
 *
 * Replaces the old client-only localStorage "Classroom" concept (see
 * client/src/utils/classroomsStorage.js, now unused) so faculty logging in from
 * their own devices actually see the courses/semesters the admin configured,
 * instead of each browser having its own private, unsynced copy.
 */
const studentSchema = new mongoose.Schema(
  {
    name: { type: String, default: '', trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
  },
  { _id: false }
);

const semesterSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // e.g. "Semester 3"
    subjects: { type: [String], default: [] },
    studentRoster: { type: [studentSchema], default: [] },
    // Which faculty (Admin docs with role:'faculty') are assigned to teach this
    // semester. A faculty account only sees semesters they're assigned to — without
    // this, every teacher at the college would see the entire course catalog.
    assignedFacultyIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }], default: [] },
  },
  { _id: true }
);

const courseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // e.g. "MBA Tech AI"
    // The education admin ("college") that owns this course. Faculty see courses
    // owned by whichever admin manages them (Admin.managedByAdminId) — same
    // ownership pattern already used for scoping teacher accounts in admin.js.
    createdByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: true,
      index: true,
    },
    semesters: { type: [semesterSchema], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Course', courseSchema);
