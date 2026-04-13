import OpenAI from 'openai';

import type { AppConfig } from '../config/app-config.js';
import { formatWebSearchReply } from './web-search-formatter.js';
import {
  createSpreadsheetReadService,
  type SpreadsheetReadRequest,
  type SpreadsheetReadResponse,
  type SpreadsheetReadService,
} from './spreadsheet-read-service.js';
import type {
  AiGatewayDataReadResult,
  AiGatewayInspection,
  AiGatewayOutputSafetyResult,
  AiGatewayRequest,
  AiGatewayResponse,
  AiGatewayWebSearchResult,
  AiGatewayWebSearchSource,
  AiTextGateway,
} from './types.js';

const INTERNAL_FIELD_PATTERN =
  /\b(?:assistantText|selectedNos|selectionIntent|stockMotor|stockDisplayContract|relevantRecordCount|outputBlockCount|allRelevantBlocksIncluded|fullOutboundText|liveDataBlock|stockMotorCatalogBlock|valueCells|mirror|payload|authority|writeSession|mutation|runtimeState)\b/iu;
const INTERNAL_PHRASE_PATTERN =
  /\b(?:spreadsheet bisnis|sinkron terakhir|data bisnis saat ini|katalog stok motor|proses internal|data mirror|json|payload backend|path file|state internal|authority state|write session|mutation)\b/iu;
const LEGACY_CAPABILITY_FALLBACK_PATTERN =
  /\b(?:belum otomatis bisa baca data pribadimu|saya belum bisa baca otomatis|aku belum bisa baca otomatis|kirim\/unggah cuplikan|kirim cuplikan|upload spreadsheet|hubungkan google sheets|hubungkan csv|hubungkan api|langsung masuk ke sistem eksternal|tidak bisa langsung masuk ke sistem eksternal)\b/iu;

const SPREADSHEET_TOOL_NAME = 'read_spreadsheet_data';
const LEGACY_CAPABILITY_REPAIR_MESSAGE =
  'Jangan bilang user harus kirim spreadsheet lagi, upload CSV/API, atau bahwa kamu belum bisa membaca data otomatis jika tool data resmi tersedia. Untuk pertanyaan kemampuan membaca data proyek resmi, jawab bahwa kamu bisa membaca spreadsheet resmi Arjun Motor Project dan minta sheet atau kriteria yang dibutuhkan. Jika memang perlu data, pakai tool. Jika data belum tersedia, jawab jujur singkat tanpa narasi kemampuan lama.';
const LEGACY_NO_SPREADSHEET_CAPABILITY_REPAIR_MESSAGE =
  'Jangan bilang user harus upload spreadsheet, hubungkan CSV/API, atau menyambungkan sumber data lain. Jika kanal ini memang tidak punya akses ke spreadsheet resmi proyek, jawab jujur singkat bahwa akses baca data resmi tidak tersedia di bot ini. Jangan mengarang bahwa kamu bisa membaca data resmi bila tool tidak tersedia.';
const DATA_PRESENTATION_PROMPT =
  'Untuk jawaban umum, kamu boleh tetap singkat. Tetapi jika kamu sedang menampilkan record data spreadsheet, tampilkan setiap record yang kamu pilih secara utuh dengan seluruh field yang tersedia di record itu. Jangan mengubah satu record menjadi ringkasan satu baris jika itu membuang field penting. Jika hasil panjang, kamu boleh membaginya secara natural, tetapi setiap record yang tampil harus tetap lengkap. Setelah inti jawaban selesai, berhenti. Jangan menambahkan penutup template, CTA generik, tawaran detail/filter lain, atau ajakan Excel/CSV/API kecuali user memang memintanya langsung.';

