const STORAGE_KEY = 'portiq_education_teachers';

export function getTeachers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTeachers(teachers) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(teachers));
}

export function addTeacher(teacher) {
  const list = getTeachers();
  const id = `teacher_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const newOne = { id, name: teacher.name.trim(), email: (teacher.email || '').trim().toLowerCase() };
  list.push(newOne);
  saveTeachers(list);
  return newOne;
}

export function removeTeacher(id) {
  const list = getTeachers().filter((t) => t.id !== id);
  saveTeachers(list);
  return true;
}
