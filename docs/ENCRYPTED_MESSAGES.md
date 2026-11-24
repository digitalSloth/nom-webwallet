## Encrypted Messages

The reference implementation is `src/core/message-envelope.ts`, tested against the shared vector by `src/core/message-envelope.test.ts`.

### Overview

Encrypted messages let one Zenon account write a private note to another. A message is a zero-amount send block whose `data` field carries an encrypted envelope. Only the two accounts can read it, with their own keys. Nothing on chain checks the envelope: wallets write and read it, and indexers only find and store it.

Messages are closer to email than to chat. Each one is a permanent, signed, paid-for block. Clients group them by counterparty into one conversation per pair of accounts. There is no subject: a message is a body, with an optional reference to the message it answers.

The protocol is stateless. Every message stands alone: no message changes how another is read, and there is no ordering or validity state to replay.

---

### Terminology

RFC-2119 terms throughout: **MUST** (required), **MUST NOT** (prohibited), **SHOULD** (recommended), **MAY** (optional).

- **Writer**: the account that signs the send block.
- **Reader**: either party opening the message. Both the writer and the recipient can open it.
- **Envelope**: the full `data` field of the block.
- **Content**: the plaintext inside the envelope, before padding.
- **Box key**: the shared key both parties derive from their own private key and the other's public key.

---

### Transport

A message MUST be a user send block (block type 2) with:

| Field           | Value                                                     |
| --------------- | --------------------------------------------------------- |
| `toAddress`     | The recipient. A user address, never an embedded contract |
| `tokenStandard` | ZNN, `zts1znnxxxxxxxxxxxxx9z4ulx`                         |
| `amount`        | `0`                                                       |
| `data`          | The envelope                                              |

The recipient never needs to receive the block to read it. A message to oneself is valid: the writer and the recipient are the same account.

Data on any other block type, or on a send to an embedded contract, is not a message and MUST be ignored.

---

### Envelope

| Offset | Bytes  | Field                           |
| ------ | ------ | ------------------------------- |
| 0      | 4      | Marker `ff 7a 6d 73`            |
| 4      | 1      | Version `01`                    |
| 5      | 24     | Nonce                           |
| 29     | 16     | Poly1305 tag                    |
| 45     | 32 × k | Encrypted padded content, k ≥ 1 |

- `0xff` never starts UTF-8 text, so no plain-text memo can be mistaken for a message.
- The version byte governs the whole layout. A new layout is a new version. There is no separate kind byte.
- The nonce MUST come from a cryptographically secure random source, fresh for every message.
- Bytes 29 onward are exactly libsodium's `crypto_box_easy(padded, nonce, recipientX25519Public, writerX25519Secret)` output, tag first.
- The envelope is 45 bytes of overhead plus a multiple of 32. The smallest is 77 bytes.

---

### Content

The content is encrypted, so its structure is private.

| Offset | Bytes | Field                                                                                         |
| ------ | ----- | --------------------------------------------------------------------------------------------- |
| 0      | 1     | Flags                                                                                         |
| 1      | 32    | Reply-to: the block hash of the message this one answers. Present only when flag bit 1 is set |
| next   | ≥ 1   | Body, UTF-8                                                                                   |

**Flags**

| Bit | Meaning                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Set when the writer's Ed25519 public key sorts below the other party's: bytewise, at the first differing byte, as unsigned values. Equal keys (a message to oneself) leave it clear |
| 1   | A reply-to hash follows                                                                                                                                                             |
| 2–7 | MUST be zero                                                                                                                                                                        |

Bit 0 binds the writer. The box key is the same in both directions, so without it the recipient could post the writer's ciphertext back to the writer as their own.

**Body**

- The body MUST be at least one byte of valid UTF-8.
- The body is plain text. Line breaks are allowed. Readers MUST render it as text, never as HTML or markdown.

**Reply-to**

- Writers MAY set it. A reader that shows conversations in order MAY ignore it.
- The hash MUST NOT be trusted to point at a message in the same conversation. Readers that show it SHOULD look the parent up in the conversation and drop the reference when it is not there.

---

### Padding

The content is padded with ISO/IEC 7816-4 to a multiple of 32 bytes, the same as libsodium `sodium_pad(buf, 32)`: append `0x80`, then `0x00` bytes until the length is a multiple of 32. At least one byte is always added, so a 32-byte content pads to 64.

Padding hides the exact length for an average cost of 16 bytes (about 1,088 plasma). Size stays visible to the nearest 32 bytes.

---

### Cryptography

#### Key Derivation

Zenon accounts use Ed25519 keypairs. Each party converts them to X25519 with libsodium's `crypto_sign_ed25519_sk_to_curve25519` (own 32-byte seed: SHA-512, then clamped) and `crypto_sign_ed25519_pk_to_curve25519` (the other party's public key). No new key infrastructure is required.

