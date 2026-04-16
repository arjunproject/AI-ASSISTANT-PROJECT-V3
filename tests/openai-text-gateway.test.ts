import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadAppConfig } from '../src/config/app-config.js';
import { createOpenAiTextGateway, inspectAiGatewayConfig } from '../src/ai/openai-text-gateway.js';

const EXPECTED_DATA_RULES_XML = [
  '<ATURAN_DATA_MUTLAK>',
  '1. VISIBILITAS & PATOKAN \'NO\': Default HANYA tampilkan motor READY. Sembunyikan TERJUAL kecuali user eksplisit meminta. PENGECUALIAN: Jika user mencari spesifik via \'NO\' (Kolom A), wajib tampilkan apa pun statusnya (Abaikan filter READY, set includeSold=true). DILARANG pakai Row Number.',
  '2. DEFINISI DATA TIDAK LENGKAP (STOK MOTOR): Sebuah data dianggap TIDAK LENGKAP hanya jika ada kekosongan pada field B, C, D, E, F, G, H, atau L. Jika field I, J, dan K (terkait penjualan) kosong, itu adalah NORMAL dan datanya tetap dianggap LENGKAP. Jangan pernah melaporkan motor sebagai "data tidak lengkap" hanya karena belum terjual.',
  '3. NO CHERRY-PICKING: Jika hasil temuan >1, WAJIB tampilkan SEMUA hasil. Beri label \'NO\' atau \'PLAT\' sebagai pembeda.',
  '4. ZERO-CHATTER: Langsung eksekusi data. DILARANG KERAS membuat kalimat basa-basi pengantar (contoh salah: "Berikut data motor:") dan DILARANG menambahkan Note/Catatan di akhir output.',
  '5. FORMAT OUTPUT BERDASARKAN INTENT:',
  '   - INTENT SPESIFIK: Jawab HANYA detail field yang ditanya sesuai <TEMPLATE_INTENT_SPESIFIK>.',
  '   - INTENT GENERAL: Tampilkan 100% FULL RECORD. DILARANG KERAS pakai tabel spasi/markdown. WAJIB pakai format List Vertikal (Satu baris satu field) sesuai <TEMPLATE_FULL_RECORD>. Nilai kosong = `-`.',
  '6. PENGGUNAAN EMOJI (DIIZINKAN): Kamu diizinkan menggunakan gaya/emoji dari Dynamic Prompt Overlay untuk menghias output, SELAMA struktur utama list vertikal `NAMA FIELD: Nilai` tetap utuh dan tidak berubah menjadi paragraf atau tabel hancur.',
  '7. PENANGANAN 0 HASIL & ANTI-HALUSINASI: Jika hasil eksekusi tool mengembalikan 0 baris data, itu berarti datanya memang tidak ada di database. Gunakan reasoning-mu sendiri dan gaya bahasamu yang sedang aktif untuk menginformasikan hal ini secara natural kepada user. DILARANG KERAS memaksakan jawaban dengan mencomot atau mengarang data dari riwayat percakapan sebelumnya untuk menutupi kegagalan pencarian tool.',
  '</ATURAN_DATA_MUTLAK>',
  '',
  '<TEMPLATE_INTENT_SPESIFIK>',
  'User: [Pertanyaan nilai spesifik] dari [Kata Kunci]',
  'Assistant: NO [Angka NO]: [Nama Kolom] = [Nilai]. NO [Angka NO berikutnya]: [Nama Kolom] = [Nilai].',
  '</TEMPLATE_INTENT_SPESIFIK>',
  '',
  '<TEMPLATE_FULL_RECORD>',
  'NO: [Nilai]',
  'NAMA MOTOR: [Nilai]',
  'TAHUN: [Nilai]',
  'PLAT: [Nilai]',
  'SURAT-SURAT: [Nilai]',
  'TAHUN PLAT: [Nilai]',
  'PAJAK: [Nilai]',
  'HARGA JUAL: [Nilai]',
  'HARGA LAKU: [Nilai]',
  'TGL TERJUAL: [Nilai]',
  'LABA/RUGI: [Nilai]',
  'HARGA BELI: [Nilai]',
  'STATUS: [Nilai]',
  '</TEMPLATE_FULL_RECORD>',
].join('\n');

