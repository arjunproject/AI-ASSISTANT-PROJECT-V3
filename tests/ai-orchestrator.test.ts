import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

import type { WAMessage } from '@whiskeysockets/baileys';

import { createAiOrchestrator } from '../src/ai/ai-orchestrator.js';
import { writeDynamicPromptRegistry } from '../src/ai/dynamic-prompt-registry.js';
import type { AiImageGateway, AiTextGateway, AiVoiceGateway } from '../src/ai/types.js';
import type { AccessDecision } from '../src/access/types.js';
import { loadAppConfig } from '../src/config/app-config.js';
import { createLogger } from '../src/core/logger.js';
import { createRuntimeStateStore } from '../src/runtime/runtime-state-store.js';
import type { RuntimeIdentityResolutionSnapshot } from '../src/whatsapp/types.js';
import { createTempRoot } from './test-helpers.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

test('ai orchestrator replies once for allowed non-command messages', async () => {
  const temp = await createTempRoot('stage-5-ai-orchestrator-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-5',
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
  });
  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const replies: string[] = [];
  const fakeGateway: AiTextGateway = {
    inspect() {
      return {
        ready: true,
        modelName: 'test-model',
        error: null,
        webSearchReady: true,
        webSearchError: null,
      };
    },
    async generateReply(request) {
      assert.equal(request.webSearchAvailable, true);
      return {
        modelName: 'test-model',
        text: 'jawaban natural',
        webSearch: {
          requested: false,
          used: false,
          query: null,
          resultCount: 0,
          sources: [],
        },
      };
    },
  };

  const orchestrator = createAiOrchestrator({
    config,
    logger,
    runtimeStateStore,
    gateway: fakeGateway,
    async sendReply(_chatJid, text) {
      replies.push(text);
    },
  });

  await orchestrator.syncState();
  const result = await orchestrator.handleAllowedNonCommandMessage(
    buildMessage('tolong jelaskan singkat'),
    buildResolution(),
    buildDecision(),
  );

  assert.equal(result.handled, true);
  assert.equal(result.replied, true);
  assert.deepEqual(replies, ['jawaban natural']);

  const snapshot = runtimeStateStore.getSnapshot();
  assert.equal(snapshot.aiGatewayReady, true);
  assert.equal(snapshot.aiModelName, 'test-model');
  assert.equal(snapshot.lastAiSender, '201507007785');
  assert.equal(snapshot.lastAiChatJid, '2362534006947@lid');
  assert.equal(snapshot.lastAiError, null);
  assert.equal(snapshot.dynamicPromptRegistryReady, true);
  assert.equal(snapshot.activeDynamicPromptCount, 0);
  assert.equal(snapshot.webSearchReady, true);
  assert.equal(snapshot.lastWebSearchUsed, false);
  assert.equal(snapshot.activeConversationCount, 1);

  const logContents = await readFile(config.logFilePath, 'utf8');
  assert.match(logContents, /ai\.handoff/);
  assert.match(logContents, /ai\.requested/);
  assert.match(logContents, /ai\.responded/);
  assert.match(logContents, /ai\.replied/);
  assert.match(logContents, /ai\.web_search_skipped/);
});

