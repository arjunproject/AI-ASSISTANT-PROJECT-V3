# BUG FOUND

Daftar ini hanya berisi bug aktif atau bug yang belum tuntas. Catatan bug yang sudah diperbaiki dihapus dari daftar aktif pada 2026-04-16.

## 2026-04-15 - Bot 2 tidak merespons DM admin biasa: bukti aktif saat ini mengarah ke state akses, bukan AI diam

### Ringkasan bug
- Laporan bug: admin biasa mengirim DM ke bot 2 tetapi tidak mendapat balasan.
- Dari runtime aktif yang bisa dibuktikan, pola no-response yang terlihat lebih kuat disebabkan oleh akses ditolak oleh registry/state, bukan karena AI tiba-tiba diam setelah menerima pesan.
- Jadi bug ini sementara lebih tepat dibaca sebagai bug akses/state yang tidak sesuai harapan operasional, bukan bug AI routing murni.

### Bukti dari runtime aktif
- Pada bot 2, admin `201144832548` pernah berhasil merespons saat `dmAccessEnabled` masih aktif:
- `.runtime-bot2/logs/runtime.log`
- `2026-04-14T22:02:15.045Z` `access.allowed`
- `2026-04-14T22:02:15.060Z` `ai.requested`
- `2026-04-14T22:02:18.259Z` `ai.responded`
- Beberapa waktu kemudian, admin yang sama tidak direspons karena ditolak dengan alasan `dm_access_disabled`:
- `2026-04-14T23:05:20.526Z` `access.evaluated isAllowed:false`
- `2026-04-14T23:05:20.532Z` `ai.skipped_denied`
- Registry admin aktif saat audit menunjukkan beberapa admin memang DM-nya mati:
- `.runtime/access/admin-registry.json`
- `Arjun` -> `dmAccessEnabled: false`
- `Rahma` -> `dmAccessEnabled: false`
- hanya `Rara` yang terlihat `dmAccessEnabled: true`
- Bot 2 juga pernah menolak nomor `201507007785` pada DM self dengan alasan `not_in_whitelist`, sejalan dengan registry super admin saat itu:
- `.runtime-bot2/logs/runtime.log`
- `2026-04-15T01:06:03.558Z` `access.evaluated isAllowed:false`
- `2026-04-15T01:06:03.561Z` `ai.skipped_denied`

### Sumber bug
- Bukti aktif mengarah ke masalah state admin registry (`dmAccessEnabled` mati).
- Bukti aktif juga mengarah ke state super-admin registry (`isActive` mati pada saat audit).
- Sumber yang paling kuat bukan "AI menerima lalu diam", tetapi "pesan ditolak sebelum AI dipanggil".
- Status WhatsApp sebelumnya sempat mengotori bukti karena `status@broadcast` masuk seperti pesan biasa, tetapi bagian itu sudah dibersihkan.

### Lokasi sumber yang terkait
- `.runtime/access/admin-registry.json`
- `.runtime/access/super-admin-registry.json`
- `src/access/access-policy.ts`
- `src/access/admin-registry.ts`
- `src/whatsapp/baileys-transport.ts`

### Catatan analisis
- Untuk laporan spesifik "admin biasa yang status DM-nya ON masih tidak direspons bot 2", belum ada contoh runtime aktif yang cocok persis.
- Jejak aktif yang berhasil ditemukan justru menunjukkan:
- saat DM benar-benar ON, bot 2 pernah merespons.
- saat no-response terjadi, runtime mencatat alasan deny yang eksplisit.

### Status
- Belum tuntas sebagai bug aktif karena perlu bukti runtime baru untuk kasus admin DM ON tetapi tetap tidak direspons.
- Admin biasa dengan `dmAccessEnabled: false` tetap tidak akan direspons; itu masih sesuai policy akses saat ini.

## 2026-04-15 - False negative data: data sebenarnya ada, tetapi AI bilang tidak ada

