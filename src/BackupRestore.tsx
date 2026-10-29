import { useRef, useState } from 'react'
import { createBackup, downloadText, getToday, MAX_BACKUP_BYTES,
  parseBackup, planRestore, restoreBackup } from './attendanceStorage'
import type { Backup } from './attendanceStorage'

type Props = { onBack: () => void }

export default function BackupRestore({ onBack }: Props) {
  const [backup, setBackup] = useState<Backup | null>(null)
  const [preview, setPreview] = useState<ReturnType<typeof planRestore> | null>(null)
  const [message, setMessage] = useState('')
  const [reading, setReading] = useState(false)
  // Ignore a slower previous file read when a different file is selected.
  const selection = useRef(0)

  function exportBackup() {
    try {
      const file = createBackup()
      downloadText(JSON.stringify(file, null, 2), `neera-backup-${getToday()}.json`, 'application/json')
      setMessage(`Download requested: ${file.records.length} records, including drafts. Keep the JSON file somewhere safe.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Backup failed. No records were changed.')
    }
  }

  async function selectFile(file: File | undefined) {
    const request = ++selection.current
    setBackup(null)
    setPreview(null)
    setMessage('')
    if (!file) { setReading(false); return }
    setReading(true)
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Select a backup smaller than 10 MB.')
      const parsed = parseBackup(await file.text())
      if (selection.current !== request) return
      const plan = planRestore(parsed)
      setBackup(parsed)
      setPreview(plan)
    } catch (error) {
      if (selection.current === request) setMessage(error instanceof Error ? error.message : 'Invalid backup.')
    } finally {
      if (selection.current === request) setReading(false)
    }
  }

  function importRecords() {
    if (!backup) return
    try {
      const result = restoreBackup(backup)
      setMessage(`Restored ${result.added} records. Skipped ${result.skipped} existing class/day records. Nothing was overwritten.`)
      setBackup(null)
      setPreview(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Restore failed. No records were changed.')
    }
  }

  return (
    <section className="attendance">
      <button className="back-button" onClick={onBack}>← Back to classes</button>
      <p className="eyebrow">RECORDS ON THIS DEVICE</p>
      <h1>Backup &amp; restore.</h1>
      <p className="subtitle">Keep a recoverable copy of confirmed attendance and unfinished drafts.</p>
      <section className="backup-panel" aria-labelledby="download-heading">
        <h2 id="download-heading">Download a backup</h2>
        <p>JSON preserves attendance and student snapshots. CSV remains available in each register for reports.</p>
        <button className="primary-button" onClick={exportBackup}>Download JSON backup</button>
      </section>
      <section className="backup-panel" aria-labelledby="restore-heading">
        <h2 id="restore-heading">Restore from a backup</h2>
        <p>Select a Neera JSON backup to review it before importing. Existing class/day records are always skipped.</p>
        <label className="search-label" htmlFor="backup-file">Choose JSON backup (maximum 10 MB)</label>
        <input id="backup-file" type="file" accept=".json,application/json"
          onChange={(event) => void selectFile(event.target.files?.[0])} />
        {reading && <p role="status">Checking backup…</p>}
        {backup && preview && (
          <div className="restore-preview">
            <h3>Review import</h3>
            <p>{backup.records.length} records in file · {preview.additions.length} to import · {preview.skipped.length} skipped</p>
            <p>Backup created: {new Date(backup.exportedAt).toLocaleString('en-GB')}</p>
            <p>Conflicts are checked again when you click Import. This restores records; it does not edit your current class rosters.</p>
            <details>
              <summary>Show records to import or skip</summary>
              <ul>
                {preview.additions.map((row) => <li key={JSON.stringify([row.className, row.date, row.kind])}>
                  Import: {row.className} · {row.date} · {row.kind} · {row.students.length} students
                </li>)}
                {preview.skipped.map((row) => <li key={JSON.stringify([row.className, row.date, row.kind])}>
                  Skip: {row.className} · {row.date} · {row.kind} (class/day already exists)
                </li>)}
              </ul>
            </details>
            <div className="action-buttons">
              <button className="primary-button" disabled={!preview.additions.length || reading} onClick={importRecords}>
                Import {preview.additions.length} records
              </button>
              <button className="secondary-button" onClick={() => { setBackup(null); setPreview(null) }}>Cancel</button>
            </div>
          </div>
        )}
      </section>
      <p className="selection-message" role="status">{message}</p>
      <p className="storage-note">Backups contain student names and attendance in plain text. They are not encrypted or automatically uploaded. Store them somewhere appropriate. Old v2 records cannot recover names that were never stored; reconstructed rosters are labelled in history.</p>
    </section>
  )
}
