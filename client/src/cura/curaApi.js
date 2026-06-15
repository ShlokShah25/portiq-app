import axios from 'axios';
import { formatApiError } from '../utils/apiErrorMessage';

export async function fetchCuraClinic() {
  const res = await axios.get('/cura/clinic');
  return res.data;
}

export async function saveCuraOnboarding(payload) {
  const res = await axios.post('/cura/onboarding', payload);
  return res.data;
}

export async function fetchCuraDashboard() {
  const res = await axios.get('/cura/dashboard');
  return res.data;
}

export async function fetchCuraPatients(query = '') {
  const res = await axios.get('/cura/patients', {
    params: query ? { q: query } : {},
  });
  return res.data?.patients || [];
}

export async function createCuraPatient(payload) {
  const res = await axios.post('/cura/patients', payload);
  return res.data?.patient;
}

export async function fetchCuraPatient(id) {
  const res = await axios.get(`/cura/patients/${id}`);
  return res.data;
}

export async function createCuraConsultation(payload) {
  const res = await axios.post('/cura/consultations', payload);
  return res.data?.consultation;
}

export async function fetchCuraFollowUps() {
  const res = await axios.get('/cura/follow-ups');
  return res.data?.followUps || [];
}

export async function fetchCuraPrescriptions() {
  const res = await axios.get('/cura/prescriptions');
  return res.data?.prescriptions || [];
}

export async function searchCuraConsultations(query) {
  const res = await axios.get('/cura/search', { params: { q: query } });
  return res.data?.results || [];
}

export async function fetchCuraAlerts() {
  const res = await axios.get('/cura/alerts');
  return res.data?.alerts || [];
}

export function curaApiError(err, fallback) {
  return formatApiError(err, fallback);
}
