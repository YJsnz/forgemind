/**
 * 认证后端 API 客户端。带超时，错误时抛出后端返回的中文信息。
 */

import { BACKEND_BASE } from './backendBase'

export interface AuthResult {
  token: string
  username: string
}

export interface MeResult {
  id: string
  username: string
}

export interface PhoneCodeResult {
  status: string
  cooldownSeconds: number
}

export interface EmailCodeResult {
  status: string
  cooldownSeconds: number
}

async function withTimeout<T>(p: Promise<T>, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('请求超时，请确认后端已启动')), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 5000): Promise<T> {
  const res = await withTimeout(fetch(`${BACKEND_BASE}${path}`, init), timeoutMs)
  if (!res.ok) {
    let message = `后端返回 ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      /* 保留状态码信息 */
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

function json(method: string, body?: unknown, token?: string): RequestInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }
}

export function register(username: string, password: string): Promise<AuthResult> {
  return request('/api/auth/register', json('POST', { username, password }))
}

export function login(username: string, password: string): Promise<AuthResult> {
  return request('/api/auth/login', json('POST', { username, password }))
}

export function sendPhoneCode(phone: string, purpose = 'login'): Promise<PhoneCodeResult> {
  return request('/api/auth/phone/send-code', json('POST', { phone, purpose }), 12000)
}

export function loginByPhone(phone: string, code: string): Promise<AuthResult> {
  return request('/api/auth/phone/login', json('POST', { phone, code }))
}

export function sendEmailCode(email: string): Promise<EmailCodeResult> {
  return request('/api/auth/email/send-code', json('POST', { email }), 12000)
}

export function loginByEmail(email: string, code: string): Promise<AuthResult> {
  return request('/api/auth/email/login', json('POST', { email, code }))
}

export function startGithubLogin(): void {
  window.location.assign(`${BACKEND_BASE}/api/auth/github/start`)
}

export function exchangeGithubCode(code: string): Promise<AuthResult> {
  return request('/api/auth/github/exchange', json('POST', { code }))
}

export function fetchMe(token: string): Promise<MeResult> {
  return request('/api/auth/me', json('GET', undefined, token))
}

export function logout(token: string): Promise<{ status: string }> {
  return request('/api/auth/logout', json('POST', undefined, token))
}
