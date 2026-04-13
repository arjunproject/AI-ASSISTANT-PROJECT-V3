# AI ASSISTANT PROJECT V3 - Tahap 3

Tahap 3 menambah access gate paling tipis di atas baseline Tahap 1 dan Tahap 2 yang sudah freeze.
Dokumen ini adalah baseline resmi Tahap 3 yang dibekukan sesudah validasi runtime nyata.

## Ruang lingkup

- Seed super admin resmi tunggal.
- Registry admin dinamis resmi tunggal.
- Evaluator access policy resmi tunggal.
- Drop total untuk sender yang tidak diizinkan.
- State dan health access minimal yang jujur.

Tahap 3 belum menambah command admin, AI, handoff AI, mirror, spreadsheet, autostart, parser bisnis, atau reply otomatis.

## Jalur resmi Tahap 3

- Runtime utama: `src/index.ts` -> `src/runtime/runtime-service.ts`
- Transport WhatsApp utama: `src/whatsapp/baileys-transport.ts`
- Inbound listener resmi Tahap 2: `src/whatsapp/inbound-listener.ts`
- Identity resolver resmi Tahap 2: `src/whatsapp/identity-resolver.ts`
- Super admin seed resmi: `src/access/super-admin-seed.ts`
- Registry admin dinamis resmi: `src/access/admin-registry.ts`
- Evaluator access policy resmi: `src/access/access-policy.ts`
- Controller access runtime resmi: `src/access/access-controller.ts`
- Registry file resmi: `.runtime/access/admin-registry.json`
- Auth store resmi: `.runtime/whatsapp/auth`
- State runtime resmi: `.runtime/status/runtime-state.json`
- Log resmi: `.runtime/logs/runtime.log`
- Lock resmi: `.runtime/lock/runtime.lock.json`

Tahap 3 tidak memakai sandbox runtime, auth sandbox, atau registry liar di lokasi lain sebagai bagian dari operasi resmi.

## Seed super admin resmi

- `6285655002277`
- `201507007785`

Super admin selalu lolos dan tidak bergantung pada registry admin dinamis.

## Registry admin dinamis resmi

Format record minimal:

- `normalizedPhoneNumber`
- `isActive`
- `createdAt`
- `updatedAt`
- `source`

Registry resmi boleh kosong pada baseline final. Seed manual hanya untuk validasi runtime dan bukan bagian dari baseline tetap.

Jika file registry rusak, gate bersifat fail-closed dan health harus jujur menandai `accessGateReady: false`.

## Hasil evaluasi access canonical

- `isAllowed`
- `role`
- `reason`
- `normalizedSender`
- `senderJid`
- `chatJid`
- `isFromSelf`
- `isGroup`

Role minimal:

- `super_admin`
- `admin`
- `non_admin`

Reason minimal:

- `official_super_admin`
- `active_dynamic_admin`
- `inactive_dynamic_admin`
- `not_in_whitelist`
- `unresolved_sender`
- `invalid_sender`

## Field access pada state / health

- `accessGateReady`
- `lastAccessDecisionAt`
- `lastAccessDecisionRole`
- `lastAccessDecisionReason`
- `lastAccessDecisionAllowed`
- `lastAccessDecisionSender`
- `activeDynamicAdminCount`
- `superAdminCount`

`overallStatus: ready` hanya keluar jika baseline Tahap 2 sehat dan access gate juga siap.

## Event log access resmi

- `access.evaluated`
- `access.allowed`
- `access.denied`
- `access.error`

Tahap 3 hanya mengevaluasi dan mencatat. Belum ada command admin, belum ada AI, belum ada reply otomatis, dan belum ada fase lanjutan lain.
