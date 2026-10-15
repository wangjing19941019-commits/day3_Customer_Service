import { AppRoutes } from './router/index.tsx'
import { AuthProvider } from './stores/AuthProvider.tsx'

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
