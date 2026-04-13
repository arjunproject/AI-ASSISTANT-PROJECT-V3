import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadAppConfig } from '../src/config/app-config.js';
import { createOpenAiVoiceGateway, inspectVoiceGatewayConfig } from '../src/ai/openai-voice-gateway.js';

test('voice gateway inspection stays blocked when api key or transcribe model is missing', () => {
  const config = loadAppConfig({
    projectRoot: process.cwd(),
    openAiApiKey: '',
    openAiTranscribeModel: '',
  });

  const inspection = inspectVoiceGatewayConfig(config);
  assert.equal(inspection.ready, false);
  assert.equal(inspection.modelName, null);
  assert.match(inspection.error ?? '', /OPENAI_API_KEY|OPENAI_TRANSCRIBE_MODEL/);
});

test('voice gateway transcribes audio with the configured official model', async () => {
  const config = loadAppConfig({
    projectRoot: process.cwd(),
    openAiApiKey: 'test-key',
    openAiTranscribeModel: 'gpt-4o-mini-transcribe',
    voiceTranscribeTimeoutMs: 7_000,
  });

  let capturedBody: Record<string, unknown> | null = null;
  let capturedOptions: Record<string, unknown> | null = null;
  const fakeClient = {
    audio: {
      transcriptions: {
        async create(body: Record<string, unknown>, options: Record<string, unknown>) {
          capturedBody = body;
          capturedOptions = options;
          return {
            text: '  halo dari voice \n\n ',
          };
        },
      },
    },
  };

  const gateway = createOpenAiVoiceGateway(config, {
    client: fakeClient as never,
  });

  const result = await gateway.transcribe({
    audioBuffer: Buffer.from('voice-bytes'),
    mimeType: 'audio/ogg; codecs=opus',
    durationSeconds: 8,
    fileSizeBytes: 1_024,
    inputMode: 'voice_note',
  });

  assert.equal(result.text, 'halo dari voice');
  assert.equal(result.durationSeconds, 8);
  assert.equal(result.fileSizeBytes, 1_024);
  assert.equal((capturedBody as { model?: string } | null)?.model, 'gpt-4o-mini-transcribe');
  assert.equal((capturedOptions as { timeout?: number } | null)?.timeout, 7_000);
});

test('voice gateway rejects audio that is too large or too long honestly', async () => {
  const config = loadAppConfig({
    projectRoot: process.cwd(),
    openAiApiKey: 'test-key',
    openAiTranscribeModel: 'gpt-4o-mini-transcribe',
    voiceMaxAudioSeconds: 30,
    voiceMaxFileBytes: 2_048,
  });

  const fakeClient = {
    audio: {
      transcriptions: {
        async create() {
          return {
            text: 'tidak boleh terpanggil',
          };
        },
      },
    },
  };

  const gateway = createOpenAiVoiceGateway(config, {
    client: fakeClient as never,
  });

  await assert.rejects(
    () =>
      gateway.transcribe({
        audioBuffer: Buffer.alloc(4_096),
        mimeType: 'audio/ogg; codecs=opus',
        durationSeconds: 5,
        fileSizeBytes: 4_096,
        inputMode: 'voice_note',
      }),
    /too large/i,
  );

  await assert.rejects(
    () =>
      gateway.transcribe({
        audioBuffer: Buffer.alloc(1_024),
        mimeType: 'audio/ogg; codecs=opus',
        durationSeconds: 45,
        fileSizeBytes: 1_024,
        inputMode: 'voice_note',
      }),
    /too long/i,
  );
});