function getInputMessages(input: unknown): Array<{ role: string; content: string }> {
  assert.equal(Array.isArray(input), true);
  return (input as Array<Record<string, unknown>>).map((item) => ({
    role: String(item.role ?? ''),
    content: String(item.content ?? ''),
  }));
}

function getInputText(input: unknown): string {
  return getInputMessages(input).map((item) => item.content).join('\n\n');
}

function assertDataRulesXmlIncluded(instructions: unknown): void {
  const text = String(instructions ?? '');
  assert.equal(text.includes(EXPECTED_DATA_RULES_XML), true);
}

test('ai gateway inspection stays blocked when api key or model is missing', () => {
  const config = loadAppConfig({
    projectRoot: process.cwd(),
    openAiApiKey: '',
    openAiTextModel: '',
  });

  const inspection = inspectAiGatewayConfig(config);
  assert.equal(inspection.ready, false);
  assert.equal(inspection.modelName, null);
  assert.equal(inspection.webSearchReady, false);
  assert.match(inspection.error ?? '', /OPENAI_API_KEY|OPENAI_TEXT_MODEL/);
});

test('ai gateway uses configured model and returns plain text through the official response path', async () => {
  const config = loadAppConfig({
    projectRoot: process.cwd(),
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
    aiRequestTimeoutMs: 5_000,
  });

  const fakeClient = {
    responses: {
      async create() {
        return {
          output_text: 'jawaban singkat',
        };
      },
    },
  };

  const gateway = createOpenAiTextGateway(config, {
    client: fakeClient as never,
  });

  const response = await gateway.generateReply({
    userText: 'Halo',
    inputMode: 'text',
    chatJid: '201507007785@s.whatsapp.net',
    senderJid: '201507007785@s.whatsapp.net',
    normalizedSender: '201507007785',
    summary: 'Fokus awal: sapaan',
    transcript: [],
    webSearchAvailable: false,
    dynamicPromptOverlay: null,
  });

  assert.equal(response.modelName, 'test-model');
  assert.equal(response.text, 'jawaban singkat');
  assert.equal(response.webSearch.used, false);
  assert.equal(response.dataRead!.used, false);
  assert.equal(response.outputSafety!.rewriteApplied, false);
});

test('ai gateway extracts text from message output parts and keeps latest message as the main anchor', async () => {
  const config = loadAppConfig({
    projectRoot: process.cwd(),
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
    aiRequestTimeoutMs: 5_000,
  });

  let capturedRequest: Record<string, any> | null = null;
  const fakeClient = {
    responses: {
      async create(request: Record<string, any>) {
        capturedRequest = request;
        return {
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'balasan panjang yang tetap singkat',
                },
              ],
            },
          ],
        };
      },
    },
  };

  const gateway = createOpenAiTextGateway(config, {
    client: fakeClient as never,
  });

  const response = await gateway.generateReply({
    userText: 'Aku lagi capek banget dan pengin cerita panjang lebar soal hari ini.',
    inputMode: 'text',
    chatJid: '2362534006947@lid',
    senderJid: '201507007785@s.whatsapp.net',
    normalizedSender: '201507007785',
    summary: 'Fokus awal: curhat berat',
    transcript: [
      {
        role: 'user',
        text: 'Halo',
        observedAt: '2026-04-10T00:00:00.000Z',
      },
      {
        role: 'assistant',
        text: 'Halo juga, aku dengerin.',
        observedAt: '2026-04-10T00:00:01.000Z',
      },
    ],
    webSearchAvailable: false,
    dynamicPromptOverlay: null,
  });

  assert.equal(response.text, 'balasan panjang yang tetap singkat');
  assert.equal(response.dataRead!.used, false);
  if (!capturedRequest) {
    throw new Error('Expected gateway request to be captured.');
  }

  const sentRequest = capturedRequest as Record<string, any>;
  assert.equal(sentRequest.reasoning?.effort ?? null, 'low');
  assert.equal(sentRequest.text?.verbosity ?? null, 'low');
  assert.equal(sentRequest.max_output_tokens ?? null, 420);
  assert.match(String(sentRequest.instructions ?? ''), /pesan terbaru user sebagai pusat utama/i);
  assert.doesNotMatch(String(sentRequest.instructions ?? ''), /JSON valid tanpa markdown|stockMotor|selectedNos|selectionIntent/i);

  const inputMessages = getInputMessages(sentRequest.input);
  assert.equal(inputMessages[0]?.role, 'system');
  assert.match(inputMessages[0]?.content ?? '', /Fokus awal: curhat berat/i);
  assert.equal(inputMessages[1]?.role, 'user');
  assert.equal(inputMessages[1]?.content, 'Halo');
  assert.equal(inputMessages[2]?.role, 'assistant');
  assert.equal(inputMessages[2]?.content, 'Halo juga, aku dengerin.');
  assert.equal(inputMessages.at(-1)?.role, 'user');
  assert.match(inputMessages.at(-1)?.content ?? '', /Pengirim WhatsApp saat ini: 201507007785/i);
  assert.match(inputMessages.at(-1)?.content ?? '', /Pesan terbaru user \(utama\):/i);
  assert.match(inputMessages.at(-1)?.content ?? '', /Aku lagi capek banget/i);
});

