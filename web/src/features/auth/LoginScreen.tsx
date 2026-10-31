import { useState, type FormEvent } from 'react'
import { Icon } from '../../shared/ui/Icon'

type Props = {
  busy: boolean
  error: string
  onLogin: (credential: string) => void
}

export function LoginScreen({ busy, error, onLogin }: Props) {
  const [token, setToken] = useState('')

  function login(event: FormEvent) {
    event.preventDefault()
    const credential = token
    setToken('')
    onLogin(credential)
  }

  return (
    <main className="login-screen grid min-h-dvh place-items-center p-5 sm:p-6">
      <form onSubmit={login} className="login-card w-full max-w-sm space-y-5">
        <div>
          <div className="login-brand-row">
            <span className="brand-mark">
              <Icon name="terminal" />
            </span>
            <p className="login-brand">
              YanDock <span>虤坞</span>
            </p>
          </div>
          <p className="login-eyebrow">你的终端，随身可达</p>
          <h1 className="mt-3 text-2xl font-semibold leading-tight">
            把开发现场
            <br />
            带在身边。
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            连接你的开发机器，继续未完成的工作。
          </p>
        </div>
        <div>
          <label htmlFor="token" className="mb-2 block text-sm">
            访问凭据
          </label>
          <input
            id="token"
            type="password"
            autoComplete="current-password"
            placeholder="输入服务器访问凭据"
            required
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="login-input w-full rounded-xl border border-border bg-background px-4 outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        <button
          disabled={busy}
          className="login-submit w-full bg-primary text-primary-foreground"
        >
          {busy ? '连接中…' : '登录工作台'}
          <Icon name="arrow" />
        </button>
        <p className="login-footnote">
          <Icon name="system" />
          默认跟随系统 · 凭据仅用于本机服务认证
        </p>
      </form>
    </main>
  )
}
