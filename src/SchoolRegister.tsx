import { useState } from 'react'
import { getToday, formatDate, downloadText } from './attendanceStorage'
import type { Attendance, Status } from './attendanceStorage'
import type { SchoolSession, SchoolClass } from './schoolApi'
import { saveSchoolDraft, confirmSchoolDraft } from './schoolStorage'
import type { SchoolData } from './schoolStorage'

type Props = { session: SchoolSession; schoolClass: SchoolClass; data: SchoolData; disabled: boolean; onBack: () => void; onChange: () => void }
const statuses: Status[] = ['Present', 'Absent', 'Late']
export default function SchoolRegister({ session, schoolClass, data, disabled, onBack, onChange }: Props) {
  const [date, setDate] = useState(getToday)
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')
  const [historyDate, setHistoryDate] = useState('')
  const row = data.entries.find((entry) => entry.classId === schoolClass.id && entry.date === date)
  const snapshot = row?.draft?.record ?? row?.pending?.record ?? row?.remote?.record
  const students = snapshot?.students ?? schoolClass.students
  const marks = snapshot?.attendance ?? {}
  const blocked = disabled
  const totals = statuses.map((status) => students.filter((student) => marks[student.id] === status).length)
  const marked = students.filter((student) => marks[student.id]).length
  const visible = students.filter((student) =>
    `${student.name} ${student.id}`.toLowerCase().includes(query.trim().toLowerCase()) &&
    (filter === 'All' || (filter === 'Unmarked' ? !marks[student.id] : marks[student.id] === filter)))
  const history = data.entries.filter((entry) => entry.classId === schoolClass.id && entry.remote).sort((a, b) => b.date.localeCompare(a.date))
  const old = history.find((entry) => entry.date === historyDate)?.remote

  function update(attendance: Attendance) {
    if (blocked) return
    try {
      saveSchoolDraft(session, schoolClass.id, date, attendance)
      setMessage('Draft saved on this device. Confirm it when every student is marked.')
      onChange()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Draft saving failed. Keep this page open.') }
  }
  function confirm() {
    if (blocked) return
    try {
      confirmSchoolDraft(session, schoolClass.id, date)
      setMessage('Confirmed locally. Use Sync now to submit to your school.')
      onChange()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Confirmation failed.') }
  }
  function csv() {
    const record = row?.pending?.record ?? row?.remote?.record
    if (!record) return
    const cell = (value: string) => `"${(/^\s*[=+\-@]/.test(value) ? "'" + value : value).replace(/"/g, '""')}"`
    const rows = [['Date', 'Class', 'Student ID', 'Name', 'Status'], ...record.students.map((student) => [date, record.className, student.id, student.name, record.attendance[student.id]])]
    downloadText('\uFEFF' + rows.map((values) => values.map(cell).join(',')).join('\r\n'), `neera-school-${date}.csv`, 'text/csv;charset=utf-8;')
  }
  return <section>
    <button className="back-button" onClick={onBack}>← School classes</button>
    <p className="eyebrow">{session.user.schoolName}</p><h1>{schoolClass.name}</h1><p className="subtitle">{formatDate(date)}</p>
    <label className="search-label" htmlFor="school-register-date">Register date</label><input id="school-register-date" type="date" className="student-search" value={date} max={getToday()} disabled={disabled} onChange={(e) => { if (e.target.value) { setDate(e.target.value); setMessage('') } }} />
    {blocked && <p role="alert">Marking is paused while syncing, or after access expires. Reopen the workspace if needed.</p>}
    <div className="attendance-summary">{statuses.map((status, index) => <div className="summary-card" key={status}><strong>{totals[index]}</strong><span>{status}</span></div>)}</div>
    <p className="overview-coverage">{marked}/{students.length} marked · {row?.draft ? 'Unconfirmed draft' : row?.pending ? 'Waiting to sync' : row?.remote ? `School version ${row.remote.version}` : 'Not started'}</p>
    {row?.issue && <p role="alert">{row.issue} Return to the workspace to review it.</p>}
    <button className="primary-button" disabled={blocked} onClick={() => update(Object.fromEntries(students.map((student) => [student.id, 'Present' as Status])))}>Mark all present</button>
    <p className="helper-text">Applies to the whole class, including hidden students.</p>
    <label className="search-label" htmlFor="school-search">Find a student</label>
    <input id="school-search" className="student-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or student ID" />
    <label className="search-label" htmlFor="school-filter">Show students</label>
    <select id="school-filter" className="student-search" value={filter} onChange={(e) => setFilter(e.target.value)}>{['All', 'Unmarked', ...statuses].map((status) => <option key={status}>{status}</option>)}</select>
    <p className="selection-message">Showing {visible.length} students</p>
    <div className="student-list">{visible.map((student) => <div className="student-row" key={student.id}>
      <div><strong>{student.name}</strong><span className="student-count">{student.id}</span></div>
      <div className="status-options" role="group" aria-label={`Attendance for ${student.name}`}>{statuses.map((status) => <button key={status} className={`status-button ${status.toLowerCase()}`} aria-pressed={marks[student.id] === status} disabled={blocked} onClick={() => update({ ...marks, [student.id]: status })}>{status}</button>)}</div>
    </div>)}</div>
    <div className="action-buttons save-section">
      <button className="primary-button" disabled={blocked || !row?.draft || marked !== students.length} onClick={confirm}>Confirm attendance</button>
      <button className="secondary-button" disabled={!!row?.draft || (!row?.pending && !row?.remote)} onClick={csv}>Download confirmed CSV</button>
    </div>
    <p className="selection-message" role="status">{message}</p>
    <h2>School history cached on this device</h2>
    {history.length === 0 && <p>No school records cached yet. Sync to retrieve them.</p>}
    <div className="class-list">{history.map((entry) => <button className="class-card" key={entry.date} onClick={() => setHistoryDate(entry.date)} aria-pressed={historyDate === entry.date}>{formatDate(entry.date)} · version {entry.remote?.version}</button>)}</div>
    {old && <div className="student-list history-list">{old.record.students.map((student) => <div className="student-row" key={student.id}><strong>{student.name}</strong><span>{old.record.attendance[student.id]}</span></div>)}</div>}
  </section>
}
