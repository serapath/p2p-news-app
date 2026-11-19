// can bare read back an empty block on our versions? (the random-access-file bug basim found) results in docs/autobase-checks.md
// random-access-file uses the global process.nextTick for empty reads and bare has no global process.
// our require('bare-process') is local per file so it doesnt help, require('bare-process/global') or a patch does
// 1. append 'a', '' and 'b'
// 2. read the empty block back and the one after it
// 3. same after reopenning the store

const runtime = typeof Bare === 'undefined' ? 'node' : 'bare'
const fs = require(runtime === 'bare' ? 'bare-fs' : 'fs')
const os = require(runtime === 'bare' ? 'bare-os' : 'os')
const path = require(runtime === 'bare' ? 'bare-path' : 'path')
const Corestore = require('corestore')
const b4a = require('b4a')
const proc = runtime === 'bare' ? require('bare-process') : process

const results = []
main().then(on_done, on_error)

async function main () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-block-check-'))
  let store = new Corestore(dir)
  let core = store.get({ name: 'log' })
  await core.ready()
  // 1.
  await core.append([b4a.from('a'), b4a.from(''), b4a.from('b')])
  show(`1. on ${runtime}: appended 'a', '' and 'b', length ${core.length}`, core.length === 3)
  // 2.
  const empty = await core.get(1).then(block => `'${b4a.toString(block)}'`, err => err.message)
  const next = await core.get(2).then(block => `'${b4a.toString(block)}'`, err => err.message)
  show(`2. reading the empty block back gives ${empty}, the next one ${next}`, empty === "''" && next === "'b'")
  // after that error store.close() never finishes and bare just exits with code 0, so stop here
  if (empty !== "''") return
  // 3.
  await store.close()
  store = new Corestore(dir)
  core = store.get({ name: 'log' })
  await core.ready()
  const again = await core.get(1).then(block => `'${b4a.toString(block)}'`, err => err.message)
  show(`3. after reopening the store the empty block gives ${again}`, again === "''")
}

/***************************************
HELPERS
***************************************/
function show (text, ok) {
  results.push(ok)
  console.log(`${ok ? 'ok    ' : 'NOT ok'} ${text}`)
}

function on_done () { proc.exit(results.every(ok => ok) ? 0 : 1) }
function on_error (err) {
  console.log('FAILED', err)
  proc.exit(1)
}
