// with 2 indexers the wait in packs pin() can go on forver. our autodisk, 2 devices, results in docs/autobase-checks.md
// run with: bare docs/pin-hang-check.js
// says "ok" while the hang is there, flip it once pin() is fixed. cause not known yet, the acks are the first suspect
// 1. b becomes an indexer
// 2. both write 4 times, then wait like pin() for 30s without writing

const fs = require('bare-fs')
const process = require('bare-process')
const os = require('bare-os')
const path = require('bare-path')
const Corestore = require('corestore')
const b4a = require('b4a')
const { create_autodisk } = require('../lib/node_modules/autodisk')

const LIMIT = 30000
const results = []
main().then(on_done, on_error)

async function main () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-hang-check-'))
  const store_a = new Corestore(path.join(dir, 'a'))
  const store_b = new Corestore(path.join(dir, 'b'))
  const a = create_autodisk({ store: store_a.namespace('pack') })
  await a.ready()
  const b = create_autodisk({ store: store_b.namespace('pack'), bootstrap: a.base.key })
  await b.ready()
  const streams = connect(store_a, store_b)
  // 1.
  await a.add_writer(b.base.local.key)
  for (let i = 0; i < 100 && !b.base.isIndexer; i++) await update_both(a, b)
  show(`1. b is an indexer: ${b.base.isIndexer}`, b.base.isIndexer)
  // 2.
  for (let i = 0; i < 4; i++) {
    await a.put('/main.js', b4a.from('v' + i))
    await b.put('/other' + i + '.js', b4a.from('x'))
  }
  const signed = a.base.view.drive.core.getBackingCore().session
  const start = Date.now()
  while (signed.length < a.base.view.drive.core.length && Date.now() - start < LIMIT) await update_both(a, b)
  const waiting = signed.length < a.base.view.drive.core.length
  show(`2. after ${Math.round((Date.now() - start) / 1000)}s the signed db core is at ${signed.length} of ${a.base.view.drive.core.length}, so pin() ${waiting ? 'would still be waiting' : 'would finish'}`, waiting)
  for (const stream of streams) stream.destroy()
}

/***************************************
HELPERS
***************************************/
async function update_both (a, b) {
  await a.base.update()
  await b.base.update()
  await sleep(50)
}

function connect (store_a, store_b) {
  const stream_a = store_a.replicate(true)
  const stream_b = store_b.replicate(false)
  stream_a.pipe(stream_b).pipe(stream_a)
  return [stream_a, stream_b]
}

function show (text, ok) {
  results.push(ok)
  console.log(`${ok ? 'ok    ' : 'NOT ok'} ${text}`)
}

function sleep (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function on_done () { process.exit(results.every(ok => ok) ? 0 : 1) }
function on_error (err) {
  console.log('FAILED', err)
  process.exit(1)
}
