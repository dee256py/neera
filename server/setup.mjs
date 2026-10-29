import { createInterface } from 'node:readline/promises'
import { emitKeypressEvents } from 'node:readline'
import { openDatabase } from './database.mjs'
import { provisionSchool } from './accounts.mjs'

// Passwords are entered locally with echo disabled; never hard-code them in Git.
function secret(question) {
  if (!process.stdin.isTTY) throw new Error('Run setup in an interactive terminal.')
  process.stdout.write(question)
  emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  return new Promise((resolve, reject) => {
    let value = ''
    const finish = () => { process.stdin.off('keypress', onKey); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n') }
    function onKey(text, key = {}) {
      if (key.ctrl && key.name === 'c') { finish(); reject(new Error('Setup cancelled.')); return }
      if (key.name === 'return') { finish(); resolve(value); return }
      if (key.name === 'backspace') { value = value.slice(0, -1); return }
      if (text && !key.ctrl && !key.meta && !text.includes('\u001b')) value += text
    }
    process.stdin.on('keypress', onKey)
  })
}
const rl = createInterface({ input: process.stdin, output: process.stdout })
let db
try {
  const schoolName = await rl.question('School name (use a fictional test school): ')
  const name = await rl.question('Admin name: ')
  const email = await rl.question('Admin email: ')
  rl.close()
  const password = await secret('Password (12+ characters; typing is hidden): ')
  const confirmation = await secret('Repeat password: ')
  if (password !== confirmation) throw new Error('Passwords do not match.')
  db = openDatabase()
  await provisionSchool(db, { schoolName, name, email, password })
  console.log('School and admin created. Start the API, then sign in through Neera → School accounts.')
} catch (error) {
  console.error(error.message.includes('UNIQUE') ? 'That email is already registered. No new school was created.' : error.message)
  process.exitCode = 1
} finally { rl.close(); db?.close() }