test('ai orchestrator applies active dynamic prompt overlays as secondary guidance', async () => {
  const temp = await createTempRoot('stage-5-ai-orchestrator-dynamic-prompt-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-5',
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
  });
  await writeDynamicPromptRegistry(config.dynamicPromptRegistryFilePath, [
    {
      id: 'overlay-chat',
      displayNumber: 1,
      name: 'Ringkas',
      content: 'Jawab tetap ringkas.',
      targetType: 'global',
      targetMembers: [],
      mode: 'dm only',
      priority: 5,
      trigger: {
        type: 'always',
        value: null,
      },
      isActive: true,
      createdBy: 'system',
      createdByNumber: '201507007785',
      updatedBy: 'system',
      updatedByNumber: '201507007785',
      createdAt: '2026-04-11T00:00:00.000Z',
      updatedAt: '2026-04-11T00:00:00.000Z',
      version: 1,
      lastUpdatedChatJid: '2362534006947@lid',
    },
    {
      id: 'overlay-inactive',
      displayNumber: 2,
      name: 'Nonaktif',
      content: 'Instruksi ini tidak boleh ikut.',
      targetType: 'global',
      targetMembers: [],
      mode: 'dm+group',
      priority: 99,
      trigger: {
        type: 'always',
        value: null,
      },
      isActive: false,
      createdBy: 'system',
      createdByNumber: '201507007785',
      updatedBy: 'system',
      updatedByNumber: '201507007785',
      createdAt: '2026-04-11T00:00:00.000Z',
      updatedAt: '2026-04-11T00:00:00.000Z',
      version: 1,
      lastUpdatedChatJid: '2362534006947@lid',
    },
  ]);

  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const overlays: Array<string | null> = [];
  const fakeGateway: AiTextGateway = {
    inspect() {
      return {
        ready: true,
        modelName: 'test-model',
        error: null,
        webSearchReady: true,
        webSearchError: null,
      };
    },
    async generateReply(request) {
      overlays.push(request.dynamicPromptOverlay);
      return {
        modelName: 'test-model',
        text: 'jawaban natural',
        webSearch: {
          requested: false,
          used: false,
          query: null,
          resultCount: 0,
          sources: [],
        },
      };
    },
  };

  const orchestrator = createAiOrchestrator({
    config,
    logger,
    runtimeStateStore,
    gateway: fakeGateway,
    async sendReply() {
      return;
    },
  });

  await orchestrator.syncState();
  await orchestrator.handleAllowedNonCommandMessage(
    buildMessage('halo dynamic prompt', 'dp-1'),
    buildResolution(),
    buildDecision(),
  );

  assert.equal(overlays.length, 1);
  assert.match(overlays[0] ?? '', /Jawab tetap ringkas\./);
  assert.doesNotMatch(overlays[0] ?? '', /Instruksi ini tidak boleh ikut/i);

  const snapshot = runtimeStateStore.getSnapshot();
  assert.equal(snapshot.dynamicPromptRegistryReady, true);
  assert.equal(snapshot.activeDynamicPromptCount, 1);
  assert.equal(snapshot.lastDynamicPromptAppliedAt !== null, true);
  assert.equal(snapshot.lastDynamicPromptError, null);

  const logContents = await readFile(config.logFilePath, 'utf8');
  assert.match(logContents, /dynamic_prompt\.applied/);
});

test('ai orchestrator keeps context neutral and can revisit archived context', async () => {
  const temp = await createTempRoot('stage-5-ai-orchestrator-memory-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-5',
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
  });
  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const requests: Array<{
    userText: string;
    summary: string | null;
    transcriptLength: number;
  }> = [];
  const fakeGateway: AiTextGateway = {
    inspect() {
      return {
        ready: true,
        modelName: 'test-model',
        error: null,
        webSearchReady: true,
        webSearchError: null,
      };
    },
    async generateReply(request) {
      requests.push({
        userText: request.userText,
        summary: request.summary,
        transcriptLength: request.transcript.length,
      });
      return {
        modelName: 'test-model',
        text: `jawaban: ${request.userText}`,
        webSearch: {
          requested: false,
          used: false,
          query: null,
          resultCount: 0,
          sources: [],
        },
      };
    },
  };

  const orchestrator = createAiOrchestrator({
    config,
    logger,
    runtimeStateStore,
    gateway: fakeGateway,
    async sendReply() {
      return;
    },
  });

  await orchestrator.syncState();
  await orchestrator.handleAllowedNonCommandMessage(
    buildMessage('printer kantor error terus', 'mem-1'),
    buildResolution(),
    buildDecision(),
  );
  await orchestrator.handleAllowedNonCommandMessage(
    buildMessage('yang tadi itu kira-kira mulai cek dari mana?', 'mem-2'),
    buildResolution(),
    buildDecision(),
  );
  await orchestrator.handleAllowedNonCommandMessage(
    buildMessage('berapa hasil 12 kali 7', 'mem-3'),
    buildResolution(),
    buildDecision(),
  );
  await orchestrator.handleAllowedNonCommandMessage(
    buildMessage('yang kemarin soal printer itu', 'mem-4'),
    buildResolution(),
    buildDecision(),
  );

  assert.equal(requests.length, 4);
  assert.equal(requests[0]?.summary, null);
  assert.equal(requests[0]?.transcriptLength, 0);
  assert.equal(requests[1]?.summary, null);
  assert.equal(requests[1]?.transcriptLength, 2);
  assert.equal(requests[2]?.summary, null);
  assert.equal(requests[2]?.transcriptLength, 4);
  assert.equal(requests[3]?.summary, null);
  assert.equal(requests[3]?.transcriptLength, 6);

  const snapshot = runtimeStateStore.getSnapshot();
  assert.equal(snapshot.lastContextUpdatedAt !== null, true);
  assert.equal(snapshot.activeConversationCount, 1);

  const logContents = await readFile(config.logFilePath, 'utf8');
  assert.match(logContents, /ai\.context\.loaded/);
});

