import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import RecipeEditor from './pages/RecipeEditor'
import Masters from './pages/Masters'
import Team from './pages/Team'
import Layout from './components/Layout'

function ProtectedRoute({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, loading, isAdmin } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}

function AppRoutes() {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>
  if (!user) return <Routes><Route path="*" element={<Navigate to="/login" replace />} /><Route path="/login" element={<Login />} /></Routes>

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/recipe/new" element={<ProtectedRoute><RecipeEditor /></ProtectedRoute>} />
        <Route path="/recipe/:id/edit" element={<ProtectedRoute><RecipeEditor /></ProtectedRoute>} />
        <Route path="/masters" element={<ProtectedRoute adminOnly><Masters /></ProtectedRoute>} />
        <Route path="/team" element={<ProtectedRoute adminOnly><Team /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
