const STORAGE_KEY = 'portiq_education_classrooms';
export const MAX_CLASSROOMS = 7;
export const MAX_STUDENTS_PER_CLASSROOM = 40;
export const MAX_SUBJECTS_PER_CLASSROOM = 9;

function normalizeSubjects(input) {
  const arr = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\n,;]+/)
      : [];
  const out = [];
  const seen = new Set();
  for (const raw of arr) {
    const s = String(raw || '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_SUBJECTS_PER_CLASSROOM) break;
  }
  return out;
}

function normalizeSubjectAssignments(input, fallbackTeacher = '') {
  const arr = Array.isArray(input) ? input : [];
  const out = [];
  const seen = new Set();
  for (const raw of arr) {
    const subject = String(raw?.subject || raw?.name || '').trim();
    if (!subject) continue;
    const key = subject.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      subject,
    });
    if (out.length >= MAX_SUBJECTS_PER_CLASSROOM) break;
  }
  return out;
}

function normalizeClassroomShape(c) {
  const legacySubjects =
    Array.isArray(c?.subjects) && c.subjects.length > 0
      ? normalizeSubjects(c.subjects)
      : normalizeSubjects(c?.subject || '');
  let subjectAssignments = normalizeSubjectAssignments(c?.subjectAssignments, c?.teacher);
  if (subjectAssignments.length === 0 && legacySubjects.length > 0) {
    subjectAssignments = legacySubjects.map((s) => ({ subject: s }));
  }
  const subjects = subjectAssignments.map((x) => x.subject);
  return {
    ...c,
    subjectAssignments,
    subjects,
    // Keep legacy single subject field for backward compatibility in older UI paths.
    subject: subjects[0] || '',
    studentEmails: Array.isArray(c?.studentEmails) ? c.studentEmails.slice(0, MAX_STUDENTS_PER_CLASSROOM) : [],
  };
}

export function getClassrooms() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeClassroomShape) : [];
  } catch {
    return [];
  }
}

export function saveClassrooms(classrooms) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(classrooms));
}

export function createClassroom(classroom) {
  const list = getClassrooms();
  if (list.length >= MAX_CLASSROOMS) {
    throw new Error(`Classroom limit reached (${MAX_CLASSROOMS}).`);
  }
  const id = `class_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const newOne = normalizeClassroomShape({
    id,
    ...classroom,
    subjectAssignments: classroom?.subjectAssignments ?? [],
    subjects: classroom?.subjects ?? classroom?.subject ?? [],
    studentEmails: classroom?.studentEmails || [],
  });
  list.push(newOne);
  saveClassrooms(list);
  return newOne;
}

export function updateClassroom(id, updates) {
  const list = getClassrooms();
  const idx = list.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  list[idx] = normalizeClassroomShape({
    ...list[idx],
    ...updates,
    subjectAssignments:
      updates?.subjectAssignments !== undefined
        ? updates?.subjectAssignments
        : list[idx].subjectAssignments,
    subjects:
      updates?.subjects !== undefined || updates?.subject !== undefined
        ? updates?.subjects ?? updates?.subject
        : list[idx].subjects,
  });
  saveClassrooms(list);
  return list[idx];
}

export function deleteClassroom(id) {
  const list = getClassrooms().filter((c) => c.id !== id);
  saveClassrooms(list);
  return true;
}