test('ai orchestrator fails closed honestly when gateway is not ready', async () => {
  const temp = await createTempRoot('stage-5-ai-orchestrator-blocked-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-5',
    openAiApiKey: null,
    openAiTextModel: null,
  });
  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const replies: string[] = [];
  const orchestrator = createAiOrchestrator({
    config,
    logger,
    runtimeStateStore,
    async sendReply(_chatJid, text) {
      replies.push(text);
    },
  });

  await orchestrator.syncState();
  const result = await orchestrator.handleAllowedNonCommandMessage(
    buildMessage('halo'),
    buildResolution(),
    buildDecision(),
  );

  assert.equal(result.handled, true);
  assert.equal(result.replied, false);
  assert.equal(replies.length, 0);
  assert.match(result.error ?? '', /OPENAI_API_KEY/);

  const snapshot = runtimeStateStore.getSnapshot();
  assert.equal(snapshot.aiGatewayReady, false);
  assert.equal(snapshot.lastAiError?.includes('OPENAI_API_KEY'), true);
});

test('ai orchestrator fails closed honestly when dynamic prompt registry is broken', async () => {
  const temp = await createTempRoot('stage-5-ai-orchestrator-dynamic-prompt-broken-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-5',
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
  });
  await writeDynamicPromptRegistry(config.dynamicPromptRegistryFilePath, []);
  await writeFile(config.dynamicPromptRegistryFilePath, '{ broken-json', 'utf8');

  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  let replyCount = 0;
  const fakeGateway: AiTextGateway = {
    inspect() {
      return {
        ready: true,
        modelName: 'test-model',
        error: null,
        webSearchReady: true,
        webSearchError: null,
      };
    },
    async generateReply() {
      replyCount += 1;
      return {
        modelName: 'test-model',
        text: 'jawaban natural',
        webSearch: {
          requested: false,
          used: false,
          query: null,
          resultCount: 0,
          sources: [],
        },
      };
    },
  };

  const orchestrator = createAiOrchestrator({
    config,
    logger,
    runtimeStateStore,
    gateway: fakeGateway,
    async sendReply() {
      return;
    },
  });

  await orchestrator.syncState();
  const result = await orchestrator.handleAllowedNonCommandMessage(
    buildMessage('halo', 'dp-broken-1'),
    buildResolution(),
    buildDecision(),
  );

  assert.equal(result.handled, true);
  assert.equal(result.replied, false);
  assert.equal(replyCount, 0);
  assert.match(result.error ?? '', /Unexpected token|Expected property name|JSON/i);

  const snapshot = runtimeStateStore.getSnapshot();
  assert.equal(snapshot.dynamicPromptRegistryReady, false);
  assert.equal(snapshot.lastDynamicPromptError !== null, true);
  assert.equal(snapshot.lastAiError, snapshot.lastDynamicPromptError);

  const logContents = await readFile(config.logFilePath, 'utf8');
  assert.match(logContents, /ai\.error/);
});

test('ai orchestrator lets the gateway decide when web search is used', async () => {
  const temp = await createTempRoot('stage-5-ai-orchestrator-web-search-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-5',
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
  });
  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const requests: Array<{ userText: string; webSearchAvailable: boolean }> = [];
  const fakeGateway: AiTextGateway = {
    inspect() {
      return {
        ready: true,
        modelName: 'test-model',
        error: null,
        webSearchReady: true,
        webSearchError: null,
      };
    },
    async generateReply(request) {
      requests.push({
        userText: request.userText,
        webSearchAvailable: request.webSearchAvailable,
      });

      if (request.userText.toLowerCase().includes('harga bitcoin')) {
        return {
          modelName: 'test-model',
          text: 'Bitcoin hari ini naik tipis.',
          webSearch: {
            requested: true,
            used: true,
            query: 'harga bitcoin hari ini',
            resultCount: 1,
            sources: [
              {
                url: 'https://example.com/btc',
                title: 'Harga Bitcoin',
                label: 'example.com',
              },
            ],
          },
        };
      }

      return {
        modelName: 'test-model',
        text: '84',
        webSearch: {
          requested: false,
          used: false,
          query: null,
          resultCount: 0,
          sources: [],
        },
      };
    },
  };

  const orchestrator = createAiOrchestrator({
    config,
    logger,
    runtimeStateStore,
    gateway: fakeGateway,
    async sendReply() {
      return;
    },
  });

  await orchestrator.syncState();
  await orchestrator.handleAllowedNonCommandMessage(
    buildMessage('12 x 7 berapa?', 'ws-1'),
    buildResolution(),
    buildDecision(),
  );
  await orchestrator.handleAllowedNonCommandMessage(
    buildMessage('Cek harga bitcoin hari ini', 'ws-2'),
    buildResolution(),
    buildDecision(),
  );

  assert.equal(requests[0]?.webSearchAvailable, true);
  assert.equal(requests[1]?.webSearchAvailable, true);

  const snapshot = runtimeStateStore.getSnapshot();
  assert.equal(snapshot.webSearchReady, true);
  assert.equal(snapshot.lastWebSearchUsed, true);
  assert.equal(snapshot.lastWebSearchQuery, 'harga bitcoin hari ini');
  assert.equal(snapshot.lastWebSearchResultCount, 1);

  const logContents = await readFile(config.logFilePath, 'utf8');
  assert.match(logContents, /ai\.web_search_skipped/);
  assert.match(logContents, /ai\.web_search_requested/);
  assert.match(logContents, /ai\.web_search_completed/);
});