### Ringkasan bug
- AI bisa menyatakan data tidak ada, padahal data tersebut sebenarnya ada di mirror/spreadsheet.
- Dari bukti runtime aktif yang ada, bug ini sangat konsisten dengan perilaku model `gpt-5-nano` yang memilih tidak memakai tool read data, lalu menjawab berdasarkan tebakan/ingatan konteks.

### Bukti dari runtime aktif
- Runtime bot 1 saat bug terjadi aktif dengan:
- `aiModelName = gpt-5-nano`
- `googleSheetsReady = true`
- `mirrorSyncReady = true`
- Jadi pada saat bug terjadi, akses mirror sebenarnya siap.

Kasus konkret yang terbukti di log:

1. User bertanya:
- `Info motor beat?`

Jejak runtime:
- `.runtime/logs/runtime.log`
- `2026-04-14T23:46:47.640Z` `ai.requested` dengan `modelName: "gpt-5-nano"`
- `2026-04-14T23:46:53.589Z` `ai.data_read_skipped`
- `2026-04-14T23:46:53.590Z` `ai.responded`

Isi jawaban:
- `Belum ada info Beat di stok motor yang ada sekarang...`

Padahal mirror aktif saat itu berisi data terkait `beat`, misalnya:
- `beat`
- `Beat ECO`
- `Beat FI`
- `beat biru`

2. Setelah user mengoreksi:
- `Bukannn.. aku mau data vario bukan beat`

Jejak runtime:
- `2026-04-14T23:47:29.324Z` `ai.requested` dengan `modelName: "gpt-5-nano"`
- `2026-04-14T23:47:38.210Z` `ai.data_read_skipped`
- `2026-04-14T23:47:38.211Z` `ai.responded`

Isi jawaban:
- `Berikut data Vario ...`

Artinya pada dua turn berurutan:
- AI tidak memakai tool data.
- AI tetap menjawab seolah mengetahui isi data.
- pada turn pertama hasilnya false negative (`Beat` dibilang tidak ada).

### Sumber bug
- Sumber bug paling kuat adalah kombinasi model `gpt-5-nano` dan pemilihan tool read data yang tidak disiplin.
- Mirror siap dan data memang ada, tetapi runtime mencatat `ai.data_read_skipped`.
- AI lalu tetap menjawab klaim faktual tentang data internal.

### Lokasi sumber yang terkait
- `src/ai/openai-text-gateway.ts`
- `src/ai/ai-orchestrator.ts`
- `.runtime/mirror/stok-motor.json`

### Status
- Belum diperbaiki.

## 2026-04-15 - Data-read saat ini sangat sensitif terhadap model, dan belum selaras dengan `gpt-5-nano`

### Ringkasan bug
- Setelah model diganti ke `gpt-5-nano`, jalur read data terasa jauh lebih rapuh.
- Gejalanya:
- AI lebih sering tidak memakai tool read.
- AI menjawab berdasarkan tebakan atau konteks percakapan.
- hasil data jadi meleset, diringkas, atau false negative.

### Bukti dari runtime aktif
- Runtime aktif saat bug-bug data terjadi:
- `aiModelName = gpt-5-nano`
- `googleSheetsReady = true`
- `mirrorSyncReady = true`
- Contoh konkret:
- kasus `Info motor beat?`
- runtime mencatat `ai.data_read_skipped`
- lalu AI tetap menjawab klaim faktual tentang stok.

### Sumber bug
- Tool read data memang tersedia, tetapi pemakaiannya masih sangat bergantung pada keputusan model.
- Belum ada layer sistem yang cukup kuat untuk membuat model kecil disiplin membaca data resmi dulu sebelum memberi jawaban faktual.
- Karena itu, saat model berganti ke `gpt-5-nano`, kelemahan arsitektur ini jadi lebih terlihat.

### Lokasi sumber yang terkait
- `src/ai/openai-text-gateway.ts`
- `src/ai/ai-orchestrator.ts`

