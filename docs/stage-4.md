# Stage 4

Tahap 4 hanya menambah command admin paling tipis di atas baseline Tahap 1-3 yang sudah beku.
Penyempurnaan terkendali terakhir di Tahap 4 menambah nama untuk admin dinamis tanpa mengubah arah baseline Tahap 1-4.

## Scope resmi

- Satu registry command resmi
- Satu parser/normalizer command resmi
- Satu normalizer nama admin resmi
- Satu normalizer nomor target resmi
- Satu resolver target admin resmi
- Satu executor command admin resmi
- Reply command singkat lewat runtime resmi
- State dan log command minimal

## Command resmi

- `Admin add <nama> <nomor>`
- `Admin remove <nama|nomor|nama nomor>`
- `Admin list`
- `Admin on <nama|nomor|nama nomor>`
- `Admin off <nama|nomor|nama nomor>`
- `Admin status <nama|nomor|nama nomor>`
- `Admin help`

## Aturan admin dinamis bernama

- Identitas internal utama tetap `normalizedPhoneNumber`
- Nama tampilan admin dinamis disimpan sebagai `displayName`
- Pencocokan unik nama memakai `nameKey`
- `nameKey` dibentuk dari trim, collapse spasi, lalu lower-case
- `Rahma`, `rahma`, `RAHMA` dianggap satu nama
- `Rahma` dan `Rahmah` tetap dua nama berbeda
- `admin add` menolak bentrok nama dengan `NAME_ALREADY_EXISTS <Nama>`
- Super admin tidak pernah dipindah ke registry dinamis

## Aturan inti

- Command diproses setelah identity resolution Tahap 2
- Command diproses setelah access gate Tahap 3
- Hanya `super_admin` yang boleh mengeksekusi command admin
- `admin` biasa ditolak jujur saat mencoba command admin
- `non_admin` tetap berhenti total di access gate Tahap 3
- Target command boleh dicari dengan nama, nomor, atau nama+nomor
- Parser juga menerima bentuk natural `admin <target> <action>` untuk `status`, `on`, `off`, dan `remove`
- Tidak ada AI, mirror, spreadsheet, atau reply bisnis lain

## Jalur resmi

- Registry command: `src/command/command-registry.ts`
- Parser command: `src/command/command-parser.ts`
- Normalizer nama admin: `src/command/admin-name-normalizer.ts`
- Normalizer nomor: `src/command/number-normalizer.ts`
- Resolver target admin: `src/command/admin-target-resolver.ts`
- Executor command: `src/command/admin-command-executor.ts`
- Dynamic admin registry resmi: `.runtime/access/admin-registry.json`
- Jalur reply command resmi: `src/whatsapp/baileys-transport.ts` -> `sendReply()` -> WhatsApp runtime utama

## Format registry admin dinamis

- `normalizedPhoneNumber`
- `displayName`
- `nameKey`
- `isActive`
- `createdAt`
- `updatedAt`
- `source`

## Bentuk command yang didukung

- `admin add Rahma 62588689668`
- `admin status Rahma`
- `admin status 62588689668`
- `admin status Rahma 62588689668`
- `admin rahma status`
- `admin off Rahma`
- `admin off 62588689668`
- `admin off Rahma 62588689668`
- `admin rahma off`
- `admin on Rahma`
- `admin rahma on`
- `admin remove Rahma`
- `admin rahma remove`

## Log resmi

- `command.detected`
- `command.normalized`
- `command.executed`
- `command.rejected`
- `command.error`

## Health/state tambahan

- `commandRegistryReady`
- `lastCommandAt`
- `lastCommandName`
- `lastCommandAllowed`
- `lastCommandReason`
- `lastCommandSender`

## Baseline final

- Tahap 4 tidak menambah parser command kedua, registry command kedua, atau normalizer nomor kedua.
- Tahap 4 tidak menambah AI, mirror, spreadsheet, atau reply bisnis lain.
- Baseline registry dinamis resmi boleh kosong pada kondisi final.
- Runtime message flow probe tetap milik baseline Tahap 1, bukan fitur command baru Tahap 4.
