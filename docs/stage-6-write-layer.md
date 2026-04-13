# Stage 6 Write Layer

Tahap 6 write layer resmi hanya punya satu jalur mutation, satu jalur apply, dan satu jalur verify.

## Jalur Resmi

- Mirror resmi tetap jadi sumber mutation: `.runtime/mirror/stok-motor.json`, `.runtime/mirror/pengeluaran-harian.json`, `.runtime/mirror/total-aset.json`, `.runtime/mirror/index.json`
- Builder mirror read-only resmi: [google-sheets-mirror.ts](/c:/Users/ASUS/OneDrive/Dokumen/AI%20ASSISTANT%20PROJECT%20V3/src/google/google-sheets-mirror.ts)
- Sync live -> mirror resmi: [google-sheets-mirror-sync.ts](/c:/Users/ASUS/OneDrive/Dokumen/AI%20ASSISTANT%20PROJECT%20V3/src/google/google-sheets-mirror-sync.ts)
- Client Google Sheets API resmi: [google-sheets-client.ts](/c:/Users/ASUS/OneDrive/Dokumen/AI%20ASSISTANT%20PROJECT%20V3/src/google/google-sheets-client.ts)
- Write contract resmi: [google-sheets-mirror-write.ts](/c:/Users/ASUS/OneDrive/Dokumen/AI%20ASSISTANT%20PROJECT%20V3/src/google/google-sheets-mirror-write.ts)
- Harness live verification resmi yang dipertahankan: [google-sheets-mirror-multi-write-test.ts](/c:/Users/ASUS/OneDrive/Dokumen/AI%20ASSISTANT%20PROJECT%20V3/src/google/google-sheets-mirror-multi-write-test.ts)

## Value-Only Rule

- Satu-satunya yang boleh berubah hanyalah value.
- Jalur resmi write memakai `spreadsheets.values.batchUpdate` dengan kontrak value-only.
- Delete resmi tidak memakai `batchClear`. Delete dilakukan dengan menulis value kosong hanya pada cell writable.

## Sacred Zone

### STOK MOTOR

- Row `1` / header sakral.
- Kolom `A` sakral.
- Kolom `K` sakral.

### PENGELUARAN HARIAN

- Row `1` / header sakral.

### TOTAL ASET

- Full read-only.
- Tidak ada write apa pun.

## Contract Resmi

### Add

- `STOK MOTOR`: append ke row aktif berikutnya berdasarkan `lastDataRow` aktif dari kolom `B / NAMA MOTOR`.
- `PENGELUARAN HARIAN`: append ke row aktif berikutnya.

### Edit

- Hanya update cell writable yang diminta.
- Tidak boleh menyentuh header atau area sakral.

### Confirm Sold

- Hanya untuk `STOK MOTOR`.
- Wajib update `I`, `J`, dan `M` pada row yang sama.

### Delete

- Hanya clear value pada cell writable.
- Tidak boleh menghapus validation, formula, style, atau metadata cell.

### Multi Write

- Multi write resmi memakai batch mutation refs dari mirror resmi.
- Planner tetap cek sacred zone per mutation.
- Apply boleh lintas sheet writable dalam satu batch selama semua mutation lolos policy.

## Verify-After-Write

- Sesudah apply, sistem baca balik live range target.
- Sistem juga cek sacred sentinel range.
- Untuk `STOK MOTOR`, validation `E` dan `M` wajib tetap ada.
- Formula sakral kolom `K` wajib tetap utuh.
- Mirror resmi lalu disinkronkan ke hasil live final.

## Sheet Yang Boleh Ditulis

- `STOK MOTOR`
- `PENGELUARAN HARIAN`

## Sheet Yang Haram Disentuh

- `TOTAL ASET`

## Artefak Runtime Resmi

- `.runtime/mirror/index.json`
- `.runtime/mirror/stok-motor.json`
- `.runtime/mirror/pengeluaran-harian.json`
- `.runtime/mirror/total-aset.json`
- `.runtime/logs/runtime.log`
- `.runtime/status/runtime-state.json`

## Yang Belum Termasuk Tahap Ini

- Write dari WhatsApp
- AI read layer dari mirror
- Intent AI ke write
- Format/style/formula/validation sync
- Mirror dua arah penuh
