import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import SchoolRegister from './SchoolRegister'
import { schoolApi, openSchoolSession, SchoolApiError, forgetMatchingSchoolSession } from './schoolApi'
import type { SchoolSession, SchoolClass, SchoolUser } from './schoolApi'
import { syncSchool } from './schoolSync'
import { readSchoolData, adoptSchoolVersion, createSchoolBackup, parseSchoolBackup,
  planSchoolRestore, restoreSchoolBackup } from './schoolStorage'
import type { SchoolData, SchoolBackup } from './schoolStorage'
import { downloadText, getToday, formatDate } from './attendanceStorage'
import type { Student } from './schoolData'

type Props = { onBack: () => void; onLogin: () => void }

function ManageClass({ cls, teachers, disabled, save }: {
  cls: SchoolClass; teachers: SchoolUser[]; disabled: boolean;
  save: (path: string, body: object) => Promise<void>
}) {
  const [teacherIds, setTeacherIds] = useState(cls.teacherIds)
  const [students, setStudents] = useState<Student[]>(cls.students)
  return <details className="backup-panel">
    <summary>Manage {cls.name}: teachers and roster</summary>
    <h3>Assigned teachers</h3>
    {teachers.length === 0 && <p>Create teacher accounts first using School accounts.</p>}
    {teachers.map((teacher) => <label className="filter-label" key={teacher.id}>
      <input type="checkbox" disabled={disabled} checked={teacherIds.includes(teacher.id)} onChange={(e) => setTeacherIds(e.target.checked ? [...teacherIds, teacher.id] : teacherIds.filter((id) => id !== teacher.id))} />{teacher.name}
    </label>)}
    <button className="secondary-button" disabled={disabled} onClick={() => void save(`/classes/${cls.id}/teachers`, { teacherIds })}>Save teacher assignments</button>
    <h3>Class roster</h3><p>Names and IDs in already saved registers stay unchanged.</p>
    {students.map((student, index) => <div className="roster-edit-row" key={student.id}>
      <input className="student-search" aria-label={`Student ${index + 1} name`} disabled={disabled} value={student.name} maxLength={120} onChange={(e) => setStudents(students.map((row) => row.id === student.id ? { ...row, name: e.target.value } : row))} />
      <button className="secondary-button" disabled={disabled} aria-label={`Remove student ${index + 1}`} onClick={() => setStudents(students.filter((row) => row.id !== student.id))}>Remove</button>
    </div>)}
    <div className="action-buttons">
      <button className="secondary-button" disabled={disabled || students.length >= 300} onClick={() => setStudents([...students, { id: crypto.randomUUID(), name: '' }])}>Add student</button>
      <button className="primary-button" disabled={disabled || !students.length || students.some((row) => !row.name.trim())} onClick={() => void save(`/classes/${cls.id}/roster`, { students, baseRosterVersion: cls.rosterVersion })}>Save roster</button>
    </div>
  </details>
}