### Status
- Belum diperbaiki.

## 2026-04-16 - Memory konteks data masih bisa lengket karena overlap kata generik

### Ringkasan bug
- Stress test modul memory menemukan kelemahan khusus di query data motor.
- Jika percakapan sebelumnya membahas satu motor, lalu user bertanya motor lain dengan kata generik yang sama, konteks lama masih bisa ikut dimuat.
- Contoh pola:
- konteks lama: `info motor aerox harga beli`
- query baru: `info motor beat harga beli`
- hasil saat stress test: konteks Aerox tetap dimuat, padahal query baru seharusnya berdiri sendiri sebagai pencarian Beat.

### Bukti dari stress test lokal
- Modul yang diuji:
- `src/ai/conversation-session-store.ts`
- Skenario:
- `rememberExchange("info motor aerox harga beli", "NO 49 Aerox HARGA BELI Rp3.400.000 STATUS READY")`
- lalu `prepareContext("info motor beat harga beli")`
- Hasil:
- `contextLoaded: true`
- `contextSource: current`
- transcript yang ikut dimuat masih berisi Aerox.
- Skenario lain:
- query baru `info motor tahun 2020 harga`
- hasil tetap `contextLoaded: true` karena overlap kata generik seperti `motor` dan `harga`.

### Sumber bug
- Fungsi relevance memory memakai `hasMeaningfulTokenOverlap`.
- Stop words saat ini belum menganggap beberapa kata domain data sebagai kata generik, misalnya `motor`, `harga`, `beli`, `tahun`, dan kemungkinan nama field lain.
- Akibatnya query baru yang sebenarnya independen bisa dianggap masih relevan dengan konteks lama.

### Dampak
- AI bisa membawa konteks record lama ke intent data baru.
- Untuk model kecil seperti `gpt-5-nano`, konteks yang salah ini memperbesar risiko:
- false negative.
- jawaban data nyasar.
- data lama bercampur dengan pencarian baru.

### Lokasi sumber yang terkait
- `src/ai/conversation-session-store.ts`
- `src/ai/openai-text-gateway.ts`
- `src/ai/ai-orchestrator.ts`

### Status
- Belum diperbaiki.

## 2026-04-16 - AI core memory terlalu mudah memuat konteks lama walaupun user memulai topik baru

### Ringkasan bug
- Stress test E2E bot 2 -> bot 1 membuktikan memory AI core masih terlalu agresif memuat konteks lama.
- Ini bukan bug read data.
- Jalur test:
- bot 2 mengirim pesan test lewat `test_outbox`.
- bot 1 menerima pesan live.
- bot 1 memanggil AI dan membalas.
- Log bot 1 dipakai sebagai bukti apakah context memory dimuat.

### Bukti E2E dari runtime aktif
- Bot 2 berhasil mengirim request test:
- `.runtime-bot2/logs/runtime.log`
- `test_outbox.outbound_sent`
- `test_outbox.sent`
- Bot 1 menerima dan membalas:
- `.runtime/logs/runtime.log`
- `inbound.received`
- `ai.handoff`
- `ai.requested`
- `ai.responded`
- `ai.replied`

Kasus stress test yang menunjukkan masalah:

1. Topik baru matematika masih memuat konteks lama
- User:
- `ZXA02 Topik baru total: 12 x 7 berapa? Jawab angka saja.`
- Message ID:
- `3EB0FAF451AB1E847E5CF9`
- Hasil log:
- `ai.context.loaded`
- `contextSource: current`
- `transcriptTurnCount: 2`
- Catatan:
- Jawaban tetap benar (`84`), tetapi konteks lama tidak semestinya ikut dimuat karena user sudah menyatakan `Topik baru total`.

