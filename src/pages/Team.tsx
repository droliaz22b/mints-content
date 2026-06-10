import { useState, useEffect, FormEvent } from 'react'
import { pb } from '../lib/pocketbase'
import type { TeamMember, UserRole } from '../types'
import { Plus, Trash2, Loader2, AlertCircle, Eye, EyeOff, RefreshCw } from 'lucide-react'

const ROLES: UserRole[] = ['admin', 'editor', 'viewer']

function randomPassword(len = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$'
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export default function Team() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<UserRole>('editor')
  const [password, setPassword] = useState(randomPassword())
  const [showPassword, setShowPassword] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  async function loadMembers() {
    setLoading(true)
    try {
      const res = await pb.collection('users').getFullList<TeamMember>({ sort: '-created' })
      setMembers(res)
    } catch { setError('Failed to load team members.') }
    finally { setLoading(false) }
  }

  useEffect(() => { loadMembers() }, [])

  async function createMember(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setCreating(true); setCreateError('')
    try {
      await pb.collection('users').create({
        email: email.trim(),
        name: name.trim() || email.trim().split('@')[0],
        role,
        password,
        passwordConfirm: password,
      })
      setEmail(''); setName(''); setRole('editor'); setPassword(randomPassword())
      await loadMembers()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create user.'
      setCreateError(msg.includes('email') ? 'This email is already registered.' : msg)
    } finally { setCreating(false) }
  }

  async function deleteMember(id: string) {
    if (!confirm('Remove this team member? They will lose access immediately.')) return
    try {
      await pb.collection('users').delete(id)
      await loadMembers()
    } catch { alert('Failed to remove member.') }
  }

  async function updateRole(id: string, newRole: UserRole) {
    try {
      await pb.collection('users').update(id, { role: newRole })
      await loadMembers()
    } catch { alert('Failed to update role.') }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Team &amp; Users</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage who has access to view, edit, and create recipes in this workspace.</p>
      </div>

      {/* Add member form */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-700 mb-5">
          <Plus size={15} /> Add Team Member
        </h2>

        {createError && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
            <AlertCircle size={14} /> {createError}
          </div>
        )}

        <form onSubmit={createMember} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">New User Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="input w-full"
                placeholder="user@example.com"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Display Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="input w-full"
                placeholder="Full name (optional)"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Role</label>
            <div className="flex gap-2">
              {ROLES.map(r => (
                <label key={r} className={`flex items-center gap-2 px-4 py-2 border rounded-lg cursor-pointer text-sm capitalize transition-colors ${role === r ? 'border-black bg-black text-white' : 'border-gray-200 hover:border-gray-400'}`}>
                  <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="sr-only" />
                  {r}
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Generated Temporary Password</label>
              <button type="button" onClick={() => setPassword(randomPassword())} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
                <RefreshCw size={12} /> Regenerate
              </button>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="input w-full pr-10 font-mono"
                required
                minLength={8}
              />
              <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              This password will be pre-registered on behalf of the user. They can change it after signing in.
            </p>
          </div>

          <button
            type="submit"
            disabled={creating}
            className="flex items-center gap-2 px-5 py-2.5 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Create &amp; Invite User
          </button>
        </form>
      </div>

      {/* Members list */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Team Members</h2>
          <span className="text-xs text-gray-400">{members.length} member{members.length !== 1 ? 's' : ''}</span>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 px-6 py-3">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Email Address</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Access Level</th>
                <th className="px-6 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.map(m => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-600">
                        {(m.name || m.email).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{m.email}</p>
                        <p className="text-xs text-gray-400">
                          Added {m.created ? new Date(m.created).toLocaleDateString() : 'Unknown date'}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <select
                      value={m.role}
                      onChange={e => updateRole(m.id, e.target.value as UserRole)}
                      className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg bg-white outline-none cursor-pointer capitalize"
                    >
                      {ROLES.map(r => <option key={r} value={r} className="capitalize">{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <button onClick={() => deleteMember(m.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {members.length === 0 && (
                <tr><td colSpan={3} className="px-6 py-10 text-center text-sm text-gray-400">No team members yet.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
