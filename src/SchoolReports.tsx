import { useState } from 'react'
import type { SchoolData } from './schoolStorage'
import { buildSchoolReport } from './attendanceReportData'
import { getToday, formatDate } from './attendanceStorage'

export default function SchoolReports({ data }: { data: SchoolData }) {
  const today = getToday()
  const [start, setStart] = useState(`${today.slice(0, 7)}-01`)
  const [end, setEnd] = useState(today)
  const [classId, setClassId] = useState('')
  const [studentId, setStudentId] = useState('')
  const [query, setQuery] = useState('')
  let reports: ReturnType<typeof buildSchoolReport> = []
  let error = ''
  try {
    if (end > today) throw new Error('Choose an end date no later than today.')
    reports = buildSchoolReport(data, start, end)
  } catch (cause) { error = cause instanceof Error ? cause.message : 'Check the date range.' }
  const selected = reports.find((r) => r.id === classId)
  const pupil = selected?.students.find((s) => s.id === studentId)
  const history = pupil?.history ?? []
  const present = history.filter((r) => r.status === 'Present').length
  const absent = history.filter((r) => r.status === 'Absent').length
  const late = history.filter((r) => r.status === 'Late').length
  return <section className="backup-panel" aria-labelledby="reports-heading">
    <h2 id="reports-heading">Attendance reports</h2>
    <p>Based on school-confirmed records cached on this device. Use Sync now to refresh. Drafts and queued changes are excluded.</p>
    <div className="report-controls">
      <label>From<input className="student-search" type="date" value={start} max={end || today} onChange={(e) => setStart(e.target.value)} /></label>
      <label>To<input className="student-search" type="date" value={end} min={start} max={today} onChange={(e) => setEnd(e.target.value)} /></label>
    </div>
    {error ? <p role="alert">{error}</p> : <>
      <p>Attendance rate = (present + late) ÷ recorded student marks. Missing registers never count as absences.</p>
      <p>No school calendar is configured: dates without a register may include weekends, holidays or dates before a class existed.</p>
      {!reports.length && <p>No accessible classes to report on.</p>}
      {reports.map((report) => <article className="backup-panel" key={report.id}>
        <h3>{report.name}</h3>
        <p><strong>{report.rate === null ? 'No recorded attendance' : `${report.rate.toFixed(1)}% attendance`}</strong> · {report.registerCount} saved registers</p>
        <p>{report.totals.Present} present · {report.totals.Absent} absent · {report.totals.Late} late student marks</p>
        <p>{report.pending} queued registers · {report.drafts} drafts excluded</p>
        <details><summary>{report.missingDates.length} calendar dates without a cached school register</summary>
          {report.missingDates.length ? <ul>{report.missingDates.map((date) => <li key={date}>{formatDate(date)}</li>)}</ul> : <p>Every date in this range has a register.</p>}
        </details>
        <button className="secondary-button" onClick={() => { setClassId(report.id); setStudentId(''); setQuery('') }}>View student histories for {report.name}</button>
      </article>)}
      {selected && <section aria-labelledby="history-heading">
        <h3 id="history-heading">Student history · {selected.name}</h3>
        <label>Find a student<input type="search" className="student-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name" /></label>
        <label>Student<select className="student-search" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          <option value="">Choose a student</option>
          {selected.students.filter((s) => s.id === studentId || s.name.toLowerCase().includes(query.trim().toLowerCase())).map((s) => <option key={s.id} value={s.id}>{s.name}{s.current ? '' : ' (historical roster)'} · {s.id}</option>)}
        </select></label>
        {pupil && <>
          <h4>{pupil.name}</h4>
          <p>{present} present · {absent} absent · {late} late · {history.length ? `${(100 * (present + late) / history.length).toFixed(1)}% attendance` : 'No recorded attendance in this range'}</p>
          <p>Only registers containing this student’s ID are counted. Names below are the names saved at the time.</p>
          <div className="report-table-wrap"><table className="report-table"><caption>Recorded attendance for {pupil.name}</caption><thead><tr><th scope="col">Date</th><th scope="col">Saved name</th><th scope="col">Status</th></tr></thead><tbody>
            {[...history].reverse().map((row) => <tr key={row.date}><td>{formatDate(row.date)}</td><td>{row.name}</td><td>{row.status}</td></tr>)}
          </tbody></table></div>
        </>}
      </section>}
    </>}
  </section>
}