2. Topik baru kode warna masih memuat konteks lama
- User:
- `ZXB01 Sekarang topik baru: kode ALFA punya warna biru. Balas: tersimpan.`
- Message ID:
- `3EB0C5D007178296E6F10C`
- Hasil log:
- `ai.context.loaded`
- `contextSource: current`
- `transcriptTurnCount: 4`
- Catatan:
- Ini topik baru, tetapi context lama tetap dibawa.

3. Topik baru berikutnya juga masih memuat konteks lama dan summary
- User:
- `ZXB02 Sekarang topik baru: kode BETA punya warna merah. Balas: tersimpan.`
- Message ID:
- `3EB0522B8DBFC57B98427F`
- Hasil log:
- `ai.context.loaded`
- `contextSource: current`
- `transcriptTurnCount: 4`
- `hasSummary: true`
- Catatan:
- Summary lama mulai ikut masuk walaupun user eksplisit menyebut `topik baru`.

4. Follow-up "yang terakhir" gagal memakai konteks terbaru dengan benar
- User:
- `ZXB03 Yang terakhir warnanya apa? Jawab satu kata.`
- Message ID:
- `3EB0C3E87FFE000A9D91A5`
- Hasil log:
- `ai.context.loaded`
- `contextSource: current`
- `transcriptTurnCount: 2`
- `hasSummary: true`
- Jawaban AI:
- `Belum.`
- Jawaban yang semestinya:
- `Merah`
- Catatan:
- Sistem memang memuat konteks, tetapi AI tetap gagal mengambil fakta terbaru dari konteks.

5. Pertanyaan umum baru masih memuat konteks lama karena kata instruksi generik
- User:
- `ZXC02 Apa ibu kota Jepang? Jawab nama kotanya saja.`
- Message ID:
- `3EB08AE06585A018A68FDA`
- Hasil log:
- `ai.context.loaded`
- `contextSource: current`
- `transcriptTurnCount: 4`
- Catatan:
- Pertanyaan umum baru tidak perlu konteks lama. Dugaan kuat overlap terjadi dari kata instruksi generik seperti `jawab`.

### Bukti E2E tambahan tanpa frasa "topik baru"
- Stress test lanjutan dijalankan dengan pesan yang langsung lompat topik tanpa memberi tahu AI bahwa ini topik baru.
- Tujuan test:
- memastikan AI/sistem bisa membedakan intent baru vs pembahasan lama secara natural.
- memastikan konteks lama masih bisa dipanggil lagi setelah beberapa topik lain.

Hasil positif:
- Konteks lama bisa dipanggil kembali setelah beberapa pembahasan berbeda.
- `U775 Kode PASIR tadi nilainya apa? Jawab satu kata.`
- Message ID: `3EB0CF7CCDBF464697C979`
- Jawaban: `HARIMAU`
- Ini benar, setelah sebelumnya ada topik matematika, ibu kota, dan promosi oli.
- `B448 Apa kode yang warnanya hijau tadi? Jawab kode saja.`
- Message ID: `3EB082125893E9ADACE2CC`
- Jawaban: `LAUT`
- Ini benar, setelah beberapa topik lain.
- `E294 KACA itu apa? Jawab satu kata.`
- Message ID: `3EB08E4E3B479BFC09E698`
- Jawaban: `MERPATI`
- Ini benar, setelah diselingi pertanyaan ibu kota Jerman.

Hasil negatif:

1. Pertanyaan standalone masih memuat konteks lama
- `R462 12 x 12 berapa? Jawab angka saja.`
- Message ID: `3EB029393E4D2A92E6F35E`
- Hasil log:
- `ai.context.loaded`
- `contextSource: current`
- `transcriptTurnCount: 2`
- `hasSummary: true`
- Jawaban benar (`144`), tetapi konteks lama tidak perlu dimuat.

2. Pertanyaan umum standalone masih memuat konteks lama
- `S903 Ibu kota Kanada apa? Jawab nama kotanya saja.`
- Message ID: `3EB095A7F802CBB9AD3AFD`
- Hasil log:
- `ai.context.loaded`
- `contextSource: current`
- `transcriptTurnCount: 4`
- `hasSummary: true`
- Jawaban benar (`Ottawa`), tetapi konteks lama tidak perlu dimuat.