test('ai orchestrator keeps conversation anchor neutral after searched follow-ups', async () => {
  const temp = await createTempRoot('stage-5-ai-orchestrator-anchor-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-5',
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
  });
  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const requests: Array<{ userText: string; summary: string | null; transcriptText: string }> = [];
  const fakeGateway: AiTextGateway = {
    inspect() {
      return {
        ready: true,
        modelName: 'test-model',
        error: null,
        webSearchReady: true,
        webSearchError: null,
      };
    },
    async generateReply(request) {
      requests.push({
        userText: request.userText,
        summary: request.summary,
        transcriptText: request.transcript.map((turn) => turn.text).join(' | '),
      });

      if (request.userText.toLowerCase().includes('rupiahnya')) {
        return {
          modelName: 'test-model',
          text: 'Sekitar Rp40 jutaan.',
          webSearch: {
            requested: true,
            used: true,
            query: 'USD to IDR exchange rate today',
            resultCount: 1,
            sources: [{ url: 'https://example.com/fx', title: 'FX', label: 'example.com' }],
          },
        };
      }

      return {
        modelName: 'test-model',
        text: 'Mulai sekitar US$2,449.99.',
        webSearch: {
          requested: true,
          used: true,
          query: 'Samsung Galaxy Book 6 Ultra price 2026',
          resultCount: 1,
          sources: [{ url: 'https://example.com/book6', title: 'Book6', label: 'example.com' }],
        },
      };
    },
  };

  const orchestrator = createAiOrchestrator({
    config,
    logger,
    runtimeStateStore,
    gateway: fakeGateway,
    async sendReply() {
      return;
    },
  });

  await orchestrator.syncState();
  await orchestrator.handleAllowedNonCommandMessage(
    buildMessage('Info harga galaxy book 6 ultra?', 'an-1'),
    buildResolution(),
    buildDecision(),
  );
  await orchestrator.handleAllowedNonCommandMessage(
    buildMessage('Rupiahnya berapa?', 'an-2'),
    buildResolution(),
    buildDecision(),
  );
  await orchestrator.handleAllowedNonCommandMessage(
    buildMessage('Yang tadi loh book 6 ultra', 'an-3'),
    buildResolution(),
    buildDecision(),
  );

  assert.equal(requests[1]?.summary, null);
  assert.match(requests[1]?.transcriptText ?? '', /Info harga galaxy book 6 ultra/i);
  assert.equal(requests[2]?.summary, null);
  assert.match(requests[2]?.transcriptText ?? '', /Info harga galaxy book 6 ultra/i);
  assert.doesNotMatch(requests[2]?.transcriptText ?? '', /USD to IDR exchange rate today/i);
});

test('ai orchestrator keeps ordinal follow-up attached to the active product context', async () => {
  const temp = await createTempRoot('stage-5-ai-orchestrator-ordinal-followup-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-5',
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
  });
  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const requests: Array<{ userText: string; summary: string | null; transcriptLength: number; transcriptText: string }> = [];
  const fakeGateway: AiTextGateway = {
    inspect() {
      return {
        ready: true,
        modelName: 'test-model',
        error: null,
        webSearchReady: true,
        webSearchError: null,
      };
    },
    async generateReply(request) {
      requests.push({
        userText: request.userText,
        summary: request.summary,
        transcriptLength: request.transcript.length,
        transcriptText: request.transcript.map((turn) => turn.text).join(' | '),
      });

      if (request.userText.toLowerCase().includes('no 1')) {
        return {
          modelName: 'test-model',
          text: 'Yang nomor 1 sekitar Rp20 jutaan.',
          webSearch: {
            requested: false,
            used: false,
            query: null,
            resultCount: 0,
            sources: [],
          },
        };
      }

      return {
        modelName: 'test-model',
        text: '1. Produk A\n2. Produk B',
        webSearch: {
          requested: true,
          used: true,
          query: 'most powerful mini pc 2026',
          resultCount: 1,
          sources: [{ url: 'https://example.com/mini-pc', title: 'Mini PC', label: 'example.com' }],
        },
      };
    },
  };

  const orchestrator = createAiOrchestrator({
    config,
    logger,
    runtimeStateStore,
    gateway: fakeGateway,
    async sendReply() {
      return;
    },
  });

  await orchestrator.syncState();
  await orchestrator.handleAllowedNonCommandMessage(
    buildMessage('Rekomendasi mini pc windows paling powerful sekarang apa?', 'ord-1'),
    buildResolution(),
    buildDecision(),
  );
  await orchestrator.handleAllowedNonCommandMessage(
    buildMessage('Yang no 1 harganya berapa?', 'ord-2'),
    buildResolution(),
    buildDecision(),
  );

  assert.equal(requests[1]?.summary, null);
  assert.equal(requests[1]?.transcriptLength, 2);
  assert.match(requests[1]?.transcriptText ?? '', /Rekomendasi mini pc windows paling powerful sekarang apa/i);
  assert.match(requests[1]?.transcriptText ?? '', /Produk A/i);

  const logContents = await readFile(config.logFilePath, 'utf8');
  assert.match(logContents, /ai\.context\.loaded/);
});

