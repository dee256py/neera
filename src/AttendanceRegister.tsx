import { useState } from 'react'
import AttendanceHistory from './AttendanceHistory'

type Status = 'Present' | 'Absent' | 'Late'
type Attendance = Record<string, Status>

type Props = {
  className: string
  onBack: () => void
}

const students = [
  { id: '001', name: 'Amina Nakato' },
  { id: '002', name: 'Daniel Kato' },
  { id: '003', name: 'Grace Namuli' },
  { id: '004', name: 'Samuel Okello' },
]

const options: Status[] = ['Present', 'Absent', 'Late']

// Use the device's local calendar date.
function getToday() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

// Check stored data before using it.
function readAttendance(key: string): {
  attendance: Attendance
  message: string
} {
  try {
    const stored = localStorage.getItem(key)

    if (!stored) {
      return { attendance: {}, message: '' }
    }

    const parsed: unknown = JSON.parse(stored)

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

      if (
        value !== 'Present' &&
        value !== 'Absent' &&
        value !== 'Late'
      ) {
        throw new Error('Invalid attendance status')
      }

      attendance[student.id] = value
    }

    return {
      attendance,
      message: 'Loaded the saved register for this class and date.',
    }
  } catch {
    return {
      attendance: {},
      message:
        'Could not load saved attendance. Check this register before saving.',
    }
  }
}

export default function AttendanceRegister({
  className,
  onBack,
}: Props) {
  const [date] = useState(getToday)
  const storageKey = `neera:attendance:v1:${className}:${date}`

  const [initial] = useState(() => readAttendance(storageKey))
  const [attendance, setAttendance] = useState<Attendance>(
    initial.attendance,
  )
  const [message, setMessage] = useState(initial.message)
  const [hasChanges, setHasChanges] = useState(false)
    const [showHistory, setShowHistory] = useState(false)

  if (showHistory) {
    return (
      <AttendanceHistory
        className={className}
        students={students}
        onBack={() => setShowHistory(false)}
      />
    )
  }

  const marked = Object.keys(attendance).length
  const complete = marked === students.length

  const totals = {
    Present: Object.values(attendance).filter(
      (status) => status === 'Present',
    ).length,
    Absent: Object.values(attendance).filter(
      (status) => status === 'Absent',
    ).length,
    Late: Object.values(attendance).filter(
      (status) => status === 'Late',
    ).length,
  }

  function markStudent(id: string, status: Status) {
    setAttendance((previous) => ({
      ...previous,
      [id]: status,
    }))
    setHasChanges(true)
    setMessage('')
  }

  function markAllPresent() {
    const updated: Attendance = {}

    students.forEach((student) => {
      updated[student.id] = 'Present'
    })

    setAttendance(updated)
    setHasChanges(true)
    setMessage('')
  }

  function saveAttendance() {
    // Avoid saving yesterday's register after leaving the page open.
    if (date !== getToday()) {
      setMessage(
        'The date has changed. Go back and reopen the class for today.',
      )
      return
    }

    if (!complete) return

    try {
      localStorage.setItem(storageKey, JSON.stringify(attendance))
      setHasChanges(false)
      setMessage(
        'Attendance saved in this browser. You can reopen it here.',
      )
    } catch {
      setMessage(
        'Saving failed. Keep this page open and try saving again.',
      )
    }
  }

  function goBack() {
    if (
      hasChanges &&
      !window.confirm('Leave this register without saving your changes?')
    ) {
      return
    }

    onBack()
  }

  return (
    <section className="attendance">
      <button className="back-button" onClick={goBack}>
        ← Back to classes
      </button>
      
      <div>
        <button className="back-button" onClick={() => setShowHistory(true)}>
          View saved history →
        </button>
      </div>

      <p className="eyebrow">SAMPLE REGISTER · 4 DEMO STUDENTS</p>
      <h1>{className}</h1>

      <p className="subtitle">
        {new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      </p>

      <div className="attendance-summary" aria-label="Attendance totals">
        {options.map((status) => (
          <div className="summary-card" key={status}>
            <strong>{totals[status]}</strong>
            <span>{status}</span>
          </div>
        ))}
      </div>

      <button className="primary-button" onClick={markAllPresent}>
        Mark all present
      </button>

      <p className="progress">
        {marked} of {students.length} students marked
        {hasChanges && ' · Unsaved changes'}
      </p>

      <div className="student-list">
        {students.map((student) => (
          <div className="student-row" key={student.id}>
            <div>
              <strong>{student.name}</strong>
              <span className="student-count">
                Student {student.id}
              </span>
            </div>

            <div
              className="status-options"
              role="group"
              aria-label={`Attendance for ${student.name}`}
            >
              {options.map((status) => (
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
        <button
          className="primary-button"
          disabled={!complete || !hasChanges}
          onClick={saveAttendance}
        >
          Save attendance
        </button>

        {!complete && (
          <p className="selection-message">
            Mark every student to enable saving.
          </p>
        )}

        <p className="selection-message" role="status">
          {message}
        </p>
      </div>

      <p className="storage-note">
        Saved on this browser and device only. School syncing is not
        connected yet.
      </p>
    </section>
  )
}