A public key that the conversion refuses (non-canonical, small order or mixed order) MUST be refused by both writer and reader.

#### Box Key

`boxKey = HSalsa20(X25519(ownSecret, otherPublic), zero 16-byte input)`, which is libsodium's `crypto_box_beforenm`. Both parties derive the same key, so the writer can read their own sent messages and both sides read the whole conversation.

Implementations SHOULD zero the X25519 secret, the shared secret and the box key after use.

#### Writing

1. Look up the recipient's Ed25519 public key. Every block an account publishes, send or receive, carries it. If the recipient has published no block, abort and say so: the recipient needs to send or receive anything first.
2. Check that the key derives the recipient address. If it does not, abort.
3. Build the content, pad it, and seal it: `XSalsa20-Poly1305(boxKey, nonce)` over the padded content.
4. Write the envelope and publish the send block.

#### Reading

1. Take the counterparty's public key: the recipient's for an outgoing message, the writer's for an incoming one.
2. Derive the box key and open the ciphertext. A failed tag means the message cannot be read with this account.
3. Remove the padding, then parse the content and apply **Reader Rules**.

---

### Reader Rules

Each envelope opens to exactly one result:

| Result               | When                                                        |
| -------------------- | ----------------------------------------------------------- |
| `notMessage`         | Fewer than 5 bytes, or the first 4 bytes are not the marker |
| `unsupportedVersion` | The version byte is not `01`                                |
| `unreadable`         | Any rule below fails                                        |
| `ok`                 | `body` and `replyTo` (lower-case hex, or `null`)            |

`unreadable` covers every failure after the version check, and readers MUST NOT say which:

- Length below 77, or length minus 45 not a multiple of 32
- Either public key refused by the X25519 conversion
- The tag fails
- The padding is invalid: the `0x80` byte must sit in the last 32 bytes, as `sodium_unpad` requires
- Flag bits 2 to 7 are set
- Flag bit 1 is set and fewer than 32 bytes follow the flags
- The body is empty
- The body is not valid UTF-8, decoded strictly (`TextDecoder` with `fatal: true` and `ignoreBOM: true`)
- Bit 0 does not match the writer the caller states

---

### Limits and Cost

All from go-zenon. Clients enforce the limits; the chain enforces only the first.

| Fact                                    | Value                     |
| --------------------------------------- | ------------------------- |
| Max block `data`                        | 16,384 bytes              |
| Base plasma of a send to a user address | 21,000 + 68 per data byte |
| Plasma that PoW can cover per block     | 94,500                    |
| Plasma per fused QSR                    | 2,100                     |

Derived:

- Largest envelope: 16,365 bytes (45 + 16,320). The body is at most 16,318 bytes without a reply-to, and 16,286 bytes with one.
- Largest envelope PoW alone can pay for: 1,069 bytes (93,692 plasma). Above that the writer needs fused QSR.
- Smallest envelope: 77 bytes, 26,236 plasma.
- Clients SHOULD show the writer the envelope size, the base plasma and whether PoW can cover it, before signing.

After the Dynamic Plasma spork activates, the node prices plasma and the PoW cap lifts. Base plasma stays a lower bound.

---

### Indexing

Indexers find messages; they never decrypt them.

- A block is a message candidate when it is a user send to a user address and its `data` is at least 77 bytes and starts with the marker.
- Indexers SHOULD record every version, not only `01`, so a newer client can read it later. Clients show unknown versions as unsupported.
- Store at least: network, block hash, writer, recipient, version (byte 4), envelope length, the envelope itself, momentum height and block time.
- Each block hash is one message. Recording is idempotent on `(network, block hash)`.

> **Implementer note (base64 views):** where block data is stored as base64, the marker is an exact prefix test. `ff 7a 6d` encodes as `/3pt`. The fifth character, `c`, holds the top 6 bits of `0x73`. The sixth holds its last 2 bits (`11`) and the top 4 bits of the version byte, so it is one of `w x y z 0-9 + /`. The 77-byte minimum is 104 base64 characters.

---

### Wallet Provider API

Keys never leave the wallet. A page passes ciphertext in and gets plaintext back, or passes plaintext in and gets a published block back. Wallets that support messages expose these methods on `window.zenon`:

```typescript
interface MessageToOpen {
    data: string;        // block data, base64
    publicKey: string;   // counterparty Ed25519 key, 64 hex
    outgoing: boolean;   // the connected account wrote it
}

type OpenedMessage =
    | { ok: true; body: string; replyTo: string | null }
    | { ok: false; reason: "notMessage" | "unsupportedVersion" | "unreadable" };

interface EncryptedMessageParams {
    to: string;
    publicKey: string;   // recipient Ed25519 key, 64 hex
    body: string;
    replyTo?: string;    // 64 hex
}

requestMessageAccess(): Promise<string>;                          // znn_requestMessageAccess, prompts; resolves the account address
decryptMessages(items: MessageToOpen[]): Promise<OpenedMessage[]>; // znn_decryptMessages, never prompts; 1 to 50 items, results in input order
sendEncryptedMessage(params: EncryptedMessageParams): Promise<unknown>; // znn_sendEncryptedMessage, prompts; resolves the published block JSON
```