test('ai orchestrator transcribes voice and routes it through the same AI pipeline', async () => {
  const temp = await createTempRoot('stage-5-ai-orchestrator-voice-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-5',
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
    openAiTranscribeModel: 'gpt-4o-mini-transcribe',
  });
  await writeDynamicPromptRegistry(config.dynamicPromptRegistryFilePath, [
    {
      id: 'voice-overlay',
      displayNumber: 1,
      name: 'Voice overlay',
      content: 'Jawab tetap singkat.',
      targetType: 'global',
      targetMembers: [],
      mode: 'dm+group',
      priority: 3,
      trigger: {
        type: 'always',
        value: null,
      },
      isActive: true,
      createdBy: 'system',
      createdByNumber: '201507007785',
      updatedBy: 'system',
      updatedByNumber: '201507007785',
      createdAt: '2026-04-11T00:00:00.000Z',
      updatedAt: '2026-04-11T00:00:00.000Z',
      version: 1,
      lastUpdatedChatJid: '2362534006947@lid',
    },
  ]);

  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const requests: Array<{ userText: string; inputMode: string; overlay: string | null }> = [];
  const replies: string[] = [];
  const fakeGateway: AiTextGateway = {
    inspect() {
      return {
        ready: true,
        modelName: 'test-model',
        error: null,
        webSearchReady: true,
        webSearchError: null,
      };
    },
    async generateReply(request) {
      requests.push({
        userText: request.userText,
        inputMode: request.inputMode,
        overlay: request.dynamicPromptOverlay,
      });
      return {
        modelName: 'test-model',
        text: 'hasil dari voice',
        webSearch: {
          requested: false,
          used: false,
          query: null,
          resultCount: 0,
          sources: [],
        },
      };
    },
  };
  const fakeVoiceGateway: AiVoiceGateway = {
    inspect() {
      return {
        ready: true,
        modelName: 'gpt-4o-mini-transcribe',
        error: null,
      };
    },
    async transcribe() {
      return {
        text: 'tolong rangkum yang barusan',
        durationSeconds: 7,
        fileSizeBytes: 2048,
      };
    },
  };

  const orchestrator = createAiOrchestrator({
    config,
    logger,
    runtimeStateStore,
    gateway: fakeGateway,
    voiceGateway: fakeVoiceGateway,
    async downloadVoiceMedia() {
      return Buffer.from('voice');
    },
    async sendReply(_chatJid, text) {
      replies.push(text);
    },
  });

  await orchestrator.syncState();
  const result = await orchestrator.handleAllowedNonCommandMessage(
    buildVoiceMessage('voice-1'),
    buildResolution(),
    buildDecision(),
  );

  assert.equal(result.handled, true);
  assert.equal(result.replied, true);
  assert.deepEqual(replies, ['hasil dari voice']);
  assert.equal(requests[0]?.userText, 'tolong rangkum yang barusan');
  assert.equal(requests[0]?.inputMode, 'voice_note');
  assert.match(requests[0]?.overlay ?? '', /Jawab tetap singkat/i);

  const snapshot = runtimeStateStore.getSnapshot();
  assert.equal(snapshot.voiceGatewayReady, true);
  assert.equal(snapshot.lastVoiceInputMode, 'voice_note');
  assert.equal(snapshot.lastVoiceTranscriptPreview, 'tolong rangkum yang barusan');
  assert.equal(snapshot.lastVoiceError, null);
  assert.equal(snapshot.lastDynamicPromptAppliedAt !== null, true);

  const logContents = await readFile(config.logFilePath, 'utf8');
  assert.match(logContents, /voice\.received/);
  assert.match(logContents, /voice\.downloaded/);
  assert.match(logContents, /voice\.transcription_requested/);
  assert.match(logContents, /voice\.transcription_completed/);
  assert.match(logContents, /voice\.handoff/);
  assert.match(logContents, /dynamic_prompt\.applied/);
  assert.match(logContents, /ai\.replied/);
});

