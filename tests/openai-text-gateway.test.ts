import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadAppConfig } from '../src/config/app-config.js';
import { createOpenAiTextGateway, inspectAiGatewayConfig } from '../src/ai/openai-text-gateway.js';

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

  const inputText = String(sentRequest.input ?? '');
  const latestMessageIndex = inputText.indexOf('Pesan terbaru user (utama):');
  const transcriptIndex = inputText.indexOf('Recent conversation (pakai hanya jika membantu memahami pesan terbaru):');
  assert.notEqual(latestMessageIndex, -1);
  assert.notEqual(transcriptIndex, -1);
  assert.equal(latestMessageIndex < transcriptIndex, true);
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
  const requestText = String((capturedRequest as Record<string, unknown>).input ?? '');
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
    userText: 'Caption user: Tolong cek ini.\nIsi gambar: monitor retak di pojok kanan atas.',
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
  const requestText = String((capturedRequest as Record<string, unknown>).input ?? '');
  assert.match(requestText, /Mode input terbaru:/);
  assert.match(requestText, /Gambar yang sudah dianalisis menjadi teks konteks visual/i);
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
    ['sheet', 'query', 'includeSold', 'limit', 'filters'],
  );
  assert.deepEqual(
    requests[0]?.tools?.[0]?.parameters?.properties?.filters?.items?.required ?? null,
    ['field', 'operator', 'value'],
  );
  assert.equal(requests[1]?.previous_response_id, 'resp-1');
  assert.equal(Array.isArray(requests[1]?.input), true);
  assert.match(String(requests[1]?.instructions ?? ''), /tampilkan setiap record yang kamu pilih secara utuh/i);
  assert.match(String(requests[1]?.instructions ?? ''), /jangan menambahkan penutup template/i);
  assert.match(String(requests[1]?.instructions ?? ''), /jangan awali record dengan numbering buatan seperti 1\), 2\)/i);
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
