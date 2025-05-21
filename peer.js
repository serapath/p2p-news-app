const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Protomux = require('protomux')
const c = require('compact-encoding')
const process = require('bare-process')

const topic_hex = 'ffb09601562034ee8394ab609322173b641ded168059d256f6a3d959b2dc6021'
const topic = b4a.from(topic_hex, 'hex')

start()

async function start () {
  const args = process.argv.slice(2)
  const name_index = args.indexOf('--name')
  const peer_name = 'native-' + (name_index !== -1 ? args[name_index + 1] : 'anonymous')

  const swarm = new Hyperswarm()
  const discovery = swarm.join(topic, { server: true, client: true })
  await discovery.flushed()

  console.log(`Joined swarm as ${peer_name}, listening for peers...`)

  // 🔁 Refresh discovery every 5 seconds
  setInterval(() => {
    swarm.join(topic, { server: true, client: true }).flushed().then(() => {
      console.log('🔄 Refreshed discovery')
    })
  }, 5000)

  swarm.on('connection', (socket, info) => {
    socket.write(peer_name + '\n')

    let remote_name = 'unknown'

    socket.once('data', (data) => {
      remote_name = b4a.toString(data).trim()
      console.log(`${remote_name} joined`)

      const mux = new Protomux(socket)

      const chat = mux.createChannel({
        protocol: 'chat-message',
        onopen () {
          console.log(`Protocol channel opened with ${remote_name}`)
        },
        onclose () {
          console.log(`Protocol channel closed with ${remote_name}`)
        }
      })

      const msg = chat.addMessage({
        encoding: c.string,
        onmessage (m) {
          console.log(`📩 Received from ${remote_name}:`, m)
          msg.send(`Hello ${remote_name}, this is ${peer_name}!`)
        }
      })

      chat.open()
    })

    socket.on('close', () => {
      console.log(`${remote_name} disconnected`)
    })

    socket.on('error', (err) => {
      console.log('Socket error:', err.message)
    })
  })
}