test('ai gateway reports incomplete max_output_tokens responses honestly', async () => {
  const config = loadAppConfig({
    projectRoot: process.cwd(),
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
    aiRequestTimeoutMs: 5_000,
  });

  const fakeClient = {
    responses: {
      async create() {
        return {
          status: 'incomplete',
          incomplete_details: {
            reason: 'max_output_tokens',
          },
          output: [
            {
              type: 'reasoning',
              summary: [],
            },
          ],
          output_text: '',
        };
      },
    },
  };

  const gateway = createOpenAiTextGateway(config, {
    client: fakeClient as never,
  });

  await assert.rejects(
    () => gateway.generateReply({
      userText: 'Kenapa kamu gak balas pesanku yang panjang tadi?',
      inputMode: 'text',
      chatJid: '2362534006947@lid',
      senderJid: '201507007785@s.whatsapp.net',
      normalizedSender: '201507007785',
      summary: 'Fokus awal: curhat panjang',
      transcript: [],
      webSearchAvailable: false,
      dynamicPromptOverlay: null,
    }),
    /incomplete response: max_output_tokens \(output=reasoning\)/i,
  );
});

test('ai gateway retries once for incomplete web search responses caused by max_output_tokens', async () => {
  const config = loadAppConfig({
    projectRoot: process.cwd(),
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
    aiRequestTimeoutMs: 5_000,
  });

  const capturedRequests: Array<Record<string, any>> = [];
  const fakeClient = {
    responses: {
      async create(request: Record<string, any>) {
        capturedRequests.push(request);
        if (capturedRequests.length === 1) {
          return {
            status: 'incomplete',
            incomplete_details: {
              reason: 'max_output_tokens',
            },
            output: [
              { type: 'reasoning', summary: [] },
              { type: 'web_search_call', action: { query: 'Samsung Galaxy Book 6 Ultra price 2026', sources: [] } },
              { type: 'reasoning', summary: [] },
            ],
            output_text: '',
          };
        }

        return {
          status: 'completed',
          output: [
            {
              type: 'web_search_call',
              action: {
                query: 'Samsung Galaxy Book 6 Ultra price 2026',
                sources: [
                  {
                    title: 'Book price',
                    url: 'https://example.com/book',
                    name: 'example.com',
                  },
                ],
              },
            },
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'Mulai sekitar $2,449.99.',
                },
              ],
            },
          ],
        };
      },
    },
  };

  const gateway = createOpenAiTextGateway(config, {
    client: fakeClient as never,
  });

  const response = await gateway.generateReply({
    userText: 'Rupiahnya berapa?',
    inputMode: 'text',
    chatJid: '2362534006947@lid',
    senderJid: '201507007785@s.whatsapp.net',
    normalizedSender: '201507007785',
    summary: 'Fokus awal: Info harga galaxy book 6 ultra?',
    transcript: [],
    webSearchAvailable: true,
    dynamicPromptOverlay: null,
  });

  assert.equal(capturedRequests.length, 2);
  assert.equal(capturedRequests[0]?.max_output_tokens, 900);
  assert.equal(capturedRequests[1]?.max_output_tokens, 1400);
  assert.match(response.text, /Mulai sekitar \$2,449\.99\./);
  assert.equal(response.dataRead!.used, false);
});

