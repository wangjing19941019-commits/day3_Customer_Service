import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import {
  MOCK_DEMO_PASSWORD,
  MOCK_DEMO_USERNAME,
  MOCK_SEED_USERNAMES,
} from '../mocks/auth.ts'
import { homePathForRole } from '../stores/roleNav.ts'
import { useAuth } from '../stores/useAuth.ts'
import { withMockLabel } from '../utils/mockFlag.ts'
import { readApiError } from '../utils/readApiError.ts'

export default function LoginPage() {
  const { status, user, login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [usernameError, setUsernameError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (status === 'loading') {
    return (
      <p className="auth-status" role="status">
        正在恢复登录状态…
      </p>
    )
  }

  if (status === 'authenticated' && user) {
    return <Navigate to={homePathForRole(user.role)} replace />
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = username.trim()
    const nextUserError = trimmed ? '' : '请输入用户名'
    const nextPassError = password ? '' : '请输入密码'
    setUsernameError(nextUserError)
    setPasswordError(nextPassError)
    setFormError('')
    if (nextUserError || nextPassError) return

    setSubmitting(true)
    try {
      await login(trimmed, password)
    } catch (error) {
      setFormError(withMockLabel(readApiError(error, '用户名或密码错误')))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={(event) => void onSubmit(event)} noValidate>
        <h1>智能客服</h1>
        <p className="hint">当前未登录</p>
        <p className="hint">
          使用统一账号进入员工端、客服端和知识库。演示账号{' '}
          {withMockLabel(`${MOCK_DEMO_USERNAME} / ${MOCK_DEMO_PASSWORD}`)}
          ；十个身份：{withMockLabel(MOCK_SEED_USERNAMES.join(' / '))}
          ，口令相同。
        </p>
        <div className={usernameError ? 'field error' : 'field'}>
          <label htmlFor="user">用户名</label>
          <input
            id="user"
            name="username"
            autoComplete="username"
            value={username}
            disabled={submitting}
            onChange={(event) => setUsername(event.target.value)}
          />
          {usernameError ? <p className="error-text">{usernameError}</p> : null}
        </div>
        <div className={passwordError ? 'field error' : 'field'}>
          <label htmlFor="pass">密码</label>
          <input
            id="pass"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={submitting}
            onChange={(event) => setPassword(event.target.value)}
          />
          {passwordError ? <p className="error-text">{passwordError}</p> : null}
        </div>
        <p className="error-text" role="alert">
          {formError}
        </p>
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          登录
        </button>
      </form>
    </div>
  )
}
