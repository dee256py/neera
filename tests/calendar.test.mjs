import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import ts from '../node_modules/typescript/lib/typescript.js'
const dir = new URL('../node_modules/.tmp/calendar-tests/', import.meta.url)
mkdirSync(dir, {recursive:true})
writeFileSync(new URL('calendar.mjs',dir),ts.transpileModule(readFileSync(new URL('../src/ugandaCalendar.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText)
const {defaultCalendar,calendarDay}=await import(new URL('calendar.mjs',dir))
test('Uganda fixed holidays, Easter and non-recurring election dates',()=>{
 const c=defaultCalendar(2026)
 assert.equal(c.holidays.find(h=>h.name==='Good Friday').date,'2026-04-03')
 assert.equal(c.holidays.find(h=>h.name==='Easter Monday').date,'2026-04-06')
 assert.equal(c.holidays.find(h=>h.name==='Archbishop Janani Luwum Day').date,'2026-02-16')
 assert.equal(c.holidays.filter(h=>h.name.includes('election')).length,2)
 assert.equal(defaultCalendar(2027).holidays.filter(h=>h.name.includes('election')).length,0)
 assert.equal(defaultCalendar(2027).holidays.find(h=>h.name==='Easter Sunday').date,'2027-03-28')
})
test('Eid suggestions are tentative and unknown future dates are not invented',()=>{
 assert.equal(defaultCalendar(2026).holidays.find(h=>h.name==='Eid al-Fitr').confirmed,false)
 assert.equal(defaultCalendar(2027).holidays.find(h=>h.name==='Eid al-Fitr').date,'')
})
test('terms, selected weekdays and closures classify missing registers',()=>{
 const c=defaultCalendar(2026); c.terms=[{name:'Test',start:'2026-01-01',end:'2026-12-31'}]
 assert.equal(calendarDay('2026-06-03',c),'closed')
 assert.equal(calendarDay('2026-06-04',c),'expected')
 assert.equal(calendarDay('2026-06-06',c),'closed')
 c.weekdays.push(6);assert.equal(calendarDay('2026-06-06',c),'expected')
 assert.equal(calendarDay('2026-03-20',c),'review')
 c.holidays.find(h=>h.name==='Eid al-Fitr').confirmed=true
 assert.equal(calendarDay('2026-03-20',c),'closed')
})
test('missing year or terms are unknown; outside terms closed; no substitute Monday invented',()=>{
 assert.equal(calendarDay('2026-03-09'),'unknown')
 const c=defaultCalendar(2026);assert.equal(calendarDay('2026-03-09',c),'unknown')
 c.terms=[{name:'Test',start:'2026-03-01',end:'2026-03-31'}]
 assert.equal(calendarDay('2026-03-09',c),'expected')
 assert.equal(calendarDay('2026-04-01',c),'closed')
})
