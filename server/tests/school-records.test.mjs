import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { openDatabase } from '../database.mjs'
import { provisionSchool } from '../accounts.mjs'
import { createApp } from '../app.mjs'
const password = 'Fictional school test password!'
const db = openDatabase(':memory:')
for (const [name, email] of [['A', 'a@example.test'], ['B', 'b@example.test']]) await provisionSchool(db, { schoolName: `School ${name}`, name, email, password })
const server = createApp(db).listen(0, '127.0.0.1'); await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}/api`
const headers = { 'Content-Type': 'application/json', 'X-Neera-Client': 'web', Origin: 'http://localhost:5173' }
async function call(path, actor, method = 'GET', body) {
  return fetch(base + path, { method, headers: { ...headers, ...(actor ? { Cookie: actor.cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify({ ...body, ...(actor ? { expectedUserId: actor.id, expectedSchoolId: actor.schoolId } : {}) }) }) })
}
async function login(email) {
  const response = await call('/auth/login', null, 'POST', { email, password })
  const body = await response.json(); assert.equal(response.status, 200); assert.ok(body.expiresAt > Date.now())
  return { ...body.user, cookie: response.headers.get('set-cookie').split(';')[0] }
}
const a = await login('a@example.test'), b = await login('b@example.test')
let teacher, other, cls, updatedClass, firstBody
function payload(date, overrides = {}) {
  return { baseVersion: 0, rosterVersion: cls.rosterVersion, mutationId: randomUUID(), record: {
    className: cls.name, date, kind: 'confirmed', rosterSource: 'captured', students: cls.students,
    attendance: Object.fromEntries(cls.students.map((s) => [s.id, 'Present'])),
  }, ...overrides }
}
try {
  await test('additive migration preserves accounts and creates version 2', () => {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2)
    assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=2').get())
  })
  await test('unauthenticated class endpoints are refused', async () => assert.equal((await call('/classes')).status, 401))
  await test('admins create school-owned classes; names are unique within a school', async () => {
    const response = await call('/classes', a, 'POST', { name: 'Primary 5', students: [{ name: 'Amina' }, { name: 'Daniel' }] })
    assert.equal(response.status, 201); cls = (await response.json()).class
    assert.equal(new Set(cls.students.map((s) => s.id)).size, 2)
    assert.equal((await call('/classes', a, 'POST', { name: 'Primary 5', students: [{ name: 'X' }] })).status, 409)
    assert.equal((await call('/classes', b, 'POST', { name: 'Primary 5', students: [{ name: 'Other' }] })).status, 201)
  })
  await test('admins assign only teachers from their own school', async () => {
    for (const [actor, email] of [[a, 'teacher@example.test'], [a, 'other@example.test'], [b, 'foreign@example.test']]) assert.equal((await call('/users', actor, 'POST', { name: email, email, password })).status, 201)
    teacher = await login('teacher@example.test'); other = await login('other@example.test')
    const foreign = await login('foreign@example.test')
    assert.equal((await call(`/classes/${cls.id}/teachers`, a, 'PUT', { teacherIds: [foreign.id] })).status, 400)
    assert.equal((await call(`/classes/${cls.id}/teachers`, a, 'PUT', { teacherIds: [teacher.id, other.id] })).status, 200)
  })
  await test('class lists and direct access enforce school and assignment isolation', async () => {
    const list = await (await call('/classes', teacher)).json()
    assert.deepEqual(list.classes.map((c) => c.id), [cls.id]); assert.equal(list.userId, teacher.id)
    assert.equal((await call(`/classes/${cls.id}/registers`, b)).status, 404)
    assert.equal((await call('/classes', teacher, 'POST', { name: 'Injected', students: [{ name: 'X' }] })).status, 403)
    assert.equal((await call(`/classes/${cls.id}/roster`, teacher, 'PUT', { students: cls.students, baseRosterVersion: 1 })).status, 403)
  })
  await test('confirmed attendance saves a versioned roster snapshot', async () => {
    firstBody = payload('2026-10-29')
    const response = await call(`/classes/${cls.id}/registers/2026-10-29`, teacher, 'PUT', firstBody)
    assert.equal(response.status, 200); const row = await response.json()
    assert.equal(row.version, 1); assert.equal(row.record.students[0].name, 'Amina')
  })
  await test('idempotent retries do not increment versions', async () => {
    const response = await call(`/classes/${cls.id}/registers/2026-10-29`, teacher, 'PUT', firstBody)
    assert.equal(response.status, 200); assert.equal((await response.json()).version, 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM register_mutations').get().n, 1)
  })
  await test('stale devices get a conflict without overwriting school data', async () => {
    const response = await call(`/classes/${cls.id}/registers/2026-10-29`, other, 'PUT', payload('2026-10-29'))
    assert.equal(response.status, 409); const body = await response.json()
    assert.equal(body.conflict, 'record'); assert.equal(body.current.version, 1)
  })
  await test('mutation IDs cannot be reused for another payload or account', async () => {
    const changed = structuredClone(firstBody); changed.record.attendance[cls.students[0].id] = 'Absent'
    assert.equal((await call(`/classes/${cls.id}/registers/2026-10-29`, teacher, 'PUT', changed)).status, 409)
    assert.equal((await call(`/classes/${cls.id}/registers/2026-10-29`, other, 'PUT', firstBody)).status, 409)
  })
  await test('switched cookies cannot submit another account\'s queued work', async () => {
    const response = await fetch(base + `/classes/${cls.id}/registers/2026-10-29`, { method: 'PUT', headers: { ...headers, Cookie: other.cookie }, body: JSON.stringify({ ...payload('2026-10-29'), expectedUserId: teacher.id, expectedSchoolId: teacher.schoolId }) })
    assert.equal(response.status, 401)
  })
  await test('roster editing detects stale edits and preserves historical names', async () => {
    const roster = cls.students.map((s, i) => ({ ...s, name: i === 0 ? 'Amina Renamed' : s.name }))
    const response = await call(`/classes/${cls.id}/roster`, a, 'PUT', { students: roster, baseRosterVersion: 1 })
    assert.equal(response.status, 200); updatedClass = (await response.json()).class
    assert.equal((await call(`/classes/${cls.id}/roster`, a, 'PUT', { students: roster, baseRosterVersion: 1 })).status, 409)
    const history = await (await call(`/classes/${cls.id}/registers`, teacher)).json()
    assert.equal(history.records[0].record.students[0].name, 'Amina')
  })
  await test('new registers reject outdated rosters and accept the latest roster', async () => {
    const stale = await call(`/classes/${cls.id}/registers/2026-10-28`, teacher, 'PUT', payload('2026-10-28'))
    assert.equal(stale.status, 409); assert.equal((await stale.json()).conflict, 'roster')
    const fresh = payload('2026-10-28', { rosterVersion: 2 }); fresh.record.students = updatedClass.students
    assert.equal((await call(`/classes/${cls.id}/registers/2026-10-28`, teacher, 'PUT', fresh)).status, 200)
  })
  await test('clients cannot alter a saved register\'s roster snapshot', async () => {
    const body = payload('2026-10-29', { baseVersion: 1, rosterVersion: 2 }); body.record.students = updatedClass.students
    assert.equal((await call(`/classes/${cls.id}/registers/2026-10-29`, teacher, 'PUT', body)).status, 400)
  })
  await test('invalid dates, marks and duplicate student IDs are rejected', async () => {
    assert.equal((await call(`/classes/${cls.id}/registers/2026-02-30`, teacher, 'PUT', payload('2026-02-30'))).status, 400)
    const body = payload('2026-10-29', { baseVersion: 1 }); body.record.attendance = {}
    assert.equal((await call(`/classes/${cls.id}/registers/2026-10-29`, teacher, 'PUT', body)).status, 400)
    assert.equal((await call('/classes', a, 'POST', { name: 'Bad', students: [{ id: 'same', name: 'A' }, { id: 'same', name: 'B' }] })).status, 400)
  })
  await test('competing writes allow exactly one versioned winner', async () => {
    const responses = await Promise.all([teacher, other].map((actor) => call(`/classes/${cls.id}/registers/2026-10-29`, actor, 'PUT', payload('2026-10-29', { baseVersion: 1 }))))
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409])
  })
  await test('older successful replays never replace newer school versions', async () => {
    const replay = await call(`/classes/${cls.id}/registers/2026-10-29`, teacher, 'PUT', firstBody)
    assert.equal(replay.status, 200); assert.equal((await replay.json()).version, 1)
    const history = await (await call(`/classes/${cls.id}/registers`, teacher)).json()
    assert.equal(history.records.find((r) => r.date === '2026-10-29').version, 2)
  })
  await test('assignment revocation blocks online reads and queued writes immediately', async () => {
    assert.equal((await call(`/classes/${cls.id}/teachers`, a, 'PUT', { teacherIds: [] })).status, 200)
    assert.equal((await call(`/classes/${cls.id}/registers`, teacher)).status, 404)
    assert.equal((await call(`/classes/${cls.id}/registers/2026-10-29`, teacher, 'PUT', payload('2026-10-29', { baseVersion: 2 }))).status, 404)
    assert.equal((await (await call('/classes', teacher)).json()).classes.length, 0)
  })
} finally { await new Promise((resolve) => server.close(resolve)); db.close() }
