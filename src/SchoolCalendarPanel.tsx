import { useEffect, useState } from 'react'
import { schoolApi, SchoolApiError } from './schoolApi'
import type { SchoolSession } from './schoolApi'
import { defaultCalendar, holidaySource } from './ugandaCalendar'
import type { SchoolCalendar } from './ugandaCalendar'

function CalendarEditor({ initial, session, saved }: { initial: SchoolCalendar; session: SchoolSession; saved: () => void }) {
  const [value, setValue] = useState(initial)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      await schoolApi('/calendar', 'PUT', { calendar:value, baseVersion:initial.version, expectedUserId:session.user.id, expectedSchoolId:session.user.schoolId })
      setMessage('School calendar saved.'); saved()
    } catch(e) { setMessage(e instanceof Error ? e.message : 'Save failed. Your edits remain on this screen.') }
    finally { setBusy(false) }
  }
  return <fieldset disabled={busy} className="calendar-editor">
    <legend>Edit {value.year} school calendar</legend>
    <h3>Teaching days</h3>
    <div className="action-buttons">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,i) => <label key={day}><input type="checkbox" checked={value.weekdays.includes(i)} onChange={e => setValue({ ...value, weekdays:e.target.checked ? [...value.weekdays,i] : value.weekdays.filter(d => d !== i) })} /> {day}</label>)}</div>
    <h3>Terms</h3><p>Enter your school’s actual term dates. No terms means reports cannot identify expected school days.</p>
    {value.terms.map((term,i) => <div className="backup-panel" key={i}>
      <label>Term name<input className="student-search" value={term.name} onChange={e => setValue({ ...value, terms:value.terms.map((t,j) => j === i ? {...t,name:e.target.value} : t) })} /></label>
      <div className="report-controls">{(['start','end'] as const).map(field => <label key={field}>{field === 'start' ? 'First day' : 'Last day'}<input className="student-search" type="date" min={`${value.year}-01-01`} max={`${value.year}-12-31`} value={term[field]} onChange={e => setValue({...value,terms:value.terms.map((t,j) => j === i ? {...t,[field]:e.target.value} : t)})} /></label>)}</div>
      <button className="secondary-button" onClick={() => setValue({...value,terms:value.terms.filter((_,j) => j !== i)})}>Remove term</button>
    </div>)}
    <button className="secondary-button" disabled={value.terms.length >= 12} onClick={() => setValue({...value,terms:[...value.terms,{name:`Term ${value.terms.length+1}`,start:'',end:''}]})}>Add term</button>
    <h3>Public holidays and school closures</h3>
    <p>Tick “Confirmed closure” only when the date is known. Unconfirmed dated holidays are flagged for review in reports. Confirm Eid dates from an official announcement. Add special holidays or substitute days when announced.</p>
    {value.holidays.map((holiday,i) => <div className="backup-panel" key={i}>
      <label>Holiday name<input className="student-search" value={holiday.name} maxLength={120} onChange={e => setValue({...value,holidays:value.holidays.map((h,j) => j === i ? {...h,name:e.target.value} : h)})} /></label>
      <label>Date<input className="student-search" type="date" min={`${value.year}-01-01`} max={`${value.year}-12-31`} value={holiday.date} onChange={e => setValue({...value,holidays:value.holidays.map((h,j) => j === i ? {...h,date:e.target.value} : h)})} /></label>
      <label className="filter-label"><input type="checkbox" checked={holiday.confirmed} onChange={e => setValue({...value,holidays:value.holidays.map((h,j) => j === i ? {...h,confirmed:e.target.checked} : h)})} />Confirmed closure</label>
      <button className="secondary-button" onClick={() => setValue({...value,holidays:value.holidays.filter((_,j) => j !== i)})}>Remove holiday</button>
    </div>)}
    <div className="action-buttons"><button className="secondary-button" disabled={value.holidays.length >= 100} onClick={() => setValue({...value,holidays:[...value.holidays,{name:'',date:'',confirmed:false}]})}>Add closure</button>
    <button className="primary-button" onClick={() => void save()}>{busy ? 'Saving…' : 'Save school calendar'}</button></div>
    <p role="status">{message}</p>
  </fieldset>
}