test('ai orchestrator keeps memory continuity across voice and text on the same chat', async () => {
  const temp = await createTempRoot('stage-5-ai-orchestrator-voice-memory-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-5',
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
    openAiTranscribeModel: 'gpt-4o-mini-transcribe',
  });
  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const requests: Array<{ userText: string; inputMode: string; transcriptText: string }> = [];
  const fakeGateway: AiTextGateway = {
    inspect() {
      return {
        ready: true,
        modelName: 'test-model',
        error: null,
        webSearchReady: true,
        webSearchError: null,
      };
    },
    async generateReply(request) {
      requests.push({
        userText: request.userText,
        inputMode: request.inputMode,
        transcriptText: request.transcript.map((turn) => turn.text).join(' | '),
      });
      return {
        modelName: 'test-model',
        text: `jawaban: ${request.userText}`,
        webSearch: {
          requested: false,
          used: false,
          query: null,
          resultCount: 0,
          sources: [],
        },
      };
    },
  };
  const fakeVoiceGateway: AiVoiceGateway = {
    inspect() {
      return {
        ready: true,
        modelName: 'gpt-4o-mini-transcribe',
        error: null,
      };
    },
    async transcribe() {
      return {
        text: 'printer kantor error terus',
        durationSeconds: 6,
        fileSizeBytes: 1024,
      };
    },
  };

  const orchestrator = createAiOrchestrator({
    config,
    logger,
    runtimeStateStore,
    gateway: fakeGateway,
    voiceGateway: fakeVoiceGateway,
    async downloadVoiceMedia() {
      return Buffer.from('voice');
    },
    async sendReply() {
      return;
    },
  });

  await orchestrator.syncState();
  await orchestrator.handleAllowedNonCommandMessage(
    buildVoiceMessage('voice-ctx-1'),
    buildResolution(),
    buildDecision(),
  );
  await orchestrator.handleAllowedNonCommandMessage(
    buildMessage('yang tadi mulai cek dari mana?', 'voice-ctx-2'),
    buildResolution(),
    buildDecision(),
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.inputMode, 'voice_note');
  assert.equal(requests[1]?.inputMode, 'text');
  assert.match(requests[1]?.transcriptText ?? '', /printer kantor error terus/i);
  assert.match(requests[1]?.transcriptText ?? '', /jawaban: printer kantor error terus/i);
});

