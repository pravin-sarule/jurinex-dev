import axios from 'axios';
import { API_BASE_URL } from './config/apiConfig';

const API = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

API.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

export const registerUser = (userData) => API.post('/api/auth/register', userData);
export const loginUser = (credentials) => API.post('/api/auth/login', credentials);

export default API;