3. Follow-up "yang terakhir" gagal membaca fakta terbaru
- Sebelum pertanyaan ini, user sudah menyimpan:
- `W640 Simpan: kode LAUT warnanya hijau. Balas siap.`
- Lalu user bertanya:
- `X338 Yang terakhir warnanya apa? Jawab satu kata.`
- Message ID: `3EB0AC4F8947C7F1ACC31E`
- Hasil log:
- `ai.context.loaded`
- `contextSource: current`
- `transcriptTurnCount: 2`
- `hasSummary: true`
- Jawaban AI:
- `Tidakdiketahui`
- Jawaban semestinya:
- `hijau`
- Catatan:
- Ini membuktikan bukan cuma "context loaded terlalu sering"; bahkan saat konteks terbaru tersedia, AI bisa gagal mengambil fakta paling baru.

4. Pertanyaan umum di akhir rangkaian masih membawa konteks lama
- `F582 Terjemahkan kata house ke bahasa Indonesia. Jawab satu kata.`
- Message ID: `3EB0AC047F7F9A1355101A`
- Hasil log:
- `ai.context.loaded`
- `contextSource: current`
- `transcriptTurnCount: 4`
- `hasSummary: true`
- Jawaban benar (`rumah`), tetapi konteks lama tidak perlu dimuat.

Catatan non-memory:
- Satu pesan follow-up tidak diproses AI karena masalah WhatsApp decrypt, bukan karena memory:
- `Y527 Yang ungu tadi kodenya apa? Jawab kode saja.`
- Message ID: `3EB02930E1AB3136CAA3F7`
- Log bot 1:
- `whatsapp.error kind: decrypt_issue message: Bad MAC`
- `inbound.ignored_non_message`
- Karena payload tidak terbaca, kasus ini tidak dihitung sebagai bug memory.

### Bukti E2E tambahan dengan kalimat panjang dan banyak detail
- Stress test lanjutan dijalankan dengan pesan panjang berisi banyak detail, lalu diselingi topik lain dan dipanggil lagi.
- Tujuan test:
- melihat apakah memory tetap stabil jika satu pesan berisi banyak fakta.
- melihat apakah catatan lama masih bisa dipanggil setelah beberapa catatan panjang baru.
- melihat apakah pertanyaan standalone panjang tetap kebocoran konteks lama.

Hasil positif:
- Detail dekat dan menengah masih bisa diambil:
- `LP103 ... nilai dari kode ANGIN ...`
- Message ID: `3EB0DD53552ACE72B1832E`
- Jawaban: `DELIMA`
- `LP106 ... nilai kode pembayaran sementara ...`
- Message ID: `3EB051689D432D8CE47B87`
- Jawaban: `TULIP`
- `LP109 ... warna DAUN apa?`
- Message ID: `3EB0EBAE13A95713C38403`
- Jawaban: `perak`

Hasil negatif:

1. Semua pesan panjang memuat konteks lama penuh
- Hampir seluruh rangkaian `LP101` sampai `LP111` mencatat:
- `ai.context.loaded`
- `contextSource: current`
- `transcriptTurnCount: 6`
- `hasSummary: true`
- `archivedSnippetCount: 4`
- Catatan:
- Ini terlalu berat/agresif. Bahkan pesan yang jelas berdiri sendiri tetap diberi konteks lama penuh.

2. Pertanyaan standalone panjang tetap membawa konteks lama walaupun user melarangnya
- User:
- `LP102 Ceritakan dengan singkat kenapa pelanggan bengkel biasanya perlu mengganti oli secara rutin, tapi jangan bahas helm, jaket, sarung tangan, kode, atau catatan sebelumnya. Jawab maksimal dua kalimat.`
- Message ID:
- `3EB00C731E0C7C0F4745E3`
- Hasil log:
- `ai.context.loaded`
- `contextSource: current`
- `transcriptTurnCount: 6`
- `hasSummary: true`
- Jawaban tetap relevan, tetapi sistem tetap memasukkan konteks lama padahal user eksplisit bilang jangan pakai catatan sebelumnya.