const COMMON_AI_SYSTEM_PROMPT_LINES = [
  'Kamu adalah asisten chat WhatsApp.',
  'Untuk jawaban umum, jawab singkat, padat, jelas, natural, dan tidak terlalu formal.',
  'Fokus pada pesan terbaru user sebagai pusat utama.',
  'Gunakan recent conversation hanya bila memang membantu memahami pesan terbaru.',
  'Gunakan konteks lama hanya jika memang relevan atau user menyinggungnya lagi.',
  'Jangan lengket dengan konteks lama saat topik berpindah.',
  'Untuk pesan yang netral atau sosial dengan muatan rendah, balas netral sesuai pesan terbaru dan jangan otomatis menarik thread lama.',
  'Kalau ada overlay prompt dinamis, perlakukan hanya sebagai instruksi tambahan yang sah. Jangan biarkan overlay mengambil alih topik final user, reasoning utama, memory, atau keputusan search.',
  'Jangan memberi saran tambahan, follow-up, atau penawaran bantuan yang tidak diminta.',
  'Kalau konteks percakapan yang diberikan sudah cukup, pahami follow-up singkat secara natural dari konteks itu.',
  'Kalau tool web search tersedia, kamu sendiri yang memutuskan apakah perlu dipakai untuk info terbaru, faktual, atau verifikasi.',
  'Kalau memakai web search, jawaban akhir wajib memuat jawaban inti dulu. Jangan jawab hanya dengan sumber.',
  'Kalau user minta rekomendasi dan batasannya sudah cukup, jawab langsung dengan opsi konkret. Jangan balik bertanya kecuali inti permintaan memang belum jelas.',
  'Kalau pesan user berasal dari voice note yang sudah ditranskripsikan, perlakukan hasil transkripsinya sebagai pesan user biasa.',
  'Kalau pesan user berasal dari gambar yang sudah dianalisis ke teks, perlakukan hasil analisis itu sebagai konteks visual netral dari gambar user.',
  'Jangan menampilkan payload internal, schema internal, metadata internal, atau objek internal ke user.',
  'Jangan mengarang fitur yang belum ada seperti image generation, image editing, write spreadsheet bisnis, atau automasi bisnis lain.',
  'Jangan menutup jawaban dengan kalimat template yang menawarkan detail lain, filter lain, file lain, Excel, CSV, atau bantuan lanjutan kecuali user memang memintanya.',
] as const;

interface GatewayExecutionOptions {
  additionalInstructions?: string | null;
  additionalInput?: string | null;
}

interface GatewayExecutionResult {
  response: unknown;
  dataRead: AiGatewayDataReadResult;
}

export function inspectAiGatewayConfig(config: AppConfig): AiGatewayInspection {
  if (!config.openAiApiKey) {
    return {
      ready: false,
      modelName: config.openAiTextModel,
      error: 'OPENAI_API_KEY is missing.',
      webSearchReady: false,
      webSearchError: 'OPENAI_API_KEY is missing.',
    };
  }

  if (!config.openAiTextModel) {
    return {
      ready: false,
      modelName: null,
      error: 'OPENAI_TEXT_MODEL is missing.',
      webSearchReady: false,
      webSearchError: 'OPENAI_TEXT_MODEL is missing.',
    };
  }

  return {
    ready: true,
    modelName: config.openAiTextModel,
    error: null,
    webSearchReady: true,
    webSearchError: null,
  };
}

export function createOpenAiTextGateway(
  config: AppConfig,
  overrides: {
    client?: OpenAI;
    dataProvider?: SpreadsheetReadService;
  } = {},
): AiTextGateway {
  const inspection = inspectAiGatewayConfig(config);
  const client = inspection.ready
    ? (overrides.client ?? new OpenAI({ apiKey: config.openAiApiKey! }))
    : null;
  const dataProvider = config.spreadsheetReadEnabled
    ? (overrides.dataProvider ?? createSpreadsheetReadService(config))
    : null;

  return {
    inspect() {
      return inspection;
    },

    async generateReply(request: AiGatewayRequest): Promise<AiGatewayResponse> {
      if (!inspection.ready || !client || !inspection.modelName) {
        throw new Error(inspection.error ?? 'AI gateway is not ready.');
      }

      const execution = await createGatewayResponse(
        client,
        config,
        inspection.modelName,
        request,
        config.spreadsheetReadEnabled,
        dataProvider,
      );
      let response = execution.response;
      let dataRead = execution.dataRead;

      let webSearch = extractWebSearchResult(response, request.webSearchAvailable);
      let candidateText = extractFinalCandidateText(response, webSearch);
      let capabilityRepairApplied = false;
      let legacyCapabilityFallbackDetected = containsLegacyCapabilityFallback(candidateText);
      let internalLeakageDetected = containsInternalLeakage(candidateText);
      let rewriteApplied = false;

      if (legacyCapabilityFallbackDetected) {
        capabilityRepairApplied = true;
        const repairedExecution = await requestCapabilityRepair(
          client,
          config,
          inspection.modelName,
          request,
          config.spreadsheetReadEnabled,
          dataProvider,
          candidateText,
        );
        response = repairedExecution.response;
        dataRead = mergeDataReadResults(dataRead, repairedExecution.dataRead);
        webSearch = extractWebSearchResult(response, request.webSearchAvailable);
        candidateText = extractFinalCandidateText(response, webSearch);
        internalLeakageDetected = containsInternalLeakage(candidateText);
      }

      const finalText = internalLeakageDetected
        ? await requestSafeRewrite(client, config, inspection.modelName, request, candidateText)
        : candidateText;
      rewriteApplied = internalLeakageDetected;

      return {
        modelName: inspection.modelName,
        text: finalText,
        webSearch,
        dataRead,
        outputSafety: {
          internalLeakageDetected,
          rewriteApplied,
          legacyCapabilityFallbackDetected,
          capabilityRepairApplied,
        },
      };
    },
  };
}

