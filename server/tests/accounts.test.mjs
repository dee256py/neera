import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { openDatabase } from '../database.mjs'
import { provisionSchool } from '../accounts.mjs'
import { createApp } from '../app.mjs'

const PASSWORD = 'Fictional test password 29!'
const db = openDatabase(':memory:')
await provisionSchool(db, { schoolName: 'School A', name: 'Admin A', email: 'admin-a@example.test', password: PASSWORD })
await provisionSchool(db, { schoolName: 'School B', name: 'Admin B', email: 'admin-b@example.test', password: PASSWORD })
let clock = Date.now()
const server = createApp(db, { now: () => clock }).listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}`
const headers = { 'Content-Type': 'application/json', 'X-Neera-Client': 'web', Origin: 'http://localhost:5173' }
async function request(path, { body, cookie, extraHeaders = {} } = {}) {
  return fetch(`${base}/api${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
async function login(email, password = PASSWORD, cookie) {
  const response = await request('/auth/login', { body: { email, password }, cookie })
  return { response, cookie: response.headers.get('set-cookie')?.split(';')[0] }
}
let a, b, teacher
try {
  await test('health endpoint and authentication requirement', async () => {
    assert.equal((await request('/health')).status, 200)
    assert.equal((await request('/auth/me')).status, 401)
    assert.equal((await request('/users')).status, 401)
  })
  await test('login issues a protected cookie without exposing hashes', async () => {
    a = await login('admin-a@example.test'); b = await login('admin-b@example.test')
    assert.equal(a.response.status, 200)
    const cookie = a.response.headers.get('set-cookie')
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Path=\/api/)
    const body = await a.response.json()
    assert.equal(body.user.role, 'admin')
    assert.equal(body.user.password_hash, undefined)
    assert.equal(a.response.headers.get('cache-control'), 'no-store')
    assert.equal((await request('/auth/me', { cookie: a.cookie })).status, 200)
  })
  await test('passwords and session tokens are not stored as plaintext', () => {
    const users = db.prepare('SELECT password_hash FROM users').all()
    assert.ok(users.every((row) => row.password_hash.startsWith('scrypt$') && row.password_hash !== PASSWORD))
    const token = a.cookie.split('=')[1]
    assert.equal(db.prepare('SELECT token_hash FROM sessions WHERE token_hash=?').get(token), undefined)
  })
  await test('admin can create a teacher only in their own school', async () => {
    const response = await request('/users', { cookie: a.cookie, body: { name: 'Teacher A', email: 'teacher-a@example.test', password: PASSWORD } })
    assert.equal(response.status, 201)
    const body = await response.json()
    assert.equal(body.user.role, 'teacher')
    assert.equal(body.user.schoolName, 'School A')
    teacher = await login('teacher-a@example.test')
    assert.equal(teacher.response.status, 200)
  })
  await test('teachers cannot list users or create accounts', async () => {
    assert.equal((await request('/users', { cookie: teacher.cookie })).status, 403)
    assert.equal((await request('/users', { cookie: teacher.cookie, body: { name: 'Injected', email: 'x@example.test', password: PASSWORD } })).status, 403)
  })
  await test('school lists are isolated', async () => {
    const aa = await (await request('/users', { cookie: a.cookie })).json()
    const bb = await (await request('/users', { cookie: b.cookie })).json()
    assert.deepEqual(aa.users.map((u) => u.email).sort(), ['admin-a@example.test', 'teacher-a@example.test'])
    assert.deepEqual(bb.users.map((u) => u.email), ['admin-b@example.test'])
  })
  await test('school and role injection, weak passwords and duplicate emails are rejected', async () => {
    const fields = { name: 'New Teacher', email: 'new@example.test', password: PASSWORD }
    for (const injection of [{ role: 'admin' }, { schoolId: 'other-school' }, { password: 'short' }]) {
      assert.equal((await request('/users', { cookie: a.cookie, body: { ...fields, ...injection } })).status, 400)
    }
    assert.equal((await request('/users', { cookie: a.cookie, body: { ...fields, email: 'TEACHER-A@example.test' } })).status, 409)
  })
  await test('cross-origin and missing custom-header mutations are blocked', async () => {
    assert.equal((await request('/auth/logout', { cookie: a.cookie, body: {}, extraHeaders: { Origin: 'https://untrusted.example' } })).status, 403)
    assert.equal((await request('/auth/logout', { cookie: a.cookie, body: {}, extraHeaders: { 'X-Neera-Client': '' } })).status, 403)
  })
  await test('unknown and wrong-password logins have the same error response', async () => {
    const wrong = await login('admin-b@example.test', 'wrong')
    const missing = await login('missing@example.test', 'wrong')
    assert.equal(wrong.response.status, 401); assert.equal(missing.response.status, 401)
    assert.deepEqual(await wrong.response.json(), await missing.response.json())
  })
  await test('repeated invalid account logins are rate limited', async () => {
    for (let n = 0; n < 4; n++) assert.equal((await login('missing@example.test', 'wrong')).response.status, 401)
    const blocked = await login('missing@example.test', 'wrong')
    assert.equal(blocked.response.status, 429)
    assert.equal(blocked.response.headers.get('retry-after'), '900')
  })
  await test('logout invalidates the stored session', async () => {
    assert.equal((await request('/auth/logout', { cookie: teacher.cookie, body: {} })).status, 200)
    assert.equal((await request('/auth/me', { cookie: teacher.cookie })).status, 401)
  })
  await test('expired and forged sessions are refused', async () => {
    assert.equal((await request('/auth/me', { cookie: 'neera_session=' + 'f'.repeat(64) })).status, 401)
    clock += 9 * 60 * 60 * 1000
    assert.equal((await request('/auth/me', { cookie: a.cookie })).status, 401)
  })
  await test('duplicate provisioning rolls back the new school', async () => {
    const count = db.prepare('SELECT COUNT(*) AS n FROM schools').get().n
    await assert.rejects(provisionSchool(db, { schoolName: 'Duplicate', name: 'Admin', email: 'admin-a@example.test', password: PASSWORD }))
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schools').get().n, count)
  })
} finally {
  await new Promise((resolve) => server.close(resolve))
  db.close()
}
