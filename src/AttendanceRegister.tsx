import { useState } from 'react'
import AttendanceHistory from './AttendanceHistory'
import { classes } from './schoolData'
import type { Student } from './schoolData'

type Status = 'Present' | 'Absent' | 'Late'
type Attendance = Record<string, Status>

type Props = {
  className: string
  onBack: () => void
}

type ReadResult = {
  attendance: Attendance
  error: string
}

type Filter = 'All' | 'Unmarked' | Status

const statuses: Status[] = ['Present', 'Absent', 'Late']
const filters: Filter[] = ['All', 'Unmarked', ...statuses]

// Use the local calendar date instead of UTC, which can select the wrong
// school day near midnight.
function getToday() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

// Browser storage can contain outdated or invalid data. Validate it before
// using it, and only load attendance belonging to the current roster.
function readAttendance(key: string, students: Student[]): ReadResult {
  try {
    const raw = localStorage.getItem(key)

    if (raw === null) return { attendance: {}, error: '' }

    const parsed: unknown = JSON.parse(raw)

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error('Invalid register')
    }

    const attendance: Attendance = {}

    for (const student of students) {
      const value = (parsed as Record<string, unknown>)[student.id]

      if (value === undefined) continue

      if (value !== 'Present' && value !== 'Absent' && value !== 'Late') {
        throw new Error('Invalid attendance status')
      }

      attendance[student.id] = value
    }

    return { attendance, error: '' }
  } catch {
    return {
      attendance: {},
      error: 'Could not read saved attendance. Review the register carefully.',
    }
  }
}

function loadInitialAttendance(
  storageKey: string,
  draftKey: string,
  students: Student[],
) {
  try {
    // Recover unfinished changes before loading the last confirmed register.
    if (localStorage.getItem(draftKey) !== null) {
      const draft = readAttendance(draftKey, students)

      if (!draft.error) {
        return {
          attendance: draft.attendance,
          isDraft: true,
          message: 'Recovered your unfinished draft. Review and save it.',
        }
      }

      // A damaged draft should not hide a readable confirmed register.
      const saved = readAttendance(storageKey, students)

      return {
        attendance: saved.attendance,
        isDraft: false,
        message:
          'Could not recover the draft. ' +
          (saved.error || 'Loaded confirmed attendance where available.'),
      }
    }

    const saved = readAttendance(storageKey, students)

    return {
      attendance: saved.attendance,
      isDraft: false,
      message: saved.error,
    }
  } catch {
    return {
      attendance: {} as Attendance,
      isDraft: false,
      message: 'Could not access browser storage. Saving may be unavailable.',
    }
  }
}

