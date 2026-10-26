import { useState } from 'react'
import './App.css'
import AttendanceRegister from './AttendanceRegister'

const classes = [
  { name: 'Primary 5', students: 72 },
  { name: 'Primary 6', students: 68 },
  { name: 'Primary 7', students: 81 },
]

function App() {
  const [selectedClass, setSelectedClass] = useState<string | null>(null)

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
        <a className="brand" href="/">neera<span>.</span></a>
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
        <div className="section-heading">
          <h2 id="class-heading">Your classes</h2>
          <p>Choose a class to get started.</p>
        </div>

        <div className="class-list">
          {classes.map((schoolClass) => (
            <button
              key={schoolClass.name}
              className="class-card"
              onClick={() => setSelectedClass(schoolClass.name)}
              aria-pressed={selectedClass === schoolClass.name}
            >
              <span>
                <strong>{schoolClass.name}</strong>
                <span className="student-count">
                  {schoolClass.students} students
                </span>
              </span>
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </div>

        <p className="selection-message" role="status">
          {selectedClass
            ? `${selectedClass} selected. We'll build its register next.`
            : 'Select one of the sample classes above.'}
        </p>
      </section>

      <footer>
        Built for teachers. Made for continuity.
      </footer>
    </main>
  )
}

export default App