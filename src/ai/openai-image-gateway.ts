import OpenAI from 'openai';

import type { AppConfig } from '../config/app-config.js';
import type {
  AiImageAnalysisRequest,
  AiImageAnalysisResult,
  AiImageGateway,
  AiImageGatewayInspection,
} from './types.js';

const IMAGE_ANALYSIS_INSTRUCTIONS = [
  'Kamu menerima gambar WhatsApp dan harus mengekstrak observasi visual terbaru untuk pipeline chat.',
  'Tulis hanya isi visual yang benar-benar terlihat pada gambar.',
  'Jangan menjawab user secara final sebagai asisten chat.',
  'Jangan membuat caption, slogan, judul, atau teks kreatif kecuali teks itu memang terlihat di gambar.',
  'Jangan mengulang caption user, jangan menulis label "Caption", "Caption user", "Isi gambar", atau "Deskripsi netral".',
  'Jangan menebak detail yang tidak terlihat jelas.',
  'Jangan memaksa topik, jangan membuat parser keyword, dan jangan membuat rule engine.',
  'Gunakan caption user hanya untuk memahami fokus observasi, bukan untuk disalin ke output.',
  'Output harus plain text, singkat, jelas, dan netral tentang gambar terbaru saja.',
  'Kalau gambar tidak bisa dipahami, kembalikan string kosong.',
].join(' ');

export function inspectImageGatewayConfig(config: AppConfig): AiImageGatewayInspection {
  if (!config.openAiApiKey) {
    return {
      ready: false,
      modelName: config.openAiTextModel,
      error: 'OPENAI_API_KEY is missing for image analysis.',
    };
  }

  if (!config.openAiTextModel) {
    return {
      ready: false,
      modelName: null,
      error: 'OPENAI_TEXT_MODEL is missing for image analysis.',
    };
  }

  return {
    ready: true,
    modelName: config.openAiTextModel,
    error: null,
  };
}

export function createOpenAiImageGateway(
  config: AppConfig,
  overrides: {
    client?: OpenAI;
  } = {},
): AiImageGateway {
  const inspection = inspectImageGatewayConfig(config);
  const client = inspection.ready
    ? (overrides.client ?? new OpenAI({ apiKey: config.openAiApiKey! }))
    : null;

  return {
    inspect() {
      return inspection;
    },

    async analyze(request: AiImageAnalysisRequest): Promise<AiImageAnalysisResult> {
      if (!inspection.ready || !inspection.modelName || !client) {
        throw new Error(inspection.error ?? 'Image gateway is not ready.');
      }

      const inputFileSizeBytes = request.fileSizeBytes ?? request.imageBuffer.byteLength;
      if (inputFileSizeBytes > config.imageMaxFileBytes) {
        throw new Error(`Image file is too large (${inputFileSizeBytes} bytes).`);
      }

      if (
        (request.widthPixels !== null && request.widthPixels > config.imageMaxEdgePixels) ||
        (request.heightPixels !== null && request.heightPixels > config.imageMaxEdgePixels)
      ) {
        throw new Error(
          `Image dimensions exceed the configured edge limit (${config.imageMaxEdgePixels}px).`,
        );
      }

      const response = await client.responses.create(
        {
          model: inspection.modelName,
          instructions: IMAGE_ANALYSIS_INSTRUCTIONS,
          input: [
            {
              role: 'user',
              content: buildImageContent(request) as never,
            },
          ] as never,
          reasoning: {
            effort: 'low',
          },
          text: {
            verbosity: 'low',
          },
          max_output_tokens: 350,
        },
        {
          timeout: config.imageAnalysisTimeoutMs,
        },
      );

      const visualText = normalizeImageAnalysis(extractOutputText(response), request.caption);
      const text = composeImageContextText(request.caption, visualText);

      return {
        text,
        caption: request.caption,
        fileSizeBytes: inputFileSizeBytes,
        widthPixels: request.widthPixels,
        heightPixels: request.heightPixels,
      };
    },
  };
}

function buildImageContent(request: AiImageAnalysisRequest): Array<Record<string, unknown>> {
  const caption = request.caption?.trim() ?? '';
  const guidanceText = caption.length > 0
    ? [
        'Caption/pertanyaan user untuk gambar ini:',
        caption,
        '',
        'Ekstrak observasi visual dari gambar terbaru agar model chat bisa menjawab caption/pertanyaan user itu.',
        'Jangan jawab user secara final dan jangan membuat caption promosi.',
      ].join('\n')
    : [
        'Ekstrak observasi visual dari gambar terbaru agar model chat bisa menjawab user.',
        'Jangan jawab user secara final dan jangan membuat caption promosi.',
      ].join('\n');

  return [
    {
      type: 'input_text',
      text: guidanceText,
    },
    {
      type: 'input_image',
      image_url: buildImageDataUrl(request.imageBuffer, request.mimeType),
    },
  ];
}

function buildImageDataUrl(imageBuffer: Buffer, mimeType: string | null): string {
  const safeMimeType = mimeType && mimeType.trim().length > 0 ? mimeType.trim().split(';', 1)[0] ?? 'image/jpeg' : 'image/jpeg';
  return `data:${safeMimeType};base64,${imageBuffer.toString('base64')}`;
}

function composeImageContextText(caption: string | null, visualText: string): string {
  const normalizedCaption = caption?.trim() ?? '';
  if (!visualText.trim()) {
    return '';
  }

  const parts = [
    'Pesan gambar terbaru:',
    normalizedCaption ? `Pertanyaan/caption user: ${normalizedCaption}` : 'Pertanyaan/caption user: (tidak ada caption)',
    `Observasi visual gambar terbaru: ${visualText.trim()}`,
    'Tugas jawaban: jawab pertanyaan/caption user berdasarkan observasi visual gambar terbaru. Jangan membuat caption kecuali user memang meminta caption. Jangan meminta user mengirim ulang atau menempel konteks visual lagi.',
  ].filter((part): part is string => Boolean(part));

  return parts.join('\n');
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

function normalizeImageAnalysis(value: string, caption: string | null): string {
  const normalizedCaption = caption?.trim() ?? '';
  const captionPattern = normalizedCaption
    ? new RegExp(escapeRegExp(normalizedCaption), 'giu')
    : null;
  const cleaned = value
    .replace(/\r\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/\b(?:caption(?:\s+user)?|pertanyaan\/caption user)\s*:\s*/giu, ' ')
    .replace(/\b(?:isi gambar|deskripsi netral|observasi visual(?: gambar terbaru)?)\s*:\s*/giu, ' ');
  const withoutCaption = captionPattern ? cleaned.replace(captionPattern, ' ') : cleaned;
  const lines = withoutCaption
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/\s{2,}/gu, ' ').trim())
    .filter((line) => line.length > 0);

  return lines.join('\n').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
