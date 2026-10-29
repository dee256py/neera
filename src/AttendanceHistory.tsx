import { useState } from 'react'
import { listRegisters, formatDate } from './attendanceStorage'

type Props = { className: string; onBack: () => void }

function loadHistory(className: string) {
  const data = listRegisters()
  return {
    registers: data.records.filter((row) => row.className === className && row.kind === 'confirmed')
      .sort((a, b) => b.date.localeCompare(a.date)),
    error: data.warnings.join(' '),
  }
}

export default function AttendanceHistory({
  className,
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
            {selected.rosterSource === 'legacy-reconstructed' &&
              ' Older record: names reconstructed from the current roster; historical names were not stored.'}
          </p>

          <div className="student-list">
            {selected.students.map((student) => {
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
