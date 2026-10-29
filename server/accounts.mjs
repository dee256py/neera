import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
const derive = promisify(scrypt)
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

export function normaliseEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw new Error('Enter a valid email address.')
  return value.trim().toLowerCase()
}
export function validName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) throw new Error('Name must contain 1–120 characters.')
  return value.trim()
}
export function validPassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256) throw new Error('Use a password with 12–256 characters.')
  return value
}
export async function hashPassword(password) {
  validPassword(password)
  const salt = randomBytes(16).toString('hex')
  const key = await derive(password, salt, 64, options)
  return `scrypt$${salt}$${key.toString('hex')}`
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 256) return false
  const [, salt, hash] = encoded.split('$')
  if (!salt || !hash || !/^[a-f0-9]{128}$/.test(hash)) return false
  const key = await derive(password, salt, 64, options)
  return timingSafeEqual(key, Buffer.from(hash, 'hex'))
}
export function tokenHash(token) { return createHash('sha256').update(token).digest('hex') }
export function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role,
    schoolId: row.school_id, schoolName: row.school_name }
}

// Only the local setup command provisions a school and its first admin.
// The public API never accepts a client-supplied school ID or admin role.
export async function provisionSchool(db, { schoolName, name, email, password }) {
  const school = validName(schoolName)
  const userName = validName(name)
  const address = normaliseEmail(email)
  const hash = await hashPassword(password)
  const schoolId = randomUUID()
  const userId = randomUUID()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('INSERT INTO schools(id,name) VALUES (?,?)').run(schoolId, school)
    db.prepare('INSERT INTO users(id,school_id,name,email,password_hash,role) VALUES (?,?,?,?,?,?)')
      .run(userId, schoolId, userName, address, hash, 'admin')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return { schoolId, userId }
}
