// is fork 0 hard coded in autobase? plain autobase, 2 indexers, results in docs/autobase-checks.md
// run with: node docs/fork-check.js
// 1. the fork is part of what gets signed (treeSignable in hypercore lib/caps.js), so changing only the fork breaks the signatrue
// 2. a normal single writer core can truncate and sign fork 1 fine
// 3. the signed core of an autobase view has no keypair, so truncate is refused and autobase only appends to it
// 4. after a reorder only the in memory view forks, the signed cores stay 0

const path = require('path')
const os = require('os')
const fs = require('fs')
const Corestore = require('corestore')
const Autobase = require('autobase')
const b4a = require('b4a')

const results = []
main().then(on_done, on_error)

async function main () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-check-'))
  const store_a = new Corestore(path.join(dir, 'a'))
  const store_b = new Corestore(path.join(dir, 'b'))
  const a = make_base(store_a, null)
  await a.ready()
  const b = make_base(store_b, a.key)
  await b.ready()
  let streams = connect(store_a, store_b)
  await a.append({ add: hex(b.local.key) })
  await wait_for(() => b.isIndexer, [a, b])
  // both write while offline, so autobase has to reorder when they meet again
  for (const stream of streams) stream.destroy()
  for (let i = 0; i < 4; i++) {
    await a.append('a' + i)
    await b.append('b' + i)
  }
  streams = connect(store_a, store_b)
  await wait_signed([a, b], 9)
  const signed = signed_core(a)
  const tree = signed.core.tree
  console.log(`a's signed view core: length ${signed.length}, fork ${signed.fork}, ${signed.manifest.signers.length} signers, quorum ${signed.manifest.quorum}`)
  // 1. verify the indexers signature as it is, and again with only the fork changed to 1
  const as_signed = signed.core.verifier.verify(tree.batch(), tree.signature)
  const fork_1 = tree.batch()
  fork_1.fork = 1
  const as_fork_1 = signed.core.verifier.verify(fork_1, tree.signature)
  show(`1. the indexers signature verifies for fork 0 (${as_signed}) and fails for fork 1 (${as_fork_1})`, as_signed && !as_fork_1)
  // 2. a normal core with its own keypair can truncate and sign the new fork
  const plain = store_a.get({ name: 'plain' })
  await plain.ready()
  await plain.append(['x', 'y', 'z'])
  await plain.truncate(1)
  await plain.append('w')
  const plain_ok = plain.core.verifier.verify(plain.core.tree.batch(), plain.core.tree.signature)
  show(`2. a normal single writer core after truncate is on fork ${plain.fork}, length ${plain.length}, its own signature verifies: ${plain_ok}`, plain.fork === 1 && plain_ok)
  // 3. try to truncate the signed view core of the autobase
  const refused = await signed.truncate(signed.length - 1).then(() => 'truncated!', err => err.code || err.message)
  show(`3. truncating the signed view core of the autobase: ${refused}, fork still ${signed.fork}`, refused === 'SESSION_NOT_WRITABLE' && signed.fork === 0)
  // 4. the reorder above made the in memory views fork, the signed cores didnt
  const forks = [signed_core(a).fork, signed_core(b).fork, system_core(a).fork, system_core(b).fork]
  show(`4. after the reorder the in memory view fork is a ${a.view.fork} b ${b.view.fork}, signed view cores a ${forks[0]} b ${forks[1]}, system cores a ${forks[2]} b ${forks[3]}`, forks.every(fork => fork === 0))
  for (const stream of streams) stream.destroy()
}

/***************************************
HELPERS
***************************************/
function make_base (store, key) {
  return new Autobase(store, key, { valueEncoding: 'json', open: open_view, apply, ackInterval: 50, ackThreshold: 0 })
}

function open_view (store) { return store.get('log', { valueEncoding: 'json' }) }

async function apply (nodes, view, host) {
  for (const node of nodes) {
    if (node.value.add) await host.addWriter(b4a.from(node.value.add, 'hex'), { indexer: true })
    else await view.append(node.value)
  }
}

// the real hypercores behind the view and the system, they only ever hold signed blocks
function signed_core (base) { return base.view.getBackingCore().session }
function system_core (base) { return base.system.core.getBackingCore().session }

function connect (store_a, store_b) {
  const stream_a = store_a.replicate(true)
  const stream_b = store_b.replicate(false)
  stream_a.pipe(stream_b).pipe(stream_a)
  return [stream_a, stream_b]
}

async function wait_for (done, bases) {
  for (let i = 0; i < 300; i++) {
    for (const base of bases) await base.update()
    if (done()) return
    await sleep(100)
  }
  throw new Error('timed out')
}

// with 2 indexers the newest entries only get signed once more entries come in, so it keeps writing small ticks
async function wait_signed (bases, length) {
  for (let i = 0; i < 400; i++) {
    for (const base of bases) await base.update()
    if (bases.every(base => base.view.signedLength >= length)) return
    if (i % 10 === 9) await bases[0].append('tick')
    await sleep(100)
  }
  throw new Error('not signed')
}

function show (text, ok) {
  results.push(ok)
  console.log(`${ok ? 'ok    ' : 'NOT ok'} ${text}`)
}

function sleep (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function hex (buffer) { return b4a.toString(buffer, 'hex') }
function on_done () { process.exit(results.every(ok => ok) ? 0 : 1) }
function on_error (err) {
  console.log('FAILED', err)
  process.exit(1)
}
