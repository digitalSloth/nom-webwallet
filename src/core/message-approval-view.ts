import type { ApprovalAction } from './dapp-approvals'
import { basePlasma, POW_MAX_ENVELOPE_BYTES } from './message-envelope'
import { messageSegments, type MessageSegment } from './message-guard'

/** The three warnings every encrypted message approval shows, verbatim. */
export const MESSAGE_WARNINGS = [
  'Messages are permanent. They stay on chain and cannot be deleted.',
  'The fact that you messaged this address is public. Anyone can see the sender, recipient, time and size.',
  "If either account's key leaks later, every past message between you can be read.",
] as const

export const POW_LIMIT_NOTE =
  'Above 1,080 bytes your account needs fused plasma; PoW cannot cover it.'

export interface MessageApprovalView {
  to: string
  body: MessageSegment[]
  /** Short form of the parent message hash, or null. */
  replyTo: string | null
  envelopeBytes: number
  basePlasma: number
  /** True above the size PoW alone can pay for, while the node caps PoW (until Dynamic Plasma is active). */
  needsFusedPlasma: boolean
  hiddenCharCount: number
  /** Runs of 3 or more consecutive line breaks, shown in the body as `N line breaks` labels. */
  lineBreakRuns: number
}

const LINE_BREAK = /\r\n|\r|\n/g
const LINE_BREAK_RUN = /(?:\r\n|\r|\n){3,}/g

/**
 * Replaces each run of 3 or more consecutive line breaks with a highlighted
 * label, so a gap that pushes text out of sight is visible in the box.
 */
export function labelLineBreakRuns(parts: MessageSegment[]): {
  segments: MessageSegment[]
  runs: number
} {
  const segments: MessageSegment[] = []
  let runs = 0
  for (const part of parts) {
    if (part.hidden) {
      segments.push(part)
      continue
    }
    let last = 0
    for (const match of part.text.matchAll(LINE_BREAK_RUN)) {
      if (match.index > last)
        segments.push({ text: part.text.slice(last, match.index), hidden: false })
      const count = match[0].match(LINE_BREAK)?.length ?? 0
      segments.push({ text: `${count} line breaks`, hidden: true })
      runs++
      last = match.index + match[0].length
    }
    if (last < part.text.length) segments.push({ text: part.text.slice(last), hidden: false })
  }
  return { segments, runs }
}

/**
 * What the approval screen renders. It reads the same content object that
 * the approval seals, so the text on screen is the text that gets encrypted,
 * with hidden characters shown as `U+XXXX` labels.
 */
export function messageApprovalView(
  action: Extract<ApprovalAction, { kind: 'sendMessage' }>,
  dynamic: boolean | null
): MessageApprovalView {
  const { content } = action
  const hiddenBody = messageSegments(content.body)
  const { segments: body, runs: lineBreakRuns } = labelLineBreakRuns(hiddenBody)
  return {
    to: action.to,
    body,
    replyTo:
      content.replyTo === null
        ? null
        : `${content.replyTo.slice(0, 8)}…${content.replyTo.slice(-6)}`,
    envelopeBytes: action.envelopeBytes,
    basePlasma: basePlasma(action.envelopeBytes),
    needsFusedPlasma: dynamic !== true && action.envelopeBytes > POW_MAX_ENVELOPE_BYTES,
    hiddenCharCount: hiddenBody.filter((part) => part.hidden).length,
    lineBreakRuns,
  }
}
