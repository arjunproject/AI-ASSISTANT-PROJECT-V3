import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createAiConversationSessionStore } from '../src/ai/conversation-session-store.js';

test('ai conversation store keeps recent transcript available for same-chat continuation', () => {
  const store = createAiConversationSessionStore(4);

  store.rememberExchange(
    'chat-1',
    'printer kantor error terus',
    'Cek kabel daya dulu.',
    '2026-04-10T00:00:00.000Z',
    'none',
  );

  const prepared = store.prepareContext('chat-1', 'yang tadi itu mulai cek dari mana?');

  assert.equal(prepared.contextLoaded, true);
  assert.equal(prepared.contextSource, 'current');
  assert.equal(prepared.summary, null);
  assert.equal(prepared.transcript.length, 2);
  assert.match(prepared.transcript[0]?.text ?? '', /printer kantor error terus/i);
});

test('ai conversation store does not load old context for standalone new topics', () => {
  const store = createAiConversationSessionStore(4);

  store.rememberExchange(
    'chat-new-topic',
    'printer kantor error terus',
    'Cek kabel daya dulu.',
    '2026-04-10T00:00:00.000Z',
    'none',
  );

  const prepared = store.prepareContext('chat-new-topic', 'berapa hasil 12 kali 7');

  assert.equal(prepared.contextLoaded, false);
  assert.equal(prepared.contextSource, 'none');
  assert.equal(prepared.summary, null);
  assert.equal(prepared.transcript.length, 0);
});

test('ai conversation store treats a fresh image handoff as a new visual boundary', () => {
  const store = createAiConversationSessionStore(4);

  store.rememberExchange(
    'chat-image-boundary',
    [
      'Pesan gambar terbaru:',
      'Pertanyaan/caption user: Ini gambar apa?',
      'Observasi visual gambar terbaru: mikrofon lavalier JETE M1 di dalam kemasan.',
      'Tugas jawaban: jawab pertanyaan/caption user berdasarkan observasi visual gambar terbaru.',
    ].join('\n'),
    'Itu mikrofon lavalier JETE M1.',
    '2026-04-10T00:00:00.000Z',
    'none',
  );

  const prepared = store.prepareContext(
    'chat-image-boundary',
    [
      'Pesan gambar terbaru:',
      'Pertanyaan/caption user: Ini gambar apa?',
      'Observasi visual gambar terbaru: cangkir putih di atas meja.',
      'Tugas jawaban: jawab pertanyaan/caption user berdasarkan observasi visual gambar terbaru.',
    ].join('\n'),
  );

  assert.equal(prepared.contextLoaded, false);
  assert.equal(prepared.contextSource, 'none');
  assert.equal(prepared.transcript.length, 0);
});

test('ai conversation store still loads visual context when the user explicitly follows up', () => {
  const store = createAiConversationSessionStore(4);

  store.rememberExchange(
    'chat-image-followup',
    [
      'Pesan gambar terbaru:',
      'Pertanyaan/caption user: Ini gambar apa?',
      'Observasi visual gambar terbaru: printer kantor menampilkan lampu error merah.',
      'Tugas jawaban: jawab pertanyaan/caption user berdasarkan observasi visual gambar terbaru.',
    ].join('\n'),
    'Itu printer kantor dengan lampu error merah.',
    '2026-04-10T00:00:00.000Z',
    'none',
  );

  const prepared = store.prepareContext('chat-image-followup', 'yang tadi harus mulai cek dari mana?');

  assert.equal(prepared.contextLoaded, true);
  assert.equal(prepared.contextSource, 'current');
  assert.match(prepared.transcript.map((turn) => turn.text).join('\n'), /lampu error merah/i);
});

test('ai conversation store limits ambiguous follow-up to the latest exchange only', () => {
  const store = createAiConversationSessionStore(4);

  store.rememberExchange(
    'chat-ambiguous-followup',
    [
      'Pesan gambar terbaru:',
      'Pertanyaan/caption user: Ini gambar apa?',
      'Observasi visual gambar terbaru: mikrofon lavalier JETE M1 di dalam kemasan.',
      'Tugas jawaban: jawab pertanyaan/caption user berdasarkan observasi visual gambar terbaru.',
    ].join('\n'),
    'Itu mikrofon lavalier JETE M1.',
    '2026-04-10T00:00:00.000Z',
    'none',
  );
  store.rememberExchange(
    'chat-ambiguous-followup',
    [
      'Pesan gambar terbaru:',
      'Pertanyaan/caption user: Kalau ini?',
      'Observasi visual gambar terbaru: botol minuman oranye di atas meja.',
      'Tugas jawaban: jawab pertanyaan/caption user berdasarkan observasi visual gambar terbaru.',
    ].join('\n'),
    'Itu botol minuman oranye.',
    '2026-04-10T00:01:00.000Z',
    'none',
  );

  const prepared = store.prepareContext('chat-ambiguous-followup', 'yang benar apa?');
  const transcriptText = prepared.transcript.map((turn) => turn.text).join('\n');

  assert.equal(prepared.contextLoaded, true);
  assert.equal(prepared.contextSource, 'current');
  assert.equal(prepared.transcript.length, 2);
  assert.match(transcriptText, /botol minuman oranye/i);
  assert.doesNotMatch(transcriptText, /mikrofon lavalier/i);
});

