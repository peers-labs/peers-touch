/**
 * Axios HTTP client with token injection and global error handling.
 * All API requests flow through this singleton client instance.
 */

import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { API_BASE } from '../utils/constants';
import { log } from '../utils/logger';

let authToken: string | null = null;

/** Persist or clear the authentication token. */
export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem('dashboard_token', token);
  } else {
    localStorage.removeItem('dashboard_token');
  }
}

/** Retrieve the current authentication token (memory-first, then localStorage). */
export function getAuthToken(): string | null {
  if (authToken) return authToken;
  authToken = localStorage.getItem('dashboard_token');
  return authToken;
}

const client: AxiosInstance = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Inject Bearer token into every outgoing request
client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAuthToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle global response errors (e.g. 401 -> redirect to login)
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      log.warn('api', 'Unauthorized, clearing token');
      setAuthToken(null);
      window.location.hash = '#/login';
    }
    return Promise.reject(error);
  },
);

export default client;
