const b4a = require('b4a')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const sodium = require('sodium-universal')
const crypto = require("hypercore-crypto")
const process = require("bare-process")
const fs = require('bare-fs').promises

const topic = b4a.from('ffb09601562034ee8394ab609322173b641ded168059d256f6a3d959b2dc6021', 'hex')

start()

/******************************************************************************
  START
******************************************************************************/
async function start(flag) { 
  const parsedArgs = parse(process.argv.slice(2))
  const validatedArgs = validate(parsedArgs)
  const name = validatedArgs['--name']
  const label = `\x1b[${process.pid % 2 ? 31 : 34}m[peer-${name}]\x1b[0m`
  
  console.log(label, 'start')

  const opts = {
   namespace: 'noisekeys',
   seed: crypto.randomBytes(32),
   name: 'noise'
  }
  const { publicKey, secretKey } = create_noise_keypair (opts)
  console.log(label, { peerkey: publicKey.toString('hex')})
  const keyPair = { publicKey, secretKey }
  const store = new Corestore(`./storage-${name}`)
  const core = store.get({ name: 'test-core' })
  await core.ready()
  console.log(label, `✅ Successfully created a new core with the key`)
  console.log(label, { corekey: core.key.toString('hex') })
  await core.append('Hello, peer!')
  const bootstrap = JSON.parse(await fs.readFile('bootstrap.json', 'utf-8'))
  const swarm = new Hyperswarm({ keyPair, bootstrap })
  swarm.on('connection', onconnection)
  console.log(label, 'Joining swarm')
  swarm.join(topic, {server: true, client: true})
  swarm.flush()
  console.log("Swarm Joined, looking for peers")
  let iid = null 

  async function onconnection(socket, info) {
    console.log("New Peer Joined, Their Public Key is: ", info.publicKey.toString('hex'))
    socket.on('error', onerror)
    console.log("Sending our core key to peer")
    socket.write(core.key.toString('hex'))

  
    store.replicate(socket)

  
    iid = setInterval(append_more, 1000)

    socket.once('data', (data) => {
      const received_key = b4a.toString(data).trim()
      console.log("Received core key from peer:", received_key)
      
     
      const clonedCore = store.get(b4a.from(received_key, 'hex'))
      clonedCore.on('append', onappend)
      clonedCore.ready().then(async () => {
        console.log("Cloned core ready:", clonedCore.key.toString('hex'))
        
      
        const unavailable = []
        if (clonedCore.length) {
          for (var i = 0, L = clonedCore.length; i < L; i++) {
            const raw = await clonedCore.get(i, { wait: false })
            if (raw) console.log(label, 'local:', { i, message: raw.toString('utf-8') })
            else unavailable.push(i)
          }
        }

        
        for (var i = 0, L = unavailable.sort().length; i < L; i++) {
          const raw = await clonedCore.get(i)
          console.log(label, 'download:', { i, message: raw.toString('utf-8') })
        }
      })
    })
  }

  function onerror(err) {
    clearInterval(iid)
    console.log(label, 'socket error', err)
  }

  function append_more() {
    const time = Math.floor(process.uptime())
    const stamp = `${time/60/60|0}h:${time/60|0}m:${time%60}s`
    core.append(`uptime: ${stamp}`)
  }

  async function onappend() {
    const L = core.length
    if (!flag) {
      flag = true
      for (var i = 0; i < L; i++) {
        const raw = await core.get(i)
        console.log(label, 'download old:', { i, message: raw.toString('utf-8') })
      }
    }
    console.log(label, "notification: 📥 New data available", L)
    const raw = await core.get(L)
    console.log(label, { i: L, message: raw.toString('utf-8') })
  }
}

/******************************************************************************
  HELPER
******************************************************************************/


function create_noise_keypair ({ namespace, seed, name }) {
  const noiseSeed = derive_seed(namespace, seed, name)
  const publicKey = b4a.alloc(32)
  const secretKey = b4a.alloc(64)
  if (noiseSeed) sodium.crypto_sign_seed_keypair(publicKey, secretKey, noiseSeed)
  else sodium.crypto_sign_keypair(publicKey, secretKey)
  return { publicKey, secretKey }
}

function derive_seed (primaryKey, namespace, name) {
  if (!b4a.isBuffer(namespace)) namespace = b4a.from(namespace) 
  if (!b4a.isBuffer(name)) name = b4a.from(name)
  if (!b4a.isBuffer(primaryKey)) primaryKey = b4a.from(primaryKey)
  const out = b4a.alloc(32)
  sodium.crypto_generichash_batch(out, [namespace, name, primaryKey])
  return out
}

function parse (L) {
  const arr = []
  for (var i = 0; i < L.length; i += 2) arr.push([L[i], L[i+1]])
  return Object.fromEntries(arr)
}

function validate (opts) {
  if (!opts['--name']) throw new Error('requires flag: --name <name_string>')
  return opts
}
