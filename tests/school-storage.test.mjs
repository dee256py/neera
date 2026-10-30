import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import ts from '../node_modules/typescript/lib/typescript.js'
const destination = new URL('../node_modules/.tmp/neera-school-tests/', import.meta.url)
mkdirSync(destination, { recursive: true })
for (const name of ['schoolData', 'attendanceStorage', 'schoolApi', 'schoolStorage', 'schoolSync']) {
  const source = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/from '(\.\/\w+)'/g, "from '$1.mjs'")
  writeFileSync(new URL(`${name}.mjs`, destination), compiled)
}
const store = await import('../node_modules/.tmp/neera-school-tests/schoolStorage.mjs')
const auth = await import('../node_modules/.tmp/neera-school-tests/schoolApi.mjs')
class MemoryStorage {
  data = new Map(); fail = false
  getItem(key) { return this.data.get(key) ?? null }
  setItem(key, value) { if (this.fail) throw new Error('Quota'); this.data.set(key, value) }
  removeItem(key) { this.data.delete(key) }
}
const session = { user: { id: 'teacher-a', schoolId: 'school-a', role: 'teacher', name: 'Teacher', email: 'teacher@example.test', schoolName: 'School A' }, expiresAt: Date.now() + 3600000 }
const cls = { id: 'class-a', name: 'Primary 5', students: [{ id: '001', name: 'Original Name' }, { id: '002', name: 'Daniel' }], teacherIds: ['teacher-a'], rosterVersion: 1 }
const date = '2026-10-29'
const marks = { '001': 'Present', '002': 'Absent' }
function setup() { globalThis.localStorage = new MemoryStorage(); store.updateSchoolClasses(session, [cls]) }
function draft() { store.saveSchoolDraft(session, cls.id, date, marks) }
function pending() { draft(); store.confirmSchoolDraft(session, cls.id, date); return store.readSchoolData(session).entries[0].pending }
function remote(version = 1, attendance = marks, day = date) {
  return { classId: cls.id, date: day, version, record: { className: cls.name, date: day, kind: 'confirmed', rosterSource: 'captured', students: cls.students, attendance } }
}