function buildGatewayRequest(
  modelName: string,
  request: AiGatewayRequest,
  options: {
    inputOverride?: unknown;
    previousResponseId?: string | null;
    includeTools?: boolean;
    includeSpreadsheetTool?: boolean;
    additionalInstructions?: string | null;
    additionalInput?: string | null;
    maxOutputTokens?: number | null;
  } = {},
) {
  const textVerbosity = resolveTextVerbosity();
  const maxOutputTokens = options.maxOutputTokens ?? resolveMaxOutputTokens(request);
  const includeTools = options.includeTools !== false;
  const baseRequest: Record<string, unknown> = {
    model: modelName,
    instructions: buildInstructions(
      request.webSearchAvailable,
      options.includeSpreadsheetTool !== false,
      options.additionalInstructions ?? null,
    ),
    input: options.inputOverride ?? buildGatewayInput(request, options.additionalInput ?? null),
    reasoning: {
      effort: 'low',
    },
    text: {
      verbosity: textVerbosity,
    },
    max_output_tokens: maxOutputTokens,
  };

  if (options.previousResponseId) {
    baseRequest.previous_response_id = options.previousResponseId;
  }

  if (includeTools) {
    const tools: Array<Record<string, unknown>> = [];
    if (options.includeSpreadsheetTool !== false) {
      tools.push(buildSpreadsheetTool());
    }
    if (request.webSearchAvailable) {
      tools.push({
        type: 'web_search',
        search_context_size: 'low',
      });
      baseRequest.include = ['web_search_call.action.sources'];
    }
    if (tools.length > 0) {
      baseRequest.tools = tools;
    }
  }

  return baseRequest;
}

