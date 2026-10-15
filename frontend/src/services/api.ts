import axios from 'axios'
import { isMockEnabled } from '../utils/mockFlag.ts'
import { clearAccessToken, getAccessToken } from '../utils/authStorage.ts'
import { emitAuthUnauthorized } from '../utils/authEvents.ts'
import { isLoginRequest, mockAdapter } from './mockAdapter.ts'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

if (isMockEnabled()) {
  api.defaults.adapter = mockAdapter
}

api.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401 && !isLoginRequest(error.config)) {
      clearAccessToken()
      emitAuthUnauthorized()
    }
    return Promise.reject(error)
  },
)

export default api
