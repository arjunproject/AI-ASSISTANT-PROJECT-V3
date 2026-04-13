# AI ASSISTANT PROJECT V3 - Tahap 0

Tahap 0 hanya membangun fondasi runtime yang bersih. Di tahap ini tidak ada WhatsApp, Baileys, QR, AI, admin gate, mirror, spreadsheet, atau artefak lama.

## Ruang lingkup

- Struktur proyek tipis dan siap ditumbuhkan.
- TypeScript build dan runtime dasar siap.
- Logger file minimal siap.
- Process lock runtime minimal siap.
- Health report minimal dan jujur siap.
- Test minimal untuk lock, health, start runtime, dan konflik lock siap.

## Struktur inti

- `src/config`: konfigurasi dasar runtime.
- `src/core`: logger, process lock, dan health.
- `src/runtime`: bootstrap runtime minimal.
- `docs`: dokumentasi Tahap 0.
- `tests`: test minimal Tahap 0.

## Command dasar

Di PowerShell Windows, gunakan `npm.cmd` bila `npm` diblokir oleh execution policy.

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
npm.cmd run health
npm.cmd start
```

## Output runtime

- Lock file: `.runtime/lock/runtime.lock.json`
- Log file: `.runtime/logs/runtime.log`

## Catatan health

Health hanya melaporkan kondisi yang benar-benar ada di Tahap 0:

- `runtimePid`
- `processLockOwner`
- `nodeReady`
- `npmScriptsReady`
- `buildReady`
- `stageName`
- `overallStatus`
- `lastError`
