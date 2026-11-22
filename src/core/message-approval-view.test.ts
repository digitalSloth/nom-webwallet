import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KeyStore } from 'znn-typescript-sdk'

import type { ApprovalAction } from '@/core/dapp-approvals'
import {
  MESSAGE_WARNINGS,
  POW_LIMIT_NOTE,
  labelLineBreakRuns,
  messageApprovalView,
} from '@/core/message-approval-view'
import { observeBox } from '@/shared/approval/scroll-gate'
import { envelopeLength, openMessage, type MessageContent } from '@/core/message-envelope'
import { messageSegments } from '@/core/message-guard'
import { sealMessageBlock } from '@/core/message-send'

type SendMessage = Extract<ApprovalAction, { kind: 'sendMessage' }>

const sender = KeyStore.fromEntropy(
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
).getKeyPair(0)
const recipient = KeyStore.fromEntropy(
  'f0e0d0c0b0a090807060504030201000ffeeddccbbaa99887766554433221100'
).getKeyPair(0)

function action(content: MessageContent): SendMessage {
  return {
    kind: 'sendMessage',
    to: recipient.address.toString(),
    recipientPublicKey: recipient.publicKey.toString('hex'),
    content,
    envelopeBytes: envelopeLength(content),
  }
}

describe('messageApprovalView', () => {
  const tricky: MessageContent = {
    body: 'Pay​ment to ‮abc‬ now\nline two',
    replyTo: 'cd'.repeat(32),
  }

  it('shows exactly the plaintext that the approval seals', () => {
    const request = action(tricky)
    const view = messageApprovalView(request, false)

    const block = sealMessageBlock(request, sender, 1)
    const opened = openMessage({
      ownSeed: recipient.privateKey,
      ownPublicKey: recipient.publicKey,
      counterpartyPublicKey: sender.publicKey,
      envelope: block.data,
      outgoing: false,
    })

    expect(opened).toEqual({ ok: true, ...tricky })
    if (!opened.ok) return
    expect(view.body).toEqual(messageSegments(opened.body))
    expect(view.to).toBe(block.toAddress.toString())
    expect(view.envelopeBytes).toBe(block.data.length)
  })

  it('shows hidden characters as U+XXXX labels and counts them', () => {
    const view = messageApprovalView(action(tricky), false)

    expect(view.body.filter((p) => p.hidden).map((p) => p.text)).toEqual([
      'U+200B',
      'U+202E',
      'U+202C',
    ])
    expect(view.hiddenCharCount).toBe(3)
    const shown = view.body.map((p) => p.text).join('')
    expect(shown).not.toContain('‮')
    expect(shown).not.toContain('​')
  })

  describe('line break runs', () => {
    const bodyOf = (body: string) => messageApprovalView(action({ body, replyTo: null }), false)

    it('labels a run of 3 or more line breaks with its length', () => {
      const view = bodyOf('hi' + '\n'.repeat(40) + 'hidden text')

      expect(view.body).toEqual([
        { text: 'hi', hidden: false },
        { text: '40 line breaks', hidden: true },
        { text: 'hidden text', hidden: false },
      ])
      expect(view.lineBreakRuns).toBe(1)
    })

    it('leaves one or two line breaks as they are', () => {
      const view = bodyOf('a\nb\n\nc')

      expect(view.body).toEqual([{ text: 'a\nb\n\nc', hidden: false }])
      expect(view.lineBreakRuns).toBe(0)
    })

    it('labels the smallest run and finds every run', () => {
      const view = bodyOf('a\n\n\nb\n\n\n\nc')

      expect(view.body.filter((p) => p.hidden).map((p) => p.text)).toEqual([
        '3 line breaks',
        '4 line breaks',
      ])
      expect(view.lineBreakRuns).toBe(2)
    })

    it('counts hidden characters apart from line break runs', () => {
      const view = bodyOf('a\u200B\n\n\nb')

      expect(view.hiddenCharCount).toBe(1)
      expect(view.lineBreakRuns).toBe(1)
    })
  })

  it('shortens the reply hash and shows none when there is no reply', () => {
    expect(messageApprovalView(action(tricky), false).replyTo).toBe('cdcdcdcd…cdcdcd')
    expect(messageApprovalView(action({ ...tricky, replyTo: null }), false).replyTo).toBeNull()
  })

  it('reports the size and the base plasma', () => {
    const content: MessageContent = {
      body: 'First encrypted message on Zenon.',
      replyTo: 'ab'.repeat(32),
    }
    const view = messageApprovalView(action(content), false)

    expect(view.envelopeBytes).toBe(141)
    expect(view.basePlasma).toBe(30588)
    expect(view.needsFusedPlasma).toBe(false)
  })

  it('flags a message that PoW cannot cover only above 1,080 bytes', () => {
    const at = (bytes: number, dynamic: boolean | null = false) =>
      messageApprovalView(
        {
          ...action({ body: 'x', replyTo: null }),
          envelopeBytes: bytes,
        },
        dynamic
      )

    expect(at(1080)).toMatchObject({ needsFusedPlasma: false, basePlasma: 94440 })
    expect(at(1081)).toMatchObject({ needsFusedPlasma: true, basePlasma: 94508 })
    expect(at(1081, true)).toMatchObject({ needsFusedPlasma: false, basePlasma: 94508 })
    expect(at(1081, null).needsFusedPlasma).toBe(true)
    expect(POW_LIMIT_NOTE).toBe(
      'Above 1,080 bytes your account needs fused plasma; PoW cannot cover it.'
    )
  })

  it('sizes the largest message at the 16,384 byte block limit', () => {
    const body = 'a'.repeat(16318)
    const request = action({ body, replyTo: null })

    expect(request.envelopeBytes).toBe(16365)
    expect(messageApprovalView(request, false).basePlasma).toBe(1133820)
  })
})

