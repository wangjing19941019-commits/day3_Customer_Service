import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { navItemsForRole, pageNameForPath } from '../stores/roleNav.ts'
import { useAuth } from '../stores/useAuth.ts'
import { withMockLabel } from '../utils/mockFlag.ts'

export default function AppShell() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const pageName = pageNameForPath(location.pathname)
  const navItems = user ? navItemsForRole(user.role) : []

  function onLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <strong>智能客服</strong>
          <span className="page-name">{pageName}</span>
        </div>
        <div className="session">
          <span className="user">已登录：{user ? withMockLabel(user.username) : ''}</span>
          <button type="button" className="btn btn-secondary" onClick={onLogout}>
            退出
          </button>
        </div>
      </header>
      <div className="shell">
        <nav className="sidebar" aria-label="业务入口">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
