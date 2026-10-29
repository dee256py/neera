import { classes } from './schoolData'
import type { Student } from './schoolData'

export type Status = 'Present' | 'Absent' | 'Late'
export type Attendance = Record<string, Status>
export type Register = {
  className: string
  date: string
  kind: 'draft' | 'confirmed'
  students: Student[]
  attendance: Attendance
  rosterSource: 'captured' | 'legacy-reconstructed'
}
export type Backup = { app: 'Neera'; version: 1; exportedAt: string; records: Register[] }

type Database = { version: 3; records: Register[]; ignoredLegacy: string[] }
const DATABASE_KEY = 'neera:database:v3'
const LEGACY_PREFIX = 'neera:attendance:v2:'
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024

export function getToday() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.')
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('Invalid name or ID.')
  // Reject special object-property names when IDs are used as lookup keys.
  if (['__proto__', 'prototype', 'constructor'].includes(value)) throw new Error('Unsupported identifier.')
  return value
}

function isStatus(value: unknown): value is Status {
  return value === 'Present' || value === 'Absent' || value === 'Late'
}

// All storage readers and importers use this validator. A confirmed record
// must include exactly one valid mark for every student in its snapshot.
export function validateRegister(value: unknown): Register {
  const row = object(value)
  const className = text(row.className)
  if (!isDate(row.date)) throw new Error('Invalid register date.')
  if (row.kind !== 'draft' && row.kind !== 'confirmed') throw new Error('Invalid register kind.')
  if (row.rosterSource !== 'captured' && row.rosterSource !== 'legacy-reconstructed') throw new Error('Invalid roster source.')
  if (!Array.isArray(row.students) || row.students.length === 0 || row.students.length > 1000) throw new Error('Invalid roster size.')
  const ids = new Set<string>()
  const students = row.students.map((entry) => {
    const student = object(entry)
    const id = text(student.id)
    if (ids.has(id)) throw new Error('Duplicate student ID.')
    ids.add(id)
    return { id, name: text(student.name) }
  })
  const marks = object(row.attendance)
  const attendance: Attendance = {}
  for (const [id, status] of Object.entries(marks)) {
    if (!ids.has(id) || !isStatus(status)) throw new Error('Invalid attendance mark or unknown student.')
    attendance[id] = status
  }
  if (row.kind === 'confirmed' && Object.keys(attendance).length !== students.length) throw new Error('Confirmed register is incomplete.')
  return { className, date: row.date, kind: row.kind, students, attendance, rosterSource: row.rosterSource }
}

function groupKey(row: Pick<Register, 'className' | 'date'>) {
  return JSON.stringify([row.className, row.date])
}
function recordKey(row: Register) { return JSON.stringify([row.className, row.date, row.kind]) }

function validateRecords(value: unknown): Register[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Invalid record list.')
  const keys = new Set<string>()
  return value.map((entry) => {
    const row = validateRegister(entry)
    const key = recordKey(row)
    if (keys.has(key)) throw new Error('Duplicate class/date/kind in records.')
    keys.add(key)
    return row
  })
}

function readDatabase(): Database {
  const raw = localStorage.getItem(DATABASE_KEY)
  if (raw === null) return { version: 3, records: [], ignoredLegacy: [] }
  const db = object(JSON.parse(raw))
  if (db.version !== 3 || !Array.isArray(db.ignoredLegacy) ||
      !db.ignoredLegacy.every((key) => typeof key === 'string' && key.startsWith(LEGACY_PREFIX))) {
    throw new Error('The local database is unreadable. No records were changed.')
  }
  return { version: 3, records: validateRecords(db.records), ignoredLegacy: db.ignoredLegacy as string[] }
}

function readLegacy(key: string): Register {
  const match = key.slice(LEGACY_PREFIX.length).match(/^(.*):(\d{4}-\d{2}-\d{2})(:draft)?$/)
  if (!match) throw new Error('Unrecognised legacy key.')
  const [, className, date, draft] = match
  const marks = object(JSON.parse(localStorage.getItem(key) ?? 'null'))
  const current = classes.find((row) => row.name === className)?.students ?? []
  // v2 never saved names. Retain all marked IDs, including removed students,
  // and disclose that historical names could not be recovered exactly.
  const students = current.filter((student) => draft || Object.hasOwn(marks, student.id)).map((student) => ({ ...student }))
  for (const id of Object.keys(marks)) {
    if (!students.some((student) => student.id === id)) students.push({ id, name: `Student ${id} (legacy name unavailable)` })
  }
  return validateRegister({ className, date, kind: draft ? 'draft' : 'confirmed',
    students, attendance: marks, rosterSource: 'legacy-reconstructed' })
}

