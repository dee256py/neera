import { useState } from 'react'
import type { Student } from './schoolData'

type Status = 'Present' | 'Absent' | 'Late'

type SavedRegister = {
  date: string
  attendance: Record<string, Status>
}

type Props = {
  className: string
  students: Student[]
  onBack: () => void
}

// Require a real calendar date, not just a string shaped like a date.
function isValidDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false

  const parsed = new Date(`${date}T12:00:00Z`)

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  )
}

function loadHistory(className: string) {
  const registers: SavedRegister[] = []
  let error = ''
  const prefix = `neera:attendance:v2:${className}:`

  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)

      // Drafts are unfinished work and must never appear as confirmed history.
      if (!key?.startsWith(prefix) || key.endsWith(':draft')) continue

      try {
        const date = key.slice(prefix.length)

        if (!isValidDate(date)) throw new Error('Invalid date')

        const parsed: unknown = JSON.parse(
          localStorage.getItem(key) ?? 'null',
        )

        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          throw new Error('Invalid register')
        }

        const attendance: Record<string, Status> = {}

        for (const [id, status] of Object.entries(parsed)) {
          if (
            status !== 'Present' &&
            status !== 'Absent' &&
            status !== 'Late'
          ) {
            throw new Error('Invalid status')
          }

          attendance[id] = status
        }

        registers.push({ date, attendance })
      } catch {
        // One damaged record should not prevent other registers from loading.
        error = 'Some saved registers could not be read.'
      }
    }
  } catch {
    error = 'Could not access saved history in this browser.'
  }

  // ISO date strings sort correctly, with the most recent school day first.
  registers.sort((a, b) => b.date.localeCompare(a.date))

  return { registers, error }
}

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export default function AttendanceHistory({
  className,
  students,
  onBack,
}: Props) {
  const [{ registers, error }] = useState(() => loadHistory(className))
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const selected = registers.find(
    (register) => register.date === selectedDate,
  )

  return (
    <section className="attendance">
      <button className="back-button" onClick={onBack}>
        ← Back to register
      </button>

      <p className="eyebrow">SAVED ON THIS DEVICE</p>
      <h1>{className}</h1>
      <h2>Attendance history</h2>

      {error && <p role="alert">{error}</p>}

      {registers.length === 0 && !error && (
        <p className="subtitle">
          No confirmed registers yet. Save attendance to see it here.
        </p>
      )}

      <div className="class-list">
        {registers.map((register) => (
          <button
            key={register.date}
            className="class-card"
            aria-pressed={selectedDate === register.date}
            onClick={() => setSelectedDate(register.date)}
          >
            <strong>{formatDate(register.date)}</strong>
            <span aria-hidden="true">→</span>
          </button>
        ))}
      </div>

      {selected && (
        <section aria-label="Saved attendance">
          <h2>{formatDate(selected.date)}</h2>
          <p className="selection-message">
            View only · Confirmed attendance marks.
          </p>

          <div className="student-list">
            {students.map((student) => {
              const status = selected.attendance[student.id]

              return (
                <div className="student-row" key={student.id}>
                  <div>
                    <strong>{student.name}</strong>
                    <span className="student-count">
                      Student {student.id}
                    </span>
                  </div>
                  <span className={`history-status ${status?.toLowerCase() ?? ''}`}>
                    {status ?? 'Not marked'}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </section>
  )
}
