import { Navigate, Outlet, Route, Routes } from 'react-router'
import AppShell from '../components/AppShell.tsx'
import AgentInboxPage from '../pages/AgentInboxPage.tsx'
import EmployeeChatPage from '../pages/EmployeeChatPage.tsx'
import KnowledgePage from '../pages/KnowledgePage.tsx'
import LoginPage from '../pages/LoginPage.tsx'
import TemplateAdminPage from '../pages/TemplateAdminPage.tsx'
import TicketListPage from '../pages/TicketListPage.tsx'
import { allowedRolesForPath, homePathForRole } from '../stores/roleNav.ts'
import { useAuth } from '../stores/useAuth.ts'
import type { UserRole } from '../types/auth.ts'

function RestoreStatus() {
  return (
    <p className="auth-status" role="status">
      正在恢复登录状态…
    </p>
  )
}

function RequireAuth() {
  const { status } = useAuth()
  if (status === 'loading') return <RestoreStatus />
  return status === 'authenticated' ? <Outlet /> : <Navigate to="/login" replace />
}

function RequireRole({ allow }: { allow: readonly UserRole[] }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (!allow.includes(user.role)) {
    return <Navigate to={homePathForRole(user.role)} replace />
  }
  return <Outlet />
}

function FallbackRoute() {
  const { status, user } = useAuth()
  if (status === 'loading') return <RestoreStatus />
  if (status === 'authenticated' && user) {
    return <Navigate to={homePathForRole(user.role)} replace />
  }
  return <Navigate to="/login" replace />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route element={<RequireRole allow={allowedRolesForPath('/employee')} />}>
            <Route path="/employee" element={<EmployeeChatPage />} />
          </Route>
          <Route element={<RequireRole allow={allowedRolesForPath('/agent')} />}>
            <Route path="/agent" element={<AgentInboxPage />} />
          </Route>
          <Route element={<RequireRole allow={allowedRolesForPath('/knowledge')} />}>
            <Route path="/knowledge" element={<KnowledgePage />} />
          </Route>
          <Route element={<RequireRole allow={allowedRolesForPath('/tickets')} />}>
            <Route path="/tickets" element={<TicketListPage />} />
          </Route>
          <Route element={<RequireRole allow={allowedRolesForPath('/templates')} />}>
            <Route path="/templates" element={<TemplateAdminPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="/" element={<FallbackRoute />} />
      <Route path="*" element={<FallbackRoute />} />
    </Routes>
  )
}
