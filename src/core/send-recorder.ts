/**
 * Hook for recording a send while it runs, so another document can tell a
 * send that finished from one whose document closed mid-way. The default
 * recorder does nothing; the extension installs one backed by session
 * storage and the web app one backed by IndexedDB.
 */

export interface SendContext {
  kind: 'send' | 'receive' | 'contract'
  title: string
  from: string
  /** Raw base units. */
  amount?: string
  decimals?: number
  symbol?: string
  tokenStandard?: string
  recipient?: string
  origin?: string
  /** The line under the PoW overlay title, e.g. 'Sending 250 ZNN'. */
  progress?: string
  /** The contract method and target this send calls, e.g. `Token.Burn:zts1...`. See contract-guard. */
  call?: string
  /** Set for an auto-receive: the PoW overlay stays hidden and the interrupted-send check drops the record unless it was published. */
  background?: boolean
}

export type TxMeta = Omit<SendContext, 'from'>

export interface SendRecording {
  /** The send is not published until a returned promise resolves. */
  publishing(hash: string): void | Promise<void>
  published(hash: string): void
  abandon(): void
  /** Stops the heartbeat and hands the stored record to the interrupted-send check. The record is kept. */
  detach(): void
}

export interface SendRecorder {
  begin(context: SendContext): SendRecording
  release(hash: string): Promise<void>
  /** The context of every send record still stored on this device. Absent when the recorder keeps none. */
  stored?(): Promise<SendContext[]>
}

const noopRecording: SendRecording = {
  publishing() {},
  published() {},
  abandon() {},
  detach() {},
}

const noopRecorder: SendRecorder = {
  begin: () => noopRecording,
  release: () => Promise.resolve(),
}

let recorder: SendRecorder = noopRecorder

export function setSendRecorder(next: SendRecorder): void {
  recorder = next
}

export function getSendRecorder(): SendRecorder {
  return recorder
}
