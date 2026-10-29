import { useState } from 'react'
import { classes } from './schoolData'
import type { Student } from './schoolData'
import { listRegisters, getToday } from './attendanceStorage'

type ClassSummary = {
  name: string
  state: 'Confirmed' | 'Not confirmed' | 'Needs review'
  present: number
  absent: number
  late: number
  absentStudents: Student[]
}

type Props = {
  onBack: () => void
}

function loadOverview() {
  const date = getToday()
  const summaries: ClassSummary[] = []
  const data = listRegisters()
  // Include restored classes even when they are no longer in the demo roster.
  const names = [...new Set([...classes.map((row) => row.name),
    ...data.records.filter((row) => row.date === date).map((row) => row.className)])]

  for (const name of names) {
    const summary: ClassSummary = {
      name,
      state: 'Not confirmed',
      present: 0,
      absent: 0,
      late: 0,
      absentStudents: [],
    }

    const record = data.records.find((row) => row.className === name && row.date === date && row.kind === 'confirmed')
    if (record) {
      summary.state = 'Confirmed'
      for (const student of record.students) {
        const status = record.attendance[student.id]
        if (status === 'Present') summary.present += 1
        if (status === 'Late') summary.late += 1
        if (status === 'Absent') {
          summary.absent += 1
          summary.absentStudents.push(student)
        }
      }
    } else if (data.warnings.length) {
      summary.state = 'Needs review'
    }

    summaries.push(summary)
  }

  return { date, summaries, warnings: data.warnings }
}

export default function SchoolOverview({ onBack }: Props) {
  const [overview, setOverview] = useState(loadOverview)

  const confirmed = overview.summaries.filter(
    (summary) => summary.state === 'Confirmed',
  )

  const totals = confirmed.reduce(
    (result, summary) => ({
      present: result.present + summary.present,
      absent: result.absent + summary.absent,
      late: result.late + summary.late,
    }),
    { present: 0, absent: 0, late: 0 },
  )

  const confirmedStudents = totals.present + totals.absent + totals.late
  const totalStudents = overview.summaries.reduce((total, summary) => {
    if (summary.state === 'Confirmed') return total + summary.present + summary.absent + summary.late
    return total + (classes.find((row) => row.name === summary.name)?.students.length ?? 0)
  }, 0)

  const dateLabel = new Date(
    `${overview.date}T12:00:00`,
  ).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <section className="attendance">
      <div className="register-navigation">
        <button className="back-button" onClick={onBack}>
          ← Back to classes
        </button>

        <button
          className="secondary-button"
          onClick={() => setOverview(loadOverview())}
        >
          Refresh overview
        </button>
      </div>

      <p className="eyebrow">SCHOOL DEMO · THIS DEVICE ONLY</p>
      <h1>Today at a glance.</h1>
      <p className="subtitle">{dateLabel}</p>

      {overview.warnings.length > 0 && <p role="alert">{overview.warnings.join(' ')}</p>}
      <p className="overview-coverage" role="status">
        {confirmed.length} of {overview.summaries.length} classes confirmed ·{' '}
        {confirmedStudents} of {totalStudents} students covered
      </p>

      <div className="attendance-summary" aria-label="Confirmed attendance">
        <div className="summary-card">
          <strong>{totals.present}</strong>
          <span>Present</span>
        </div>
        <div className="summary-card">
          <strong>{totals.absent}</strong>
          <span>Absent</span>
        </div>
        <div className="summary-card">
          <strong>{totals.late}</strong>
          <span>Late</span>
        </div>
      </div>

      <p className="helper-text">
        Totals include confirmed registers only. Late students are shown
        separately from students marked present.
      </p>

      <h2>Class registers</h2>

      <div className="student-list">
        {overview.summaries.map((summary) => (
          <div className="student-row" key={summary.name}>
            <div>
              <strong>{summary.name}</strong>
              {summary.state === 'Confirmed' && (
                <span className="student-count">
                  {summary.present} present · {summary.absent} absent ·{' '}
                  {summary.late} late
                </span>
              )}
            </div>

            <span className="overview-state">{summary.state}</span>
          </div>
        ))}
      </div>

      <h2>Absent students</h2>

      {totals.absent === 0 ? (
        <p className="selection-message">
          {confirmed.length === 0
            ? 'Confirm a register to see absence information.'
            : 'No absences in the confirmed registers.'}
        </p>
      ) : (
        <div className="student-list">
          {confirmed.flatMap((summary) =>
            summary.absentStudents.map((student) => (
              <div
                className="student-row"
                key={`${summary.name}-${student.id}`}
              >
                <div>
                  <strong>{student.name}</strong>
                  <span className="student-count">
                    {summary.name} · Student {student.id}
                  </span>
                </div>

                <span className="history-status absent">Absent</span>
              </div>
            )),
          )}
        </div>
      )}

      <p className="storage-note">
        This overview reads confirmed attendance from this browser.
        Shared school records and secure admin access are not connected yet.
        “Needs review” means a record could not be read or was incomplete.
      </p>
    </section>
  )
}