test('ai gateway attaches web search sources when tool is used', async () => {
  const config = loadAppConfig({
    projectRoot: process.cwd(),
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
    aiRequestTimeoutMs: 5_000,
  });

  let capturedRequest: Record<string, any> | null = null;
  const fakeClient = {
    responses: {
      async create(request: Record<string, any>) {
        capturedRequest = request;
        return {
          status: 'completed',
          output: [
            {
              type: 'web_search_call',
              action: {
                query: 'harga bitcoin hari ini',
                sources: [
                  {
                    title: 'Harga Bitcoin',
                    url: 'https://example.com/btc',
                    name: 'example.com',
                  },
                ],
              },
            },
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'Bitcoin hari ini naik tipis.',
                },
              ],
            },
          ],
        };
      },
    },
  };

  const gateway = createOpenAiTextGateway(config, {
    client: fakeClient as never,
  });

  const response = await gateway.generateReply({
    userText: 'Cek harga bitcoin hari ini',
    inputMode: 'text',
    chatJid: '2362534006947@lid',
    senderJid: '201507007785@s.whatsapp.net',
    normalizedSender: '201507007785',
    summary: null,
    transcript: [],
    webSearchAvailable: true,
    dynamicPromptOverlay: null,
  });

  assert.equal(response.webSearch.used, true);
  assert.equal(response.webSearch.query, 'harga bitcoin hari ini');
  assert.equal(response.webSearch.resultCount, 1);
  assert.match(response.text, /Bitcoin hari ini naik tipis\./);
  assert.equal(response.dataRead!.used, false);
  assert.match(response.text, /Sumber: https:\/\/example\.com\/btc/);
  const requestRecord = capturedRequest as {
    tools?: Array<{ type?: string }>;
    include?: string[];
  } | null;
  assert.equal(requestRecord?.tools?.some((tool) => tool.type === 'web_search'), true);
  assert.deepEqual(requestRecord?.include ?? null, ['web_search_call.action.sources']);
});

test('ai gateway rejects source-only web search responses honestly', async () => {
  const config = loadAppConfig({
    projectRoot: process.cwd(),
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
    aiRequestTimeoutMs: 5_000,
  });

  const fakeClient = {
    responses: {
      async create() {
        return {
          status: 'completed',
          output: [
            {
              type: 'web_search_call',
              action: {
                query: 'harga samsung s26 ultra',
                sources: [
                  {
                    title: 'Harga Samsung',
                    url: 'https://example.com/s26',
                    name: 'example.com',
                  },
                ],
              },
            },
          ],
        };
      },
    },
  };

  const gateway = createOpenAiTextGateway(config, {
    client: fakeClient as never,
  });

  await assert.rejects(
    () => gateway.generateReply({
      userText: 'Rupiahnya berapa?',
      inputMode: 'text',
      chatJid: '2362534006947@lid',
      senderJid: '201507007785@s.whatsapp.net',
      normalizedSender: '201507007785',
      summary: 'Fokus awal: Berapa harga samsung s26 ultra?',
      transcript: [],
      webSearchAvailable: true,
      dynamicPromptOverlay: null,
    }),
    /empty response/i,
  );
});

test('ai gateway includes dynamic prompt overlay as secondary guidance', async () => {
  const config = loadAppConfig({
    projectRoot: process.cwd(),
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
    aiRequestTimeoutMs: 5_000,
  });

  let capturedRequest: Record<string, any> | null = null;
  const fakeClient = {
    responses: {
      async create(request: Record<string, any>) {
        capturedRequest = request;
        return {
          output_text: 'jawaban singkat',
        };
      },
    },
  };

  const gateway = createOpenAiTextGateway(config, {
    client: fakeClient as never,
  });

  await gateway.generateReply({
    userText: 'Halo',
    inputMode: 'text',
    chatJid: '201507007785@s.whatsapp.net',
    senderJid: '201507007785@s.whatsapp.net',
    normalizedSender: '201507007785',
    summary: null,
    transcript: [],
    webSearchAvailable: false,
    dynamicPromptOverlay: 'Jawab lebih ringkas.',
  });

  if (!capturedRequest) {
    throw new Error('Expected gateway request to be captured.');
  }
  const requestText = getInputText((capturedRequest as Record<string, unknown>).input);
  assert.match(requestText, /Overlay instruksi tambahan untuk chat ini/i);
  assert.match(requestText, /Jawab lebih ringkas\./);
});

