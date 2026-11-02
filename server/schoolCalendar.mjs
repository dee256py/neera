// Calendar changes use optimistic versions, just like attendance corrections.
export function validateCalendar(value) {
  if (!value || !Number.isInteger(value.year) || value.year < 2020 || value.year > 2100) throw new Error('Use a year from 2020 to 2100.')
  const date = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && s.startsWith(`${value.year}-`) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s
  const name = s => typeof s === 'string' && s.trim().length > 0 && s.length <= 120
  if (!Array.isArray(value.weekdays) || !value.weekdays.length || value.weekdays.length > 7 || new Set(value.weekdays).size !== value.weekdays.length || value.weekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error('Select valid teaching days.')
  if (!Array.isArray(value.terms) || value.terms.length > 12 || value.terms.some(t => !t || !name(t.name) || !date(t.start) || !date(t.end) || t.start > t.end)) throw new Error('Check term names and dates in the selected year.')
  const terms = [...value.terms].sort((a,b) => a.start.localeCompare(b.start))
  if (terms.some((t,i) => i && t.start <= terms[i-1].end)) throw new Error('Term dates must not overlap.')
  if (!Array.isArray(value.holidays) || value.holidays.length > 100 || value.holidays.some(h => !h || !name(h.name) || typeof h.confirmed !== 'boolean' || !(date(h.date) || h.date === '' && !h.confirmed))) throw new Error('Check holiday dates; confirmed holidays need a date.')
  return { year: value.year, weekdays: value.weekdays, terms: terms.map(t => ({ name:t.name.trim(), start:t.start, end:t.end })), holidays:value.holidays.map(h => ({ name:h.name.trim(), date:h.date, confirmed:h.confirmed })) }
}
export function installCalendarRoutes(app, db, authenticated, adminOnly) {
  app.get('/api/calendar', authenticated, (req,res) => {
    const calendars = db.prepare('SELECT version,data_json FROM school_calendars WHERE school_id=? ORDER BY year').all(req.account.school_id).map(r => ({ ...JSON.parse(r.data_json), version:r.version }))
    res.json({ userId:req.account.id, schoolId:req.account.school_id, calendars })
  })
  app.put('/api/calendar', authenticated, adminOnly, (req,res) => {
    if (req.body?.expectedUserId !== req.account.id || req.body?.expectedSchoolId !== req.account.school_id) return res.status(401).json({ error:'Account changed. Reopen the workspace.' })
    let calendar
    try { calendar = validateCalendar(req.body.calendar) } catch (e) { return res.status(400).json({ error:e.message }) }
    const base = req.body.baseVersion
    if (!Number.isSafeInteger(base) || base < 0) return res.status(400).json({ error:'Invalid calendar version.' })
    db.exec('BEGIN IMMEDIATE')
    try {
      const old = db.prepare('SELECT version FROM school_calendars WHERE school_id=? AND year=?').get(req.account.school_id,calendar.year)
      if ((old?.version ?? 0) !== base) { db.exec('ROLLBACK'); return res.status(409).json({ error:'Calendar changed elsewhere. Reload the saved calendar before editing again.' }) }
      db.prepare('INSERT INTO school_calendars(school_id,year,version,data_json) VALUES (?,?,?,?) ON CONFLICT(school_id,year) DO UPDATE SET version=excluded.version,data_json=excluded.data_json').run(req.account.school_id,calendar.year,base+1,JSON.stringify(calendar))
      db.exec('COMMIT'); res.json({ ok:true })
    } catch(e) { db.exec('ROLLBACK'); throw e }
  })
}