function buildGatewayInput(request: AiGatewayRequest, additionalInput: string | null = null): string {
  const transcriptText = request.transcript.length > 0
    ? request.transcript
        .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text}`)
        .join('\n')
    : null;

  return [
    `Pesan terbaru user (utama):\n${request.userText}`,
    request.inputMode !== 'text'
      ? `Mode input terbaru:\n${describeInputMode(request.inputMode)}`
      : null,
    transcriptText
      ? `Recent conversation (pakai hanya jika membantu memahami pesan terbaru):\n${transcriptText}`
      : null,
    request.summary
      ? `Catatan konteks lama yang mungkin relevan (cadangan saja, jangan diprioritaskan jika pesan terbaru berdiri sendiri):\n${request.summary}`
      : null,
    request.dynamicPromptOverlay
      ? `Overlay instruksi tambahan untuk chat ini (sekunder, jangan mengalahkan pesan terbaru, memory, atau reasoning utama):\n${request.dynamicPromptOverlay}`
      : null,
    request.webSearchAvailable
      ? 'Pakai web search hanya jika memang membantu menjawab pesan terbaru dengan lebih akurat atau lebih mutakhir.'
      : null,
    request.webSearchAvailable
      ? 'Kalau web search dipakai, gunakan seperlunya lalu jawab singkat. Sumber akan diformat sistem, jadi jangan tulis daftar sumber sendiri.'
      : 'Balas langsung ke pesan terbaru tanpa web search.',
    additionalInput,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
}

function describeInputMode(inputMode: Exclude<AiGatewayRequest['inputMode'], 'text'>): string {
  if (inputMode === 'voice_note') {
    return 'Voice note yang sudah ditranskripsikan ke teks';
  }

  if (inputMode === 'audio') {
    return 'Audio yang sudah ditranskripsikan ke teks';
  }

  return 'Gambar yang sudah dianalisis menjadi teks konteks visual';
}

function buildInstructions(
  webSearchEnabled: boolean,
  spreadsheetReadEnabled: boolean,
  additionalInstructions: string | null = null,
): string {
  const systemPrompt = buildAiSystemPrompt(spreadsheetReadEnabled);

  if (!webSearchEnabled) {
    return [
      systemPrompt,
      'Balas dalam teks biasa yang natural. Jangan gunakan JSON, schema, atau payload internal.',
      additionalInstructions,
    ].join(' ');
  }

  return [
    systemPrompt,
    'Balas dalam teks biasa yang natural. Jangan gunakan JSON, schema, atau payload internal.',
    'Saat web search tersedia, pakai hanya untuk fakta terbaru, harga, jadwal, berita, atau verifikasi.',
    'Tentukan sendiri dari pesan terbaru dan konteks mana yang relevan. Jangan dipaksa konteks lama jika tidak cocok.',
    'Kalau hasil search tidak cukup, jawab jujur singkat.',
    additionalInstructions,
  ].join(' ');
}

function buildAiSystemPrompt(spreadsheetReadEnabled: boolean): string {
  if (!spreadsheetReadEnabled) {
    return [
      ...COMMON_AI_SYSTEM_PROMPT_LINES,
      'Di bot ini kamu tidak punya akses ke spreadsheet resmi Arjun Motor Project.',
      'Jangan mengaku bisa membaca data resmi proyek jika tool data tidak tersedia di sesi ini.',
      'Jangan menyuruh user upload spreadsheet, hubungkan CSV/API, atau menyambungkan sumber data lain.',
    ].join(' ');
  }

  return [
    ...COMMON_AI_SYSTEM_PROMPT_LINES,
    'Jika kamu perlu membaca data spreadsheet resmi, kamu boleh memanggil tool read_spreadsheet_data.',
    'Gunakan query bebas jika data bisa berada di kolom mana pun dalam sheet; gunakan filters hanya jika memang ingin membatasi field tertentu.',
    'Jika user menanyakan apakah kamu bisa membaca datanya, dan tool data resmi tersedia, jawab bahwa kamu bisa membaca spreadsheet resmi Arjun Motor Project.',
    'Saat memakai data spreadsheet, jawab seperti membaca spreadsheet asli secara natural, tanpa menyebut tool, backend, mirror, JSON, atau istilah internal.',
    'Jangan bilang user harus upload spreadsheet, hubungkan CSV/API, atau bahwa kamu tidak bisa membaca data otomatis jika tool data resmi tersedia.',
    'Jangan mengarahkan user ke upload file atau koneksi sumber data lain kecuali user memang sedang membahas sumber data di luar spreadsheet resmi proyek.',
    'Jika menampilkan data STOK MOTOR, gunakan nomor resmi dari data, bukan numbering buatan.',
    'Default tampilkan motor READY saja; tampilkan TERJUAL hanya jika user meminta eksplisit.',
    'Status tampilkan sebagai READY atau TERJUAL, bukan true/false.',
    'Jika hasil lebih dari satu dan intent sudah jelas, tampilkan semua hasil yang relevan tanpa bertanya berulang.',
    'Instruksi singkat atau ringkas tidak boleh menghilangkan field record saat kamu sedang menampilkan data spreadsheet.',
  ].join(' ');
}

async function createGatewayResponse(
  client: OpenAI,
  config: AppConfig,
  modelName: string,
  request: AiGatewayRequest,
  spreadsheetReadEnabled: boolean,
  dataProvider: SpreadsheetReadService | null,
  options: GatewayExecutionOptions = {},
): Promise<GatewayExecutionResult> {
  let response = await client.responses.create(buildGatewayRequest(modelName, request, {
    includeSpreadsheetTool: spreadsheetReadEnabled,
    additionalInstructions: options.additionalInstructions ?? null,
    additionalInput: options.additionalInput ?? null,
  }), {
    timeout: config.aiRequestTimeoutMs,
  });
  const dataRead: AiGatewayDataReadResult = {
    toolAvailable: spreadsheetReadEnabled,
    requested: false,
    used: false,
    toolCallCount: 0,
    sheetNames: [],
    toolError: null,
  };

  if (shouldRetryForIncompleteSearch(response, request)) {
    response = await client.responses.create(
      {
        ...buildGatewayRequest(modelName, request, {
          includeSpreadsheetTool: spreadsheetReadEnabled,
          additionalInstructions: options.additionalInstructions ?? null,
          additionalInput: options.additionalInput ?? null,
        }),
        max_output_tokens: 1400,
      },
      {
        timeout: config.aiRequestTimeoutMs,
      },
    );
  }

  let toolLoopCount = 0;
  while (toolLoopCount < 2) {
    const toolCalls = extractSpreadsheetToolCalls(response);
    if (toolCalls.length === 0) {
      return {
        response,
        dataRead,
      };
    }

    if (!dataProvider) {
      dataRead.toolError = 'Spreadsheet read is not available in this runtime.';
      return {
        response,
        dataRead,
      };
    }

    dataRead.requested = true;
    dataRead.used = true;
    dataRead.toolCallCount += toolCalls.length;
    dataRead.sheetNames = dedupeStrings([
      ...dataRead.sheetNames,
      ...toolCalls.map((toolCall) => toolCall.arguments.sheet),
    ]);

    const outputs = await Promise.all(
      toolCalls.map((toolCall) => buildSpreadsheetToolOutput(toolCall, dataProvider)),
    );
    const toolErrors = outputs
      .map((output) => output.result.error)
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    dataRead.toolError = toolErrors[0] ?? dataRead.toolError;

    response = await client.responses.create(
      buildGatewayRequest(modelName, request, {
        previousResponseId: extractResponseId(response),
        inputOverride: outputs.map((output) => output.item),
        includeSpreadsheetTool: spreadsheetReadEnabled,
        additionalInstructions: combineInstructions(
          options.additionalInstructions ?? null,
          DATA_PRESENTATION_PROMPT,
        ),
        maxOutputTokens: resolveToolReplyMaxOutputTokens(outputs.map((output) => output.result)),
      }),
      {
        timeout: config.aiRequestTimeoutMs,
      },
    );

    if (isMaxOutputTokensIncomplete(response)) {
      const retryMaxOutputTokens = expandToolReplyMaxOutputTokens(
        resolveToolReplyMaxOutputTokens(outputs.map((output) => output.result)),
      );
      response = await client.responses.create(
        buildGatewayRequest(modelName, request, {
          previousResponseId: extractResponseId(response),
          inputOverride: outputs.map((output) => output.item),
          includeSpreadsheetTool: spreadsheetReadEnabled,
          additionalInstructions: combineInstructions(
            options.additionalInstructions ?? null,
            DATA_PRESENTATION_PROMPT,
          ),
          maxOutputTokens: retryMaxOutputTokens,
        }),
        {
          timeout: config.aiRequestTimeoutMs,
        },
      );
    }
    toolLoopCount += 1;
  }

  return {
    response,
    dataRead,
  };
}

function extractOutputText(response: unknown): string {
  if (
    response &&
    typeof response === 'object' &&
    typeof (response as { output_text?: unknown }).output_text === 'string' &&
    (response as { output_text: string }).output_text.trim().length > 0
  ) {
    return (response as { output_text: string }).output_text;
  }

  if (!response || typeof response !== 'object') {
    return '';
  }

  const output = (response as { output?: unknown[] }).output;
  if (!Array.isArray(output)) {
    return '';
  }

  const texts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const content = (item as { content?: unknown[] }).content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      const outputText = extractOutputTextPart(part);
      if (outputText) {
        texts.push(outputText);
      }
    }
  }

  return texts.join('\n').trim();
}

function extractOutputTextPart(part: unknown): string | null {
  if (!part || typeof part !== 'object') {
    return null;
  }

  const record = part as {
    type?: unknown;
    text?: unknown;
    content?: unknown[];
  };

  if (record.type === 'output_text' && typeof record.text === 'string' && record.text.trim().length > 0) {
    return record.text;
  }

  if (record.type === 'text' && typeof record.text === 'string' && record.text.trim().length > 0) {
    return record.text;
  }

  if (Array.isArray(record.content)) {
    const nestedTexts = record.content
      .map((nestedPart) => extractOutputTextPart(nestedPart))
      .filter((value): value is string => Boolean(value));
    if (nestedTexts.length > 0) {
      return nestedTexts.join('\n');
    }
  }

  return null;
}

function extractWebSearchResult(response: unknown, available: boolean): AiGatewayWebSearchResult {
  const emptyResult: AiGatewayWebSearchResult = {
    requested: false,
    used: false,
    query: null,
    resultCount: 0,
    sources: [],
  };

  if (!available || !response || typeof response !== 'object') {
    return emptyResult;
  }

  const output = (response as { output?: unknown[] }).output;
  if (!Array.isArray(output)) {
    return emptyResult;
  }

  const sources: AiGatewayWebSearchSource[] = [];
  const queries: string[] = [];
  let used = false;

  for (const item of output) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const typedItem = item as {
      type?: unknown;
      action?: {
        query?: unknown;
        queries?: unknown;
        sources?: unknown;
      };
    };

    if (typedItem.type !== 'web_search_call') {
      continue;
    }

    used = true;

    const action = typedItem.action;
    if (!action || typeof action !== 'object') {
      continue;
    }

    if (typeof action.query === 'string' && action.query.trim().length > 0) {
      queries.push(action.query.trim());
    }

    if (Array.isArray(action.queries)) {
      for (const query of action.queries) {
        if (typeof query === 'string' && query.trim().length > 0) {
          queries.push(query.trim());
        }
      }
    }

    if (!Array.isArray(action.sources)) {
      continue;
    }

    for (const source of action.sources) {
      if (!source || typeof source !== 'object') {
        continue;
      }

      const typedSource = source as {
        type?: unknown;
        name?: unknown;
        url?: unknown;
        title?: unknown;
      };
      const url =
        typeof typedSource.url === 'string' && typedSource.url.trim().length > 0
          ? typedSource.url.trim()
          : null;
      const title =
        typeof typedSource.title === 'string' && typedSource.title.trim().length > 0
          ? typedSource.title.trim()
          : null;
      const label =
        typeof typedSource.name === 'string' && typedSource.name.trim().length > 0
          ? typedSource.name.trim()
          : typeof typedSource.type === 'string' && typedSource.type.trim().length > 0
            ? typedSource.type.trim()
            : null;

      if (!url && !title && !label) {
        continue;
      }

      sources.push({
        url,
        title,
        label,
      });
    }
  }

  const uniqueSources = dedupeSources(sources);
  const query = queries.find((value) => value.length > 0) ?? null;

  return {
    requested: used,
    used,
    query,
    resultCount: uniqueSources.length,
    sources: uniqueSources,
  };
}

function dedupeSources(sources: AiGatewayWebSearchSource[]): AiGatewayWebSearchSource[] {
  const seen = new Set<string>();
  const unique: AiGatewayWebSearchSource[] = [];

  for (const source of sources) {
    const key = source.url ?? source.label ?? source.title ?? '';
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(source);
  }

  return unique;
}

function finalizeReplyText(text: string, webSearch: AiGatewayWebSearchResult): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }

  if (!webSearch.used || webSearch.sources.length === 0) {
    return trimmed;
  }

  return formatWebSearchReply(trimmed, webSearch.sources);
}

function extractFinalCandidateText(response: unknown, webSearch: AiGatewayWebSearchResult): string {
  const rawText = extractOutputText(response).trim();
  if (!rawText) {
    throw new Error(describeEmptyAiResponse(response));
  }

  const candidateText = finalizeReplyText(rawText, webSearch).trim();
  if (!candidateText) {
    throw new Error(describeEmptyAiResponse(response));
  }

  return candidateText;
}

function describeEmptyAiResponse(response: unknown): string {
  if (!response || typeof response !== 'object') {
    return 'AI gateway returned an empty response.';
  }

  const typedResponse = response as {
    status?: unknown;
    incomplete_details?: { reason?: unknown } | null;
    output?: unknown[];
  };
  const status = typeof typedResponse.status === 'string' ? typedResponse.status : null;
  const incompleteReason =
    typedResponse.incomplete_details &&
    typeof typedResponse.incomplete_details === 'object' &&
    typeof typedResponse.incomplete_details.reason === 'string'
      ? typedResponse.incomplete_details.reason
      : null;
  const outputTypes = Array.isArray(typedResponse.output)
    ? typedResponse.output
        .map((item) => (
          item &&
          typeof item === 'object' &&
          typeof (item as { type?: unknown }).type === 'string'
            ? (item as { type: string }).type
            : 'unknown'
        ))
        .join(',')
    : null;

  if (status === 'incomplete' && incompleteReason) {
    return `AI gateway returned an incomplete response: ${incompleteReason}${outputTypes ? ` (output=${outputTypes})` : ''}.`;
  }

  if (outputTypes) {
    return `AI gateway returned an empty response (output=${outputTypes}).`;
  }

  return 'AI gateway returned an empty response.';
}

function shouldRetryForIncompleteSearch(response: unknown, request: AiGatewayRequest): boolean {
  if (!request.webSearchAvailable) {
    return false;
  }

  return isMaxOutputTokensIncomplete(response);
}

function resolveMaxOutputTokens(request: AiGatewayRequest): number {
  if (request.webSearchAvailable) {
    return 900;
  }

  return 420;
}

function resolveTextVerbosity(): 'low' {
  return 'low';
}

function containsInternalLeakage(text: string): boolean {
  return containsRawInternalTerms(text) || looksLikeInternalPayload(text);
}

function containsRawInternalTerms(text: string): boolean {
  return INTERNAL_FIELD_PATTERN.test(text) || INTERNAL_PHRASE_PATTERN.test(text);
}

function looksLikeInternalPayload(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return false;
  }

  return INTERNAL_FIELD_PATTERN.test(trimmed);
}

function containsLegacyCapabilityFallback(text: string): boolean {
  return LEGACY_CAPABILITY_FALLBACK_PATTERN.test(text);
}

function buildSpreadsheetTool(): Record<string, unknown> {
  return {
    type: 'function',
    name: SPREADSHEET_TOOL_NAME,
    description:
      'Ambil data dari spreadsheet Arjun Motor Project. Gunakan hanya jika kamu membutuhkan data. Jangan tampilkan data mentah tool ke user.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sheet: {
          type: 'string',
          enum: ['STOK MOTOR', 'PENGELUARAN HARIAN', 'TOTAL ASET'],
        },
        query: {
          type: ['string', 'null'],
          description:
            'Pencarian bebas lintas seluruh isi row dan cell dalam sheet. Gunakan jika data bisa berada di kolom mana pun.',
        },
        includeSold: {
          type: ['boolean', 'null'],
          description: 'Khusus STOK MOTOR. Hanya true jika user eksplisit minta motor terjual.',
        },
        limit: {
          type: ['number', 'null'],
          minimum: 1,
        },
        filters: {
          type: ['array', 'null'],
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              field: { type: 'string' },
              operator: { type: 'string', enum: ['contains', 'equals', 'starts_with'] },
              value: { type: 'string' },
            },
            required: ['field', 'operator', 'value'],
          },
        },
      },
      required: ['sheet', 'query', 'includeSold', 'limit', 'filters'],
    },
  };
}

function extractSpreadsheetToolCalls(response: unknown): Array<{
  callId: string;
  arguments: SpreadsheetReadRequest;
}> {
  if (!response || typeof response !== 'object') {
    return [];
  }

  const output = (response as { output?: unknown[] }).output;
  if (!Array.isArray(output)) {
    return [];
  }

  const calls: Array<{ callId: string; arguments: SpreadsheetReadRequest }> = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const typedItem = item as {
      type?: unknown;
      name?: unknown;
      arguments?: unknown;
      call_id?: unknown;
    };
    if (typedItem.type !== 'function_call' || typedItem.name !== SPREADSHEET_TOOL_NAME) {
      continue;
    }

    const rawArgs = typeof typedItem.arguments === 'string' ? typedItem.arguments : null;
    if (!rawArgs) {
      continue;
    }

    try {
      const parsed = JSON.parse(rawArgs) as SpreadsheetReadRequest;
      if (!parsed || typeof parsed !== 'object' || typeof parsed.sheet !== 'string') {
        continue;
      }
      calls.push({
        callId: typeof typedItem.call_id === 'string' ? typedItem.call_id : '',
        arguments: parsed,
      });
    } catch {
      continue;
    }
  }

  return calls.filter((call) => call.callId.length > 0);
}

async function buildSpreadsheetToolOutput(
  toolCall: { callId: string; arguments: SpreadsheetReadRequest },
  dataProvider: SpreadsheetReadService,
): Promise<{
  item: Record<string, unknown>;
  result: SpreadsheetReadResponse;
}> {
  const output = await dataProvider.readData(toolCall.arguments);
  return {
    item: {
      type: 'function_call_output',
      call_id: toolCall.callId,
      output: JSON.stringify(output satisfies SpreadsheetReadResponse),
    },
    result: output,
  };
}

function extractResponseId(response: unknown): string | null {
  if (response && typeof response === 'object') {
    const id = (response as { id?: unknown }).id;
    if (typeof id === 'string' && id.trim().length > 0) {
      return id;
    }
  }
  return null;
}

async function requestSafeRewrite(
  client: OpenAI,
  config: AppConfig,
  modelName: string,
  request: AiGatewayRequest,
  unsafeText: string,
): Promise<string> {
  const response = await client.responses.create(
    {
      model: modelName,
      instructions: [
        'Tugas kamu hanya menulis ulang jawaban agar aman dan natural.',
        'Jangan menambah data baru, jangan mengubah fakta, jangan menyebut tool, backend, mirror, JSON, path, state, authority, atau istilah internal.',
        'Pastikan jawaban akhir berupa bahasa manusia yang enak dibaca.',
        'Jangan menambahkan penutup template, CTA generik, atau tawaran bantuan lanjutan yang tidak diminta user.',
      ].join(' '),
      input: [
        'Tulis ulang jawaban berikut agar aman untuk user akhir:',
        unsafeText,
      ].join('\n'),
      reasoning: {
        effort: 'low',
      },
      text: {
        verbosity: resolveTextVerbosity(),
      },
      max_output_tokens: resolveMaxOutputTokens(request),
    },
    {
      timeout: config.aiRequestTimeoutMs,
    },
  );

  const rewritten = extractOutputText(response).trim();
  if (!rewritten || containsInternalLeakage(rewritten)) {
    return 'Maaf, jawaban tadi belum siap ditampilkan dengan aman.';
  }

  return rewritten;
}

async function requestCapabilityRepair(
  client: OpenAI,
  config: AppConfig,
  modelName: string,
  request: AiGatewayRequest,
  spreadsheetReadEnabled: boolean,
  dataProvider: SpreadsheetReadService | null,
  previousAnswer: string,
): Promise<GatewayExecutionResult> {
  const repaired = await createGatewayResponse(
    client,
    config,
    modelName,
    request,
    spreadsheetReadEnabled,
    dataProvider,
    {
      additionalInstructions: spreadsheetReadEnabled
        ? LEGACY_CAPABILITY_REPAIR_MESSAGE
        : LEGACY_NO_SPREADSHEET_CAPABILITY_REPAIR_MESSAGE,
      additionalInput: `Jawaban sebelumnya keliru dan harus diperbaiki:\n${previousAnswer}`,
    },
  );

  const repairedCandidate = extractFinalCandidateText(
    repaired.response,
    extractWebSearchResult(repaired.response, request.webSearchAvailable),
  );
  if (containsLegacyCapabilityFallback(repairedCandidate)) {
    return {
      response: {
        output_text: spreadsheetReadEnabled
          ? 'Maaf, aku belum bisa mengambil data resmi proyek sekarang.'
          : 'Maaf, bot ini tidak punya akses ke spreadsheet resmi proyek.',
      },
      dataRead: repaired.dataRead,
    };
  }

  return repaired;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function combineInstructions(...parts: Array<string | null | undefined>): string | null {
  const normalized = parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0);

  return normalized.length > 0 ? normalized.join(' ') : null;
}

function mergeDataReadResults(
  left: AiGatewayDataReadResult,
  right: AiGatewayDataReadResult,
): AiGatewayDataReadResult {
  return {
    toolAvailable: left.toolAvailable || right.toolAvailable,
    requested: left.requested || right.requested,
    used: left.used || right.used,
    toolCallCount: left.toolCallCount + right.toolCallCount,
    sheetNames: dedupeStrings([...left.sheetNames, ...right.sheetNames]),
    toolError: right.toolError ?? left.toolError,
  };
}

function isMaxOutputTokensIncomplete(response: unknown): boolean {
  if (!response || typeof response !== 'object') {
    return false;
  }

  const typedResponse = response as {
    status?: unknown;
    incomplete_details?: { reason?: unknown } | null;
  };

  return (
    typedResponse.status === 'incomplete' &&
    Boolean(
      typedResponse.incomplete_details &&
        typeof typedResponse.incomplete_details === 'object' &&
        typedResponse.incomplete_details.reason === 'max_output_tokens',
    )
  );
}

function resolveToolReplyMaxOutputTokens(results: SpreadsheetReadResponse[]): number {
  const totalReturnedRows = results.reduce((sum, result) => sum + result.rows.length, 0);
  const totalFilteredRows = results.reduce((sum, result) => sum + result.filteredRowCount, 0);
  const totalCells = results.reduce(
    (sum, result) =>
      sum + result.rows.reduce((rowSum, row) => rowSum + Object.keys(row).length, 0),
    0,
  );

  if (totalFilteredRows >= 40 || totalReturnedRows >= 25 || totalCells >= 280) {
    return 3200;
  }

  if (totalFilteredRows >= 15 || totalReturnedRows >= 8 || totalCells >= 120) {
    return 2200;
  }

  return 1400;
}

function expandToolReplyMaxOutputTokens(current: number): number {
  return Math.min(Math.max(current + 1000, 2200), 4200);
}
