import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import ts from '../node_modules/typescript/lib/typescript.js'

// Compile just the pure storage module; no browser or extra test dependency.
mkdirSync(new URL('../node_modules/.tmp/neera-storage-tests/', import.meta.url), { recursive: true })
for (const name of ['schoolData', 'attendanceStorage']) {
  const source = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
    .replaceAll("'./schoolData'", "'./schoolData.mjs'")
  writeFileSync(new URL(`../node_modules/.tmp/neera-storage-tests/${name}.mjs`, import.meta.url), compiled)
}
const store = await import('../node_modules/.tmp/neera-storage-tests/attendanceStorage.mjs')
const { classes } = await import('../node_modules/.tmp/neera-storage-tests/schoolData.mjs')
class MemoryStorage {
  data = new Map()
  fail = false
  get length() { return this.data.size }
  key(i) { return [...this.data.keys()][i] ?? null }
  getItem(key) { return this.data.get(key) ?? null }
  setItem(key, value) { if (this.fail) throw new Error('Quota'); this.data.set(key, value) }
}
function setup() { globalThis.localStorage = new MemoryStorage() }
function record(overrides = {}) {
  return { className: 'Primary 5', date: '2026-10-29', kind: 'confirmed',
    students: [{ id: '001', name: 'Original Name' }], attendance: { '001': 'Absent' }, rosterSource: 'captured', ...overrides }
}
function backup(records) { return { app: 'Neera', version: 1, exportedAt: new Date().toISOString(), records } }

test('confirmed snapshot remains detached from edits to the source roster', () => {
  setup(); const row = record(); store.saveRegister(row)
  row.students[0].name = 'Changed'
  assert.equal(store.loadRegister('Primary 5', row.date).record.students[0].name, 'Original Name')
})
test('draft recovery, confirmation and removal are one database update', () => {
  setup(); store.saveRegister(record({ kind: 'draft', attendance: {} }))
  assert.equal(store.loadRegister('Primary 5', '2026-10-29').record.kind, 'draft')
  store.saveRegister(record())
  assert.deepEqual(store.listRegisters().records.map((r) => r.kind), ['confirmed'])
})
test('draft failure preserves the previous confirmed record', () => {
  setup(); store.saveRegister(record()); const before = localStorage.getItem('neera:database:v3')
  localStorage.fail = true
  assert.throws(() => store.saveRegister(record({ kind: 'draft' })))
  assert.equal(localStorage.getItem('neera:database:v3'), before)
})
test('v2 marks and removed IDs survive migration; original keys remain', () => {
  setup(); const key = 'neera:attendance:v2:Primary 5:2026-10-28'
  const marks = JSON.stringify({ '001': 'Present', '099': 'Absent' })
  localStorage.setItem(key, marks)
  const old = store.listRegisters().records[0]
  assert.equal(old.rosterSource, 'legacy-reconstructed')
  assert.equal(old.students.length, 2)
  assert.match(old.students[1].name, /unavailable/)
  store.saveRegister(record())
  assert.equal(localStorage.getItem(key), marks)
  assert.equal(store.listRegisters().records.length, 2)
  const savedName = store.listRegisters().records.find((r) => r.date === '2026-10-28').students[0].name
  const name = classes[0].students[0].name
  classes[0].students[0].name = 'Later roster edit'
  assert.equal(store.listRegisters().records.find((r) => r.date === '2026-10-28').students[0].name, savedName)
  classes[0].students[0].name = name
})
test('migrated legacy drafts do not reappear after confirmation', () => {
  setup(); localStorage.setItem('neera:attendance:v2:Primary 5:2026-10-29:draft', JSON.stringify({ '001': 'Late' }))
  store.saveRegister(record())
  assert.equal(store.loadRegister('Primary 5', '2026-10-29').record.kind, 'confirmed')
})
test('backup round trip includes drafts and confirmed snapshots', () => {
  setup(); store.saveRegister(record()); store.saveRegister(record({ date: '2026-10-28', kind: 'draft', attendance: {} }))
  const file = store.parseBackup(JSON.stringify(store.createBackup()))
  setup(); assert.deepEqual(store.restoreBackup(file), { added: 2, skipped: 0 })
  assert.equal(store.listRegisters().records.length, 2)
})
test('existing class/day skips incoming drafts too, with no overwriting', () => {
  setup(); store.saveRegister(record())
  const file = backup([record({ kind: 'draft', attendance: { '001': 'Late' } }), record({ date: '2026-10-28' })])
  assert.equal(store.planRestore(file).skipped.length, 1)
  assert.deepEqual(store.restoreBackup(file), { added: 1, skipped: 1 })
  assert.equal(store.loadRegister('Primary 5', '2026-10-29').record.attendance['001'], 'Absent')
})
test('conflicts are rechecked after preview', () => {
  setup(); const file = backup([record()]); assert.equal(store.planRestore(file).additions.length, 1)
  store.saveRegister(record({ attendance: { '001': 'Late' } }))
  assert.deepEqual(store.restoreBackup(file), { added: 0, skipped: 1 })
  assert.equal(store.loadRegister('Primary 5', '2026-10-29').record.attendance['001'], 'Late')
})
test('failed restore keeps database byte-for-byte unchanged', () => {
  setup(); store.saveRegister(record()); const before = localStorage.getItem('neera:database:v3')
  localStorage.fail = true
  assert.throws(() => store.restoreBackup(backup([record({ date: '2026-10-28' })])))
  assert.equal(localStorage.getItem('neera:database:v3'), before)
})
for (const [label, invalid] of [
  ['impossible date', record({ date: '2026-02-30' })],
  ['unknown status', record({ attendance: { '001': 'Missing' } })],
  ['incomplete confirmed', record({ attendance: {} })],
  ['unknown student', record({ attendance: { '002': 'Absent' } })],
  ['duplicate ID', record({ students: [{ id: '001', name: 'A' }, { id: '001', name: 'B' }] })],
  ['unsafe ID', record({ students: [{ id: '__proto__', name: 'A' }] })],
]) test(`rejects ${label} before writing`, () => {
  setup(); assert.throws(() => store.parseBackup(JSON.stringify(backup([invalid]))))
  assert.equal(localStorage.length, 0)
})
test('rejects malformed JSON, other applications, duplicates and oversized files', () => {
  setup(); assert.throws(() => store.parseBackup('{'))
  assert.throws(() => store.parseBackup(JSON.stringify({ ...backup([]), app: 'Other' })))
  assert.throws(() => store.parseBackup(JSON.stringify(backup([record(), record()]))))
  assert.throws(() => store.parseBackup(' '.repeat(store.MAX_BACKUP_BYTES + 1)))
})
test('corrupt legacy entries are reported and not silently excluded from backups', () => {
  setup(); localStorage.setItem('neera:attendance:v2:Primary 5:2026-10-28', '{')
  assert.equal(store.listRegisters().warnings.length, 1)
  assert.throws(() => store.createBackup())
  assert.throws(() => store.saveRegister(record()))
  assert.equal(localStorage.length, 1)
})
test('unavailable storage is reported; invalid modern database is never overwritten', () => {
  setup(); localStorage.setItem('neera:database:v3', '{')
  assert.equal(store.listRegisters().warnings.length, 1)
  assert.throws(() => store.restoreBackup(backup([record()])))
  assert.equal(localStorage.getItem('neera:database:v3'), '{')
})