test('account and school caches never read each other or the demo database', () => {
  setup(); localStorage.setItem('neera:database:v3', 'demo sentinel'); draft()
  assert.equal(store.readSchoolData({ ...session, user: { ...session.user, id: 'teacher-b' } }).entries.length, 0)
  assert.equal(store.readSchoolData({ ...session, user: { ...session.user, schoolId: 'school-b' } }).entries.length, 0)
  assert.equal(localStorage.getItem('neera:database:v3'), 'demo sentinel')
})
test('draft persistence does not count as confirmation; complete confirmation creates a queue item', () => {
  setup(); draft(); let row = store.readSchoolData(session).entries[0]; assert.ok(row.draft); assert.equal(row.pending, undefined)
  store.confirmSchoolDraft(session, cls.id, date); row = store.readSchoolData(session).entries[0]
  assert.equal(row.draft, undefined); assert.equal(row.pending.baseVersion, 0); assert.ok(row.pending.mutationId)
})
test('incomplete confirmation is refused without losing its draft', () => {
  setup(); store.saveSchoolDraft(session, cls.id, date, { '001': 'Present' })
  assert.throws(() => store.confirmSchoolDraft(session, cls.id, date))
  assert.ok(store.readSchoolData(session).entries[0].draft)
})
test('roster changes never alter the snapshot of existing local work', () => {
  setup(); draft(); store.updateSchoolClasses(session, [{ ...cls, rosterVersion: 2, students: [{ id: '001', name: 'Renamed' }] }])
  assert.equal(store.readSchoolData(session).entries[0].draft.record.students[0].name, 'Original Name')
})
test('new remote versions preserve and flag conflicting queued work', () => {
  setup(); pending(); store.mergeSchoolRemote(session, remote(1, { '001': 'Late', '002': 'Present' }))
  const row = store.readSchoolData(session).entries[0]
  assert.ok(row.issue); assert.equal(row.pending.record.attendance['001'], 'Present'); assert.equal(row.remote.version, 1)
})
test('lost acknowledgements are recognised despite different mark insertion order', () => {
  setup(); pending(); store.mergeSchoolRemote(session, remote(1, { '002': 'Absent', '001': 'Present' }))
  const row = store.readSchoolData(session).entries[0]
  assert.equal(row.pending, undefined); assert.equal(row.issue, undefined); assert.equal(row.remote.version, 1)
})
test('unconfirmed edits survive upload acknowledgement with an updated baseline', () => {
  setup(); const submitted = pending()
  store.saveSchoolDraft(session, cls.id, date, { '001': 'Late', '002': 'Absent' })
  store.acknowledgeSchoolUpload(session, submitted, remote())
  const row = store.readSchoolData(session).entries[0]
  assert.equal(row.pending, undefined); assert.equal(row.draft.baseVersion, 1); assert.equal(row.draft.record.attendance['001'], 'Late')
})
test('a newer local confirmation is not cleared by an older upload response', () => {
  setup(); const submitted = pending()
  store.saveSchoolDraft(session, cls.id, date, { '001': 'Late', '002': 'Absent' }); store.confirmSchoolDraft(session, cls.id, date)
  store.acknowledgeSchoolUpload(session, submitted, remote())
  const row = store.readSchoolData(session).entries[0]
  assert.ok(row.pending); assert.notEqual(row.pending.mutationId, submitted.mutationId); assert.ok(row.issue)
})
test('stale pulls cannot replace newer cached school versions', () => {
  setup(); store.mergeSchoolRemote(session, remote(3)); store.mergeSchoolRemote(session, remote(1))
  assert.equal(store.readSchoolData(session).entries[0].remote.version, 3)
})
test('reassignment retains queued data but removes the class from active access', () => {
  setup(); pending(); store.updateSchoolClasses(session, [])
  const data = store.readSchoolData(session); assert.equal(data.classes.length, 0); assert.ok(data.entries[0].pending); assert.ok(data.entries[0].issue)
  assert.throws(() => store.saveSchoolDraft(session, cls.id, date, marks))
})
test('adopting a reviewed school copy clears only that local entry\'s changes', () => {
  setup(); pending(); store.mergeSchoolRemote(session, remote(2, { '001': 'Late', '002': 'Absent' }))
  store.saveSchoolDraft(session, cls.id, '2026-10-28', marks)
  store.adoptSchoolVersion(session, cls.id, date)
  const data = store.readSchoolData(session); const row = data.entries.find((r) => r.date === date)
  assert.equal(row.pending, undefined); assert.equal(row.issue, undefined); assert.equal(row.remote.version, 2)
  assert.ok(data.entries.find((r) => r.date === '2026-10-28').draft)
})
test('school backup round trip includes snapshots, drafts, queued edits and cached versions', () => {
  setup(); pending(); store.mergeSchoolRemote(session, remote(1, marks, '2026-10-28'))
  store.saveSchoolDraft(session, cls.id, '2026-10-27', { '001': 'Present' })
  const backup = store.parseSchoolBackup(session, JSON.stringify(store.createSchoolBackup(session)))
  setup(); assert.deepEqual(store.restoreSchoolBackup(session, backup), { added: 3, skipped: 0 })
  assert.equal(store.readSchoolData(session).entries.length, 3)
})
test('restore rejects another school/account, demo backups and invalid statuses', () => {
  setup(); pending(); const backup = store.createSchoolBackup(session)
  for (const file of [{ ...backup, schoolId: 'other' }, { ...backup, userId: 'other' }, { ...backup, app: 'Neera' }]) assert.throws(() => store.parseSchoolBackup(session, JSON.stringify(file)))
  backup.data.entries[0].pending.record.attendance['001'] = 'Invalid'
  assert.throws(() => store.parseSchoolBackup(session, JSON.stringify(backup)))
})
test('restore rechecks conflicts and never replaces an existing class/date', () => {
  setup(); pending(); const backup = store.createSchoolBackup(session)
  setup(); assert.equal(store.planSchoolRestore(session, backup).additions.length, 1)
  store.saveSchoolDraft(session, cls.id, date, { '001': 'Late' })
  assert.deepEqual(store.restoreSchoolBackup(session, backup), { added: 0, skipped: 1 })
  assert.equal(store.readSchoolData(session).entries[0].draft.record.attendance['001'], 'Late')
})
test('failed storage writes preserve previously saved drafts and restores are atomic', () => {
  setup(); draft(); const before = new Map(localStorage.data); localStorage.fail = true
  assert.throws(() => store.confirmSchoolDraft(session, cls.id, date)); assert.deepEqual(localStorage.data, before)
})
test('expired offline sessions cannot mark, confirm or restore', () => {
  setup(); pending(); const expired = { ...session, expiresAt: Date.now() - 1 }
  assert.throws(() => store.saveSchoolDraft(expired, cls.id, date, marks))
  assert.throws(() => store.confirmSchoolDraft(expired, cls.id, date))
  assert.throws(() => store.restoreSchoolBackup(expired, store.createSchoolBackup(session)))
})
test('offline identity is time-limited and sign out removes the active pointer', () => {
  setup(); auth.rememberSchoolSession(session); assert.equal(auth.cachedSchoolSession().user.id, session.user.id)
  auth.rememberSchoolSession({ ...session, expiresAt: Date.now() - 1 }); assert.equal(auth.cachedSchoolSession(), null)
  auth.rememberSchoolSession(session)
  auth.forgetMatchingSchoolSession({ ...session, user: { ...session.user, id: 'different-account' } })
  assert.equal(auth.cachedSchoolSession().user.id, session.user.id)
  auth.forgetMatchingSchoolSession(session); assert.equal(auth.cachedSchoolSession(), null)
})
test('corrupt school storage is reported and never silently replaced', () => {
  setup(); const key = [...localStorage.data.keys()][0]; localStorage.setItem(key, '{')
  assert.throws(() => store.readSchoolData(session)); assert.throws(() => store.updateSchoolClasses(session, [cls])); assert.equal(localStorage.getItem(key), '{')
})
