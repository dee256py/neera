import { openDatabase } from './database.mjs'
import { createApp } from './app.mjs'
const db = openDatabase()
// Loopback only: this is a local development API, not a public deployment.
const server = createApp(db).listen(3001, '127.0.0.1', () => {
  console.log('Neera API running at http://127.0.0.1:3001')
})
function shutdown() { server.close(() => { db.close(); process.exit(0) }) }
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