// Reading is side-effect free. v2 keys remain intact, and valid records are
// copied into v3 only when the teacher next saves or restores data.
function collect() {
  const db = readDatabase()
  const records = [...db.records]
  const keys = new Set(records.map(recordKey))
  const ignored = new Set(db.ignoredLegacy)
  const legacyKeys: string[] = []
  const warnings: string[] = []
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (!key?.startsWith(LEGACY_PREFIX) || ignored.has(key)) continue
    try {
      const row = readLegacy(key)
      legacyKeys.push(key)
      if (!keys.has(recordKey(row))) {
        records.push(row)
        keys.add(recordKey(row))
      }
    } catch {
      warnings.push(`Could not read older register: ${key.slice(LEGACY_PREFIX.length)}.`)
    }
  }
  return { records, warnings, ignoredLegacy: [...new Set([...db.ignoredLegacy, ...legacyKeys])] }
}

export function listRegisters() {
  try {
    return collect()
  } catch {
    return { records: [] as Register[], warnings: ['Could not read browser attendance storage.'], ignoredLegacy: [] as string[] }
  }
}

function writable() {
  const data = collect()
  // Do not silently drop an unreadable legacy record during migration/export.
  if (data.warnings.length) throw new Error('Older records need review before saving or backing up. Existing data was not changed.')
  return data
}

function commit(records: Register[], ignoredLegacy: string[]) {
  const db: Database = { version: 3, records: validateRecords(records), ignoredLegacy }
  // One setItem replaces the whole database atomically. On quota/write failure,
  // the previous value remains intact; no partial restore is published.
  localStorage.setItem(DATABASE_KEY, JSON.stringify(db))
}

export function saveRegister(record: Register) {
  const row = validateRegister(record)
  const data = writable()
  const retained = data.records.filter((existing) => {
    if (recordKey(existing) === recordKey(row)) return false
    return !(row.kind === 'confirmed' && existing.kind === 'draft' && groupKey(existing) === groupKey(row))
  })
  commit([...retained, row], data.ignoredLegacy)
}

export function loadRegister(className: string, date: string) {
  const data = listRegisters()
  const records = data.records.filter((row) => row.className === className && row.date === date)
  return { record: records.find((row) => row.kind === 'draft') ?? records.find((row) => row.kind === 'confirmed'), warnings: data.warnings }
}

export function createBackup(): Backup {
  const { records } = writable()
  return { app: 'Neera', version: 1, exportedAt: new Date().toISOString(), records }
}

export function parseBackup(raw: string): Backup {
  if (new Blob([raw]).size > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 10 MB limit.')
  const file = object(JSON.parse(raw))
  if (file.app !== 'Neera' || file.version !== 1) throw new Error('Select a supported Neera JSON backup (version 1).')
  if (typeof file.exportedAt !== 'string' || Number.isNaN(Date.parse(file.exportedAt))) throw new Error('Invalid backup timestamp.')
  return { app: 'Neera', version: 1, exportedAt: file.exportedAt, records: validateRecords(file.records) }
}

export function planRestore(backup: Backup) {
  const data = writable()
  // If any data exists for a class/day, skip the entire incoming class/day.
  // An imported draft must not mask an existing confirmed register either.
  const existing = new Set(data.records.map(groupKey))
  const records = validateRecords(backup.records)
  const additions = records.filter((row) => !existing.has(groupKey(row)))
  const skipped = records.filter((row) => existing.has(groupKey(row)))
  return { additions, skipped }
}

export function restoreBackup(backup: Backup) {
  // Re-check conflicts at click time: a preview is not authority to overwrite.
  const data = writable()
  const existing = new Set(data.records.map(groupKey))
  const records = validateRecords(backup.records)
  const additions = records.filter((row) => !existing.has(groupKey(row)))
  if (additions.length) commit([...data.records, ...additions], data.ignoredLegacy)
  return { added: additions.length, skipped: records.length - additions.length }
}

export function downloadText(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
