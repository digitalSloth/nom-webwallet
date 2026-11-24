import { CONNECT_TIMEOUT_MS } from '@/config'

/** The chain ID from the node's frontier momentum. Rejects on error, close, bad answer or timeout. */
export function probeChainId(url: string, timeoutMs = CONNECT_TIMEOUT_MS): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let socket: WebSocket | undefined
    let settled = false

    function settle(finish: () => void): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket?.close()
      } catch {
        // already closed
      }
      finish()
    }

    try {
      socket = new WebSocket(url)
    } catch (err) {
      reject(err instanceof Error ? err : new Error('Could not open the connection'))
      return
    }

    const timer = setTimeout(() => settle(() => reject(new Error('Timed out'))), timeoutMs)

    socket.addEventListener('open', () => {
      socket?.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'ledger.getFrontierMomentum',
          params: [],
        })
      )
    })
    socket.addEventListener('message', (event: MessageEvent) => {
      let chainId: unknown
      try {
        const body = JSON.parse(String(event.data))
        if (body?.id !== 1) return
        chainId = body.result?.chainIdentifier
      } catch {
        settle(() => reject(new Error('The node answered with invalid JSON')))
        return
      }
      if (typeof chainId === 'number' && Number.isSafeInteger(chainId) && chainId > 0) {
        settle(() => resolve(chainId as number))
      } else {
        settle(() => reject(new Error('The node returned no chain ID')))
      }
    })
    socket.addEventListener('error', () => settle(() => reject(new Error('Connection failed'))))
    socket.addEventListener('close', () =>
      settle(() => reject(new Error('Connection closed before an answer')))
    )
  })
}