- Capability check: `typeof window.zenon?.decryptMessages === "function"`. There is no version handshake. An unknown envelope version comes back per item as `unsupportedVersion`.
- For a message to oneself, `publicKey` is the account's own key and `outgoing` is `true`.
- `outgoing` sets which side wrote the message, so the wallet can check flag bit 0.

#### Access

- Access is granted per site and per account. `requestMessageAccess` prompts: the screen names the site and the account and says the site can read every message of that account while the wallet is unlocked. A locked wallet unlocks on the same screen.
- `decryptMessages` answers only when the site is connected, the active account has granted access, and the wallet is unlocked. Decrypting never extends the auto-lock.
- Disconnecting a site removes its grant. Wallets SHOULD also let the user stop message access for one site without disconnecting it.

#### Sending

`sendEncryptedMessage` uses the normal send approval. The approval MUST:

- Check that `publicKey` derives `to`, so a page cannot show one recipient while encrypting to another key.
- Show the recipient, the body with hidden and look-alike characters made visible, the envelope size, the base plasma and whether PoW can cover it.
- Show the warnings in **Client Conventions**.

#### Errors

| Case                                                                      | Code   |
| ------------------------------------------------------------------------- | ------ |
| Site not connected, or no message access for the active account           | 4100   |
| Wallet locked or past the auto-lock time, or no wallet                    | 4900   |
| Malformed params, more than 50 items, or `publicKey` does not derive `to` | -32602 |
| User rejected                                                             | 4001   |

---

### Client Conventions

Non-normative. Clients SHOULD follow them so conversations look the same everywhere.

#### Conversations

- One conversation per counterparty address. Messages to oneself form their own conversation.
- Messages show oldest to newest, with the writer, the time and a link to the block. The body renders as plain text with line breaks kept.
- A list row shows the counterparty, the time of the latest message and the first line of its body once decrypted. Before decryption it shows that the content is encrypted.

#### Spam

Anyone can write to anyone for the cost of plasma or PoW. Clients SHOULD sort conversations into:

- **Inbox**: conversations where the account has written at least once, favorites, and its own conversation.
- **Requests**: first contact from everyone else.
- **Muted**: counterparties the user muted. Muting is local to the client. It never touches the chain.

#### Warnings

Clients MUST show these three lines, verbatim, before a first send. Wallets show them on every send approval:

1. "Messages are permanent. They stay on chain and cannot be deleted."
2. "The fact that you messaged this address is public. Anyone can see the sender, recipient, time and size."
3. "If either account's key leaks later, every past message between you can be read."

#### Recipients Without a Public Key

An address that has published no block has no public key to encrypt to. Clients MUST NOT let the user write to it, and SHOULD say that its owner needs to send any transaction or receive a pending transfer first.

---

### Security Considerations

- **No forward secrecy.** Both sides use their long-term account keys. A key that leaks later, on either side, decrypts every past message between the two accounts.
- **Impersonation after compromise.** Whoever holds an account's key can write messages that look as if any counterparty sent them to that account.
- **Public metadata.** Anyone can see the writer, the recipient, the time, the momentum and the size to the nearest 32 bytes. The body and the reply structure stay private.
- **Permanence.** A message stays on chain forever. Nothing deletes it.
- **Key reuse.** The Ed25519 signing key is converted to X25519 for key agreement, as libsodium supports. Signing and encryption share one key.
- **Site access.** A site with message access reads every message of that account while the wallet is unlocked. The grant is per site and per account, and revocable.

---

### Test Vector

One JSON file, generated with libsodium and committed byte for byte in both the wallet and the hub:

- `src/core/message-envelope.vector.json` (this repository)
- `zenonhub/tests/fixtures/message-envelope.vector.json`

Inputs: writer seed bytes `0x01..0x20`, recipient seed bytes `0x21..0x40`, nonce bytes `0x41..0x58`, reply-to 32 bytes of `0xab`, body `First encrypted message on Zenon.`. The first seed writes.

| Size                  | Bytes  |
| --------------------- | ------ |
| Content (1 + 32 + 33) | 66     |
| Padded                | 96     |
| Envelope              | 141    |
| Base plasma           | 30,588 |

Implementations MUST re-derive the envelope from the inputs with libsodium in their tests, so the file cannot drift from libsodium.

---

### Summary

