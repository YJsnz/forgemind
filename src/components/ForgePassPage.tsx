import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft as ArrowLeftData, GitBranch as GithubData, KeyRound as KeyData, Mail as MailData, ShieldCheck as ShieldData } from 'lucide'
import { AuthUI } from './ui/auth-fuse'
import { MorphingIcon } from './MorphingIcon'
import { useAuthStore } from '../store/auth'
import { exchangeGithubCode, sendEmailCode, startGithubLogin } from '../api/auth'

type ForgePassPageProps = {
  onBack: () => void
  onSuccess: () => void
  onEnterWorkspace: () => void
}

export function ForgePassPage({ onBack, onSuccess, onEnterWorkspace }: ForgePassPageProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const login = useAuthStore((state) => state.login)
  const register = useAuthStore((state) => state.register)
  const loginByEmail = useAuthStore((state) => state.loginByEmail)
  const applyAuthResult = useAuthStore((state) => state.applyAuthResult)
  const setPhase = useAuthStore((state) => state.setPhase)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailCodeSent, setEmailCodeSent] = useState(false)
  const [emailCooldown, setEmailCooldown] = useState(0)
  const [emailLoginOpen, setEmailLoginOpen] = useState(false)
  const [oauthBusy, setOauthBusy] = useState(false)

  useEffect(() => {
    // auth-fuse is kept as supplied. ForgeMind accounts are identifiers rather than
    // necessarily email addresses, so the host disables browser email-only validation.
    rootRef.current?.querySelectorAll('form').forEach((form) => form.noValidate = true)
  }, [])

  useEffect(() => {
    if (emailCooldown <= 0) return
    const timer = window.setInterval(() => setEmailCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [emailCooldown])

  useEffect(() => {
    const oauthCode = new URLSearchParams(window.location.search).get('forgepass_oauth')
    if (!oauthCode) return
    window.history.replaceState({}, '', window.location.pathname)
    setError('')
    setOauthBusy(true)
    void exchangeGithubCode(oauthCode)
      .then((result) => {
        applyAuthResult(result)
        setPhase('factory')
        onSuccess()
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'GitHub 登录失败'))
      .finally(() => setOauthBusy(false))
  }, [applyAuthResult, onSuccess, setPhase])

  const handleSubmit = (event: FormEvent<HTMLDivElement>) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null
    if (!form) return
    if (form.dataset.authMode !== 'password') return
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

  const handleSendEmailCode = () => {
    if (emailBusy || emailCooldown > 0) return
    setError('')
    setEmailBusy(true)
    void sendEmailCode(email)
      .then((result) => {
        setEmailCodeSent(true)
        setEmailCooldown(result.cooldownSeconds)
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '邮箱验证码发送失败'))
      .finally(() => setEmailBusy(false))
  }

  const handleEmailLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (emailBusy) return
    setError('')
    setEmailBusy(true)
    void loginByEmail(email, emailCode)
      .then(() => {
        setPhase('factory')
        onSuccess()
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '邮箱验证失败'))
      .finally(() => setEmailBusy(false))
  }

  const extraContent = (
    <div className="fp-alt-auth">
      <button className="fp-email-toggle" type="button" onClick={() => setEmailLoginOpen((open) => !open)} aria-expanded={emailLoginOpen}><MorphingIcon icon={MailData} size={15} /><span>{emailLoginOpen ? '收起邮箱登录' : '使用邮箱登录'}</span><b>{emailLoginOpen ? '−' : '+'}</b></button>
      {emailLoginOpen && <form className="fp-phone-auth fp-email-auth" data-auth-mode="email" onSubmit={handleEmailLogin}>
        <div className="fp-phone-heading"><span><MorphingIcon icon={MailData} size={15} /></span><div><strong>邮箱验证码登录</strong><small>首次验证将自动创建 ForgePass 账户</small></div></div>
        <div className="fp-phone-row"><input aria-label="邮箱" type="email" placeholder="你的邮箱地址" value={email} onChange={(event) => { setEmail(event.target.value); setEmailCode(''); setEmailCodeSent(false) }} autoComplete="email" /><button type="button" onClick={handleSendEmailCode} disabled={emailBusy || emailCooldown > 0 || email.trim().length < 5}>{emailCooldown > 0 ? `${emailCooldown}s 后重发` : emailBusy ? '发送中…' : '获取验证码'}</button></div>
        <div className="fp-phone-row"><input aria-label="邮箱验证码" type="text" inputMode="numeric" maxLength={6} placeholder="6 位邮箱验证码" value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" /><button type="submit" disabled={!emailCodeSent || emailBusy || emailCode.length !== 6}>{emailBusy ? '验证中…' : '邮箱登录'}</button></div>
      </form>}
      <div className="fp-auth-divider"><span>或</span></div>
      <button className="fp-github-login" type="button" onClick={() => { setError(''); setOauthBusy(true); startGithubLogin() }} disabled={oauthBusy || emailBusy}><MorphingIcon icon={GithubData} size={15} />{oauthBusy ? '正在连接 GitHub…' : '使用 GitHub 登录'}</button>
    </div>
  )

  return (
    <section className="fp-shell" aria-labelledby="fp-title">
      <div className="fp-grid" aria-hidden="true" />
      <header className="fp-brandbar">
        <button type="button" className="fp-back" onClick={onBack}><MorphingIcon icon={ArrowLeftData} size={15} /> 返回 ForgeMind</button>
        <div className="fp-brand"><span className="fp-brand-mark"><MorphingIcon icon={KeyData} size={18} /></span><span><strong id="fp-title">ForgePass</strong><small>ONE IDENTITY / ALL FORGE PRODUCTS</small></span></div>
        <span className="fp-security"><MorphingIcon icon={ShieldData} size={14} /> RULE-FIRST ACCESS</span>
      </header>
      <div className="fp-auth-wrap" ref={rootRef} onSubmitCapture={handleSubmit}>
        <AuthUI extraContent={extraContent} />
        {busy && <div className="fp-busy" role="status">正在连接 ForgePass…</div>}
        {error && <div className="fp-error" role="alert">{error}</div>}
      </div>
      <footer className="fp-footer"><span>ForgeMind</span><i /> <span>ForgeHub</span><i /> <span>ForgeCloud</span><i /> <span>ForgeLab</span><b>同一账户，统一身份，跨生态访问</b><button type="button" onClick={onEnterWorkspace}>还没有账号？进入工作台注册</button></footer>
    </section>
  )
}
