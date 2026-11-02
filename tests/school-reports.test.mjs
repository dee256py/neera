import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import ts from '../node_modules/typescript/lib/typescript.js'
const dir = new URL('../node_modules/.tmp/neera-report-tests/', import.meta.url)
mkdirSync(dir, { recursive: true })
writeFileSync(new URL('schoolReports.mjs', dir), ts.transpileModule(readFileSync(new URL('../src/attendanceReportData.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText)
const { buildSchoolReport, reportDates } = await import(new URL('schoolReports.mjs', dir))
const cls = { id: 'a', name: 'Class A', students: [{ id: '1', name: 'New name' }, { id: '3', name: 'New pupil' }] }
const record = { date: '2026-10-01', students: [{ id: '1', name: 'Old name' }, { id: '2', name: 'Former pupil' }], attendance: { '1': 'Late', '2': 'Absent' } }
const row = { classId: 'a', date: record.date, remote: { record }, pending: { record: { ...record, attendance: { '1': 'Present', '2': 'Present' } } } }
const data = { classes: [cls], entries: [row] }
test('confirmed snapshots supply totals; queues excluded and missing days are not absences', () => {
 const [r] = buildSchoolReport(data, '2026-10-01', '2026-10-03')
 assert.deepEqual(r.totals, { Present: 0, Absent: 1, Late: 1 }); assert.equal(r.rate, 50)
 assert.deepEqual(r.missingDates, ['2026-10-02', '2026-10-03']); assert.equal(r.pending, 1)
})
test('IDs preserve historical names and removed pupils without inventing new pupil absences', () => {
 const [r] = buildSchoolReport(data, record.date, record.date)
 assert.equal(r.students.find(s => s.id === '1').history[0].name, 'Old name')
 assert.equal(r.students.find(s => s.id === '2').current, false)
 assert.equal(r.students.find(s => s.id === '3').history.length, 0)
})
test('inaccessible classes and out-of-range records never contribute', () => {
 assert.equal(buildSchoolReport({ ...data, classes: [] }, record.date, record.date).length, 0)
 const [r] = buildSchoolReport(data, '2026-10-02', '2026-10-02')
 assert.equal(r.rate, null); assert.equal(r.marks, 0)
})
test('draft-only and queued-only dates remain missing school registers', () => {
 const [r] = buildSchoolReport({ ...data, entries: [{ classId: 'a', date: record.date, draft: { record }, pending: { record } }] }, record.date, record.date)
 assert.equal(r.registerCount, 0); assert.equal(r.missingDates.length, 1); assert.equal(r.drafts, 1)
})
test('inclusive leap dates; invalid, reversed and excessive ranges rejected', () => {
 assert.deepEqual(reportDates('2024-02-28', '2024-03-01'), ['2024-02-28', '2024-02-29', '2024-03-01'])
 for (const range of [['2026-02-30', '2026-03-01'], ['', '2026-01-01'], ['2026-10-02','2026-10-01'], ['2025-01-01','2026-12-31']]) assert.throws(() => reportDates(...range))
})
