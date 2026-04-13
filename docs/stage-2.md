# AI ASSISTANT PROJECT V3 - Tahap 2

Tahap 2 menambah inbound message core paling tipis di atas baseline Tahap 1 yang sudah freeze.
Dokumen ini adalah baseline resmi Tahap 2 yang dibekukan sesudah validasi runtime nyata.

## Ruang lingkup

- Satu listener inbound resmi di jalur `messages.upsert`.
- Satu resolver identitas resmi yang menangani:
  - `remoteJid`
  - `participant`
  - `key.participant`
  - `senderPn` / `sender_pn`
  - `contextInfo.participant`
  - `@s.whatsapp.net`
  - `@lid`
  - identitas bot sendiri
  - direct chat
  - group chat
- Logging inbound operasional yang jujur.
- State inbound minimal yang jujur untuk health.

Tahap 2 belum menambah access gate, admin whitelist, parser bisnis, auto-reply, AI, mirror, spreadsheet, atau fitur Tahap 3.

## Jalur resmi Tahap 2

- Runtime utama: `src/index.ts` -> `src/runtime/runtime-service.ts`
- Transport WhatsApp utama: `src/whatsapp/baileys-transport.ts`
- Listener inbound resmi: `src/whatsapp/inbound-listener.ts`
- Resolver identitas resmi: `src/whatsapp/identity-resolver.ts`
- Auth store resmi: `.runtime/whatsapp/auth`
- State runtime resmi: `.runtime/status/runtime-state.json`
- Log resmi: `.runtime/logs/runtime.log`
- Lock resmi: `.runtime/lock/runtime.lock.json`

Tahap 2 tidak memakai sandbox runtime, auth sandbox, atau jalur audit terpisah sebagai bagian dari operasi resmi.

## Field inbound pada state / health

Tahap 2 menambah field tipis berikut:

- `inboundReady`
- `lastInboundMessageAt`
- `lastInboundMessageId`
- `lastInboundSender`
- `lastInboundNormalizedSender`
- `lastInboundChatJid`
- `lastInboundWasFromSelf`
- `lastInboundWasGroup`

`overallStatus: ready` hanya keluar jika baseline Tahap 1 sudah sehat dan inbound resmi sudah benar-benar terbukti pada run aktif itu.

## Event log inbound resmi

- `inbound.received`
- `inbound.identity_resolved`
- `inbound.ignored_non_message`
- `inbound.error`

## Event log operasional final

- `runtime.start`
- `runtime.stop`
- `lock.acquired`
- `lock.released`
- `lock.rejected`
- `whatsapp.connected`
- `whatsapp.disconnected`
- `whatsapp.reconnecting`
- `whatsapp.message_flow_usable`
- `whatsapp.error`
- `inbound.received`
- `inbound.identity_resolved`
- `inbound.ignored_non_message`
- `inbound.error`

Setiap event inbound membawa field operasional yang cukup:

- `messageId`
- `chatJid`
- `senderJid`
- `normalizedSender`
- `isFromSelf`
- `isGroup`
- `textPreview`
- `messageTimestamp`
- `resolutionSource`

## Catatan perilaku

- History sync `append` tidak dihitung sebagai bukti inbound live.
- Tahap 2 hanya membaca dan mencatat pesan. Tidak ada gate, tidak ada drop non-admin, tidak ada reply otomatis.
- Resolusi bot identity dipisahkan dari sender identity agar runtime tidak mencampur nomor bot dengan pengirim eksternal.
- Probe internal untuk pembuktian message flow tetap berada di jalur runtime utama dan tidak menambah fitur baru di luar scope.
