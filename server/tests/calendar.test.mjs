import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { openDatabase } from '../database.mjs'
import { provisionSchool } from '../accounts.mjs'
import { createApp } from '../app.mjs'
import { validateCalendar } from '../schoolCalendar.mjs'
const db=openDatabase(':memory:')
const password='Fictional calendar test password!'
for(const name of ['a','b'])await provisionSchool(db,{schoolName:name,name,email:`${name}@example.test`,password})
const server=createApp(db).listen(0,'127.0.0.1');await once(server,'listening')
const base=`http://127.0.0.1:${server.address().port}/api`
async function call(path,actor,method='GET',body){return fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Neera-Client':'web',Origin:'http://localhost:5173',...(actor?{Cookie:actor.cookie}:{})},...(body?{body:JSON.stringify(body)}:{})})}
async function login(email){const r=await call('/auth/login,null'.split(',')[0],null,'POST',{email,password});const d=await r.json();return {...d.user,cookie:r.headers.get('set-cookie').split(';')[0]}}
const a=await login('a@example.test'),b=await login('b@example.test')
const calendar={year:2026,terms:[{name:'Term 3',start:'2026-09-01',end:'2026-12-10'}],weekdays:[1,2,3,4,5],holidays:[{name:'Independence Day',date:'2026-10-09',confirmed:true}]}
const payload={calendar,baseVersion:0,expectedUserId:a.id,expectedSchoolId:a.schoolId}
try{
 await test('calendar endpoints require authentication',async()=>assert.equal((await call('/calendar')).status,401))
 await test('saved calendar scoped to school and readable by teachers',async()=>{
  assert.equal((await call('/calendar',a,'PUT',payload)).status,200)
  assert.equal((await (await call('/calendar',a)).json()).calendars[0].version,1)
  assert.deepEqual((await (await call('/calendar',b)).json()).calendars,[])
  await call('/users',a,'POST',{name:'Teacher',email:'t@example.test',password})
  const t=await login('t@example.test')
  assert.equal((await (await call('/calendar',t)).json()).calendars.length,1)
  assert.equal((await call('/calendar',t,'PUT',{...payload,expectedUserId:t.id})).status,403)
 })
 await test('stale calendar edits cannot overwrite another admin version',async()=>assert.equal((await call('/calendar',a,'PUT',payload)).status,409))
 await test('switched identities cannot save into another school',async()=>assert.equal((await call('/calendar',b,'PUT',payload)).status,401))
 await test('invalid dates, overlapping terms, weekdays and confirmed undated holidays rejected',()=>{
  for(const patch of [{terms:[{name:'Bad',start:'2026-02-30',end:'2026-03-03'}]},{terms:[calendar.terms[0],calendar.terms[0]]},{weekdays:[]},{weekdays:[7]},{holidays:[{name:'Eid',date:'',confirmed:true}]}]) assert.throws(()=>validateCalendar({...calendar,...patch}))
 })
 await test('invalid save is atomic and later valid update increments version',async()=>{
  assert.equal((await call('/calendar',a,'PUT',{...payload,baseVersion:1,calendar:{...calendar,weekdays:[]}})).status,400)
  assert.equal((await (await call('/calendar',a)).json()).calendars[0].version,1)
  assert.equal((await call('/calendar',a,'PUT',{...payload,baseVersion:1})).status,200)
  assert.equal((await (await call('/calendar',a)).json()).calendars[0].version,2)
 })
}finally{await new Promise(resolve=>server.close(resolve));db.close()}
