import { useState } from 'react'

type Status = 'Present' | 'Absent' | 'Late'

type SavedRegister = {
  date: string
  attendance: Record<string, Status>
}

type Props = {
  className: string
  students: { id: string; name: string }[]
  onBack: () => void
}

function loadHistory(className: string) {
  const registers: SavedRegister[] = []
  let error = ''
  const prefix = `neera:attendance:v2:${className}:`

  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)

      if (!key?.startsWith(prefix)) continue

      try {
        const date = key.slice(prefix.length)

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          throw new Error('Invalid date')
        }

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
        error = 'Some saved registers could not be read.'
      }
    }
  } catch {
    error = 'Could not access saved history in this browser.'
  }

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
          No saved registers yet. Save attendance to see it here.
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
            View only · These are the saved attendance marks.
          </p>

          <div className="student-list">
            {students.map((student) => (
              <div className="student-row" key={student.id}>
                <strong>{student.name}</strong>
                <span>
                  {selected.attendance[student.id] ?? 'Not marked'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </section>
  )
}