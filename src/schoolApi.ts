import type { Register } from './attendanceStorage'
import type { Student } from './schoolData'
export type SchoolUser = { id: string; name: string; email: string; role: 'admin' | 'teacher'; schoolId: string; schoolName: string }
export type SchoolSession = { user: SchoolUser; expiresAt: number }
export type SchoolClass = { id: string; name: string; students: Student[]; rosterVersion: number; teacherIds: string[] }
export type RemoteRegister = { classId: string; date: string; version: number; record: Register }

export class SchoolApiError extends Error {
  status: number
  detail: Record<string, unknown>
  constructor(message: string, status: number, detail: Record<string, unknown> = {}) {
    super(message); this.status = status; this.detail = detail
  }
}
export async function schoolApi<T>(path: string, method = 'GET', body?: object): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Neera-Client': 'web' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch { throw new SchoolApiError('API unreachable. Local work has been kept.', 0) }
  const data = await response.json().catch(() => ({ error: 'The API did not return JSON.' }))
  if (!response.ok) throw new SchoolApiError(data.error || 'School request failed.', response.status, data)
  return data as T
}

const ACTIVE_SESSION = 'neera:school:active'
export function rememberSchoolSession(session: SchoolSession) {
  // This is an offline-device convenience, never server authentication.
  // The token remains in its HttpOnly cookie and all API permissions are checked.
  localStorage.setItem(ACTIVE_SESSION, JSON.stringify(session))
}
export function forgetSchoolSession() { localStorage.removeItem(ACTIVE_SESSION) }
export function cachedSchoolSession(): SchoolSession | null {
  try {
    const session = JSON.parse(localStorage.getItem(ACTIVE_SESSION) ?? 'null') as SchoolSession | null
    if (!session || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now() ||
      !session.user?.id || !session.user.schoolId || !['teacher', 'admin'].includes(session.user.role)) return null
    return session
  } catch { return null }
}
export function forgetMatchingSchoolSession(session: SchoolSession) {
  const active = cachedSchoolSession()
  if (active?.user.id === session.user.id && active.user.schoolId === session.user.schoolId) forgetSchoolSession()
}
export async function openSchoolSession(): Promise<{ session: SchoolSession; offline: boolean }> {
  try {
    const session = await schoolApi<SchoolSession>('/auth/me')
    rememberSchoolSession(session)
    return { session, offline: false }
  } catch (error) {
    if (error instanceof SchoolApiError && error.status === 401) { forgetSchoolSession(); throw error }
    if (error instanceof SchoolApiError && [0, 502, 503, 504].includes(error.status)) {
      const session = cachedSchoolSession()
      if (session) return { session, offline: true }
    }
    throw error
  }
}
