import { useState } from 'react'
import AttendanceRegister from './AttendanceRegister'
import SchoolOverview from './SchoolOverview'
import SchoolAccounts from './SchoolAccounts'
import SchoolWorkspace from './SchoolWorkspace'
import BackupRestore from './BackupRestore'
import { classes } from './schoolData'
import './App.css'

export default function App() {
  const [selectedClass, setSelectedClass] = useState<string | null>(null)
  const [showOverview, setShowOverview] = useState(false)

  const [showBackup, setShowBackup] = useState(false)

  const [showAccounts, setShowAccounts] = useState(false)

  const [showSchool, setShowSchool] = useState(false)

  if (showSchool) {
    return <main className="neera"><SchoolWorkspace onBack={() => setShowSchool(false)} onLogin={() => { setShowSchool(false); setShowAccounts(true) }} /></main>
  }

  if (showAccounts) {
    return <main className="neera"><SchoolAccounts onBack={() => setShowAccounts(false)} onOpenSchool={() => { setShowAccounts(false); setShowSchool(true) }} /></main>
  }

  if (showBackup) {
    return <main className="neera"><BackupRestore onBack={() => setShowBackup(false)} /></main>
  }

  if (showOverview) {
    return (
      <main className="neera">
        <SchoolOverview onBack={() => setShowOverview(false)} />
      </main>
    )
  }

  // Remount the register when switching classes so their state stays separate.
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
        <span className="demo-badge">Separate demo</span>
        <div className="action-buttons"><button className="primary-button" onClick={() => setShowSchool(true)}>School workspace</button><button className="secondary-button" onClick={() => setShowAccounts(true)}>School accounts</button></div>
      </header>

      <section className="intro">
        <p className="eyebrow">ANOTHER CHANCE TO LEARN</p>
        <h1>Every student counts.</h1>
        <p className="subtitle">
          A simpler way to take attendance and keep learning going.
        </p>

        <button
          className="secondary-button"
          onClick={() => setShowOverview(true)}
        >
          View school overview →
        </button>
        <button className="secondary-button backup-link" onClick={() => setShowBackup(true)}>
          Backup &amp; restore
        </button>
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