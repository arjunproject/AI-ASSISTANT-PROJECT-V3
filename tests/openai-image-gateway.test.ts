import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadAppConfig } from '../src/config/app-config.js';
import { createOpenAiImageGateway, inspectImageGatewayConfig } from '../src/ai/openai-image-gateway.js';

test('image gateway inspection stays blocked when api key or model is missing', () => {
  const config = loadAppConfig({
    projectRoot: process.cwd(),
    openAiApiKey: '',
    openAiTextModel: '',
  });

  const inspection = inspectImageGatewayConfig(config);
  assert.equal(inspection.ready, false);
  assert.equal(inspection.modelName, null);
  assert.match(inspection.error ?? '', /OPENAI_API_KEY|OPENAI_TEXT_MODEL/);
});

test('image gateway analyzes image with the configured official model', async () => {
  const config = loadAppConfig({
    projectRoot: process.cwd(),
    openAiApiKey: 'test-key',
    openAiTextModel: 'gpt-5-mini',
    imageAnalysisTimeoutMs: 9_000,
  });

  let capturedBody: Record<string, unknown> | null = null;
  let capturedOptions: Record<string, unknown> | null = null;
  const fakeClient = {
    responses: {
      async create(body: Record<string, unknown>, options: Record<string, unknown>) {
        capturedBody = body;
        capturedOptions = options;
        return {
          output_text: '  layar laptop dengan editor kode terbuka \n\n ',
        };
      },
    },
  };

  const gateway = createOpenAiImageGateway(config, {
    client: fakeClient as never,
  });

  const result = await gateway.analyze({
    imageBuffer: Buffer.from('image-bytes'),
    mimeType: 'image/jpeg',
    caption: 'Ini gambar apa?',
    fileSizeBytes: 1_024,
    widthPixels: 1_280,
    heightPixels: 720,
    inputMode: 'image',
  });

  assert.equal(result.text, 'Caption user: Ini gambar apa?\nIsi gambar: layar laptop dengan editor kode terbuka');
  assert.equal(result.caption, 'Ini gambar apa?');
  assert.equal(result.fileSizeBytes, 1_024);
  assert.equal((capturedBody as { model?: string } | null)?.model, 'gpt-5-mini');
  assert.equal((capturedOptions as { timeout?: number } | null)?.timeout, 9_000);

  const content = (((capturedBody as { input?: Array<{ content?: unknown[] }> } | null)?.input?.[0]?.content) ??
    []) as Array<Record<string, unknown>>;
  assert.equal(content[0]?.type, 'input_text');
  assert.equal(content[1]?.type, 'input_image');
  assert.match(String(content[1]?.image_url ?? ''), /^data:image\/jpeg;base64,/);
});

test('image gateway rejects image that is too large or exceeds configured edge size honestly', async () => {
  const config = loadAppConfig({
    projectRoot: process.cwd(),
    openAiApiKey: 'test-key',
    openAiTextModel: 'gpt-5-mini',
    imageMaxFileBytes: 2_048,
    imageMaxEdgePixels: 1_024,
  });

  const fakeClient = {
    responses: {
      async create() {
        return {
          output_text: 'tidak boleh terpanggil',
        };
      },
    },
  };

  const gateway = createOpenAiImageGateway(config, {
    client: fakeClient as never,
  });

  await assert.rejects(
    () =>
      gateway.analyze({
        imageBuffer: Buffer.alloc(4_096),
        mimeType: 'image/png',
        caption: null,
        fileSizeBytes: 4_096,
        widthPixels: 800,
        heightPixels: 800,
        inputMode: 'image',
      }),
    /too large/i,
  );

  await assert.rejects(
    () =>
      gateway.analyze({
        imageBuffer: Buffer.alloc(1_024),
        mimeType: 'image/png',
        caption: null,
        fileSizeBytes: 1_024,
        widthPixels: 2_000,
        heightPixels: 1_500,
        inputMode: 'image',
      }),
    /edge limit|dimensions/i,
  );
});
