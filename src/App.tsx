import { useState } from 'react'
import AttendanceRegister from './AttendanceRegister'
import { classes } from './schoolData'
import './App.css'

export default function App() {
  const [selectedClass, setSelectedClass] = useState<string | null>(null)

  // A new component instance is created for each class so attendance state
  // cannot carry over accidentally when switching classes.
  if (selectedClass) {
    return (
      <main className="neera">
        <AttendanceRegister
          key={selectedClass}
          className={selectedClass}
          onBack={() => setSelectedClass(null)}
        />
      </main>
    )
  }

  return (
    <main className="neera">
      <header className="header">
        <span className="brand">
          neera<span>.</span>
        </span>
        <span className="demo-badge">Teacher demo</span>
      </header>

      <section className="intro">
        <p className="eyebrow">ANOTHER CHANCE TO LEARN</p>
        <h1>Every student counts.</h1>
        <p className="subtitle">
          A simpler way to take attendance and keep learning going.
        </p>
      </section>

      <section className="register" aria-labelledby="class-heading">
        <h2 id="class-heading">Your classes</h2>
        <p className="muted">Choose a class to get started.</p>

        <div className="class-list">
          {classes.map((schoolClass) => (
            <button
              key={schoolClass.name}
              className="class-card"
              onClick={() => setSelectedClass(schoolClass.name)}
            >
              <span>
                <strong>{schoolClass.name}</strong>
                <span className="student-count">
                  {schoolClass.students.length} students
                </span>
              </span>
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      </section>

      <footer>Built for teachers. Made for continuity.</footer>
    </main>
  )
}