test('ai gateway labels image-derived input honestly inside the shared prompt', async () => {
  const config = loadAppConfig({
    projectRoot: process.cwd(),
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
    aiRequestTimeoutMs: 5_000,
  });

  let capturedRequest: Record<string, any> | null = null;
  const fakeClient = {
    responses: {
      async create(request: Record<string, any>) {
        capturedRequest = request;
        return {
          output_text: 'jawaban singkat',
        };
      },
    },
  };

  const gateway = createOpenAiTextGateway(config, {
    client: fakeClient as never,
  });

  await gateway.generateReply({
    userText: [
      'Pesan gambar terbaru:',
      'Pertanyaan/caption user: Tolong cek ini.',
      'Observasi visual gambar terbaru: monitor retak di pojok kanan atas.',
      'Tugas jawaban: jawab pertanyaan/caption user berdasarkan observasi visual gambar terbaru. Jangan membuat caption kecuali user memang meminta caption. Jangan meminta user mengirim ulang atau menempel konteks visual lagi.',
    ].join('\n'),
    inputMode: 'image',
    chatJid: '201507007785@s.whatsapp.net',
    senderJid: '201507007785@s.whatsapp.net',
    normalizedSender: '201507007785',
    summary: null,
    transcript: [],
    webSearchAvailable: false,
    dynamicPromptOverlay: null,
  });

  if (!capturedRequest) {
    throw new Error('Expected gateway request to be captured.');
  }
  const requestText = getInputText((capturedRequest as Record<string, unknown>).input);
  assert.match(requestText, /Mode input terbaru:/);
  assert.match(requestText, /Gambar terbaru yang sudah dianalisis menjadi observasi visual/i);
  assert.match(requestText, /Aturan khusus pesan gambar terbaru:/i);
  assert.match(requestText, /Jika user bertanya "ini gambar apa", jawab identifikasi objek utama/i);
  assert.match(requestText, /Jangan membuat caption, daftar caption, atau gaya promosi/i);
});

test('ai gateway requests a safe rewrite when the response contains internal payloads', async () => {
  const config = loadAppConfig({
    projectRoot: process.cwd(),
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
    aiRequestTimeoutMs: 5_000,
  });

  let callCount = 0;
  const fakeClient = {
    responses: {
      async create() {
        callCount += 1;
        if (callCount === 1) {
          return {
            output_text: '{"assistantText":"internal","stockMotor":{"display":true,"selectedNos":["42"]}}',
          };
        }
        return {
          output_text: 'Maaf, aku belum bisa menampilkan detail itu sekarang.',
        };
      },
    },
  };

  const gateway = createOpenAiTextGateway(config, {
    client: fakeClient as never,
  });

  const response = await gateway.generateReply({
    userText: 'Halo',
    inputMode: 'text',
    chatJid: '6285655002277@s.whatsapp.net',
    senderJid: '6285655002277@s.whatsapp.net',
    normalizedSender: '6285655002277',
    summary: null,
    transcript: [],
    webSearchAvailable: false,
    dynamicPromptOverlay: null,
  });

  assert.equal(response.text, 'Maaf, aku belum bisa menampilkan detail itu sekarang.');
  assert.equal(callCount, 2);
  assert.equal(response.outputSafety!.rewriteApplied, true);
});

test('ai gateway falls back when safe rewrite still leaks internal metadata', async () => {
  const config = loadAppConfig({
    projectRoot: process.cwd(),
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
    aiRequestTimeoutMs: 5_000,
  });

  let callCount = 0;
  const fakeClient = {
    responses: {
      async create() {
        callCount += 1;
        return {
          output_text: 'Iya, sinkron terakhir berhasil dan data bisnis saat ini sudah siap.',
        };
      },
    },
  };

  const gateway = createOpenAiTextGateway(config, {
    client: fakeClient as never,
  });

  const response = await gateway.generateReply({
    userText: 'Masih kebaca dataku?',
    inputMode: 'text',
    chatJid: '6285655002277@s.whatsapp.net',
    senderJid: '6285655002277@s.whatsapp.net',
    normalizedSender: '6285655002277',
    summary: null,
    transcript: [],
    webSearchAvailable: false,
    dynamicPromptOverlay: null,
  });

  assert.equal(response.text, 'Maaf, jawaban tadi belum siap ditampilkan dengan aman.');
  assert.equal(callCount, 2);
  assert.equal(response.outputSafety!.rewriteApplied, true);
});