test('ai conversation store archives older context neutrally when recent transcript overflows', () => {
  const store = createAiConversationSessionStore(2);

  store.rememberExchange(
    'chat-2',
    'printer kantor error terus',
    'Cek kabel daya dulu.',
    '2026-04-10T00:00:00.000Z',
    'none',
  );
  store.rememberExchange(
    'chat-2',
    'yang tadi itu mulai cek dari mana?',
    'Mulai dari restart printer.',
    '2026-04-10T00:01:00.000Z',
    'current',
  );
  store.rememberExchange(
    'chat-2',
    'berapa hasil 12 kali 7',
    '84',
    '2026-04-10T00:02:00.000Z',
    'current',
  );

  const prepared = store.prepareContext('chat-2', 'yang kemarin soal printer itu');

  assert.equal(prepared.contextLoaded, true);
  assert.equal(prepared.contextSource, 'current');
  assert.equal(prepared.transcript.length, 2);
  assert.equal(prepared.archivedSnippetCount, 1);
  assert.match(prepared.summary ?? '', /printer kantor error terus/i);
  assert.match(prepared.transcript[0]?.text ?? '', /yang tadi itu mulai cek dari mana/i);
  assert.doesNotMatch(
    prepared.transcript.map((turn) => turn.text).join('\n'),
    /berapa hasil 12 kali 7/i,
  );
});

test('ai conversation store keeps archived notes free from search source metadata', () => {
  const store = createAiConversationSessionStore(1);

  store.rememberExchange(
    'chat-3',
    'Harga emas hari ini berapa?',
    'Sekitar Rp1,9 jutaan per gram.\nSumber: https://example.com/emas',
    '2026-04-10T00:00:00.000Z',
    'none',
  );
  store.rememberExchange(
    'chat-3',
    '12 x 7 berapa?',
    '84',
    '2026-04-10T00:01:00.000Z',
    'current',
  );

  const prepared = store.prepareContext('chat-3', 'balik ke emas tadi');

  assert.match(prepared.summary ?? '', /Harga emas hari ini berapa/i);
  assert.doesNotMatch(prepared.summary ?? '', /Sumber:/i);
  assert.doesNotMatch(prepared.summary ?? '', /example\.com/i);
});

test('ai conversation store strips internal payloads from stored assistant context', () => {
  const store = createAiConversationSessionStore(1);

  store.rememberExchange(
    'chat-internal',
    'Ada motor yang suratnya lengkap hidup?',
    '{"assistantText":"Ini internal","stockMotor":{"display":true,"selectionIntent":"surat lengkap hidup"}}',
    '2026-04-10T00:00:00.000Z',
    'none',
  );
  store.rememberExchange(
    'chat-internal',
    'Lanjut yang tadi',
    'Siap, kita lanjut dari konteks user saja.',
    '2026-04-10T00:01:00.000Z',
    'current',
  );

  const prepared = store.prepareContext('chat-internal', 'masih nyambung?');

  assert.doesNotMatch(prepared.summary ?? '', /assistantText|stockMotor|selectionIntent/i);
  assert.doesNotMatch(prepared.summary ?? '', /mirror|json|sinkron terakhir|spreadsheet bisnis/i);
  assert.doesNotMatch(
    prepared.transcript.map((turn) => turn.text).join('\n'),
    /assistantText|stockMotor|selectionIntent|sinkron terakhir|spreadsheet bisnis/i,
  );
});

test('ai conversation store does not keep legacy read fallback disclaimers in memory', () => {
  const store = createAiConversationSessionStore(1);

  store.rememberExchange(
    'chat-fallback',
    'Kamu udah bisa baca dataku?',
    'Belum otomatis bisa baca data pribadimu. Kirim/unggah cuplikan atau hubungkan Google Sheets/CSV/API.',
    '2026-04-10T00:00:00.000Z',
    'none',
  );
  store.rememberExchange(
    'chat-fallback',
    'Lanjut',
    'Siap, lanjut.',
    '2026-04-10T00:01:00.000Z',
    'current',
  );

  const prepared = store.prepareContext('chat-fallback', 'cek lagi');

  assert.doesNotMatch(prepared.summary ?? '', /belum bisa baca otomatis|hubungkan google sheets|csv\/api/i);
  assert.equal(prepared.transcript.length, 2);
  assert.doesNotMatch(
    prepared.transcript.map((turn) => turn.text).join('\n'),
    /belum bisa baca otomatis|hubungkan google sheets|csv\/api/i,
  );
});

