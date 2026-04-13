import OpenAI, { toFile } from 'openai';

import type { AppConfig } from '../config/app-config.js';
import type {
  AiVoiceGateway,
  AiVoiceGatewayInspection,
  AiVoiceTranscriptionRequest,
  AiVoiceTranscriptionResult,
} from './types.js';

export function inspectVoiceGatewayConfig(config: AppConfig): AiVoiceGatewayInspection {
  if (!config.openAiApiKey) {
    return {
      ready: false,
      modelName: config.openAiTranscribeModel,
      error: 'OPENAI_API_KEY is missing for voice transcription.',
    };
  }

  if (!config.openAiTranscribeModel) {
    return {
      ready: false,
      modelName: null,
      error: 'OPENAI_TRANSCRIBE_MODEL is missing.',
    };
  }

  return {
    ready: true,
    modelName: config.openAiTranscribeModel,
    error: null,
  };
}

export function createOpenAiVoiceGateway(
  config: AppConfig,
  overrides: {
    client?: OpenAI;
  } = {},
): AiVoiceGateway {
  const inspection = inspectVoiceGatewayConfig(config);
  const client = inspection.ready
    ? (overrides.client ?? new OpenAI({ apiKey: config.openAiApiKey! }))
    : null;

  return {
    inspect() {
      return inspection;
    },

    async transcribe(request: AiVoiceTranscriptionRequest): Promise<AiVoiceTranscriptionResult> {
      if (!inspection.ready || !inspection.modelName || !client) {
        throw new Error(inspection.error ?? 'Voice gateway is not ready.');
      }

      const inputFileSizeBytes = request.fileSizeBytes ?? request.audioBuffer.byteLength;
      if (inputFileSizeBytes > config.voiceMaxFileBytes) {
        throw new Error(`Voice audio file is too large (${inputFileSizeBytes} bytes).`);
      }

      if (request.durationSeconds !== null && request.durationSeconds > config.voiceMaxAudioSeconds) {
        throw new Error(`Voice audio is too long (${request.durationSeconds} seconds).`);
      }

      const file = await toFile(
        request.audioBuffer,
        buildAudioFileName(request.inputMode, request.mimeType),
        request.mimeType ? { type: request.mimeType } : undefined,
      );

      const transcription = await client.audio.transcriptions.create(
        {
          file,
          model: inspection.modelName,
        },
        {
          timeout: config.voiceTranscribeTimeoutMs,
        },
      );

      const text = normalizeTranscript(typeof transcription.text === 'string' ? transcription.text : '');
      return {
        text,
        durationSeconds: request.durationSeconds,
        fileSizeBytes: inputFileSizeBytes,
      };
    },
  };
}

function buildAudioFileName(inputMode: AiVoiceTranscriptionRequest['inputMode'], mimeType: string | null): string {
  return `${inputMode}${guessAudioFileExtension(mimeType)}`;
}

function guessAudioFileExtension(mimeType: string | null): string {
  if (!mimeType) {
    return '.ogg';
  }

  if (mimeType.includes('ogg')) {
    return '.ogg';
  }

  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) {
    return '.mp3';
  }

  if (mimeType.includes('wav')) {
    return '.wav';
  }

  if (mimeType.includes('mp4') || mimeType.includes('aac')) {
    return '.m4a';
  }

  if (mimeType.includes('webm')) {
    return '.webm';
  }

  return '.audio';
}

function normalizeTranscript(value: string): string {
  return value
    .replace(/\r\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}
