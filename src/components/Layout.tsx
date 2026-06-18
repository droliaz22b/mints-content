import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import { ChefHat, ChevronDown, KeyRound, Users, LogOut, Menu, X, LayoutGrid, Settings, SlidersHorizontal, FileUp, ClipboardList } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'

export default function Layout() {
  const { user, logout, isAdmin } = useAuth()
  const { settings, logoUrl } = useSettings()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  function handleLogout() {
    logout()
    navigate('/login')
  }

  const initials = (user?.name || user?.email || 'U').charAt(0).toUpperCase()

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-screen-xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2">
            {logoUrl
              ? <img src={logoUrl} alt="logo" className="h-7 w-auto object-contain" />
              : <div className="w-7 h-7 bg-black rounded-md flex items-center justify-center flex-shrink-0"><ChefHat size={15} className="text-white" /></div>
            }
            <span className="font-semibold text-sm tracking-tight">{settings?.site_title || 'Mints CMS'}</span>
          </div>

          {/* Desktop nav */}
          <nav className="hidden sm:flex items-center gap-1">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `text-sm px-3 py-1.5 rounded-md transition-colors ${isActive ? 'text-black font-medium' : 'text-gray-500 hover:text-black'}`
              }
            >
              Dashboard
            </NavLink>
            {isAdmin && (
              <NavLink
                to="/masters"
                className={({ isActive }) =>
                  `text-sm px-3 py-1.5 rounded-md transition-colors ${isActive ? 'text-black font-medium' : 'text-gray-500 hover:text-black'}`
                }
              >
                Masters
              </NavLink>
            )}

            <div className="relative ml-2" ref={menuRef}>
              <button onClick={() => setMenuOpen(v => !v)} className="flex items-center gap-1.5">
                <div className="w-8 h-8 rounded-full bg-gray-800 text-white text-sm font-medium flex items-center justify-center relative">
                  {initials}
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-amber-400 rounded-full border-2 border-white" />
                </div>
                <ChevronDown size={14} className="text-gray-400" />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-10 w-56 bg-white border border-gray-200 rounded-xl shadow-lg py-2 z-50">
                  <div className="px-4 py-2 border-b border-gray-100 mb-1">
                    <p className="text-xs text-gray-500">Logged in as</p>
                    <p className="text-sm font-medium truncate">{user?.email}</p>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => { navigate('/team'); setMenuOpen(false) }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <Users size={14} /> Team &amp; Users
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      onClick={() => { navigate('/settings'); setMenuOpen(false) }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <SlidersHorizontal size={14} /> Site Settings
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      onClick={() => { navigate('/import'); setMenuOpen(false) }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <FileUp size={14} /> Import Docs
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      onClick={() => { navigate('/review'); setMenuOpen(false) }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <ClipboardList size={14} /> Review Later
                    </button>
                  )}
                  <button
                    onClick={() => { navigate('/change-password'); setMenuOpen(false) }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                  >
                    <KeyRound size={14} /> Change Password
                  </button>
                  <div className="border-t border-gray-100 mt-1 pt-1">
                    <button
                      onClick={handleLogout}
                      className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                    >
                      <LogOut size={14} /> Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </nav>

          {/* Mobile right side */}
          <div className="flex sm:hidden items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-gray-800 text-white text-xs font-medium flex items-center justify-center">
              {initials}
            </div>
            <button
              onClick={() => setMobileOpen(v => !v)}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600"
            >
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {mobileOpen && (
          <div className="sm:hidden bg-white border-t border-gray-100 px-3 py-2 space-y-0.5">
            <NavLink
              to="/"
              end
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${isActive ? 'bg-gray-100 text-black font-medium' : 'text-gray-600'}`
              }
            >
              <LayoutGrid size={16} /> Dashboard
            </NavLink>
            {isAdmin && (
              <NavLink
                to="/masters"
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${isActive ? 'bg-gray-100 text-black font-medium' : 'text-gray-600'}`
                }
              >
                <Settings size={16} /> Masters
              </NavLink>
            )}
            {isAdmin && (
              <NavLink
                to="/team"
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${isActive ? 'bg-gray-100 text-black font-medium' : 'text-gray-600'}`
                }
              >
                <Users size={16} /> Team &amp; Users
              </NavLink>
            )}
            {isAdmin && (
              <NavLink
                to="/settings"
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${isActive ? 'bg-gray-100 text-black font-medium' : 'text-gray-600'}`
                }
              >
                <SlidersHorizontal size={16} /> Site Settings
              </NavLink>
            )}
            {isAdmin && (
              <NavLink
                to="/import"
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${isActive ? 'bg-gray-100 text-black font-medium' : 'text-gray-600'}`
                }
              >
                <FileUp size={16} /> Import Docs
              </NavLink>
            )}
            {isAdmin && (
              <NavLink
                to="/review"
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${isActive ? 'bg-gray-100 text-black font-medium' : 'text-gray-600'}`
                }
              >
                <ClipboardList size={16} /> Review Later
              </NavLink>
            )}
            <div className="border-t border-gray-100 mt-1 pt-1">
              <div className="px-3 py-1.5">
                <p className="text-xs text-gray-400 truncate">{user?.email}</p>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-red-600 w-full"
              >
                <LogOut size={16} /> Sign Out
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-screen-xl mx-auto px-3 sm:px-6 py-4 sm:py-8">
        <Outlet />
      </main>
    </div>
  )
}
