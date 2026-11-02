import type { SchoolData } from './schoolStorage'
import type { Status } from './attendanceStorage'

// Calendar days are potential register dates, not assumed school days.
// Without a school calendar we must never turn a missing register into absence.
export function reportDates(start: string, end: string): string[] {
  const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s
  if (!valid(start) || !valid(end) || start > end) throw new Error('Choose a valid start and end date.')
  const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1
  if (days > 366) throw new Error('Choose a range of up to 366 days.')
  return Array.from({ length: days }, (_, i) => new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10))
}
export function buildSchoolReport(data: SchoolData, start: string, end: string) {
  const dates = reportDates(start, end)
  return data.classes.map((cls) => {
    // Only server-confirmed snapshots count. Pending corrections remain separate.
    const entries = data.entries.filter((e) => e.classId === cls.id && e.date >= start && e.date <= end)
    const records = entries.flatMap((e) => e.remote ? [e.remote.record] : []).sort((a, b) => a.date.localeCompare(b.date))
    const totals = { Present: 0, Absent: 0, Late: 0 }
    const students = new Map<string, { id: string; name: string; current: boolean; history: { date: string; name: string; status: Status }[] }>()
    for (const student of cls.students) students.set(student.id, { ...student, current: true, history: [] })
    for (const record of records) for (const student of record.students) {
      const status = record.attendance[student.id]
      totals[status]++
      // IDs, never names, join history; removed pupils retain their saved names.
      const row = students.get(student.id) ?? { ...student, current: false, history: [] }
      if (!row.current) row.name = student.name
      row.history.push({ date: record.date, name: student.name, status })
      students.set(student.id, row)
    }
    const marks = totals.Present + totals.Absent + totals.Late
    const recorded = new Set(records.map((r) => r.date))
    return { id: cls.id, name: cls.name, totals, marks, rate: marks ? 100 * (totals.Present + totals.Late) / marks : null,
      registerCount: records.length, missingDates: dates.filter((date) => !recorded.has(date)),
      pending: entries.filter((e) => e.pending).length, drafts: entries.filter((e) => e.draft).length,
      students: [...students.values()].sort((a, b) => a.name.localeCompare(b.name)) }
  })
}
