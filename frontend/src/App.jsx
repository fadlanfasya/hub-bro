import { Navigate, Route, Routes, NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Database, LogOut, Sun, Moon, Users as UsersIcon, UserCircle,
} from 'lucide-react'
import Logo from './components/Logo'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboards from './pages/Dashboards'
import DashboardEditor from './pages/DashboardEditor'
import DataSources from './pages/DataSources'
import PublicDashboard from './pages/PublicDashboard'
import Users from './pages/Users'
import Account from './pages/Account'
import { useTheme } from './useTheme'
import { AuthProvider, useAuth, ROLE_LABELS } from './useAuth'

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="page muted">Loading…</div>
  return user ? children : <Navigate to="/login" replace />
}

/** Blocks a route the current role can't use, rather than showing a broken page. */
function RequireCapability({ capability, children }) {
  const { can, loading } = useAuth()
  if (loading) return <div className="page muted">Loading…</div>
  return can(capability) ? children : <Navigate to="/" replace />
}

function Sidebar() {
  const [theme, toggleTheme] = useTheme()
  const { user, can, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // the editor needs the horizontal room, so the sidebar collapses to an icon rail there
  const rail = /^\/dashboards\/\d+/.test(location.pathname)

  const signOut = () => {
    logout()
    navigate('/login')
  }

  const navClass = ({ isActive }) => (isActive ? 'active' : '')

  return (
    <aside className={rail ? 'sidebar rail' : 'sidebar'}>
      <div className="brand">
        <Logo size={26} />
        {!rail && <span>Hub-Bro</span>}
      </div>

      <nav>
        <NavLink to="/" end className={navClass} title="Dashboards">
          <LayoutDashboard size={16} />{!rail && <span>Dashboards</span>}
        </NavLink>
        {can('datasource.view') && (
          <NavLink to="/datasources" className={navClass} title="Data sources">
            <Database size={16} />{!rail && <span>Data sources</span>}
          </NavLink>
        )}
        {can('user.manage') && (
          <NavLink to="/users" className={navClass} title="Users">
            <UsersIcon size={16} />{!rail && <span>Users</span>}
          </NavLink>
        )}
      </nav>

      <div className="sidebar-foot">
        {!rail && user && (
          <div className="whoami">
            <div className="whoami-email" title={user.email}>{user.email}</div>
            <div className="whoami-role">{ROLE_LABELS[user.role] || user.role}</div>
          </div>
        )}
        <NavLink to="/account" className={navClass} title="Account">
          <UserCircle size={16} />{!rail && <span>Account</span>}
        </NavLink>
        <button className="nav-btn" onClick={toggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          {!rail && <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
        </button>
        <button className="nav-btn" onClick={signOut} title="Log out">
          <LogOut size={16} />{!rail && <span>Log out</span>}
        </button>
      </div>
    </aside>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/shared/:token" element={<PublicDashboard />} />
      <Route path="/*" element={
        <RequireAuth>
          <div className="app-shell">
            <Sidebar />
            <main className="app-main">
              <Routes>
                <Route path="/" element={<Dashboards />} />
                <Route path="/dashboards/:id" element={<DashboardEditor />} />
                <Route path="/account" element={<Account />} />
                <Route path="/datasources" element={
                  <RequireCapability capability="datasource.view"><DataSources /></RequireCapability>
                } />
                <Route path="/users" element={
                  <RequireCapability capability="user.manage"><Users /></RequireCapability>
                } />
              </Routes>
            </main>
          </div>
        </RequireAuth>
      } />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