|                    | Value                                                                      |
| ------------------ | -------------------------------------------------------------------------- |
| Carrier            | User send block, 0 ZNN, to a user address                                  |
| Marker and version | `ff 7a 6d 73`, `01`                                                        |
| Encryption         | `crypto_box_easy`: X25519 from the account Ed25519 keys, XSalsa20-Poly1305 |
| Who can read       | The writer and the recipient                                               |
| Content            | Flags, optional reply-to hash, body                                        |
| Subject            | None                                                                       |
| Padding            | ISO/IEC 7816-4 to 32 bytes                                                 |
| Envelope size      | 77 to 16,365 bytes                                                         |
| Base plasma        | 21,000 + 68 per envelope byte                                              |
| PoW alone          | Up to a 1,069-byte envelope                                                |
| Public             | Writer, recipient, time, momentum, size to 32 bytes                        |
| Private            | Body, reply structure                                                      |
| Indexer role       | Find and store envelopes; never decrypt                                    |
| State              | None. Each message stands alone                                            |

---

### Sealed inscriptions

Encrypted ZRC-321 inscriptions use a different box from messages: libsodium `crypto_box_seal`, an anonymous box that needs only the recipient's public key. The wallet only opens them. A page seals with the recipient's key, and the sealer cannot open the result afterwards. The reference implementation is `src/core/sealed-box.ts`, tested against `src/core/sealed-box.vector.json` and libsodium by `src/core/sealed-box.test.ts`.

#### Format

- The payload is standard base64 (the `+/` alphabet, `=` padding, unused bits zero) of `ephemeralPublicKey (32) ‖ box`. The box is XSalsa20-Poly1305 with a 16-byte tag, so the payload is 48 bytes of overhead plus a multiple of 32.
- The nonce is BLAKE2b with a 24-byte output over `ephemeralPublicKey ‖ recipientX25519PublicKey`. The key is `crypto_box_beforenm(ephemeralPublicKey, recipientX25519Secret)`.
- The recipient X25519 keys derive from the account Ed25519 keys as for messages.
- The wallet refuses an ephemeral key that is non-canonical, off the curve, of small order or of mixed order (a torsion component), as it refuses a counterparty key for messages. libsodium accepts a mixed-order key, so a box sealed under one is unreadable here by design.

#### Plaintext

The plaintext is the UTF-8 bytes of one JSON object `{"v":1,"name"?,"image"?,"description"?,"ext"?}`, padded with ISO/IEC 7816-4 (one `0x80`, then zero bytes) to a multiple of 32 bytes. The wallet returns the JSON text only when all of these hold:

- The box authenticates and the padding is valid within the last 32 bytes.
- The bytes are well-formed UTF-8 with no byte order mark.
- The JSON is an object with `v` equal to `1`, a `name` of at most 128 code points, an `image` that is an `https://` or `ipfs://` URI by the byte rules of ZRC-321, a string `description` and an object `ext`.

Duplicate keys and number tokens are not checked by the wallet. The page applies the full ZRC-321 rules to the returned text.

#### Method

```typescript
interface SealedToOpen {
    payload: string;     // the inscription's payload, base64
}

type OpenedInscription =
    | { ok: true; json: string }
    | { ok: false; reason: "unreadable" };

decryptInscriptions(items: SealedToOpen[]): Promise<OpenedInscription[]>; // znn_decryptInscriptions, never prompts; 1 to 50 items, results in input order
```

- Capability check: `typeof window.zenon?.decryptInscriptions === "function"`.
- `decryptInscriptions` shares the gate of `decryptMessages` and the same `requestMessageAccess` grant: a secure origin, a connected site, a grant for the active account, an unlocked wallet inside the auto-lock time. It never extends the auto-lock. Calls from one origin run one at a time across both methods.
- Every failure of one item (another account's payload, a bad encoding, a failed key check, bad padding, invalid UTF-8, a schema mismatch) returns the same `unreadable`, so a page learns nothing else.
- Errors and codes are those of `decryptMessages`. The approval screen of `requestMessageAccess` says the site can read encrypted messages and inscriptions.

---

### Wallet Implementation

Facts of this wallet that the protocol sections leave open.

- The methods exist on `window.zenon` of the browser extension only. The web wallet exposes no injected provider, and WalletConnect does not carry these methods.
- All four methods work only from an `https:` page or a loopback page (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`). Other pages get code 4100, `Message access needs an https page or a localhost page.`
- `outgoing` and `publicKey` MUST come from the signed block, never from the message content.
- The approval screen shows a note above 1,080 bytes: `Above 1,080 bytes your account needs fused plasma; PoW cannot cover it.` Envelopes are 45 plus a multiple of 32 bytes, so this equals the 1,069-byte limit above.
- The user removes a grant with "Stop" in Connected sites.
