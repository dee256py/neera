import express from 'express'
import { installSchoolRoutes } from './schoolRecords.mjs'
import { randomBytes, randomUUID } from 'node:crypto'
import { normaliseEmail, validName, validPassword, hashPassword, verifyPassword, tokenHash, publicUser } from './accounts.mjs'

const COOKIE = 'neera_session'
const COOKIE_PATH = '/api'
const SESSION_MS = 8 * 60 * 60 * 1000
// A dummy hash makes unknown accounts follow the same expensive verification path.
const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`
const USER_QUERY = `SELECT u.*, s.name AS school_name FROM users u JOIN schools s ON s.id=u.school_id`

function cookieToken(req) {
  const value = req.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null
}

export function createApp(db, { now = Date.now } = {}) {
  const app = express()
  app.disable('x-powered-by')
  const allowedOrigins = new Set([
    'http://localhost:5173', 'http://localhost:4173', 'http://localhost:4174',
    'http://127.0.0.1:5173', 'http://127.0.0.1:4173', 'http://127.0.0.1:4174',
  ])
  const cookieOptions = { httpOnly: true, sameSite: 'strict', path: COOKIE_PATH,
    secure: process.env.NODE_ENV === 'production' }
  const attempts = new Map()

  app.use('/api', (_req, res, next) => {
    // Authentication responses must never be stored in browser/service-worker caches.
    res.set('Cache-Control', 'no-store')
    res.set('X-Content-Type-Options', 'nosniff')
    next()
  })
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD'].includes(req.method)) return next()
    // Custom header + no CORS prevents cross-site form requests. Check Origin too.
    if (req.get('X-Neera-Client') !== 'web' ||
      (req.get('Origin') && !allowedOrigins.has(req.get('Origin')))) {
      return res.status(403).json({ error: 'Request origin is not permitted.' })
    }
    if (!req.is('application/json')) return res.status(415).json({ error: 'Send JSON.' })
    next()
  })
  app.use(express.json({ limit: '512kb' }))

  app.get('/api/health', (_req, res) => {
    db.prepare('SELECT 1').get()
    res.json({ service: 'Neera API', status: 'ok', database: 'connected' })
  })

  function authenticated(req, res, next) {
    const token = cookieToken(req)
    const session = token && db.prepare('SELECT user_id,expires_at FROM sessions WHERE token_hash=? AND expires_at>?')
      .get(tokenHash(token), now())
    if (!session) return res.status(401).json({ error: 'Sign in to continue.' })
    req.sessionExpiresAt = session.expires_at
    req.account = db.prepare(`${USER_QUERY} WHERE u.id=?`).get(session.user_id)
    if (!req.account) return res.status(401).json({ error: 'Sign in to continue.' })
    next()
  }
  function adminOnly(req, res, next) {
    if (req.account.role !== 'admin') return res.status(403).json({ error: 'School admin access is required.' })
    next()
  }

  app.post('/api/auth/login', async (req, res) => {
    let email
    try { email = normaliseEmail(req.body?.email) } catch { return res.status(400).json({ error: 'Enter a valid email address.' }) }
    const password = req.body?.password
    if (typeof password !== 'string' || password.length > 256) return res.status(400).json({ error: 'Enter your password.' })
    // Count attempts before awaiting password hashing to bound concurrent requests.
    for (const [key, entry] of attempts) if (entry.until <= now()) attempts.delete(key)
    const keys = [`ip:${req.ip}`, `account:${req.ip}:${email}`]
    if (attempts.size > 5000 || keys.some((key, i) => (attempts.get(key)?.count ?? 0) >= (i ? 5 : 30))) {
      res.set('Retry-After', '900')
      return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' })
    }
    for (const key of keys) {
      const entry = attempts.get(key) ?? { count: 0, until: now() + 900000 }
      entry.count += 1
      attempts.set(key, entry)
    }
    const row = db.prepare(`${USER_QUERY} WHERE u.email=?`).get(email)
    const valid = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH)
    if (!row || !valid) return res.status(401).json({ error: 'Email or password is incorrect.' })
    attempts.delete(keys[1])
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now())
    const previous = cookieToken(req)
    if (previous) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(previous))
    const token = randomBytes(32).toString('hex')
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)')
      .run(tokenHash(token), row.id, now() + SESSION_MS)
    res.cookie(COOKIE, token, { ...cookieOptions, maxAge: SESSION_MS })
    res.json({ user: publicUser(row), expiresAt: now() + SESSION_MS })
  })

  app.get('/api/auth/me', authenticated, (req, res) => res.json({ user: publicUser(req.account), expiresAt: req.sessionExpiresAt }))
  app.post('/api/auth/logout', (req, res) => {
    const token = cookieToken(req)
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token))
    res.clearCookie(COOKIE, cookieOptions)
    res.json({ ok: true })
  })

  app.get('/api/users', authenticated, adminOnly, (req, res) => {
    const rows = db.prepare(`${USER_QUERY} WHERE u.school_id=? ORDER BY u.name`).all(req.account.school_id)
    res.json({ users: rows.map(publicUser) })
  })
  app.post('/api/users', authenticated, adminOnly, async (req, res) => {
    let name, email, password
    try {
      name = validName(req.body?.name)
      email = normaliseEmail(req.body?.email)
      password = validPassword(req.body?.password)
    } catch (error) { return res.status(400).json({ error: error.message }) }
    // Reject privilege/school injection rather than trusting hidden form controls.
    if (Object.hasOwn(req.body, 'schoolId') || Object.hasOwn(req.body, 'role')) {
      return res.status(400).json({ error: 'This endpoint creates teachers in your school only.' })
    }
    const hash = await hashPassword(password)
    const id = randomUUID()
    try {
      db.prepare('INSERT INTO users(id,school_id,name,email,password_hash,role) VALUES (?,?,?,?,?,?)')
        .run(id, req.account.school_id, name, email, hash, 'teacher')
    } catch (error) {
      if (error.message.includes('UNIQUE')) return res.status(409).json({ error: 'That email is already registered.' })
      throw error
    }
    const row = db.prepare(`${USER_QUERY} WHERE u.id=?`).get(id)
    res.status(201).json({ user: publicUser(row) })
  })

  installSchoolRoutes(app, db, authenticated, adminOnly)

  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }))
  // Four arguments are required for Express to recognise an error handler.
  app.use((error, _req, res, _next) => {
    const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500
    if (status === 500) console.error('Neera API request failed:', error.message)
    res.status(status).json({ error: status === 500 ? 'Server request failed.' : 'Invalid or oversized JSON request.' })
  })
  return app
}