export default function SchoolCalendarPanel({ session, refresh, onCalendars }: { session: SchoolSession; refresh: number; onCalendars: (value: SchoolCalendar[]) => void }) {
  const [calendars, setCalendars] = useState<SchoolCalendar[]>([])
  const [year, setYear] = useState(new Date().getFullYear())
  const [notice, setNotice] = useState('Loading calendar…')
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const cacheKey = `neera:calendar:v1:${session.user.schoolId}:${session.user.id}`
  useEffect(() => {
    let active = true
    async function load() {
      let cached: SchoolCalendar[] = []
      try { const parsed: unknown = JSON.parse(localStorage.getItem(cacheKey) ?? '[]'); if (Array.isArray(parsed) && parsed.every(c => c && Number.isInteger(c.year) && Number.isInteger(c.version) && Array.isArray(c.terms) && c.terms.every((t: {name?: unknown;start?:unknown;end?:unknown} | null) => t && typeof t.name === 'string' && typeof t.start === 'string' && typeof t.end === 'string') && Array.isArray(c.holidays) && c.holidays.every((h: {name?:unknown;date?:unknown;confirmed?:unknown} | null) => h && typeof h.name === 'string' && typeof h.date === 'string' && typeof h.confirmed === 'boolean') && Array.isArray(c.weekdays) && c.weekdays.every((d: unknown) => Number.isInteger(d)))) cached = parsed }
      catch { /* A damaged optional cache must not prevent attendance opening. */ }
      if (active) { setCalendars(cached); onCalendars(cached) }
      try {
        const result = await schoolApi<{userId:string;schoolId:string;calendars:SchoolCalendar[]}>('/calendar')
        if (result.userId !== session.user.id || result.schoolId !== session.user.schoolId) throw new SchoolApiError('Account changed. Reopen the workspace.', 401)
        if (!active) return
        setCalendars(result.calendars); onCalendars(result.calendars)
        try { localStorage.setItem(cacheKey,JSON.stringify(result.calendars)); setNotice('Latest saved school calendar loaded.') }
        catch { setNotice('Calendar loaded, but could not cache it for offline use.') }
      } catch(e) { if (active) {
        if (e instanceof SchoolApiError && [401,403].includes(e.status)) { setCalendars([]); onCalendars([]); setNotice('Sign in again to load your school calendar.') }
        else setNotice(`Using cached calendar if available. ${e instanceof Error ? e.message : 'Refresh failed.'}`)
      } }
      finally { if (active) setLoading(false) }
    }
    void load()
    return () => { active = false }
  }, [cacheKey, session.user.id, session.user.schoolId, refresh, reload, onCalendars])
  const calendar = calendars.find(c => c.year === year)
  const shown = calendar ?? defaultCalendar(year)
  return <details className="backup-panel">
    <summary>School calendar and Uganda public holidays</summary>
    <p role="status">{notice}</p>
    <label>Calendar year<select className="student-search" value={year} onChange={e => setYear(Number(e.target.value))}>{Array.from({length:81},(_,i) => 2020+i).map(y => <option key={y}>{y}</option>)}</select></label>
    <p>Holiday defaults were checked on 2 November 2026. Future special declarations require an update. <a href={holidaySource} target="_blank" rel="noreferrer">Uganda government holiday reference</a>.</p>
    <p>{calendar ? 'Saved calendar used by reports.' : 'Suggested calendar only — an admin must save it and set terms before reports use it.'}</p>
    <p>Eid al-Fitr and Eid al-Adha dates require annual confirmation. No automatic substitute Mondays are added.</p>
    <button className="secondary-button" onClick={() => { setLoading(true); setReload(r => r+1) }}>Reload saved calendar (discards unsaved edits)</button>
    {session.user.role === 'admin' && !loading ? <CalendarEditor key={`${year}:${calendar?.version ?? 0}:${reload}`} initial={shown} session={session} saved={() => { setLoading(true); setReload(r => r+1) }} /> : <>
      <p>{calendar?.terms.map(t => `${t.name}: ${t.start} to ${t.end}`).join(' · ') || 'Term dates not configured.'}</p>
      <ul>{shown.holidays.map((h,i) => <li key={i}>{h.date || 'Date to be announced'} · {h.name}{h.confirmed ? '' : ' — needs confirmation'}</li>)}</ul>
    </>}
    <p className="storage-note">Calendar edits require a connection and admin access. Saved calendars live in the school database; attendance JSON backups do not include calendar settings.</p>
  </details>
}
