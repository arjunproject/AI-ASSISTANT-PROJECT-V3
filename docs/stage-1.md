# AI ASSISTANT PROJECT V3 - Tahap 1

Tahap 1 hanya menambah WhatsApp core paling tipis di atas fondasi Tahap 0.

## Ruang lingkup

- Transport WhatsApp resmi memakai Baileys.
- Auth state lokal persisten di satu lokasi.
- QR disimpan sebagai PNG dan dibuka dengan Paint Windows.
- Reconnect dasar dengan backoff sederhana.
- Health runtime jujur untuk status socket, sync companion, session, dan QR.
- Lock runtime Tahap 0 tetap dipakai.

## Struktur inti tambahan

- `src/whatsapp/session-store.ts`: auth store lokal persisten.
- `src/whatsapp/qr-manager.ts`: generate QR PNG dan buka Paint.
- `src/whatsapp/reconnect-manager.ts`: backoff reconnect sederhana.
- `src/whatsapp/baileys-transport.ts`: satu wiring resmi Baileys.
- `src/runtime/runtime-state-store.ts`: status runtime yang dibaca oleh `health`.

## Path runtime Tahap 1

- Runtime root resmi: `.runtime`
- Auth store: `.runtime/whatsapp/auth`
- QR PNG: `.runtime/whatsapp/qr/login-qr.png`
- Runtime state: `.runtime/status/runtime-state.json`
- Log file: `.runtime/logs/runtime.log`
- Lock file: `.runtime/lock/runtime.lock.json`

Tahap 1 tidak memakai sandbox runtime, auth sandbox, atau jalur audit terpisah sebagai bagian dari operasi resmi.

## Command dasar

Di PowerShell Windows gunakan `npm.cmd` bila `npm` diblokir execution policy.

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
npm.cmd run health
npm.cmd start
```

## Catatan health

Health Tahap 1 melaporkan:

- `runtimePid`
- `processLockOwner`
- `stageName`
- `nodeReady`
- `buildReady`
- `whatsappTransportMode`
- `connectionState`
- `socketState`
- `syncState`
- `sessionStoreReady`
- `sessionPresent`
- `receivedPendingNotifications`
- `companionOnline`
- `appStateSyncReady`
- `deviceActivityState`
- `messageFlowState`
- `qrState`
- `qrFilePath`
- `qrOpenedInPaint`
- `lastConnectAt`
- `lastDisconnectAt`
- `lastSyncAt`
- `lastInboundMessageAt`
- `lastOutboundMessageAt`
- `lastMessageFlowAt`
- `lastProbeAt`
- `lastDecryptIssue`
- `lastSessionIssue`
- `lastMessageFlowError`
- `lastError`
- `overallStatus`

`overallStatus: ready` hanya keluar jika socket sudah open, pending notifications sudah diterima, app-state sync sudah sehat, companion online, device activity sudah `active`, dan message flow sudah `usable`.

## Log operasional final

Log file resmi hanya dipakai untuk event operasional inti:

- `runtime.start`
- `runtime.stop`
- `lock.acquired`
- `lock.released`
- `lock.rejected`
- `whatsapp.qr.generated`
- `whatsapp.qr.opened_in_paint`
- `whatsapp.connected`
- `whatsapp.disconnected`
- `whatsapp.reconnecting`
- `whatsapp.message_flow_usable`
- `runtime.error`
- `whatsapp.error`

## Catatan runtime nyata

- Jika auth valid belum ada, runtime akan meminta QR.
- QR ditulis ke PNG lalu dibuka lewat `mspaint.exe`.
- Jika koneksi putus non-logout, reconnect akan dicoba dengan backoff sederhana.
- Runtime tidak lagi menganggap `connection: open` sebagai sehat penuh. Status `connected` baru keluar setelah sync awal memberi bukti sehat.
- Runtime memakai profil desktop penuh dan full history sync agar WhatsApp memperlakukan companion sebagai desktop aktif, bukan sekadar socket web yang setengah hidup.
- Runtime menjaga client tetap online saat connect agar perangkat tertaut tidak tertinggal di status `terakhir aktif`.
- Runtime menyimpan cache pesan tipis di memori agar retry/resend dari Baileys tidak kosong saat perangkat lain meminta pesan ulang.
- Jika terjadi `logged_out` atau `badSession`, auth store dipertahankan apa adanya dan state ditandai jujur sebagai `logged_out` agar recovery tidak destruktif.
- Jalur resmi Tahap 1 hanya satu: satu runtime, satu lock, satu health, satu log file, satu auth store, dan satu transport Baileys.