test('ai orchestrator analyzes image and routes it through the same AI pipeline', async () => {
  const temp = await createTempRoot('stage-5-ai-orchestrator-image-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-5',
    openAiApiKey: 'test-key',
    openAiTextModel: 'gpt-5-mini',
  });
  await writeDynamicPromptRegistry(config.dynamicPromptRegistryFilePath, [
    {
      id: 'image-overlay',
      displayNumber: 1,
      name: 'Image overlay',
      content: 'Jawab tetap ringkas.',
      targetType: 'global',
      targetMembers: [],
      mode: 'dm+group',
      priority: 3,
      trigger: {
        type: 'always',
        value: null,
      },
      isActive: true,
      createdBy: 'system',
      createdByNumber: '201507007785',
      updatedBy: 'system',
      updatedByNumber: '201507007785',
      createdAt: '2026-04-11T00:00:00.000Z',
      updatedAt: '2026-04-11T00:00:00.000Z',
      version: 1,
      lastUpdatedChatJid: '2362534006947@lid',
    },
  ]);

  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const requests: Array<{ userText: string; inputMode: string; overlay: string | null }> = [];
  const replies: string[] = [];
  const fakeGateway: AiTextGateway = {
    inspect() {
      return {
        ready: true,
        modelName: 'gpt-5-mini',
        error: null,
        webSearchReady: true,
        webSearchError: null,
      };
    },
    async generateReply(request) {
      requests.push({
        userText: request.userText,
        inputMode: request.inputMode,
        overlay: request.dynamicPromptOverlay,
      });
      return {
        modelName: 'gpt-5-mini',
        text: 'hasil dari image',
        webSearch: {
          requested: false,
          used: false,
          query: null,
          resultCount: 0,
          sources: [],
        },
      };
    },
  };
  const fakeImageGateway: AiImageGateway = {
    inspect() {
      return {
        ready: true,
        modelName: 'gpt-5-mini',
        error: null,
      };
    },
    async analyze() {
      return {
        text: 'Caption user: Tolong cek ini.\nIsi gambar: layar laptop dengan editor kode terbuka.',
        caption: 'Tolong cek ini.',
        fileSizeBytes: 2_048,
        widthPixels: 1_280,
        heightPixels: 720,
      };
    },
  };

  const orchestrator = createAiOrchestrator({
    config,
    logger,
    runtimeStateStore,
    gateway: fakeGateway,
    imageGateway: fakeImageGateway,
    async downloadImageMedia() {
      return Buffer.from('image');
    },
    async sendReply(_chatJid, text) {
      replies.push(text);
    },
  });

  await orchestrator.syncState();
  const result = await orchestrator.handleAllowedNonCommandMessage(
    buildImageMessage('image-1', 'Tolong cek ini.'),
    buildResolution(),
    buildDecision(),
  );

  assert.equal(result.handled, true);
  assert.equal(result.replied, true);
  assert.deepEqual(replies, ['hasil dari image']);
  assert.equal(requests[0]?.inputMode, 'image');
  assert.match(requests[0]?.userText ?? '', /Isi gambar: layar laptop/i);
  assert.match(requests[0]?.overlay ?? '', /Jawab tetap ringkas/i);

  const snapshot = runtimeStateStore.getSnapshot();
  assert.equal(snapshot.imageGatewayReady, true);
  assert.equal(snapshot.lastImageInputMode, 'image');
  assert.equal(snapshot.lastImageCaptionPreview, 'Tolong cek ini.');
  assert.equal(snapshot.lastImageError, null);
  assert.equal(snapshot.lastDynamicPromptAppliedAt !== null, true);

  const logContents = await readFile(config.logFilePath, 'utf8');
  assert.match(logContents, /image\.received/);
  assert.match(logContents, /image\.downloaded/);
  assert.match(logContents, /image\.analysis_requested/);
  assert.match(logContents, /image\.analysis_completed/);
  assert.match(logContents, /image\.handoff/);
  assert.match(logContents, /dynamic_prompt\.applied/);
  assert.match(logContents, /ai\.replied/);
});

test('ai orchestrator keeps memory continuity across image and text on the same chat', async () => {
  const temp = await createTempRoot('stage-5-ai-orchestrator-image-memory-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-5',
    openAiApiKey: 'test-key',
    openAiTextModel: 'gpt-5-mini',
  });
  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const requests: Array<{ userText: string; inputMode: string; transcriptText: string }> = [];
  const fakeGateway: AiTextGateway = {
    inspect() {
      return {
        ready: true,
        modelName: 'gpt-5-mini',
        error: null,
        webSearchReady: true,
        webSearchError: null,
      };
    },
    async generateReply(request) {
      requests.push({
        userText: request.userText,
        inputMode: request.inputMode,
        transcriptText: request.transcript.map((turn) => turn.text).join(' | '),
      });
      return {
        modelName: 'gpt-5-mini',
        text: `jawaban: ${request.userText}`,
        webSearch: {
          requested: false,
          used: false,
          query: null,
          resultCount: 0,
          sources: [],
        },
      };
    },
  };
  const fakeImageGateway: AiImageGateway = {
    inspect() {
      return {
        ready: true,
        modelName: 'gpt-5-mini',
        error: null,
      };
    },
    async analyze() {
      return {
        text: 'Caption user: Ini bagian mana yang rusak?\nIsi gambar: printer kantor menampilkan lampu error merah.',
        caption: 'Ini bagian mana yang rusak?',
        fileSizeBytes: 1_024,
        widthPixels: 1_000,
        heightPixels: 700,
      };
    },
  };

  const orchestrator = createAiOrchestrator({
    config,
    logger,
    runtimeStateStore,
    gateway: fakeGateway,
    imageGateway: fakeImageGateway,
    async downloadImageMedia() {
      return Buffer.from('image');
    },
    async sendReply() {
      return;
    },
  });

  await orchestrator.syncState();
  await orchestrator.handleAllowedNonCommandMessage(
    buildImageMessage('image-ctx-1', 'Ini bagian mana yang rusak?'),
    buildResolution(),
    buildDecision(),
  );
  await orchestrator.handleAllowedNonCommandMessage(
    buildMessage('Yang tadi harus mulai cek dari mana?', 'image-ctx-2'),
    buildResolution(),
    buildDecision(),
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.inputMode, 'image');
  assert.equal(requests[1]?.inputMode, 'text');
  assert.match(requests[1]?.transcriptText ?? '', /printer kantor menampilkan lampu error merah/i);
});