test('ai gateway executes spreadsheet tool calls before returning final text', async () => {
  const config = loadAppConfig({
    projectRoot: process.cwd(),
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
    aiRequestTimeoutMs: 5_000,
  });

  const requests: Array<Record<string, any>> = [];
  const logEntries: Array<{ message: string; context?: Record<string, unknown> }> = [];
  const fakeClient = {
    responses: {
      async create(request: Record<string, any>) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            id: 'resp-1',
            output: [
              {
                type: 'function_call',
                name: 'read_spreadsheet_data',
                arguments: '{"sheet":"STOK MOTOR","query":null,"includeSold":false,"limit":null,"filters":null}',
                call_id: 'call-1',
              },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'Stok yang siap tersedia ada beberapa unit.',
                },
              ],
            },
          ],
        };
      },
    },
  };

  const gateway = createOpenAiTextGateway(config, {
    client: fakeClient as never,
    logger: {
      logFilePath: 'test.log',
      info(message, context) {
        logEntries.push({ message, context });
      },
      warn(message, context) {
        logEntries.push({ message, context });
      },
      error(message, context) {
        logEntries.push({ message, context });
      },
    },
    dataProvider: {
      async readData() {
        return {
          spreadsheetName: 'Arjun Motor Project',
          sheetName: 'STOK MOTOR',
          headers: ['NO', 'NAMA MOTOR', 'STATUS'],
          rows: [{ NO: '1', 'NAMA MOTOR': 'Beat', STATUS: 'READY' }],
          rowCount: 1,
          filteredRowCount: 1,
          error: null,
        };
      },
    },
  });

  const response = await gateway.generateReply({
    userText: 'Ada stok motor yang ready?',
    inputMode: 'text',
    chatJid: '6285655002277@s.whatsapp.net',
    senderJid: '6285655002277@s.whatsapp.net',
    normalizedSender: '6285655002277',
    summary: null,
    transcript: [],
    webSearchAvailable: false,
    dynamicPromptOverlay: null,
  });

  assert.equal(response.text, 'Stok yang siap tersedia ada beberapa unit.');
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.tools?.some((tool: { name?: string }) => tool.name === 'read_spreadsheet_data'), true);
  assert.deepEqual(
    requests[0]?.tools?.[0]?.parameters?.required ?? null,
    ['sheet', 'query', 'includeSold', 'limit', 'incompleteOnly', 'filters'],
  );
  assert.deepEqual(
    requests[0]?.tools?.[0]?.parameters?.properties?.filters?.items?.required ?? null,
    ['field', 'operator', 'value'],
  );
  const spreadsheetTool = requests[0]?.tools?.[0];
  assert.deepEqual(
    spreadsheetTool?.parameters?.properties?.filters?.items?.properties?.operator?.enum ?? null,
    ['contains', 'equals', 'starts_with', 'is_empty'],
  );
  assert.match(
    String(spreadsheetTool?.parameters?.properties?.query?.description ?? ''),
    /ekstrak ANGKA-nya saja/,
  );
  assert.match(
    String(spreadsheetTool?.parameters?.properties?.query?.description ?? ''),
    /DILARANG KERAS memasukkan kata "no", "nomor", atau spasi/,
  );
  assert.match(
    String(spreadsheetTool?.parameters?.properties?.includeSold?.description ?? ''),
    /Pencarian via NO wajib di-set true/,
  );
  assert.match(
    String(spreadsheetTool?.parameters?.properties?.filters?.items?.properties?.value?.description ?? ''),
    /ekstrak ANGKA-nya saja/,
  );
  assert.match(
    String(spreadsheetTool?.parameters?.properties?.filters?.description ?? ''),
    /gunakan parameter incompleteOnly=true sebagai jalur utama/,
  );
  assert.match(
    String(spreadsheetTool?.parameters?.properties?.filters?.description ?? ''),
    /Operator "is_empty" tetap tersedia jika user meminta cek kekosongan field tertentu/,
  );
  assert.match(
    String(spreadsheetTool?.parameters?.properties?.incompleteOnly?.description ?? ''),
    /Set true HANYA JIKA user mencari motor yang datanya tidak lengkap/,
  );
  assert.equal(requests[1]?.previous_response_id, 'resp-1');
  assert.equal(Array.isArray(requests[1]?.input), true);
  const toolArgumentsLog = logEntries.find((entry) => entry.message === 'ai.data_read_tool_arguments');
  assert.equal(toolArgumentsLog?.context?.toolName, 'read_spreadsheet_data');
  assert.equal(toolArgumentsLog?.context?.sheet, 'STOK MOTOR');
  assert.equal(toolArgumentsLog?.context?.query, null);
  assert.equal(toolArgumentsLog?.context?.includeSold, false);
  assert.equal(toolArgumentsLog?.context?.incompleteOnly, null);
  assert.equal(toolArgumentsLog?.context?.filters, null);
  assert.equal(
    toolArgumentsLog?.context?.rawArguments,
    '{"sheet":"STOK MOTOR","query":null,"includeSold":false,"limit":null,"filters":null}',
  );
  assertDataRulesXmlIncluded(requests[0]?.instructions);
  assertDataRulesXmlIncluded(requests[1]?.instructions);
  assert.match(String(requests[1]?.instructions ?? ''), /<ATURAN_DATA_MUTLAK>/);
  assert.match(String(requests[1]?.instructions ?? ''), /ZERO-CHATTER/);
  assert.match(String(requests[1]?.instructions ?? ''), /DILARANG KERAS pakai tabel spasi\/markdown/);
  assert.match(String(requests[1]?.instructions ?? ''), /PENGGUNAAN EMOJI \(DIIZINKAN\)/);
  assert.match(String(requests[1]?.instructions ?? ''), /PENANGANAN 0 HASIL & ANTI-HALUSINASI/);
  assert.match(String(requests[1]?.instructions ?? ''), /Gunakan reasoning-mu sendiri dan gaya bahasamu yang sedang aktif/);
  assert.match(String(requests[1]?.instructions ?? ''), /Status tampilkan sebagai READY atau TERJUAL, bukan true\/false/);
  assert.match(String(requests[1]?.instructions ?? ''), /<TEMPLATE_FULL_RECORD>/);
  assert.match(String(requests[1]?.instructions ?? ''), /HARGA BELI: \[Nilai\]/);
  assert.doesNotMatch(String(requests[1]?.instructions ?? ''), /Mio|Beat berapa|harga beli motor Mio/i);
  assert.equal(response.dataRead!.used, true);
  assert.equal(response.dataRead!.toolCallCount, 1);
  assert.deepEqual(response.dataRead!.sheetNames, ['STOK MOTOR']);
});

