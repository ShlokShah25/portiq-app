const STORAGE_KEY = 'portiq_education_classrooms';

export function getClassrooms() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveClassrooms(classrooms) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(classrooms));
}

export function createClassroom(classroom) {
  const list = getClassrooms();
  const id = `class_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const newOne = { id, ...classroom, studentEmails: classroom.studentEmails || [] };
  list.push(newOne);
  saveClassrooms(list);
  return newOne;
}

export function updateClassroom(id, updates) {
  const list = getClassrooms();
  const idx = list.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...updates };
  saveClassrooms(list);
  return list[idx];
}

export function deleteClassroom(id) {
  const list = getClassrooms().filter((c) => c.id !== id);
  saveClassrooms(list);
  return true;
}