test('ai orchestrator keeps memory continuity across text and image on the same chat', async () => {
  const temp = await createTempRoot('stage-5-ai-orchestrator-text-image-memory-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-5',
    openAiApiKey: 'test-key',
    openAiTextModel: 'gpt-5-mini',
  });
  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const requests: Array<{ userText: string; inputMode: string; transcriptText: string }> = [];
  const fakeGateway: AiTextGateway = {
    inspect() {
      return {
        ready: true,
        modelName: 'gpt-5-mini',
        error: null,
        webSearchReady: true,
        webSearchError: null,
      };
    },
    async generateReply(request) {
      requests.push({
        userText: request.userText,
        inputMode: request.inputMode,
        transcriptText: request.transcript.map((turn) => turn.text).join(' | '),
      });
      return {
        modelName: 'gpt-5-mini',
        text: `jawaban: ${request.userText}`,
        webSearch: {
          requested: false,
          used: false,
          query: null,
          resultCount: 0,
          sources: [],
        },
      };
    },
  };
  const fakeImageGateway: AiImageGateway = {
    inspect() {
      return {
        ready: true,
        modelName: 'gpt-5-mini',
        error: null,
      };
    },
    async analyze() {
      return {
        text: 'Caption user: Yang ini maksudku.\nIsi gambar: kemasan tinta printer warna hitam.',
        caption: 'Yang ini maksudku.',
        fileSizeBytes: 1_024,
        widthPixels: 800,
        heightPixels: 800,
      };
    },
  };

  const orchestrator = createAiOrchestrator({
    config,
    logger,
    runtimeStateStore,
    gateway: fakeGateway,
    imageGateway: fakeImageGateway,
    async downloadImageMedia() {
      return Buffer.from('image');
    },
    async sendReply() {
      return;
    },
  });

  await orchestrator.syncState();
  await orchestrator.handleAllowedNonCommandMessage(
    buildMessage('Tinta printer yang cocok yang mana?', 'text-image-1'),
    buildResolution(),
    buildDecision(),
  );
  await orchestrator.handleAllowedNonCommandMessage(
    buildImageMessage('text-image-2', 'Yang ini maksudku.'),
    buildResolution(),
    buildDecision(),
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.inputMode, 'text');
  assert.equal(requests[1]?.inputMode, 'image');
  assert.match(requests[1]?.transcriptText ?? '', /Tinta printer yang cocok yang mana/i);
});

function buildMessage(text: string, id = 'ai-msg-1'): WAMessage {
  return {
    key: {
      id,
      remoteJid: '2362534006947@lid',
      fromMe: false,
    },
    message: {
      conversation: text,
    },
  } as WAMessage;
}

function buildImageMessage(id = 'ai-image-1', caption: string | null = null): WAMessage {
  return {
    key: {
      id,
      remoteJid: '2362534006947@lid',
      fromMe: false,
    },
    message: {
      imageMessage: {
        mimetype: 'image/jpeg',
        caption: caption ?? undefined,
        fileLength: 2048,
        width: 1280,
        height: 720,
      },
    },
  } as WAMessage;
}

function buildVoiceMessage(id = 'ai-voice-1'): WAMessage {
  return {
    key: {
      id,
      remoteJid: '2362534006947@lid',
      fromMe: false,
    },
    message: {
      audioMessage: {
        ptt: true,
        seconds: 7,
        fileLength: 2048,
        mimetype: 'audio/ogg; codecs=opus',
      },
    },
  } as WAMessage;
}

function buildResolution(): RuntimeIdentityResolutionSnapshot {
  return {
    observedAt: '2026-04-10T00:00:00.000Z',
    chatJid: '2362534006947@lid',
    senderJid: '201507007785@s.whatsapp.net',
    normalizedSender: '201507007785',
    senderPn: '201507007785',
    senderLid: '2362534006947@lid',
    botNumber: '6285655002277',
    botJid: '6285655002277@s.whatsapp.net',
    botLid: '18687553736945@lid',
    remoteJid: '2362534006947@lid',
    participant: null,
    keyParticipant: null,
    contextParticipant: null,
    explicitSenderPn: null,
    isFromSelf: false,
    isGroup: false,
    source: 'remote_jid_alt',
  };
}

function buildDecision(): AccessDecision {
  return {
    evaluatedAt: '2026-04-10T00:00:00.000Z',
    isAllowed: true,
    role: 'super_admin',
    reason: 'official_super_admin',
    chatContextType: 'dm',
    chatAccessAllowed: true,
    chatAccessReason: 'direct_message',
    normalizedSender: '201507007785',
    senderJid: '201507007785@s.whatsapp.net',
    chatJid: '2362534006947@lid',
    isFromSelf: false,
    isGroup: false,
  };
}