test('ai conversation store strips generic trailing CTA closings from assistant memory', () => {
  const store = createAiConversationSessionStore(1);

  store.rememberExchange(
    'chat-template-closing',
    'Tampilkan data motor yang ready.',
    [
      'NO: 23',
      'NAMA MOTOR: beat',
      'STATUS: READY',
      '',
      'Kalau mau, aku bisa bantu detail lain atau bikin versi Excel/CSV.',
    ].join('\n'),
    '2026-04-10T00:00:00.000Z',
    'none',
  );
  store.rememberExchange(
    'chat-template-closing',
    'Lanjut',
    'Siap, lanjut dari data yang tadi.',
    '2026-04-10T00:01:00.000Z',
    'current',
  );

  const prepared = store.prepareContext('chat-template-closing', 'cek konteks');

  assert.match(prepared.summary ?? '', /NO: 23/i);
  assert.doesNotMatch(prepared.summary ?? '', /excel|csv|detail lain/i);
  assert.doesNotMatch(
    prepared.transcript.map((turn) => turn.text).join('\n'),
    /excel|csv|detail lain/i,
  );
});

test('ai conversation store keeps short content-bearing follow-ups inside the recent conversation window', () => {
  const store = createAiConversationSessionStore(4);

  store.rememberExchange(
    'chat-4',
    'Info harga galaxy book 6 ultra?',
    'Mulai sekitar US$2,449.99.',
    '2026-04-10T00:00:00.000Z',
    'none',
  );

  const prepared = store.prepareContext('chat-4', 'Kalo btc?');

  assert.equal(prepared.contextSource, 'current');
  assert.equal(prepared.summary, null);
  assert.equal(prepared.transcript.length, 2);
  assert.match(prepared.transcript[0]?.text ?? '', /galaxy book 6 ultra/i);

  const remembered = store.rememberExchange(
    'chat-4',
    'Kalo btc?',
    'BTC sekarang lagi di kisaran tertentu.',
    '2026-04-10T00:01:00.000Z',
    prepared.contextSource,
  );

  assert.equal(remembered.summaryUpdated, true);
});

test('ai conversation store keeps ordinal follow-up attached through recent transcript, not topic parsers', () => {
  const store = createAiConversationSessionStore(4);

  store.rememberExchange(
    'chat-5',
    'Rekomendasi mini pc paling kuat sekarang apa?',
    '1. Produk A\n2. Produk B',
    '2026-04-10T00:00:00.000Z',
    'none',
  );

  const prepared = store.prepareContext('chat-5', 'Yang no 1 harganya berapa?');

  assert.equal(prepared.contextSource, 'current');
  assert.equal(prepared.summary, null);
  assert.equal(prepared.transcript.length, 2);
  assert.match(prepared.transcript[0]?.text ?? '', /Rekomendasi mini pc paling kuat/i);
  assert.match(prepared.transcript[1]?.text ?? '', /Produk A/i);
});

test('ai conversation store keeps the active transcript short even when session capacity is larger', () => {
  const store = createAiConversationSessionStore(6);

  store.rememberExchange(
    'chat-6',
    'Topik awal masih aktif',
    'Balasan awal.',
    '2026-04-10T00:00:00.000Z',
    'none',
  );
  store.rememberExchange(
    'chat-6',
    'Topik masih lanjut',
    'Balasan lanjut.',
    '2026-04-10T00:01:00.000Z',
    'current',
  );
  store.rememberExchange(
    'chat-6',
    'Topik ketiga',
    'Balasan ketiga.',
    '2026-04-10T00:02:00.000Z',
    'current',
  );
  store.rememberExchange(
    'chat-6',
    'Topik keempat',
    'Balasan keempat.',
    '2026-04-10T00:03:00.000Z',
    'current',
  );

  const prepared = store.prepareContext('chat-6', 'lanjut topik terbaru');

  assert.equal(prepared.contextSource, 'current');
  assert.equal(prepared.transcript.length, 2);
  assert.equal(prepared.archivedSnippetCount, 1);
  assert.match(prepared.summary ?? '', /Topik awal masih aktif/i);
  assert.match(prepared.transcript[0]?.text ?? '', /Topik keempat/i);
});