3. Pertanyaan matematika standalone panjang tetap membawa konteks lama
- User:
- `LP105 Tanpa menghubungkan ke catatan bengkel atau kode apa pun, berapa hasil 48 dibagi 4 lalu dikali 12? Jawab angka saja.`
- Message ID:
- `3EB0C1CF37FD5124985371`
- Hasil log:
- `ai.context.loaded`
- `contextSource: current`
- `transcriptTurnCount: 6`
- `hasSummary: true`
- Jawaban benar (`144`), tetapi context loading tidak semestinya terjadi.

4. Pertanyaan umum standalone panjang tetap membawa konteks lama
- User:
- `LP108 Aku mau tanya hal umum yang tidak ada hubungannya dengan semua catatan panjang tadi: ibu kota Jepang apa? Jawab nama kotanya saja.`
- Message ID:
- `3EB0AA33A1EEAFE38FE2A2`
- Hasil log:
- `ai.context.loaded`
- `contextSource: current`
- `transcriptTurnCount: 6`
- `hasSummary: true`
- Jawaban benar (`Tokyo`), tetapi context loading tidak semestinya terjadi.

5. Memory gagal mengambil catatan pertama setelah beberapa catatan panjang baru
- User:
- `LP110 Sekarang kembali jauh ke catatan pertama, bukan catatan Raka dan bukan kode warna: nilai kode ANGIN apa? Jawab satu kata saja.`
- Message ID:
- `3EB0154CA9B332B4648970`
- Hasil log:
- `ai.context.loaded`
- `contextSource: current`
- `transcriptTurnCount: 6`
- `hasSummary: true`
- Jawaban AI:
- `kosong`
- Jawaban semestinya:
- `DELIMA`
- Catatan:
- Ini bukti memory tidak cukup selektif untuk mengambil konteks lama yang spesifik saat beberapa catatan panjang sudah masuk setelahnya.

6. Pertanyaan baru dengan instruksi eksplisit tetap membawa konteks lama
- User:
- `LP111 Terjemahkan kata house ke bahasa Indonesia. Ini pertanyaan baru dan tidak perlu memakai catatan-catatan panjang sebelumnya. Jawab satu kata.`
- Message ID:
- `3EB06015A3464AC70F95F2`
- Hasil log:
- `ai.context.loaded`
- `contextSource: current`
- `transcriptTurnCount: 6`
- `hasSummary: true`
- Jawaban benar (`rumah`), tetapi konteks lama tetap dimuat.

Kesimpulan tambahan:
- Untuk pesan panjang, masalah utamanya bukan model tidak mampu menjawab semua hal.
- Masalah pondasinya adalah context gate terlalu permisif dan selalu membawa payload memory besar.
- Saat payload memory makin padat, AI bisa:
- tetap menjawab pertanyaan mudah dengan benar.
- berhasil mengambil detail yang relatif dekat.
- gagal mengambil detail lama yang spesifik karena tertimbun konteks baru.

### Sumber bug
- `src/ai/conversation-session-store.ts`
- Fungsi `hasMeaningfulTokenOverlap` masih terlalu mudah menganggap overlap sebagai relevansi konteks.
- `CONTEXT_STOP_WORDS` belum memasukkan banyak kata instruksi generik, misalnya:
- `jawab`
- `balas`
- `topik`
- `baru`
- `singkat`
- `angka`
- `nama`
- `kode`
- Akibatnya frasa operasional seperti `jawab ... saja`, `topik baru`, atau `balas tersimpan` bisa membuat konteks lama dianggap relevan.
- Sistem juga belum punya boundary kuat untuk frasa eksplisit seperti:
- `topik baru`
- `topik baru total`
- `sekarang topik baru`
- Frasa tersebut seharusnya memutus konteks lama, bukan malah tetap memuatnya.

