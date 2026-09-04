import { create } from 'zustand'
import {
  login as apiLogin,
  register as apiRegister,
  loginByPhone as apiLoginByPhone,
  loginByEmail as apiLoginByEmail,
  fetchMe,
  logout as apiLogout,
} from '../api/auth'

/**
 * 认证状态机。phase 驱动 3D 电梯舱 → 进入动画 → 工厂。
 * - elevator：未登录，相机锁在舱内
 * - entering：登录成功，舱门打开 + BT 音效 + 相机推镜（由 LoginCameraRig 播完调 setPhase('factory')）
 * - factory：已进入工厂，完整 UI + 相机控制接管
 */

export type AuthPhase = 'elevator' | 'entering' | 'factory'

const TOKEN_KEY = 'forgemind.token'

interface AuthState {
  phase: AuthPhase
  user: string | null
  token: string | null
  busy: boolean
  login: (username: string, password: string) => Promise<void>
  loginByPhone: (phone: string, code: string) => Promise<void>
  loginByEmail: (email: string, code: string) => Promise<void>
  applyAuthResult: (result: { token: string; username: string }) => void
  register: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  restoreSession: () => Promise<void>
  setPhase: (phase: AuthPhase) => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  phase: 'elevator',
  user: null,
  token: localStorage.getItem(TOKEN_KEY),
  busy: false,

  login: async (username, password) => {
    set({ busy: true })
    try {
      const res = await apiLogin(username, password)
      localStorage.setItem(TOKEN_KEY, res.token)
      set({ token: res.token, user: res.username, phase: 'entering', busy: false })
    } catch (error) {
      set({ busy: false })
      throw error
    }
  },

  loginByPhone: async (phone, code) => {
    set({ busy: true })
    try {
      const res = await apiLoginByPhone(phone, code)
      localStorage.setItem(TOKEN_KEY, res.token)
      set({ token: res.token, user: res.username, phase: 'entering', busy: false })
    } catch (error) {
      set({ busy: false })
      throw error
    }
  },

  loginByEmail: async (email, code) => {
    set({ busy: true })
    try {
      const res = await apiLoginByEmail(email, code)
      localStorage.setItem(TOKEN_KEY, res.token)
      set({ token: res.token, user: res.username, phase: 'entering', busy: false })
    } catch (error) {
      set({ busy: false })
      throw error
    }
  },

  applyAuthResult: (res) => {
    localStorage.setItem(TOKEN_KEY, res.token)
    set({ token: res.token, user: res.username, phase: 'entering', busy: false })
  },

  register: async (username, password) => {
    set({ busy: true })
    try {
      const res = await apiRegister(username, password)
      localStorage.setItem(TOKEN_KEY, res.token)
      set({ token: res.token, user: res.username, phase: 'entering', busy: false })
    } catch (error) {
      set({ busy: false })
      throw error
    }
  },

  logout: async () => {
    const token = get().token
    if (token) {
      try {
        await apiLogout(token)
      } catch {
        /* 后端离线也照常登出 */
      }
    }
    localStorage.removeItem(TOKEN_KEY)
    set({ token: null, user: null, phase: 'elevator' })
  },

  restoreSession: async () => {
    const token = get().token
    if (!token) return
    try {
      const me = await fetchMe(token)
      set({ user: me.username, phase: 'factory' })
    } catch {
      localStorage.removeItem(TOKEN_KEY)
      set({ token: null, user: null, phase: 'elevator' })
    }
  },

  setPhase: (phase) => set({ phase }),
}))
