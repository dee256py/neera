import { validateRegister } from './attendanceStorage'
import type { Attendance, Register } from './attendanceStorage'
import type { SchoolSession, SchoolClass, RemoteRegister } from './schoolApi'

type Work = { record: Register; baseVersion: number; rosterVersion: number }
export type PendingRegister = Work & { mutationId: string }
export type SchoolEntry = {
  classId: string; date: string; draft?: Work; pending?: PendingRegister
  remote?: RemoteRegister; issue?: string
}
export type SchoolData = { version: 1; classes: SchoolClass[]; entries: SchoolEntry[] }
function key(session: SchoolSession) { return `neera:school:v1:${encodeURIComponent(session.user.schoolId)}:${encodeURIComponent(session.user.id)}` }
function integer(value: unknown, minimum = 0) { return Number.isSafeInteger(value) && Number(value) >= minimum }

function validateRemote(row: RemoteRegister, classId: string, date: string): RemoteRegister {
  if (row.classId !== classId || row.date !== date || !integer(row.version, 1)) throw new Error('Invalid school register metadata.')
  const record = validateRegister(row.record)
  if (record.kind !== 'confirmed' || record.date !== date) throw new Error('Invalid server register.')
  return { classId, date, version: row.version, record }
}
function validateWork(row: Work, date: string, kind: 'draft' | 'confirmed'): Work {
  if (!integer(row.baseVersion) || !integer(row.rosterVersion, 1)) throw new Error('Invalid local register version.')
  const record = validateRegister(row.record)
  if (record.date !== date || record.kind !== kind) throw new Error('Invalid local register.')
  return { record, baseVersion: row.baseVersion, rosterVersion: row.rosterVersion }
}
export function validateSchoolClasses(value: SchoolClass[]): SchoolClass[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error('Invalid class list.')
  const ids = new Set<string>()
  return value.map((row) => {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) || !integer(row.rosterVersion, 1) ||
      !Array.isArray(row.teacherIds) || !row.teacherIds.every((id) => typeof id === 'string')) throw new Error('Invalid class metadata.')
    ids.add(row.id)
    const snapshot = validateRegister({ className: row.name, date: '2026-01-01', kind: 'draft',
      students: row.students, attendance: {}, rosterSource: 'captured' })
    return { id: row.id, name: snapshot.className, students: snapshot.students, rosterVersion: row.rosterVersion, teacherIds: [...row.teacherIds] }
  })
}
function validateData(value: SchoolData): SchoolData {
  if (!value || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 10000) throw new Error('School storage is unreadable. Nothing was changed.')
  const seen = new Set<string>()
  const entries = value.entries.map((row) => {
    if (!row || typeof row.classId !== 'string' || !row.classId || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error('Invalid local entry.')
    const identity = JSON.stringify([row.classId, row.date])
    if (seen.has(identity)) throw new Error('Duplicate local entry.')
    seen.add(identity)
    const result: SchoolEntry = { classId: row.classId, date: row.date }
    if (row.remote) result.remote = validateRemote(row.remote, row.classId, row.date)
    if (row.draft) result.draft = validateWork(row.draft, row.date, 'draft')
    if (row.pending) {
      if (typeof row.pending.mutationId !== 'string' || !/^[a-f0-9-]{36}$/i.test(row.pending.mutationId)) throw new Error('Invalid local mutation ID.')
      result.pending = { ...validateWork(row.pending, row.date, 'confirmed'), mutationId: row.pending.mutationId }
    }
    if (row.issue) result.issue = String(row.issue).slice(0, 500)
    if (!result.remote && !result.draft && !result.pending) throw new Error('Empty local entry.')
    return result
  })
  return { version: 1, classes: validateSchoolClasses(value.classes), entries }
}
export function readSchoolData(session: SchoolSession): SchoolData {
  const raw = localStorage.getItem(key(session))
  return raw === null ? { version: 1, classes: [], entries: [] } : validateData(JSON.parse(raw))
}
function write(session: SchoolSession, data: SchoolData) {
  localStorage.setItem(key(session), JSON.stringify(validateData(data)))
}
function entry(data: SchoolData, classId: string, date: string) {
  let row = data.entries.find((item) => item.classId === classId && item.date === date)
  if (!row) { row = { classId, date }; data.entries.push(row) }
  return row
}
export function updateSchoolClasses(session: SchoolSession, classes: SchoolClass[]) {
  const data = readSchoolData(session)
  data.classes = validateSchoolClasses(classes)
  for (const row of data.entries) {
    if (!data.classes.some((cls) => cls.id === row.classId)) {
      if (row.pending || row.draft) row.issue = 'Class access changed. Local work is retained but cannot be uploaded.'
    } else if (row.issue?.startsWith('Class access changed.')) delete row.issue
  }
  write(session, data)
}
export function saveSchoolDraft(session: SchoolSession, classId: string, date: string, attendance: Attendance) {
  if (session.expiresAt <= Date.now()) throw new Error('Offline access expired. Sign in again before changing school records.')
  const data = readSchoolData(session)
  const cls = data.classes.find((item) => item.id === classId)
  if (!cls) throw new Error('This class is not available in the cached school workspace.')
  const row = entry(data, classId, date)
  const existing = row.draft ?? row.pending
  const snapshot = existing?.record ?? row.remote?.record
  const record = validateRegister({ className: cls.name, date, kind: 'draft', rosterSource: 'captured',
    students: snapshot?.students ?? cls.students, attendance })
  row.draft = { record, baseVersion: existing?.baseVersion ?? row.remote?.version ?? 0,
    rosterVersion: existing?.rosterVersion ?? cls.rosterVersion }
  write(session, data)
}
export function confirmSchoolDraft(session: SchoolSession, classId: string, date: string) {
  if (session.expiresAt <= Date.now()) throw new Error('Sign in again before confirming records.')
  const data = readSchoolData(session)
  const row = entry(data, classId, date)
  if (!row.draft) throw new Error('No draft to confirm.')
  row.pending = { ...row.draft, record: validateRegister({ ...row.draft.record, kind: 'confirmed' }), mutationId: crypto.randomUUID() }
  delete row.draft
  write(session, data)
}
export function sameSchoolRecord(a: Register, b: Register) {
  const canonical = (row: Register) => JSON.stringify([row.className, row.date, row.kind, row.students,
    row.students.map((student) => row.attendance[student.id])])
  return canonical(a) === canonical(b)
}
export function mergeSchoolRemote(session: SchoolSession, incoming: RemoteRegister) {
  const data = readSchoolData(session)
  const row = entry(data, incoming.classId, incoming.date)
  const remote = validateRemote(incoming, incoming.classId, incoming.date)
  if (row.remote && remote.version < row.remote.version) return
  // A response lost after upload is safe to acknowledge if the school now has
  // exactly the same confirmed snapshot. Different changes are never auto-merged.
  if (row.pending && sameSchoolRecord(row.pending.record, remote.record)) {
    delete row.pending
    delete row.issue
    if (row.draft) row.draft.baseVersion = remote.version
  } else if ((row.pending && row.pending.baseVersion !== remote.version) ||
    (row.draft && row.draft.baseVersion !== remote.version)) {
    row.issue = 'The school version changed. Review both copies before continuing.'
  }
  row.remote = remote
  write(session, data)
}
export function acknowledgeSchoolUpload(session: SchoolSession, submitted: PendingRegister, incoming: RemoteRegister) {
  const data = readSchoolData(session)
  const row = entry(data, incoming.classId, incoming.date)
  const remote = validateRemote(incoming, incoming.classId, incoming.date)
  if (row.remote && row.remote.version > remote.version) return
  if (row.pending?.mutationId === submitted.mutationId) { delete row.pending; delete row.issue }
  else if (row.pending) row.issue = 'Local work changed during upload. Review before syncing again.'
  if (row.draft && row.draft.baseVersion === submitted.baseVersion) row.draft.baseVersion = remote.version
  row.remote = remote
  write(session, data)
}
export function flagSchoolIssue(session: SchoolSession, classId: string, date: string, message: string) {
  const data = readSchoolData(session)
  const row = data.entries.find((item) => item.classId === classId && item.date === date)
  if (row) { row.issue = message; write(session, data) }
}
export function adoptSchoolVersion(session: SchoolSession, classId: string, date: string) {
  const data = readSchoolData(session)
  const index = data.entries.findIndex((item) => item.classId === classId && item.date === date)
  if (index < 0) return
  const old = data.entries[index]
  // Called only after explicit confirmation in the UI. Demo data is untouched.
  if (old.remote) data.entries[index] = { classId, date, remote: old.remote }
  else data.entries.splice(index, 1)
  write(session, data)
}

export type SchoolBackup = { app: 'NeeraSchool'; version: 1; schoolId: string; userId: string; exportedAt: string; data: SchoolData }
export function createSchoolBackup(session: SchoolSession): SchoolBackup {
  return { app: 'NeeraSchool', version: 1, schoolId: session.user.schoolId, userId: session.user.id,
    exportedAt: new Date().toISOString(), data: readSchoolData(session) }
}
export function parseSchoolBackup(session: SchoolSession, raw: string): SchoolBackup {
  if (new Blob([raw]).size > 10 * 1024 * 1024) throw new Error('Backup exceeds 10 MB.')
  const file = JSON.parse(raw) as SchoolBackup
  if (!file || file.app !== 'NeeraSchool' || file.version !== 1 || file.schoolId !== session.user.schoolId || file.userId !== session.user.id) throw new Error('Choose a school backup for this same school and account. Demo backups are separate.')
  if (typeof file.exportedAt !== 'string' || Number.isNaN(Date.parse(file.exportedAt))) throw new Error('Invalid backup timestamp.')
  return { ...file, data: validateData(file.data) }
}
export function planSchoolRestore(session: SchoolSession, backup: SchoolBackup) {
  const file = parseSchoolBackup(session, JSON.stringify(backup))
  const existing = new Set(readSchoolData(session).entries.map((row) => JSON.stringify([row.classId, row.date])))
  return { additions: file.data.entries.filter((row) => !existing.has(JSON.stringify([row.classId, row.date]))),
    skipped: file.data.entries.filter((row) => existing.has(JSON.stringify([row.classId, row.date]))) }
}
export function restoreSchoolBackup(session: SchoolSession, backup: SchoolBackup) {
  if (session.expiresAt <= Date.now()) throw new Error('Sign in again before restoring school data.')
  const file = parseSchoolBackup(session, JSON.stringify(backup))
  const plan = planSchoolRestore(session, file)
  const data = readSchoolData(session)
  const known = new Set(data.classes.map((row) => row.id))
  const addedClasses = new Set(plan.additions.map((row) => row.classId))
  data.classes.push(...file.data.classes.filter((row) => !known.has(row.id) && addedClasses.has(row.id)))
  data.entries.push(...plan.additions)
  if (plan.additions.length) write(session, data)
  return { added: plan.additions.length, skipped: plan.skipped.length }
}
