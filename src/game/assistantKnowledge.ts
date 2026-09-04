import { assistantScopedStorageKey } from './assistantStorage'

const KNOWLEDGE_KEY = 'forgemind.assistant-knowledge.v1'
const KNOWLEDGE_URL = 'http://127.0.0.1:8080/api/v1/ai/knowledge'

export interface AssistantKnowledgeDocument {
  id: string
  workspaceId?: string
  title: string
  category: string
  source?: string
  content: string
  status?: string
  creator?: string
  createdAt?: string
  updatedAt?: string
}

export function readAssistantKnowledge(): AssistantKnowledgeDocument[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(assistantScopedStorageKey(KNOWLEDGE_KEY)) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isKnowledgeDocument).slice(0, 48)
  } catch {
    return []
  }
}

function writeAssistantKnowledge(documents: AssistantKnowledgeDocument[]) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(assistantScopedStorageKey(KNOWLEDGE_KEY), JSON.stringify(documents.slice(0, 48))) } catch { /* optional cache */ }
}

/** Keep the last authenticated ForgeCloud workspace snapshot available to the assistant. */
export function cacheAssistantKnowledge(documents: AssistantKnowledgeDocument[]) {
  writeAssistantKnowledge(documents.filter(isKnowledgeDocument))
}

function authHeaders(): Record<string, string> {
  const token = window.localStorage.getItem('forgemind.token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Hydrate workspace-authored RAG entries so the next assistant request can retrieve them. */
export async function hydrateAssistantKnowledge(): Promise<AssistantKnowledgeDocument[]> {
  const local = readAssistantKnowledge()
  if (typeof window === 'undefined' || !window.localStorage.getItem('forgemind.token')) return local
  try {
    const response = await fetch(KNOWLEDGE_URL, { headers: authHeaders() })
    if (!response.ok) throw new Error(`知识库读取失败：${response.status}`)
    const remote = (await response.json()) as unknown
    const documents = Array.isArray(remote) ? remote.filter(isKnowledgeDocument).slice(0, 48) : []
    writeAssistantKnowledge(documents)
    return documents
  } catch {
    return local
  }
}

function isKnowledgeDocument(value: unknown): value is AssistantKnowledgeDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<AssistantKnowledgeDocument>
  return typeof candidate.id === 'string'
    && typeof candidate.title === 'string'
    && typeof candidate.category === 'string'
    && typeof candidate.content === 'string'
    && candidate.content.trim().length > 0
    && candidate.content.length <= 16000
}
