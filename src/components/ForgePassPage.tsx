import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft as ArrowLeftData, KeyRound as KeyData, ShieldCheck as ShieldData } from 'lucide'
import { AuthUI } from './ui/auth-fuse'
import { MorphingIcon } from './MorphingIcon'
import { useAuthStore } from '../store/auth'

type ForgePassPageProps = {
  onBack: () => void
  onSuccess: () => void
  onEnterWorkspace: () => void
}

export function ForgePassPage({ onBack, onSuccess, onEnterWorkspace }: ForgePassPageProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const login = useAuthStore((state) => state.login)
  const register = useAuthStore((state) => state.register)
  const setPhase = useAuthStore((state) => state.setPhase)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // auth-fuse is kept as supplied. ForgeMind accounts are identifiers rather than
    // necessarily email addresses, so the host disables browser email-only validation.
    rootRef.current?.querySelectorAll('form').forEach((form) => form.noValidate = true)
  }, [])

  const handleSubmit = (event: FormEvent<HTMLDivElement>) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null
    if (!form) return
    event.preventDefault()
    event.stopPropagation()
    const values = new FormData(form)
    const account = String(values.get('email') || '').trim()
    const password = String(values.get('password') || '')
    const isRegistration = form.elements.namedItem('name') !== null
    if (account.length < 2) {
      setError('ForgePass 账户标识至少需要 2 个字符')
      return
    }
    if (password.length < 6) {
      setError('密码至少需要 6 位')
      return
    }
    setError('')
    setBusy(true)
    void (isRegistration ? register(account, password) : login(account, password))
      .then(() => {
        setPhase('factory')
        onSuccess()
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'ForgePass 身份验证失败'))
      .finally(() => setBusy(false))
  }

  return (
    <section className="fp-shell" aria-labelledby="fp-title">
      <div className="fp-grid" aria-hidden="true" />
      <header className="fp-brandbar">
        <button type="button" className="fp-back" onClick={onBack}><MorphingIcon icon={ArrowLeftData} size={15} /> 返回 ForgeMind</button>
        <div className="fp-brand"><span className="fp-brand-mark"><MorphingIcon icon={KeyData} size={18} /></span><span><strong id="fp-title">ForgePass</strong><small>ONE IDENTITY / ALL FORGE PRODUCTS</small></span></div>
        <span className="fp-security"><MorphingIcon icon={ShieldData} size={14} /> RULE-FIRST ACCESS</span>
      </header>
      <div className="fp-auth-wrap" ref={rootRef} onSubmitCapture={handleSubmit}>
        <AuthUI />
        {busy && <div className="fp-busy" role="status">正在连接 ForgePass…</div>}
        {error && <div className="fp-error" role="alert">{error}</div>}
      </div>
      <footer className="fp-footer"><span>ForgeMind</span><i /> <span>ForgeHub</span><i /> <span>ForgeCloud</span><i /> <span>ForgeLab</span><b>同一账户，统一身份，跨生态访问</b><button type="button" onClick={onEnterWorkspace}>还没有账号？进入工作台注册</button></footer>
    </section>
  )
}