// CSV fields must escape quotes. Prefix formula-like values so spreadsheet
// apps treat them as text rather than executable formulas.
function csvCell(value: string) {
  const safe = /^\s*[=+\-@]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

export default function AttendanceRegister({ className, onBack }: Props) {
  const students =
    classes.find((schoolClass) => schoolClass.name === className)
      ?.students ?? []

  const [date] = useState(getToday)

  // Drafts and confirmed registers have separate keys. History reads only
  // confirmed keys, so unfinished work never appears as completed attendance.
  const storageKey = `neera:attendance:v2:${className}:${date}`
  const draftKey = `${storageKey}:draft`

  const [initial] = useState(() =>
    loadInitialAttendance(storageKey, draftKey, students),
  )
  const [attendance, setAttendance] = useState<Attendance>(initial.attendance)
  const [message, setMessage] = useState(initial.message)
  const [hasChanges, setHasChanges] = useState(initial.isDraft)
  const [showHistory, setShowHistory] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<Filter>('All')

  // Calculate totals from the full roster, independently of visible filters.
  const marked = students.filter(
    (student) => attendance[student.id] !== undefined,
  ).length
  const complete = students.length > 0 && marked === students.length

  const totals = {
    Present: 0,
    Absent: 0,
    Late: 0,
  }

  for (const student of students) {
    const status = attendance[student.id]
    if (status) totals[status] += 1
  }

  const query = search.trim().toLowerCase()

  const filteredStudents = students.filter((student) => {
    const matchesSearch =
      student.name.toLowerCase().includes(query) ||
      student.id.toLowerCase().includes(query)

    const matchesStatus =
      statusFilter === 'All' ||
      (statusFilter === 'Unmarked'
        ? attendance[student.id] === undefined
        : attendance[student.id] === statusFilter)

    return matchesSearch && matchesStatus
  })

  function updateAttendance(updated: Attendance) {
    // Prevent an open tab from recording today's changes under yesterday.
    if (date !== getToday()) {
      setMessage('The date has changed. Go back and reopen this class.')
      return
    }

    setAttendance(updated)
    setHasChanges(true)

    // Save immediately after each marking action, without requiring internet.
    try {
      localStorage.setItem(draftKey, JSON.stringify(updated))
      setMessage('Draft saved on this device. Not yet confirmed.')
    } catch {
      setMessage(
        'Draft saving failed. Keep this page open and try Save attendance.',
      )
    }
  }

  function markStudent(id: string, status: Status) {
    updateAttendance({ ...attendance, [id]: status })
  }

  function markAllPresent() {
    const updated: Attendance = {}

    // This deliberately applies to everyone, including students hidden
    // by the current search or filter.
    students.forEach((student) => {
      updated[student.id] = 'Present'
    })

    updateAttendance(updated)
  }

  function saveAttendance() {
    if (date !== getToday()) {
      setMessage('The date has changed. Go back and reopen this class.')
      return
    }

    if (!complete) return

    try {
      localStorage.setItem(storageKey, JSON.stringify(attendance))
    } catch {
      setMessage('Saving failed. Keep this page open and try again.')
      return
    }

    setHasChanges(false)

    // Only remove the draft after the confirmed register has been written.
    try {
      localStorage.removeItem(draftKey)
      setMessage('Attendance confirmed and saved on this device.')
    } catch {
      setMessage(
        'Attendance confirmed, but the draft could not be cleared. ' +
        'A draft recovery notice may appear when reopening.',
      )
    }
  }

  function exportCsv() {
    // Export only confirmed attendance, always for the entire class.
    if (!complete || hasChanges) return

    const rows: string[][] = [
      ['Date', 'Class', 'Student ID', 'Student name', 'Status'],
      ...students.map((student) => [
        date,
        className,
        student.id,
        student.name,
        attendance[student.id] ?? '',
      ]),
    ]

    const csv = rows
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n')

    // The UTF-8 marker helps Excel display names correctly.
    const blob = new Blob(['\uFEFF', csv], {
      type: 'text/csv;charset=utf-8;',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download =
      `neera-${className.toLowerCase().replace(/\s+/g, '-')}-${date}.csv`

    document.body.appendChild(link)
    link.click()
    link.remove()

    // Release the temporary download URL after the browser has used it.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('CSV download requested for the confirmed register.')
  }

  function goBack() {
    if (
      hasChanges &&
      !window.confirm(
        'Leave with unconfirmed changes? Successfully saved drafts ' +
        'will be available when you return.',
      )
    ) {
      return
    }

    onBack()
  }

  // All hooks are above this conditional return so their order stays stable.
  if (showHistory) {
    return (
      <AttendanceHistory
        className={className}
        students={students}
        onBack={() => setShowHistory(false)}
      />
    )
  }

  return (
    <section className="attendance">
      <div className="register-navigation">
        <button className="back-button" onClick={goBack}>
          ← Back to classes
        </button>
        <button
          className="back-button"
          onClick={() => setShowHistory(true)}
        >
          View saved history →
        </button>
      </div>

      <p className="eyebrow">
        SAMPLE REGISTER · {students.length} DEMO STUDENTS
      </p>
      <h1>{className}</h1>
      <p className="subtitle">{formatDate(date)}</p>

      <div className="attendance-summary" aria-label="Attendance totals">
        {statuses.map((status) => (
          <div className="summary-card" key={status}>
            <strong>{totals[status]}</strong>
            <span>{status}</span>
          </div>
        ))}
      </div>

      <button
        className="primary-button"
        onClick={markAllPresent}
        disabled={students.length === 0}
      >
        Mark all present
      </button>
      <p className="helper-text">Applies to the whole class.</p>

      <p className="progress">
        {marked} of {students.length} students marked
        {hasChanges && ' · Awaiting confirmation'}
      </p>

      <div className="register-tools">
        <label className="search-label" htmlFor="student-search">
          Find a student
        </label>
        <input
          id="student-search"
          className="student-search"
          type="search"
          placeholder="Search name or student ID"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <label className="search-label" htmlFor="status-filter">
          Show students
        </label>
        <select
          id="status-filter"
          className="student-search"
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as Filter)
          }
        >
          {filters.map((filter) => (
            <option key={filter} value={filter}>
              {filter === 'All' ? 'Everyone' : filter}
            </option>
          ))}
        </select>

        <p className="selection-message" role="status">
          Showing {filteredStudents.length} of {students.length} students
        </p>

        {(search || statusFilter !== 'All') && (
          <button
            className="secondary-button"
            onClick={() => {
              setSearch('')
              setStatusFilter('All')
            }}
          >
            Clear search and filter
          </button>
        )}
      </div>

      {filteredStudents.length === 0 && (
        <p className="selection-message">
          No students match. Clear the search and filter to see everyone.
        </p>
      )}

      <div className="student-list">
        {filteredStudents.map((student) => (
          <div className="student-row" key={student.id}>
            <div>
              <strong>{student.name}</strong>
              <span className="student-count">Student {student.id}</span>
            </div>

            <div
              className="status-options"
              role="group"
              aria-label={`Attendance for ${student.name}`}
            >
              {statuses.map((status) => (
                <button
                  key={status}
                  className={`status-button ${status.toLowerCase()}`}
                  aria-pressed={attendance[student.id] === status}
                  onClick={() => markStudent(student.id, status)}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="save-section">
        <div className="action-buttons">
          <button
            className="primary-button"
            disabled={!complete || !hasChanges}
            onClick={saveAttendance}
          >
            Save attendance
          </button>
          <button
            className="secondary-button"
            disabled={!complete || hasChanges}
            onClick={exportCsv}
          >
            Download CSV
          </button>
        </div>

        {!complete && (
          <p className="selection-message">
            Mark every student to enable confirmation and CSV export.
          </p>
        )}

        <p className="selection-message" role="status">
          {message}
        </p>
      </div>

      <p className="storage-note">
        Saved in this browser on this device only. Clearing site data
        can remove records. School syncing is not connected yet.
      </p>
    </section>
  )
}