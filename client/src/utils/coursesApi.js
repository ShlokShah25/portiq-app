import axios from 'axios';

/**
 * Server-backed Course -> Semester -> Subject API for education mode.
 * Replaces the old localStorage-only classroomsStorage.js, which never synced
 * across devices (a real problem once faculty log in from their own laptops).
 */

export async function listCourses() {
  const res = await axios.get('/courses');
  return {
    courses: Array.isArray(res.data?.courses) ? res.data.courses : [],
    limits: res.data?.limits || {},
  };
}

export async function getCourse(id) {
  const res = await axios.get(`/courses/${encodeURIComponent(id)}`);
  return { course: res.data?.course || null, limits: res.data?.limits || {} };
}

export async function createCourse(name) {
  const res = await axios.post('/courses', { name });
  return res.data?.course;
}

export async function updateCourse(id, updates) {
  const res = await axios.put(`/courses/${encodeURIComponent(id)}`, updates);
  return res.data?.course;
}

export async function deleteCourse(id) {
  await axios.delete(`/courses/${encodeURIComponent(id)}`);
  return true;
}