### Dampak
- Memory bisa bocor ke intent/topik baru.
- Model kecil seperti `gpt-5-nano` makin mudah terpengaruh konteks yang sebenarnya tidak relevan.
- Walaupun jawaban kadang tetap benar, pondasinya belum aman karena AI menerima konteks lama yang tidak diperlukan.
- Pada follow-up tertentu, konteks yang dimuat pun belum menjamin AI mengambil fakta terbaru dengan benar.

### Lokasi sumber yang terkait
- `src/ai/conversation-session-store.ts`
- `src/ai/openai-text-gateway.ts`
- `.runtime/logs/runtime.log`
- `.runtime-bot2/logs/runtime.log`
- `src/runtime/runtime-test-outbox.ts`

### Status
- Belum diperbaiki.

## 2026-04-15 - Pencarian data belum cukup deterministik untuk semua value/field di semua kolom

### Ringkasan bug
- Secara operasional, pencarian data dirasa akurat hanya jika query dekat dengan:
- nama motor.
- header tertentu.
- kata kunci yang mudah dikenali model.
- Padahal kebutuhan yang diinginkan:
- semua field/value dari kolom A sampai Z bisa menjadi dasar pencarian.
- apa pun isi data di baris/kolom mana pun harus bisa dijadikan patokan.

### Hasil audit source
- Service read aktif sebenarnya sudah punya whole-row query.
- `matchesQuery(row, query)` memeriksa semua `cell.value`.
- `matchesQuery(row, query)` juga memeriksa `cell.label`.
- Jadi di level service, query bebas lintas value memang ada.
- Tetapi kelemahannya:
- model harus lebih dulu membentuk `query` yang tepat.
- model harus lebih dulu memutuskan memakai tool.
- tidak ada search planner deterministik yang mengambil alih pencarian lintas seluruh nilai secara disiplin.

### Sumber bug
- Masalahnya bukan murni read-service tidak bisa mencari semua kolom.
- Masalah utamanya ada di jembatan AI -> tool:
- model belum konsisten mengirim query yang tepat.
- model belum konsisten memakai tool.
- sistem belum memberi jalur pencarian yang cukup deterministik untuk model kecil.

### Lokasi sumber yang terkait
- `src/ai/spreadsheet-read-service.ts`
- `src/ai/openai-text-gateway.ts`

### Status
- Belum diperbaiki.

## 2026-04-15 - Sistem belum punya layer khusus untuk recap, akumulasi, filter lanjutan, dan analisis data terstruktur

### Ringkasan bug
- Kebutuhan seperti recap, akumulasi, perhitungan, filter tertentu, dan analisis data terstruktur saat ini belum punya layer sistem yang kuat.
- Akibatnya pekerjaan seperti itu masih terlalu dibebankan ke reasoning AI murni.

### Hasil audit source
- Tool read aktif saat ini hanya mengembalikan:
- `headers`
- `rows`
- `rowCount`
- `filteredRowCount`
- `error`
- Tidak ada operasi sistem khusus untuk:
- sum.
- recap by period.
- group by.
- aggregate by status.
- ringkasan bisnis terstruktur.
- Jadi kalau user minta rekap atau akumulasi, AI harus mengimprovisasi sendiri dari data yang dikembalikan.
- Untuk model seperti `gpt-5-nano`, ini rawan salah atau tidak konsisten.

### Sumber bug
- Kekurangan ini bukan hanya masalah model.
- Ini juga gap kemampuan sistem aktif: belum ada tool/layer analitik data yang memang dibuat untuk tugas recap/akumulasi/filter lanjutan.

### Lokasi sumber yang terkait
- `src/ai/spreadsheet-read-service.ts`
- `src/ai/openai-text-gateway.ts`

### Status
- Belum diperbaiki.
