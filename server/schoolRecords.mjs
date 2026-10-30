import { randomUUID, createHash } from 'node:crypto'
import { validName } from './accounts.mjs'

function fail(message) { throw new Error(message) }
function students(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 300) fail('Use a roster of 1–300 students.')
  const ids = new Set()
  return value.map((entry) => {
    const name = validName(entry?.name)
    const id = entry?.id ?? randomUUID()
    if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id) || ids.has(id)) fail('Student IDs must be unique and valid.')
    ids.add(id)
    return { id, name }
  })
}
function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`${date}T12:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}
function schoolClass(row, db) {
  return { id: row.id, name: row.name, students: JSON.parse(row.students_json), rosterVersion: row.roster_version,
    teacherIds: db.prepare('SELECT user_id FROM class_teachers WHERE class_id=? ORDER BY user_id').all(row.id).map((item) => item.user_id) }
}
function remote(row) {
  return { classId: row.class_id, date: row.date, version: row.version, record: JSON.parse(row.record_json) }
}
function record(body, classRow, date) {
  const input = body?.record
  if (!input || input.kind !== 'confirmed' || input.date !== date || input.className !== classRow.name || input.rosterSource !== 'captured') fail('Send a confirmed register for this class and date.')
  if (!Array.isArray(input.students) || input.students.some((student) => typeof student?.id !== 'string')) fail('A register must include student IDs.')
  const roster = students(input.students)
  const marks = input.attendance
  if (!marks || typeof marks !== 'object' || Array.isArray(marks) || Object.keys(marks).length !== roster.length) fail('Mark every student exactly once.')
  const attendance = {}
  for (const student of roster) {
    const status = Object.hasOwn(marks, student.id) ? marks[student.id] : undefined
    if (!['Present', 'Absent', 'Late'].includes(status)) fail('Invalid or missing attendance mark.')
    attendance[student.id] = status
  }
  return { className: classRow.name, date, kind: 'confirmed', rosterSource: 'captured', students: roster, attendance }
}

export function installSchoolRoutes(app, db, authenticated, adminOnly) {
  function permitted(req, id) {
    const row = db.prepare('SELECT * FROM school_classes WHERE id=? AND school_id=?').get(id, req.account.school_id)
    if (!row) return null
    if (req.account.role !== 'admin' && !db.prepare('SELECT 1 FROM class_teachers WHERE class_id=? AND user_id=?').get(id, req.account.id)) return null
    return row
  }

  // The expected identity only denies mismatches; it never grants access.
  // This prevents a queued action in an old tab using a newly signed-in cookie.
  app.use('/api/classes', authenticated, (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) &&
      (req.body?.expectedUserId !== req.account.id || req.body?.expectedSchoolId !== req.account.school_id)) {
      return res.status(401).json({ error: 'The signed-in account changed. Reopen the workspace.' })
    }
    next()
  })
  app.get('/api/classes', authenticated, (req, res) => {
    const rows = req.account.role === 'admin'
      ? db.prepare('SELECT * FROM school_classes WHERE school_id=? ORDER BY name').all(req.account.school_id)
      : db.prepare('SELECT c.* FROM school_classes c JOIN class_teachers t ON t.class_id=c.id WHERE c.school_id=? AND t.user_id=? ORDER BY c.name').all(req.account.school_id, req.account.id)
    res.json({ userId: req.account.id, schoolId: req.account.school_id, classes: rows.map((row) => schoolClass(row, db)) })
  })
  app.post('/api/classes', authenticated, adminOnly, (req, res) => {
    let name, roster
    try { name = validName(req.body?.name); roster = students(req.body?.students) }
    catch (error) { return res.status(400).json({ error: error.message }) }
    const id = randomUUID()
    try { db.prepare('INSERT INTO school_classes(id,school_id,name,students_json) VALUES (?,?,?,?)').run(id, req.account.school_id, name, JSON.stringify(roster)) }
    catch (error) {
      if (error.message.includes('UNIQUE')) return res.status(409).json({ error: 'That class name already exists in this school.' })
      throw error
    }
    res.status(201).json({ class: schoolClass(db.prepare('SELECT * FROM school_classes WHERE id=?').get(id), db) })
  })
  app.put('/api/classes/:id/teachers', authenticated, adminOnly, (req, res) => {
    if (!permitted(req, req.params.id)) return res.status(404).json({ error: 'Class unavailable.' })
    const ids = req.body?.teacherIds
    if (!Array.isArray(ids) || ids.length > 100 || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== 'string' || !db.prepare("SELECT 1 FROM users WHERE id=? AND school_id=? AND role='teacher'").get(id, req.account.school_id))) {
      return res.status(400).json({ error: 'Assign teachers from your school only.' })
    }
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('DELETE FROM class_teachers WHERE class_id=?').run(req.params.id)
      for (const id of ids) db.prepare('INSERT INTO class_teachers(class_id,user_id) VALUES (?,?)').run(req.params.id, id)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    res.json({ ok: true })
  })
  app.put('/api/classes/:id/roster', authenticated, adminOnly, (req, res) => {
    const row = permitted(req, req.params.id)
    if (!row) return res.status(404).json({ error: 'Class unavailable.' })
    let roster
    try { roster = students(req.body?.students) } catch (error) { return res.status(400).json({ error: error.message }) }
    if (!Number.isSafeInteger(req.body?.baseRosterVersion)) return res.status(400).json({ error: 'Provide a roster version.' })
    const result = db.prepare('UPDATE school_classes SET students_json=?,roster_version=roster_version+1 WHERE id=? AND roster_version=?')
      .run(JSON.stringify(roster), row.id, req.body.baseRosterVersion)
    if (!result.changes) return res.status(409).json({ error: 'The roster changed. Reload before editing.' })
    res.json({ class: schoolClass(db.prepare('SELECT * FROM school_classes WHERE id=?').get(row.id), db) })
  })
  app.get('/api/classes/:id/registers', authenticated, (req, res) => {
    if (!permitted(req, req.params.id)) return res.status(404).json({ error: 'Class unavailable or no longer assigned.' })
    res.json({ userId: req.account.id, schoolId: req.account.school_id, records: db.prepare('SELECT * FROM school_registers WHERE class_id=? ORDER BY date DESC').all(req.params.id).map(remote) })
  })
  app.put('/api/classes/:id/registers/:date', authenticated, (req, res) => {
    const cls = permitted(req, req.params.id)
    if (!cls) return res.status(404).json({ error: 'Class unavailable or no longer assigned.' })
    if (req.body?.expectedUserId !== req.account.id || req.body?.expectedSchoolId !== req.account.school_id) {
      return res.status(401).json({ error: 'The signed-in account changed. Reopen your school workspace.' })
    }
    const { date } = req.params
    const { baseVersion, rosterVersion, mutationId } = req.body ?? {}
    if (!validDate(date) || !Number.isSafeInteger(baseVersion) || baseVersion < 0 || !Number.isSafeInteger(rosterVersion) || rosterVersion < 1 || typeof mutationId !== 'string' || !/^[a-f0-9-]{36}$/i.test(mutationId)) {
      return res.status(400).json({ error: 'Invalid register date, version or mutation ID.' })
    }
    // One transaction protects the version check and write from competing clients.
    db.exec('BEGIN IMMEDIATE')
    try {
      const previous = db.prepare('SELECT * FROM school_registers WHERE class_id=? AND date=?').get(cls.id, date)
      // Normalise fields before hashing; all requests still pass authorisation above.
      let normalised
      try { normalised = record(req.body, cls, date) }
      catch (error) { db.exec('ROLLBACK'); return res.status(400).json({ error: error.message }) }
      const hash = createHash('sha256').update(JSON.stringify({ normalised, baseVersion, rosterVersion })).digest('hex')
      const replay = db.prepare('SELECT * FROM register_mutations WHERE id=?').get(mutationId)
      if (replay) {
        db.exec('ROLLBACK')
        if (replay.user_id !== req.account.id || replay.class_id !== cls.id || replay.date !== date || replay.payload_hash !== hash) return res.status(409).json({ error: 'Mutation ID was reused for a different request.' })
        return res.json(JSON.parse(replay.response_json))
      }
      if ((previous?.version ?? 0) !== baseVersion) {
        db.exec('ROLLBACK')
        return res.status(409).json({ error: 'Another device changed this register. Your local copy has been kept.', conflict: 'record', current: previous ? remote(previous) : null })
      }
      if (!previous && cls.roster_version !== rosterVersion) {
        db.exec('ROLLBACK')
        return res.status(409).json({ error: 'The class roster changed. Review the new roster before submitting.', conflict: 'roster', class: schoolClass(cls, db) })
      }
      const expected = previous ? JSON.parse(previous.record_json).students : JSON.parse(cls.students_json)
      if (JSON.stringify(normalised.students) !== JSON.stringify(expected)) {
        db.exec('ROLLBACK')
        return res.status(400).json({ error: 'The student snapshot does not match the school register.' })
      }
      const version = baseVersion + 1
      db.prepare(`INSERT INTO school_registers(class_id,date,version,record_json,updated_by) VALUES (?,?,?,?,?)
        ON CONFLICT(class_id,date) DO UPDATE SET version=excluded.version,record_json=excluded.record_json,updated_by=excluded.updated_by`)
        .run(cls.id, date, version, JSON.stringify(normalised), req.account.id)
      const result = { classId: cls.id, date, version, record: normalised }
      db.prepare('INSERT INTO register_mutations(id,user_id,class_id,date,payload_hash,response_json) VALUES (?,?,?,?,?,?)')
        .run(mutationId, req.account.id, cls.id, date, hash, JSON.stringify(result))
      db.exec('COMMIT')
      res.json(result)
    } catch (error) { db.exec('ROLLBACK'); throw error }
  })
}
