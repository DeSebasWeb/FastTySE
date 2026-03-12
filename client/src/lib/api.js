import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

// Attach JWT token to every request if available
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export async function uploadCsv(file, onProgress) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded * 100) / e.total));
      }
    },
  });
  return res.data;
}

export async function getUploads() {
  const res = await api.get('/uploads');
  return res.data;
}

export async function getRows(uploadId, page = 1, limit = 100) {
  const res = await api.get(`/uploads/${uploadId}/rows`, {
    params: { page, limit },
  });
  return res.data;
}

export async function deleteUpload(uploadId) {
  const res = await api.delete(`/uploads/${uploadId}`);
  return res.data;
}

// --- Dashboard API ---

function cleanFilters(filters) {
  const params = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v != null && v !== '') params[k] = v;
  }
  return params;
}

export async function getDashboardStats(filters = {}) {
  const res = await api.get('/dashboard/stats', { params: cleanFilters(filters) });
  return res.data;
}

export async function getFilterOptions(filters = {}) {
  const res = await api.get('/dashboard/filter-options', { params: cleanFilters(filters) });
  return res.data;
}

export async function getDashboardRows(filters = {}, page = 1, limit = 100) {
  const res = await api.get('/dashboard/rows', {
    params: { ...cleanFilters(filters), page, limit },
  });
  return res.data;
}

export async function getMultiRows(blocks, page = 1, limit = 100, { rangeFrom, rangeTo } = {}) {
  const body = { blocks, page, limit };
  if (rangeFrom) body.rangeFrom = rangeFrom;
  if (rangeTo) body.rangeTo = rangeTo;
  const res = await api.post('/dashboard/multi-rows', body);
  return res.data;
}

// --- Auth API ---

export async function login(cedula, contrasena) {
  const res = await api.post('/auth/login', { cedula, contrasena });
  return res.data;
}

export async function getMe() {
  const res = await api.get('/auth/me');
  return res.data;
}

export async function getAnalysts() {
  const res = await api.get('/auth/analysts');
  return res.data;
}

// --- Assignments API ---

export async function createAssignments(userIds, filters, label) {
  const res = await api.post('/assignments', { userIds, filters, label });
  return res.data;
}

export async function getAssignments() {
  const res = await api.get('/assignments');
  return res.data;
}

export async function deleteAssignment(id) {
  const res = await api.delete(`/assignments/${id}`);
  return res.data;
}

export async function getAssignmentSiblings(id) {
  const res = await api.get(`/assignments/${id}/siblings`);
  return res.data;
}

// --- Evidences API ---

export async function saveEvidence({ assignmentId, rowIndex, status, imageData, rotation, observations }) {
  const res = await api.post('/evidences', { assignmentId, rowIndex, status, imageData, rotation, observations });
  return res.data;
}

export async function getEvidences(assignmentId) {
  const res = await api.get(`/evidences/${assignmentId}`);
  return res.data;
}

export async function deleteEvidence(id) {
  const res = await api.delete(`/evidences/${id}`);
  return res.data;
}
