import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !err.config.url.includes('/auth/')) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export const auth = {
  register: (email, password) => api.post('/auth/register', { email, password }),
  registrationStatus: () => api.get('/auth/registration'),
  changePassword: (current_password, new_password) =>
    api.post('/auth/change-password', { current_password, new_password }),
  login: (email, password) => {
    const form = new URLSearchParams()
    form.set('username', email)
    form.set('password', password)
    return api.post('/auth/login', form)
  },
  me: () => api.get('/auth/me'),
}

export const users = {
  list: () => api.get('/users'),
  roles: () => api.get('/users/roles'),
  create: (payload) => api.post('/users', payload),
  update: (id, payload) => api.put(`/users/${id}`, payload),
  remove: (id) => api.delete(`/users/${id}`),
}

export const datasources = {
  list: () => api.get('/datasources'),
  // readable by every role — exposes status only, never configuration
  health: () => api.get('/datasources/health'),
  check: (id) => api.post(`/datasources/${id}/check`),
  create: (payload) => api.post('/datasources', payload),
  update: (id, payload) => api.put(`/datasources/${id}`, payload),
  uploadCsv: (name, file) => {
    const form = new FormData()
    form.set('name', name)
    form.set('file', file)
    return api.post('/datasources/upload-csv', form)
  },
  remove: (id) => api.delete(`/datasources/${id}`),
}

export const dashboards = {
  list: () => api.get('/dashboards'),
  create: (name) => api.post('/dashboards', { name }),
  get: (id) => api.get(`/dashboards/${id}`),
  update: (id, payload) => api.put(`/dashboards/${id}`, payload),
  remove: (id) => api.delete(`/dashboards/${id}`),
  duplicate: (id) => api.post(`/dashboards/${id}/duplicate`),
  history: (id) => api.get(`/dashboards/${id}/history`),
  restore: (id, snapshotId) => api.post(`/dashboards/${id}/history/${snapshotId}/restore`),
  share: (id) => api.post(`/dashboards/${id}/share`),
  unshare: (id) => api.delete(`/dashboards/${id}/share`),
}

// read-only endpoints for shared dashboards — no auth header needed
export const publicApi = {
  get: (token) => axios.get(`/api/public/dashboards/${token}`),
  fetch: (token, widget_id) =>
    axios.post(`/api/public/dashboards/${token}/data`, { widget_id }),
}

export const data = {
  // ad-hoc query while building a widget — editors and admins only
  fetch: (datasource_id, options = {}) => api.post('/data/fetch', { datasource_id, options }),
  // data for a saved widget; options come from the stored dashboard, so this is
  // safe for viewers (they can't craft their own query)
  forWidget: (dashboardId, widgetId) =>
    api.post(`/data/dashboards/${dashboardId}/widgets/${widgetId}`),
  invalidate: (datasource_id) => api.post(`/data/invalidate/${datasource_id}`),
}

export default api
