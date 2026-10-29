import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
type User = { id: string; name: string; email: string; role: 'admin' | 'teacher'; schoolId: string; schoolName: string }
type Props = { onBack: () => void }

async function request<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Neera-Client': 'web' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = await response.json().catch(() => ({ error: 'API unavailable. Check that the backend is running.' }))
  if (!response.ok) throw new Error(data.error || 'Request failed.')
  return data as T
}

export default function SchoolAccounts({ onBack }: Props) {
  const [user, setUser] = useState<User | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [teacherName, setTeacherName] = useState('')
  const [teacherEmail, setTeacherEmail] = useState('')
  const [teacherPassword, setTeacherPassword] = useState('')
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      try {
        // A 401 is normal before signing in; passwords/tokens are never cached.
        const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
        if (response.status === 401) return
        if (!response.ok) throw new Error('Session check failed.')
        const data = await response.json() as { user: User }
        if (!active) return
        setUser(data.user)
        if (data.user.role === 'admin') {
          const result = await request<{ users: User[] }>('/users')
          if (active) setUsers(result.users)
        }
      } catch {
        if (active) setMessage('School accounts need the API. Start it on port 3001, then reopen this screen.')
      } finally { if (active) setBusy(false) }
    }
    void load()
    return () => { active = false }
  }, [])

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('')
    try {
      const result = await request<{ user: User }>('/auth/login', { email, password })
      setUser(result.user); setPassword('')
      if (result.user.role === 'admin') setUsers((await request<{ users: User[] }>('/users')).users)
      setMessage('Signed in successfully.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Sign in failed.') }
    finally { setBusy(false) }
  }
  async function logout() {
    setBusy(true)
    try {
      await request('/auth/logout', {})
      setUser(null); setUsers([]); setTeacherPassword('')
      setMessage('Signed out. Your server session has been revoked.')
    } catch { setMessage('Sign out could not reach the API. Reconnect and retry; your session may still be active.') }
    finally { setBusy(false) }
  }
  async function addTeacher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true)
    try {
      await request('/users', { name: teacherName, email: teacherEmail, password: teacherPassword })
      setTeacherName(''); setTeacherEmail(''); setTeacherPassword('')
      setUsers((await request<{ users: User[] }>('/users')).users)
      setMessage('Teacher account created in your school.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create teacher.') }
    finally { setBusy(false) }
  }

  return (
    <section className="attendance">
      <button className="back-button" onClick={onBack}>← Back to demo</button>
      <p className="eyebrow">LOCAL ACCOUNT DEVELOPMENT</p>
      <h1>School accounts.</h1>
      <p className="subtitle">Initial admin accounts are created using the local setup command.</p>
      <p className="overview-coverage">Attendance screens still use demo data on this device. Account-specific attendance and school syncing are the next step.</p>
      {busy && <p role="status">Working…</p>}
      {!user ? (
        <form className="backup-panel account-form" onSubmit={login}>
          <h2>Sign in</h2>
          <label htmlFor="account-email">Email</label>
          <input id="account-email" className="student-search" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="account-password">Password</label>
          <input id="account-password" className="student-search" type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="primary-button" disabled={busy}>Sign in</button>
        </form>
      ) : (
        <>
          <section className="backup-panel">
            <h2>{user.schoolName}</h2>
            <p>Signed in as {user.name} · {user.role === 'admin' ? 'School admin' : 'Teacher'}</p>
            <p>{user.email}</p>
            <button className="secondary-button" disabled={busy} onClick={logout}>Sign out</button>
          </section>
          {user.role === 'admin' ? (
            <>
              <form className="backup-panel account-form" onSubmit={addTeacher}>
                <h2>Add a teacher</h2>
                <label htmlFor="teacher-name">Teacher name</label>
                <input id="teacher-name" className="student-search" required maxLength={120} value={teacherName} onChange={(e) => setTeacherName(e.target.value)} />
                <label htmlFor="teacher-email">Teacher email</label>
                <input id="teacher-email" className="student-search" type="email" required autoComplete="off" value={teacherEmail} onChange={(e) => setTeacherEmail(e.target.value)} />
                <label htmlFor="teacher-password">Initial password (12+ characters)</label>
                <input id="teacher-password" className="student-search" type="password" required minLength={12} maxLength={256} autoComplete="new-password" value={teacherPassword} onChange={(e) => setTeacherPassword(e.target.value)} />
                <button className="primary-button" disabled={busy}>Create teacher account</button>
              </form>
              <h2>People in your school</h2>
              <div className="student-list">{users.map((person) => (
                <div className="student-row" key={person.id}>
                  <div><strong>{person.name}</strong><span className="student-count">{person.email}</span></div>
                  <span className="overview-state">{person.role}</span>
                </div>
              ))}</div>
            </>
          ) : <p className="selection-message">Teacher account ready. Managing school accounts is restricted to admins.</p>}
        </>
      )}
      <p className="selection-message" role="status">{message}</p>
      <p className="storage-note">Account access requires the API. Passwords are hashed on the server and session tokens use HttpOnly cookies. This is a local development checkpoint; the demo attendance is not protected by school login yet.</p>
    </section>
  )
}
