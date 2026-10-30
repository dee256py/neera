import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import ts from '../node_modules/typescript/lib/typescript.js'
import { openDatabase } from '../server/database.mjs'
import { provisionSchool } from '../server/accounts.mjs'
import { createApp } from '../server/app.mjs'
const destination = new URL('../node_modules/.tmp/neera-sync-tests/', import.meta.url)
mkdirSync(destination, { recursive: true })
for (const name of ['schoolData', 'attendanceStorage', 'schoolApi', 'schoolStorage', 'schoolSync']) {
  const source = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText.replace(/from '(\.\/\w+)'/g, "from '$1.mjs'")
  writeFileSync(new URL(`${name}.mjs`, destination), compiled)
}
const store = await import('../node_modules/.tmp/neera-sync-tests/schoolStorage.mjs')
const { syncSchool } = await import('../node_modules/.tmp/neera-sync-tests/schoolSync.mjs')
const auth = await import('../node_modules/.tmp/neera-sync-tests/schoolApi.mjs')
class MemoryStorage {
  data = new Map()
  getItem(key) { return this.data.get(key) ?? null }
  setItem(key, value) { this.data.set(key, value) }
  removeItem(key) { this.data.delete(key) }
}
await test('real API + two offline caches: queue replay, conflicts, identity changes and roster changes', async () => {
  const db = openDatabase(':memory:')
  const password = 'Fictional integration password!'
  await provisionSchool(db, { schoolName: 'Integration School', name: 'Admin', email: 'admin@example.test', password })
  const server = createApp(db).listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const nativeFetch = globalThis.fetch
  const headers = { 'Content-Type': 'application/json', 'X-Neera-Client': 'web', Origin: 'http://localhost:5173' }
  async function login(email) {
    const response = await nativeFetch(base + '/api/auth/login', { method: 'POST', headers, body: JSON.stringify({ email, password }) })
    assert.equal(response.status, 200)
    return { session: await response.json(), cookie: response.headers.get('set-cookie').split(';')[0] }
  }
  let cookie
  let offline = false
  let loseNextUpload = false
  try {
    const admin = await login('admin@example.test')
    async function adminCall(path, body, method = 'POST') {
      const response = await nativeFetch(base + '/api' + path, { method, headers: { ...headers, Cookie: admin.cookie }, body: JSON.stringify({ ...body, expectedUserId: admin.session.user.id, expectedSchoolId: admin.session.user.schoolId }) })
      assert.ok(response.ok, `Admin request failed ${response.status}`)
      return response.json()
    }
    const teacher = await adminCall('/users', { name: 'Teacher', email: 'teacher@example.test', password })
    const other = await adminCall('/users', { name: 'Other', email: 'other@example.test', password })
    const cls = (await adminCall('/classes', { name: 'Primary 5', students: [{ name: 'Pupil A' }, { name: 'Pupil B' }] })).class
    await adminCall(`/classes/${cls.id}/teachers`, { teacherIds: [teacher.user.id, other.user.id] }, 'PUT')
    const signedIn = await login('teacher@example.test'); cookie = signedIn.cookie
    const session = signedIn.session
    const deviceA = new MemoryStorage(), deviceB = new MemoryStorage()
    globalThis.fetch = async (path, options = {}) => {
      if (offline) throw new TypeError('Offline')
      const response = await nativeFetch(base + path, { ...options, headers: { ...options.headers, Origin: 'http://localhost:5173', Cookie: cookie } })
      if (loseNextUpload && options.method === 'PUT') { loseNextUpload = false; throw new TypeError('Response lost after commit') }
      return response
    }
    const date = '2026-10-29'
    const marks = (status) => Object.fromEntries(cls.students.map((student) => [student.id, status]))
    const confirm = (status, day = date) => { store.saveSchoolDraft(session, cls.id, day, marks(status)); store.confirmSchoolDraft(session, cls.id, day) }
    globalThis.localStorage = deviceA; await syncSchool(session); confirm('Present')
    globalThis.localStorage = deviceB; await syncSchool(session); confirm('Absent')
    globalThis.localStorage = deviceA; offline = true
    await assert.rejects(syncSchool(session)); assert.ok(store.readSchoolData(session).entries[0].pending)
    offline = false; assert.equal((await syncSchool(session)).uploaded, 1)
    globalThis.localStorage = deviceB; await syncSchool(session)
    let row = store.readSchoolData(session).entries[0]
    assert.ok(row.issue); assert.equal(row.pending.record.attendance[cls.students[0].id], 'Absent'); assert.equal(row.remote.version, 1)
    store.adoptSchoolVersion(session, cls.id, date); confirm('Late'); await syncSchool(session)
    assert.equal(store.readSchoolData(session).entries[0].remote.version, 2)
    globalThis.localStorage = deviceA; await syncSchool(session); confirm('Absent'); loseNextUpload = true
    await assert.rejects(syncSchool(session)); assert.ok(store.readSchoolData(session).entries[0].pending)
    assert.equal((await syncSchool(session)).uploaded, 0)
    row = store.readSchoolData(session).entries[0]; assert.equal(row.pending, undefined); assert.equal(row.remote.version, 3)
    const switched = await login('other@example.test'); cookie = switched.cookie
    const before = JSON.stringify(store.readSchoolData(session))
    await assert.rejects(syncSchool(session), /different account/)
    assert.equal(JSON.stringify(store.readSchoolData(session)), before)
    cookie = signedIn.cookie
    confirm('Present', '2026-10-28')
    await adminCall(`/classes/${cls.id}/roster`, { baseRosterVersion: 1, students: cls.students.map((student) => ({ ...student, name: student.name + ' renamed' })) }, 'PUT')
    await syncSchool(session)
    row = store.readSchoolData(session).entries.find((entry) => entry.date === '2026-10-28')
    assert.ok(row.issue); assert.ok(row.pending); assert.equal(row.remote, undefined)
    await adminCall(`/classes/${cls.id}/teachers`, { teacherIds: [] }, 'PUT')
    await syncSchool(session)
    assert.equal(store.readSchoolData(session).classes.length, 0)
    assert.ok(store.readSchoolData(session).entries.some((entry) => entry.pending))
    auth.rememberSchoolSession(session)
    await nativeFetch(base + '/api/auth/logout', { method: 'POST', headers: { ...headers, Cookie: cookie }, body: '{}' })
    await assert.rejects(auth.openSchoolSession())
    assert.equal(auth.cachedSchoolSession(), null)
  } finally {
    globalThis.fetch = nativeFetch
    await new Promise((resolve) => server.close(resolve)); db.close()
  }
})