export default function SchoolWorkspace({ onBack, onLogin }: Props) {
  const [session, setSession] = useState<SchoolSession | null>(null)
  const [data, setData] = useState<SchoolData | null>(null)
  const [teachers, setTeachers] = useState<SchoolUser[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('Opening school workspace…')
  const [offline, setOffline] = useState(false)
  const [clock, setClock] = useState(Date.now)
  const [className, setClassName] = useState('')
  const [names, setNames] = useState('')
  const [backup, setBackup] = useState<SchoolBackup | null>(null)
  const [plan, setPlan] = useState<ReturnType<typeof planSchoolRestore> | null>(null)
  const lock = useRef(false)
  const fileSelection = useRef(0)

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    let active = true
    async function open() {
      try {
        const opened = await openSchoolSession()
        let live = opened.session
        let notice = 'Offline cached workspace. Confirm locally and sync when the API is reachable.'
        if (!opened.offline) {
          try {
            const result = await syncSchool(live)
            live = result.session
            notice = `School data refreshed. ${result.queued} queued, ${result.conflicts} requiring review.`
            if (live.user.role === 'admin') {
              const response = await schoolApi<{ users: SchoolUser[] }>('/users')
              if (active) setTeachers(response.users.filter((user) => user.role === 'teacher'))
            }
          } catch (error) {
            if (error instanceof SchoolApiError && error.status === 401) throw error
            notice = error instanceof Error ? error.message : 'Could not refresh school data.'
          }
        }
        const cached = readSchoolData(live)
        if (active) { setSession(live); setData(cached); setOffline(opened.offline); setMessage(notice) }
      } catch (error) { if (active) setMessage(error instanceof Error ? error.message : 'Could not open school workspace.') }
      finally { if (active) setBusy(false) }
    }
    void open()
    return () => { active = false }
  }, [])

  function refreshLocal() {
    if (!session) return
    try { setData(readSchoolData(session)) }
    catch (error) { setData(null); setMessage(error instanceof Error ? error.message : 'School storage could not be read.') }
  }
  async function run(action?: () => Promise<void>) {
    if (!session || lock.current) return
    lock.current = true; setBusy(true)
    try {
      if (action) await action()
      const result = await syncSchool(session)
      setSession(result.session); setData(readSchoolData(result.session)); setOffline(false)
      if (result.session.user.role === 'admin') {
        const result = await schoolApi<{ users: SchoolUser[] }>('/users')
        setTeachers(result.users.filter((user) => user.role === 'teacher'))
      }
      setMessage(`Synced ${result.uploaded} records. ${result.queued} queued, ${result.conflicts} requiring review.`)
    } catch (error) {
      if (error instanceof SchoolApiError && error.status === 401) { forgetMatchingSchoolSession(session); setSession(null); setData(null) }
      else {
        refreshLocal()
        if (error instanceof SchoolApiError && [0, 502, 503, 504].includes(error.status)) setOffline(true)
      }
      setMessage(error instanceof Error ? error.message : 'School operation failed. Local work was kept.')
    } finally { lock.current = false; setBusy(false) }
  }
  function owner() {
    return { expectedUserId: session!.user.id, expectedSchoolId: session!.user.schoolId }
  }
  async function saveClass(path: string, body: object) {
    await run(async () => { await schoolApi(path, 'PUT', { ...body, ...owner() }) })
  }
  async function createClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run(async () => {
      await schoolApi('/classes', 'POST', { name: className, students: names.split('\n').map((name) => name.trim()).filter(Boolean).map((name) => ({ name })), ...owner() })
      setClassName(''); setNames('')
    })
  }
  function downloadBackup() {
    if (!session) return
    try { downloadText(JSON.stringify(createSchoolBackup(session), null, 2), `neera-school-backup-${getToday()}.json`, 'application/json') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Backup failed.') }
  }
  async function chooseBackup(file: File | undefined) {
    const request = ++fileSelection.current
    setBackup(null); setPlan(null)
    if (!file || !session) return
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Backup exceeds 10 MB.')
      const parsed = parseSchoolBackup(session, await file.text())
      if (fileSelection.current !== request) return
      setPlan(planSchoolRestore(session, parsed)); setBackup(parsed)
    } catch (error) { if (fileSelection.current === request) setMessage(error instanceof Error ? error.message : 'Backup could not be read.') }
  }
  function restore() {
    if (!session || !backup) return
    try {
      const result = restoreSchoolBackup(session, backup)
      setMessage(`Restored ${result.added} local entries; skipped ${result.skipped}. Sync to recheck school versions and permissions.`)
      setBackup(null); setPlan(null); refreshLocal()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Restore failed.') }
  }

  const expired = !!session && clock >= session.expiresAt
  const today = getToday()
  const selected = data?.classes.find((cls) => cls.id === selectedId)
  const remoteToday = data?.entries.filter((row) => row.date === today && row.remote && data.classes.some((cls) => cls.id === row.classId)) ?? []
  const confirmedCount = remoteToday.length
  const totals = { Present: 0, Absent: 0, Late: 0 }
  for (const row of remoteToday) for (const status of Object.values(row.remote!.record.attendance)) totals[status] += 1

  return <section className="attendance">
    <div className="register-navigation"><button className="back-button" onClick={onBack}>← Demo home</button><button className="secondary-button" onClick={onLogin}>School accounts</button></div>
    <p className="eyebrow">{offline ? 'CACHED OFFLINE ACCESS' : 'SCHOOL WORKSPACE'}</p>
    <h1>{session?.user.schoolName ?? 'Your school.'}</h1>
    {session && <p>{session.user.name} · {session.user.role} · {formatDate(today)}</p>}
    <p className="selection-message" role="status">{message}</p>
    {!session && !busy && <button className="primary-button" onClick={onLogin}>Sign in to your school</button>}
    {session && data && <>
      <div className="action-buttons">
        <button className="primary-button" disabled={busy} onClick={() => void run()}>{busy ? 'Working…' : 'Sync now'}</button>
        <button className="secondary-button" disabled={busy} onClick={downloadBackup}>Download school backup</button>
      </div>
      <p className="overview-coverage">{data.entries.filter((row) => row.pending).length} waiting to sync · {data.entries.filter((row) => row.draft).length} unfinished drafts · {data.entries.filter((row) => row.issue).length} need review</p>
      {expired && <p role="alert">Cached access expired. Sign in again before marking or restoring records.</p>}
      {selected ? <SchoolRegister key={selected.id} session={session} schoolClass={selected} data={data} disabled={busy || expired} onBack={() => setSelectedId('')} onChange={refreshLocal} /> : <>
        <h2>{session.user.role === 'admin' ? 'School classes' : 'Your assigned classes'}</h2>
        {data.classes.length === 0 && <p>{session.user.role === 'admin' ? 'Create your first class below.' : 'No assigned classes yet. Ask your school admin to assign one.'}</p>}
        <div className="class-list">{data.classes.map((cls) => <button className="class-card" key={cls.id} onClick={() => setSelectedId(cls.id)} disabled={busy}><span><strong>{cls.name}</strong><span className="student-count">{cls.students.length} students</span></span><span aria-hidden="true">→</span></button>)}</div>
        <h2>School-confirmed attendance cached for today</h2>
        <p>{confirmedCount} of {data.classes.length} accessible classes confirmed. Local queues and drafts are excluded.</p>
        <div className="attendance-summary">{(['Present', 'Absent', 'Late'] as const).map((status) => <div className="summary-card" key={status}><strong>{totals[status]}</strong><span>{status}</span></div>)}</div>
        {remoteToday.flatMap((row) => row.remote!.record.students.filter((student) => row.remote!.record.attendance[student.id] === 'Absent').map((student) => <p key={`${row.classId}:${student.id}`}>{student.name} · {row.remote!.record.className} · Absent</p>))}
        {session.user.role === 'admin' && <>
          <form className="backup-panel account-form" onSubmit={createClass}>
            <h2>Create a school class</h2><label htmlFor="school-class-name">Class name</label>
            <input id="school-class-name" className="student-search" required maxLength={120} value={className} onChange={(e) => setClassName(e.target.value)} />
            <label htmlFor="school-student-names">Student names — one per line (1–300)</label>
            <textarea id="school-student-names" className="student-search" rows={6} required value={names} onChange={(e) => setNames(e.target.value)} />
            <button className="primary-button" disabled={busy || expired || offline}>Create class</button>
          </form>
          {data.classes.map((cls) => <ManageClass key={`${cls.id}:${cls.rosterVersion}:${cls.teacherIds.join(',')}`} cls={cls} teachers={teachers} disabled={busy || expired || offline} save={saveClass} />)}
        </>}
      </>}
      {data.entries.filter((row) => row.issue).map((row) => <section className="backup-panel" key={`${row.classId}:${row.date}`}>
        <h2>Review {row.pending?.record.className ?? row.draft?.record.className ?? row.remote?.record.className} · {row.date}</h2>
        <p role="alert">{row.issue}</p>
        <p>Your local copy is still retained. Download a school backup before discarding local changes.</p>
        <details><summary>Compare attendance copies</summary><pre className="record-comparison">{JSON.stringify({ local: row.draft?.record ?? row.pending?.record, school: row.remote?.record ?? 'No school register yet' }, null, 2)}</pre></details>
        {data.classes.some((cls) => cls.id === row.classId) && <button className="secondary-button" disabled={busy || expired} onClick={() => {
          if (window.confirm('Discard the local draft/queued changes for this date? Download a school backup first if you want to keep them. The school copy will not be overwritten.')) {
            try { adoptSchoolVersion(session, row.classId, row.date); refreshLocal() } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not resolve local copy.') }
          }
        }}>{row.remote ? 'Use school version' : 'Start from updated roster'}</button>}
      </section>)}
      <details className="backup-panel"><summary>Restore a school backup for this account</summary>
        <p>Demo backups and other accounts are rejected. Existing class/day entries are skipped.</p>
        <label className="search-label" htmlFor="school-backup">Choose school JSON backup (maximum 10 MB)</label>
        <input id="school-backup" type="file" accept=".json,application/json" disabled={busy || expired} onChange={(e) => void chooseBackup(e.target.files?.[0])} />
        {backup && plan && <><p>{plan.additions.length} entries to import · {plan.skipped.length} skipped</p><details><summary>Review entries</summary><ul>{plan.additions.map((row) => <li key={`${row.classId}:${row.date}`}>{row.draft?.record.className ?? row.pending?.record.className ?? row.remote?.record.className} · {row.date}</li>)}</ul></details><button className="primary-button" disabled={busy || expired || !plan.additions.length} onClick={restore}>Import {plan.additions.length} entries</button><button className="secondary-button" onClick={() => { setBackup(null); setPlan(null) }}>Cancel</button></>}
      </details>
      <p className="storage-note">School records are separate from demo data and cached per school/account. Sync uses the API and a valid session. Offline cached access lasts until the saved session expiry; it is not an encrypted device lock. Reassigned classes are rechecked on sync. Keep this device private and sign out on shared devices.</p>
    </>}
  </section>
}