describe('observeBox', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubResizeObserver() {
    const observed: unknown[] = []
    let callback: () => void = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          callback = cb
        }
        observe(target: unknown) {
          observed.push(target)
        }
        disconnect = disconnect
      }
    )
    return { observed, fire: () => callback(), disconnect }
  }

  it('watches the box and its children, re-measures on resize and stops on request', () => {
    const ro = stubResizeObserver()
    const child = {}
    const box = { children: [child] } as unknown as HTMLElement
    const onChange = vi.fn()

    const stop = observeBox(box, onChange)
    ro.fire()

    expect(ro.observed).toEqual([box, child])
    expect(onChange).toHaveBeenCalledTimes(1)
    stop()
    expect(ro.disconnect).toHaveBeenCalled()
  })

  it('does nothing without ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined)

    expect(() => observeBox({ children: [] } as unknown as HTMLElement, vi.fn())()).not.toThrow()
  })

  it('is used by the shared gate that both screens call', () => {
    const gate = readFileSync('src/shared/approval/scroll-gate.ts', 'utf8')
    const web = readFileSync('src/apps/web/components/DappRequestDialog.vue', 'utf8')

    expect(gate).toContain('observeBox(box.value, measure)')
    expect(gate).toContain('stopObserving()')
    expect(web).toMatch(/<SignScreen[^>]*@unread="messageUnread = \$event"/s)
    expect(web).toContain('pickerFor !== null || messageUnread')
    expect(web).toContain('if (pickerFor.value !== null || messageUnread.value) return')
  })
})

describe('labelLineBreakRuns', () => {
  it('labels runs in a signed message the same way as in a sent one', () => {
    const { segments, runs } = labelLineBreakRuns(messageSegments('pay 1\n\n\n\n\nsend all'))

    expect(segments).toEqual([
      { text: 'pay 1', hidden: false },
      { text: '5 line breaks', hidden: true },
      { text: 'send all', hidden: false },
    ])
    expect(runs).toBe(1)
  })

  it('leaves hidden-character labels and short breaks alone', () => {
    const { segments, runs } = labelLineBreakRuns(messageSegments('a\u202Eb\n\nc'))

    expect(segments.filter((p) => p.hidden).map((p) => p.text)).toEqual(['U+202E'])
    expect(runs).toBe(0)
  })
})

describe('message warnings', () => {
  it('are the three lines of the spec, verbatim', () => {
    expect([...MESSAGE_WARNINGS]).toEqual([
      'Messages are permanent. They stay on chain and cannot be deleted.',
      'The fact that you messaged this address is public. Anyone can see the sender, recipient, time and size.',
      "If either account's key leaks later, every past message between you can be read.",
    ])
  })

  it('gates Send on the message being scrolled to the end', () => {
    const screen = readFileSync('src/shared/approval/EncryptedMessageScreen.vue', 'utf8')
    const gate = readFileSync('src/shared/approval/scroll-gate.ts', 'utf8')
    const host = readFileSync('src/apps/extension/approval/ApprovalHost.vue', 'utf8')

    expect(gate).toContain('el.scrollHeight > el.clientHeight')
    expect(gate).toContain('el.scrollTop + el.clientHeight >= el.scrollHeight')
    expect(gate).toContain('onUnread(false)')
    expect(screen).toContain('useScrollGate(bodyBox')
    expect(screen).toContain('@scroll="measure"')
    expect(screen).toContain('Scroll to read the whole message.')
    expect(screen).toContain("emit('unread', unread)")
    expect(host).toContain('@unread="messageUnread = $event"')
    expect(host).toContain('pickerFor !== null || messageUnread')
    expect(host).toContain('if (pickerFor.value !== null || messageUnread.value) return')
  })

  it('gates Sign on a long message being scrolled to the end and labels line break runs', () => {
    const screen = readFileSync('src/shared/approval/SignScreen.vue', 'utf8')
    const host = readFileSync('src/apps/extension/approval/ApprovalHost.vue', 'utf8')

    expect(screen).toContain('useScrollGate(messageBox')
    expect(screen).toContain('@scroll="measure"')
    expect(screen).toContain('Scroll to read the whole message.')
    expect(screen).toContain("emit('unread', unread)")
    expect(screen).toContain('labelLineBreakRuns(rawParts.value)')
    expect(host).toMatch(/<SignScreen[^>]*@unread="messageUnread = \$event"/s)
  })

  it('are rendered by the approval screen from the view, not retyped', () => {
    const screen = readFileSync('src/shared/approval/EncryptedMessageScreen.vue', 'utf8')

    expect(screen).toContain('v-for="warning in MESSAGE_WARNINGS"')
    expect(screen).toContain('v-for="(part, index) in view.body"')
    expect(screen).not.toContain('view.subject')
    expect(screen).toContain('v-if="view.needsFusedPlasma"')
    expect(screen).toContain('Size: {{ view.envelopeBytes }} bytes')
  })
})
