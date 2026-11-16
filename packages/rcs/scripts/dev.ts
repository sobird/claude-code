const specs: { label: string; cmd: string[] }[] = [
  { label: 'web', cmd: ['bunx', 'next', 'dev', '--port', '3000'] },
  { label: 'gateway', cmd: ['bun', '--watch', 'server/index.ts'] },
]

async function pipeWithPrefix(stream: ReadableStream<Uint8Array>, label: string) {
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  let pending = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    pending += decoder.decode(value, { stream: true })
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) console.log(`[${label}] ${line}`)
  }
  if (pending) console.log(`[${label}] ${pending}`)
}

const children = specs.map(({ label, cmd }) => {
  const child = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  void pipeWithPrefix(child.stdout, label)
  void pipeWithPrefix(child.stderr, label)
  return child
})

let shuttingDown = false

function shutdown(code: number): never {
  if (!shuttingDown) {
    shuttingDown = true
    for (const child of children) child.kill()
  }
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

const exits = await Promise.all(children.map((child) => child.exited))
shutdown(exits.some((code) => code !== 0) ? 1 : 0)