test('ai gateway repairs legacy spreadsheet fallback replies with a second model pass', async () => {
  const config = loadAppConfig({
    projectRoot: process.cwd(),
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
    aiRequestTimeoutMs: 5_000,
  });

  const requests: Array<Record<string, any>> = [];
  const fakeClient = {
    responses: {
      async create(request: Record<string, any>) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            output_text: 'Belum otomatis bisa baca data pribadimu. Kirim/unggah cuplikan atau hubungkan Google Sheets/CSV/API.',
          };
        }
        if (requests.length === 2) {
          return {
            id: 'resp-repair-1',
            output: [
              {
                type: 'function_call',
                name: 'read_spreadsheet_data',
                arguments: '{"sheet":"STOK MOTOR","query":"sonic","includeSold":false,"limit":null,"filters":[{"field":"NAMA MOTOR","operator":"contains","value":"sonic"}]}',
                call_id: 'call-repair-1',
              },
            ],
          };
        }
        return {
          output_text: 'Ada data Sonic yang bisa aku bacakan dari spreadsheet resmi.',
        };
      },
    },
  };

  const gateway = createOpenAiTextGateway(config, {
    client: fakeClient as never,
    dataProvider: {
      async readData() {
        return {
          spreadsheetName: 'Arjun Motor Project',
          sheetName: 'STOK MOTOR',
          headers: ['NO', 'NAMA MOTOR', 'STATUS'],
          rows: [{ NO: '37', 'NAMA MOTOR': 'Sonic', STATUS: 'READY' }],
          rowCount: 1,
          filteredRowCount: 1,
          error: null,
        };
      },
    },
  });

  const response = await gateway.generateReply({
    userText: 'Info data motor sonic?',
    inputMode: 'text',
    chatJid: '6285655002277@s.whatsapp.net',
    senderJid: '6285655002277@s.whatsapp.net',
    normalizedSender: '6285655002277',
    summary: null,
    transcript: [],
    webSearchAvailable: false,
    dynamicPromptOverlay: null,
  });

  assert.equal(response.text, 'Ada data Sonic yang bisa aku bacakan dari spreadsheet resmi.');
  assert.equal(response.outputSafety!.legacyCapabilityFallbackDetected, true);
  assert.equal(response.outputSafety!.capabilityRepairApplied, true);
  assert.equal(response.dataRead!.used, true);
  assert.equal(requests.length, 3);
  assert.match(String(requests[1]?.instructions ?? ''), /jangan bilang user harus kirim spreadsheet lagi/i);
});

