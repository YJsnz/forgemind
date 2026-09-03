import { BACKEND_BASE } from './backendBase'

export type ForgeLabApiAttachment = {
  id: string
  name: string
  kind: 'image' | 'archive'
  sizeBytes: number
  downloadUrl: string
}

export type ForgeLabApiReply = {
  id: string
  author: string
  role: string
  content: string
  meta: string
  likes: number
  liked?: boolean
}

export type ForgeLabApiPost = {
  id: string
  section: string
  title: string
  summary: string
  content?: string
  author: string
  role: string
  meta: string
  replies: number
  likes: number
  liked?: boolean
  tag: string
  iconKey: string
  attachments?: ForgeLabApiAttachment[]
  repliesList?: ForgeLabApiReply[]
}

export type ForgeLabApiNotification = {
  id: string
  kind: 'reply' | 'like' | 'notice'
  title: string
  body: string
  meta: string
  read: boolean
}

function headers(json = false): Record<string, string> {
  const token = localStorage.getItem('forgemind.token')
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string }
    return body.error ?? `后端返回 ${response.status}`
  } catch {
    return `后端返回 ${response.status}`
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BACKEND_BASE}${path}`, {
    ...init,
    headers: { ...headers(init.body !== undefined && !(init.body instanceof FormData)), ...(init.headers ?? {}) },
  })
  if (!response.ok) throw new Error(await readError(response))
  return await response.json() as T
}

export function loadForgeLabPosts() {
  return request<ForgeLabApiPost[]>('/api/forgelab/posts')
}

export function loadForgeLabPost(postId: string) {
  return request<ForgeLabApiPost>(`/api/forgelab/posts/${encodeURIComponent(postId)}`)
}

export function createForgeLabPost(metadata: Record<string, string>, image: File | null, archive: File | null) {
  const form = new FormData()
  form.append('metadata', JSON.stringify(metadata))
  if (image) form.append('image', image, image.name)
  if (archive) form.append('archive', archive, archive.name)
  return request<ForgeLabApiPost>('/api/forgelab/posts', { method: 'POST', body: form })
}

export function toggleForgeLabPostLike(postId: string) {
  return request<{ liked: boolean; likes: number }>(`/api/forgelab/posts/${encodeURIComponent(postId)}/like`, { method: 'POST' })
}

export function createForgeLabReply(postId: string, content: string) {
  return request<ForgeLabApiReply>(`/api/forgelab/posts/${encodeURIComponent(postId)}/replies`, { method: 'POST', headers: headers(true), body: JSON.stringify({ content }) })
}

export function toggleForgeLabReplyLike(replyId: string) {
  return request<{ liked: boolean; likes: number }>(`/api/forgelab/replies/${encodeURIComponent(replyId)}/like`, { method: 'POST' })
}

export function loadForgeLabNotifications() {
  return request<ForgeLabApiNotification[]>('/api/forgelab/notifications')
}

export function markForgeLabNotificationRead(notificationId: string) {
  return request<{ ok: boolean }>(`/api/forgelab/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'POST' })
}

export function markAllForgeLabNotificationsRead() {
  return request<{ ok: boolean }>('/api/forgelab/notifications/read-all', { method: 'POST' })
}