test('ai gateway retries data-heavy spreadsheet replies with a higher token budget when first reply is incomplete', async () => {
  const config = loadAppConfig({
    projectRoot: process.cwd(),
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
    aiRequestTimeoutMs: 5_000,
  });

  const requests: Array<Record<string, any>> = [];
  const fakeClient = {
    responses: {
      async create(request: Record<string, any>) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            id: 'resp-data-1',
            output: [
              {
                type: 'function_call',
                name: 'read_spreadsheet_data',
                arguments: '{"sheet":"STOK MOTOR","query":"ready","includeSold":false,"limit":null,"filters":null}',
                call_id: 'call-data-1',
              },
            ],
          };
        }

        if (requests.length === 2) {
          return {
            status: 'incomplete',
            incomplete_details: {
              reason: 'max_output_tokens',
            },
            output: [
              {
                type: 'reasoning',
                summary: [],
              },
            ],
            output_text: '',
          };
        }

        return {
          output_text: 'Daftar stok berhasil dibacakan lengkap.',
        };
      },
    },
  };

  const gateway = createOpenAiTextGateway(config, {
    client: fakeClient as never,
    dataProvider: {
      async readData() {
        return {
          spreadsheetName: 'Arjun Motor Project',
          sheetName: 'STOK MOTOR',
          headers: ['NO', 'NAMA MOTOR', 'STATUS'],
          rows: Array.from({ length: 12 }, (_, index) => ({
            NO: String(index + 1),
            'NAMA MOTOR': `Motor ${index + 1}`,
            STATUS: 'READY',
          })),
          rowCount: 12,
          filteredRowCount: 12,
          error: null,
        };
      },
    },
  });

  const response = await gateway.generateReply({
    userText: 'Tampilkan stok motor yang ready.',
    inputMode: 'text',
    chatJid: '6285655002277@s.whatsapp.net',
    senderJid: '6285655002277@s.whatsapp.net',
    normalizedSender: '6285655002277',
    summary: null,
    transcript: [],
    webSearchAvailable: false,
    dynamicPromptOverlay: null,
  });

  assert.equal(response.text, 'Daftar stok berhasil dibacakan lengkap.');
  assert.equal(requests.length, 3);
  assert.equal(requests[1]?.max_output_tokens, 2200);
  assert.equal(requests[2]?.max_output_tokens, 3200);
});

test('secondary ai gateway disables spreadsheet tool registration entirely', async () => {
  const config = loadAppConfig({
    projectRoot: process.cwd(),
    runtimeProfile: 'secondary',
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
    aiRequestTimeoutMs: 5_000,
  });

  let capturedRequest: Record<string, any> | null = null;
  const fakeClient = {
    responses: {
      async create(request: Record<string, any>) {
        capturedRequest = request;
        return {
          output_text: 'Di bot ini aku tidak punya akses ke spreadsheet resmi proyek, tapi aku tetap bisa bantu untuk percakapan umum.',
        };
      },
    },
  };

  const gateway = createOpenAiTextGateway(config, {
    client: fakeClient as never,
    dataProvider: {
      async readData() {
        throw new Error('Spreadsheet data provider should stay disabled.');
      },
    },
  });

  const response = await gateway.generateReply({
    userText: 'Bisa baca data stok motor?',
    inputMode: 'text',
    chatJid: '201507007785@s.whatsapp.net',
    senderJid: '201507007785@s.whatsapp.net',
    normalizedSender: '201507007785',
    summary: null,
    transcript: [],
    webSearchAvailable: false,
    dynamicPromptOverlay: null,
  });

  assert.equal(response.dataRead!.toolAvailable, false);
  assert.equal(response.dataRead!.used, false);
  if (!capturedRequest) {
    throw new Error('Expected gateway request to be captured.');
  }
  const requestRecord = capturedRequest as unknown as Record<string, any>;
  assert.equal(requestRecord.tools ?? null, null);
  assert.doesNotMatch(String(requestRecord.instructions ?? ''), /read_spreadsheet_data/i);
  assert.match(String(requestRecord.instructions ?? ''), /tidak punya akses ke spreadsheet resmi/i);
});
