import type { WAMessage } from '@whiskeysockets/baileys';

import type { AccessDecision } from '../access/types.js';
import type { AppConfig } from '../config/app-config.js';
import type { Logger } from '../core/logger.js';
import type { RuntimeStateStore } from '../runtime/runtime-state-store.js';
import { extractAudioMessage, type ExtractedAudioMessage } from '../whatsapp/message-audio.js';
import { extractImageMessage, type ExtractedImageMessage } from '../whatsapp/message-image.js';
import { extractMessageText } from '../whatsapp/message-text.js';
import type { RuntimeIdentityResolutionSnapshot } from '../whatsapp/types.js';
import { createAiConversationSessionStore } from './conversation-session-store.js';
import { createDynamicPromptRegistry } from './dynamic-prompt-registry.js';
import { createOpenAiImageGateway } from './openai-image-gateway.js';
import { createOpenAiTextGateway } from './openai-text-gateway.js';
import { createOpenAiVoiceGateway } from './openai-voice-gateway.js';
import type {
  AiImageGateway,
  AiInputMode,
  AiOrchestratorResult,
  AiTextGateway,
  AiVoiceGateway,
} from './types.js';

interface RuntimeMessageContext {
  messageId: string | null;
  chatJid: string | null;
  senderJid: string | null;
  normalizedSender: string | null;
}

export interface AiOrchestrator {
  syncState(): Promise<void>;
  handleAllowedNonCommandMessage(
    message: WAMessage,
    resolvedIdentity: RuntimeIdentityResolutionSnapshot | null,
    accessDecision: AccessDecision,
  ): Promise<AiOrchestratorResult>;
}

export function createAiOrchestrator(dependencies: {
  config: AppConfig;
  logger: Logger;
  runtimeStateStore: RuntimeStateStore;
  sendReply(chatJid: string, text: string, quotedMessage: WAMessage): Promise<void>;
  downloadVoiceMedia?(message: WAMessage): Promise<Buffer>;
  downloadImageMedia?(message: WAMessage): Promise<Buffer>;
  gateway?: AiTextGateway;
  voiceGateway?: AiVoiceGateway;
  imageGateway?: AiImageGateway;
}): AiOrchestrator {
  const { config, logger, runtimeStateStore, sendReply, downloadVoiceMedia, downloadImageMedia } = dependencies;
  const gateway = dependencies.gateway ?? createOpenAiTextGateway(config, { logger });
  const voiceGateway = dependencies.voiceGateway ?? createOpenAiVoiceGateway(config);
  const imageGateway = dependencies.imageGateway ?? createOpenAiImageGateway(config);
  const conversationStore = createAiConversationSessionStore(config.aiSessionMaxTurns);
  const dynamicPromptRegistry = createDynamicPromptRegistry({
    registryFilePath: config.dynamicPromptRegistryFilePath,
    auditFilePath: config.dynamicPromptAuditFilePath,
    logger,
  });

  return {
    async syncState() {
      const inspection = gateway.inspect();
      const voiceInspection = voiceGateway.inspect();
      const imageInspection = imageGateway.inspect();
      const dynamicPromptInspection = await dynamicPromptRegistry.inspect();
      await runtimeStateStore.update({
        aiGatewayReady: inspection.ready,
        aiModelName: inspection.modelName,
        lastAiError: inspection.ready ? null : inspection.error,
        voiceGatewayReady: voiceInspection.ready,
        lastVoiceError: voiceInspection.ready ? runtimeStateStore.getSnapshot().lastVoiceError : voiceInspection.error,
        imageGatewayReady: imageInspection.ready,
        lastImageError: imageInspection.ready ? runtimeStateStore.getSnapshot().lastImageError : imageInspection.error,
        dynamicPromptRegistryReady: dynamicPromptInspection.ready,
        activeDynamicPromptCount: dynamicPromptInspection.activeCount,
        lastDynamicPromptAuditAt: dynamicPromptInspection.lastAuditAt,
        lastDynamicPromptError: dynamicPromptInspection.error,
        webSearchReady: inspection.webSearchReady,
        lastWebSearchError: inspection.webSearchReady ? null : inspection.webSearchError,
        activeConversationCount: conversationStore.getActiveConversationCount(),
      });
    },

    async handleAllowedNonCommandMessage(message, resolvedIdentity, accessDecision) {
      const extractedImage = extractImageMessage(message.message);
      if (extractedImage) {
        const context = resolveMessageContext(message, resolvedIdentity, accessDecision);
        return handleImageInput(message, accessDecision, context, extractedImage);
      }

      const userText = extractMessageText(message.message);
      const context = resolveMessageContext(message, resolvedIdentity, accessDecision);

      if (userText) {
        return handleNormalizedInput(message, accessDecision, context, userText, 'text');
      }

      const extractedAudio = extractAudioMessage(message.message);
      if (!extractedAudio) {
        return {
          handled: false,
          replied: false,
          skipped: 'non_text',
          error: null,
        };
      }

      return handleVoiceInput(message, accessDecision, context, extractedAudio);
    },
  };

  async function handleImageInput(
    message: WAMessage,
    accessDecision: AccessDecision,
    context: RuntimeMessageContext,
    extractedImage: ExtractedImageMessage,
  ): Promise<AiOrchestratorResult> {
    const inspection = imageGateway.inspect();
    const receivedAt = new Date().toISOString();
    const captionPreview = previewText(extractedImage.caption ?? '');

    await runtimeStateStore.update({
      imageGatewayReady: inspection.ready,
      lastImageMessageAt: receivedAt,
      lastImageSender: context.normalizedSender ?? context.senderJid,
      lastImageChatJid: context.chatJid,
      lastImageError: inspection.ready ? null : inspection.error,
      lastImageCaptionPreview: captionPreview,
      lastImageInputMode: extractedImage.inputMode,
    });

    logger.info('image.received', {
      messageId: context.messageId,
      chatJid: context.chatJid,
      senderJid: context.senderJid,
      normalizedSender: context.normalizedSender,
      inputMode: extractedImage.inputMode,
      fileLengthBytes: extractedImage.fileLengthBytes,
      widthPixels: extractedImage.widthPixels,
      heightPixels: extractedImage.heightPixels,
      captionPreview,
    });

    if (!context.chatJid) {
      const missingChatError = 'Image handoff could not continue because chatJid is missing.';
      await runtimeStateStore.update({
        imageGatewayReady: inspection.ready,
        lastImageError: missingChatError,
      });
      logger.error('image.analysis_failed', {
        messageId: context.messageId,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        stage: 'handoff',
        message: missingChatError,
      });
      return {
        handled: true,
        replied: false,
        skipped: null,
        error: missingChatError,
      };
    }

    if (!inspection.ready) {
      const errorMessage = inspection.error ?? 'Image gateway is not ready.';
      logger.error('image.analysis_failed', {
        messageId: context.messageId,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        stage: 'gateway',
        message: errorMessage,
      });
      await sendReply(context.chatJid, 'Gambarnya belum bisa diproses sekarang.', message);
      return {
        handled: true,
        replied: true,
        skipped: null,
        error: errorMessage,
      };
    }

    if (!downloadImageMedia) {
      const missingDownloaderError = 'Image media downloader is not available.';
      await runtimeStateStore.update({
        imageGatewayReady: inspection.ready,
        lastImageError: missingDownloaderError,
      });
      logger.error('image.analysis_failed', {
        messageId: context.messageId,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        stage: 'download',
        message: missingDownloaderError,
      });
      await sendReply(context.chatJid, 'Gambarnya gagal diunduh.', message);
      return {
        handled: true,
        replied: true,
        skipped: null,
        error: missingDownloaderError,
      };
    }

    try {
      const imageBuffer = await downloadImageMedia(message);
      logger.info('image.downloaded', {
        messageId: context.messageId,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        inputMode: extractedImage.inputMode,
        fileSizeBytes: imageBuffer.byteLength,
        widthPixels: extractedImage.widthPixels,
        heightPixels: extractedImage.heightPixels,
        captionPreview,
      });

      logger.info('image.analysis_requested', {
        messageId: context.messageId,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        inputMode: extractedImage.inputMode,
        fileSizeBytes: imageBuffer.byteLength,
        widthPixels: extractedImage.widthPixels,
        heightPixels: extractedImage.heightPixels,
        captionPreview,
      });

      const analysis = await imageGateway.analyze({
        imageBuffer,
        mimeType: extractedImage.mimeType,
        caption: extractedImage.caption,
        fileSizeBytes: extractedImage.fileLengthBytes ?? imageBuffer.byteLength,
        widthPixels: extractedImage.widthPixels,
        heightPixels: extractedImage.heightPixels,
        inputMode: extractedImage.inputMode,
      });
      const analysisAt = new Date().toISOString();
      const analysisPreview = previewText(analysis.text);

      if (!analysis.text) {
        const emptyAnalysisError = 'Image analysis returned empty text.';
        await runtimeStateStore.update({
          imageGatewayReady: true,
          lastImageAnalysisAt: analysisAt,
          lastImageSender: context.normalizedSender ?? context.senderJid,
          lastImageChatJid: context.chatJid,
          lastImageError: emptyAnalysisError,
          lastImageCaptionPreview: captionPreview,
          lastImageInputMode: extractedImage.inputMode,
        });
        logger.warn('image.analysis_failed', {
          messageId: context.messageId,
          chatJid: context.chatJid,
          senderJid: context.senderJid,
          normalizedSender: context.normalizedSender,
          stage: 'analysis',
          reason: 'empty_analysis',
          message: emptyAnalysisError,
        });
        await sendReply(context.chatJid, 'Gambarnya belum kebaca jelas.', message);
        return {
          handled: true,
          replied: true,
          skipped: null,
          error: emptyAnalysisError,
        };
      }

      await runtimeStateStore.update({
        imageGatewayReady: true,
        lastImageAnalysisAt: analysisAt,
        lastImageSender: context.normalizedSender ?? context.senderJid,
        lastImageChatJid: context.chatJid,
        lastImageError: null,
        lastImageCaptionPreview: captionPreview,
        lastImageInputMode: extractedImage.inputMode,
      });
      logger.info('image.analysis_completed', {
        messageId: context.messageId,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        inputMode: extractedImage.inputMode,
        fileSizeBytes: analysis.fileSizeBytes,
        widthPixels: analysis.widthPixels,
        heightPixels: analysis.heightPixels,
        captionPreview,
        analysisPreview,
      });
      logger.info('image.handoff', {
        messageId: context.messageId,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        inputMode: extractedImage.inputMode,
      });

      return handleNormalizedInput(message, accessDecision, context, analysis.text, extractedImage.inputMode);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await runtimeStateStore.update({
        imageGatewayReady: inspection.ready,
        lastImageSender: context.normalizedSender ?? context.senderJid,
        lastImageChatJid: context.chatJid,
        lastImageError: errorMessage,
        lastImageCaptionPreview: captionPreview,
        lastImageInputMode: extractedImage.inputMode,
      });
      logger.error('image.analysis_failed', {
        messageId: context.messageId,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        stage: 'download_or_analysis',
        message: errorMessage,
        error,
      });
      await sendReply(context.chatJid, describeImageFailureReply(errorMessage), message);
      return {
        handled: true,
        replied: true,
        skipped: null,
        error: errorMessage,
      };
    }
  }

  async function handleVoiceInput(
    message: WAMessage,
    accessDecision: AccessDecision,
    context: RuntimeMessageContext,
    extractedAudio: ExtractedAudioMessage,
  ): Promise<AiOrchestratorResult> {
    const inspection = voiceGateway.inspect();
    const receivedAt = new Date().toISOString();

    await runtimeStateStore.update({
      voiceGatewayReady: inspection.ready,
      lastVoiceMessageAt: receivedAt,
      lastVoiceSender: context.normalizedSender ?? context.senderJid,
      lastVoiceChatJid: context.chatJid,
      lastVoiceError: inspection.ready ? null : inspection.error,
      lastVoiceTranscriptPreview: null,
      lastVoiceDurationSeconds: extractedAudio.durationSeconds,
      lastVoiceInputMode: extractedAudio.inputMode,
    });

    logger.info('voice.received', {
      messageId: context.messageId,
      chatJid: context.chatJid,
      senderJid: context.senderJid,
      normalizedSender: context.normalizedSender,
      inputMode: extractedAudio.inputMode,
      durationSeconds: extractedAudio.durationSeconds,
      fileLengthBytes: extractedAudio.fileLengthBytes,
    });

    if (!context.chatJid) {
      const missingChatError = 'Voice handoff could not continue because chatJid is missing.';
      await runtimeStateStore.update({
        voiceGatewayReady: inspection.ready,
        lastVoiceError: missingChatError,
      });
      logger.error('voice.transcription_failed', {
        messageId: context.messageId,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        stage: 'handoff',
        message: missingChatError,
      });
      return {
        handled: true,
        replied: false,
        skipped: null,
        error: missingChatError,
      };
    }

    if (!inspection.ready) {
      const errorMessage = inspection.error ?? 'Voice transcription gateway is not ready.';
      logger.error('voice.transcription_failed', {
        messageId: context.messageId,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        stage: 'gateway',
        message: errorMessage,
      });
      await sendReply(context.chatJid, 'Voice note belum bisa diproses sekarang.', message);
      return {
        handled: true,
        replied: true,
        skipped: null,
        error: errorMessage,
      };
    }

    if (!downloadVoiceMedia) {
      const missingDownloaderError = 'Voice media downloader is not available.';
      await runtimeStateStore.update({
        voiceGatewayReady: inspection.ready,
        lastVoiceError: missingDownloaderError,
      });
      logger.error('voice.transcription_failed', {
        messageId: context.messageId,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        stage: 'download',
        message: missingDownloaderError,
      });
      await sendReply(context.chatJid, 'Voice note-nya gagal diunduh.', message);
      return {
        handled: true,
        replied: true,
        skipped: null,
        error: missingDownloaderError,
      };
    }

    try {
      const audioBuffer = await downloadVoiceMedia(message);
      logger.info('voice.downloaded', {
        messageId: context.messageId,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        inputMode: extractedAudio.inputMode,
        fileSizeBytes: audioBuffer.byteLength,
        durationSeconds: extractedAudio.durationSeconds,
      });

      logger.info('voice.transcription_requested', {
        messageId: context.messageId,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        inputMode: extractedAudio.inputMode,
        durationSeconds: extractedAudio.durationSeconds,
        fileSizeBytes: audioBuffer.byteLength,
      });

      const transcription = await voiceGateway.transcribe({
        audioBuffer,
        mimeType: extractedAudio.mimeType,
        durationSeconds: extractedAudio.durationSeconds,
        fileSizeBytes: extractedAudio.fileLengthBytes ?? audioBuffer.byteLength,
        inputMode: extractedAudio.inputMode,
      });
      const transcriptionAt = new Date().toISOString();
      const transcriptPreview = previewText(transcription.text);

      if (!transcription.text) {
        const emptyTranscriptError = 'Voice transcription returned empty text.';
        await runtimeStateStore.update({
          voiceGatewayReady: true,
          lastVoiceTranscriptionAt: transcriptionAt,
          lastVoiceSender: context.normalizedSender ?? context.senderJid,
          lastVoiceChatJid: context.chatJid,
          lastVoiceError: emptyTranscriptError,
          lastVoiceTranscriptPreview: null,
          lastVoiceDurationSeconds: transcription.durationSeconds,
          lastVoiceInputMode: extractedAudio.inputMode,
        });
        logger.warn('voice.transcription_failed', {
          messageId: context.messageId,
          chatJid: context.chatJid,
          senderJid: context.senderJid,
          normalizedSender: context.normalizedSender,
          stage: 'transcription',
          reason: 'empty_transcript',
          message: emptyTranscriptError,
        });
        await sendReply(context.chatJid, 'Voice note-nya belum kebaca jelas.', message);
        return {
          handled: true,
          replied: true,
          skipped: null,
          error: emptyTranscriptError,
        };
      }

      await runtimeStateStore.update({
        voiceGatewayReady: true,
        lastVoiceTranscriptionAt: transcriptionAt,
        lastVoiceSender: context.normalizedSender ?? context.senderJid,
        lastVoiceChatJid: context.chatJid,
        lastVoiceError: null,
        lastVoiceTranscriptPreview: transcriptPreview,
        lastVoiceDurationSeconds: transcription.durationSeconds,
        lastVoiceInputMode: extractedAudio.inputMode,
      });
      logger.info('voice.transcription_completed', {
        messageId: context.messageId,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        inputMode: extractedAudio.inputMode,
        durationSeconds: transcription.durationSeconds,
        fileSizeBytes: transcription.fileSizeBytes,
        transcriptPreview,
      });
      logger.info('voice.handoff', {
        messageId: context.messageId,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        inputMode: extractedAudio.inputMode,
      });

      return handleNormalizedInput(message, accessDecision, context, transcription.text, extractedAudio.inputMode);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await runtimeStateStore.update({
        voiceGatewayReady: inspection.ready,
        lastVoiceSender: context.normalizedSender ?? context.senderJid,
        lastVoiceChatJid: context.chatJid,
        lastVoiceError: errorMessage,
        lastVoiceTranscriptPreview: null,
        lastVoiceDurationSeconds: extractedAudio.durationSeconds,
        lastVoiceInputMode: extractedAudio.inputMode,
      });
      logger.error('voice.transcription_failed', {
        messageId: context.messageId,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        stage: 'download_or_transcription',
        message: errorMessage,
        error,
      });
      await sendReply(context.chatJid, describeVoiceFailureReply(errorMessage), message);
      return {
        handled: true,
        replied: true,
        skipped: null,
        error: errorMessage,
      };
    }
  }

  async function handleNormalizedInput(
    message: WAMessage,
    accessDecision: AccessDecision,
    context: RuntimeMessageContext,
    userText: string,
    inputMode: AiInputMode,
  ): Promise<AiOrchestratorResult> {
    const inspection = gateway.inspect();

    if (!context.chatJid) {
      const missingChatError = 'AI handoff could not continue because chatJid is missing.';
      await runtimeStateStore.update({
        aiGatewayReady: inspection.ready,
        aiModelName: inspection.modelName,
        webSearchReady: inspection.webSearchReady,
        lastAiSender: context.normalizedSender ?? context.senderJid,
        lastAiChatJid: null,
        lastAiError: missingChatError,
        activeConversationCount: conversationStore.getActiveConversationCount(),
      });
      logger.error('ai.error', {
        messageId: context.messageId,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        message: missingChatError,
      });
      return {
        handled: true,
        replied: false,
        skipped: null,
        error: missingChatError,
      };
    }

    if (!inspection.ready) {
      await runtimeStateStore.update({
        aiGatewayReady: inspection.ready,
        aiModelName: inspection.modelName,
        dynamicPromptRegistryReady: runtimeStateStore.getSnapshot().dynamicPromptRegistryReady,
        webSearchReady: inspection.webSearchReady,
        lastAiSender: context.normalizedSender ?? context.senderJid,
        lastAiChatJid: context.chatJid,
        lastAiError: inspection.error,
        lastWebSearchError: inspection.webSearchError,
        activeConversationCount: conversationStore.getActiveConversationCount(),
      });
      logger.error('ai.error', {
        messageId: context.messageId,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        message: inspection.error,
      });
      return {
        handled: true,
        replied: false,
        skipped: null,
        error: inspection.error,
      };
    }

    const dynamicPromptResolution = await dynamicPromptRegistry.resolve({
      chatJid: context.chatJid,
      senderJid: context.senderJid,
      normalizedSender: context.normalizedSender,
      isGroup: accessDecision.isGroup,
      userText,
      manualPromptIds: [],
      intentTags: [],
      domainTag: null,
    });

    if (!dynamicPromptResolution.ready) {
      await runtimeStateStore.update({
        aiGatewayReady: true,
        aiModelName: inspection.modelName,
        dynamicPromptRegistryReady: false,
        activeDynamicPromptCount: 0,
        lastDynamicPromptAuditAt: dynamicPromptResolution.lastAuditAt,
        lastDynamicPromptError: dynamicPromptResolution.error,
        webSearchReady: inspection.webSearchReady,
        lastAiSender: context.normalizedSender ?? context.senderJid,
        lastAiChatJid: context.chatJid,
        lastAiError: dynamicPromptResolution.error,
        lastWebSearchError: inspection.webSearchReady ? null : inspection.webSearchError,
        activeConversationCount: conversationStore.getActiveConversationCount(),
      });
      logger.error('ai.error', {
        messageId: context.messageId,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        message: dynamicPromptResolution.error,
      });
      return {
        handled: true,
        replied: false,
        skipped: null,
        error: dynamicPromptResolution.error,
      };
    }

    const preparedContext = conversationStore.prepareContext(context.chatJid, userText);
    if (preparedContext.contextLoaded) {
      logger.info('ai.context.loaded', {
        messageId: context.messageId,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        source: preparedContext.contextSource,
        transcriptTurnCount: preparedContext.transcript.length,
        hasSummary: Boolean(preparedContext.summary),
        archivedSnippetCount: preparedContext.archivedSnippetCount,
      });
    }
    if (dynamicPromptResolution.overlayText) {
      logger.info('dynamic_prompt.applied', {
        messageId: context.messageId,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        promptIds: dynamicPromptResolution.appliedPrompts.map((prompt) => prompt.id),
        appliedCount: dynamicPromptResolution.appliedPrompts.length,
      });
    }
    const requestAt = new Date().toISOString();

    await runtimeStateStore.update({
      aiGatewayReady: true,
      aiModelName: inspection.modelName,
      dynamicPromptRegistryReady: true,
      activeDynamicPromptCount: dynamicPromptResolution.activeCount,
      lastDynamicPromptAuditAt: dynamicPromptResolution.lastAuditAt,
      lastDynamicPromptError: null,
      webSearchReady: inspection.webSearchReady,
      lastAiRequestAt: requestAt,
      lastAiSender: context.normalizedSender ?? context.senderJid,
      lastAiChatJid: context.chatJid,
      lastAiError: null,
      lastWebSearchError: null,
      activeConversationCount: conversationStore.getActiveConversationCount(),
    });

    logger.info('ai.handoff', {
      messageId: context.messageId,
      chatJid: context.chatJid,
      senderJid: context.senderJid,
      normalizedSender: context.normalizedSender,
      isFromSelf: accessDecision.isFromSelf,
      isGroup: accessDecision.isGroup,
      inputMode,
    });
    logger.info('ai.requested', {
      messageId: context.messageId,
      chatJid: context.chatJid,
      senderJid: context.senderJid,
      normalizedSender: context.normalizedSender,
      modelName: inspection.modelName,
    });

    try {
      const aiResponse = await gateway.generateReply({
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        userText,
        inputMode,
        summary: preparedContext.summary,
        transcript: preparedContext.transcript,
        webSearchAvailable: inspection.webSearchReady,
        dynamicPromptOverlay: dynamicPromptResolution.overlayText,
      });
      const respondedAt = new Date().toISOString();
      if (aiResponse.webSearch.used) {
        logger.info('ai.web_search_requested', {
          messageId: context.messageId,
          chatJid: context.chatJid,
          senderJid: context.senderJid,
          normalizedSender: context.normalizedSender,
          query: aiResponse.webSearch.query,
          resultCount: aiResponse.webSearch.resultCount,
        });
        logger.info('ai.web_search_completed', {
          messageId: context.messageId,
          chatJid: context.chatJid,
          senderJid: context.senderJid,
          normalizedSender: context.normalizedSender,
          used: aiResponse.webSearch.used,
          query: aiResponse.webSearch.query,
          resultCount: aiResponse.webSearch.resultCount,
        });
      } else {
        logger.info('ai.web_search_skipped', {
          messageId: context.messageId,
          chatJid: context.chatJid,
          senderJid: context.senderJid,
          normalizedSender: context.normalizedSender,
          reason: 'not_used_by_ai',
        });
      }
      const dataRead = aiResponse.dataRead ?? {
        toolAvailable: config.spreadsheetReadEnabled,
        requested: false,
        used: false,
        toolCallCount: 0,
        sheetNames: [],
        toolError: null,
      };
      const outputSafety = aiResponse.outputSafety ?? {
        internalLeakageDetected: false,
        rewriteApplied: false,
        legacyCapabilityFallbackDetected: false,
        capabilityRepairApplied: false,
      };
      if (dataRead.used) {
        logger.info('ai.data_read_requested', {
          messageId: context.messageId,
          chatJid: context.chatJid,
          senderJid: context.senderJid,
          normalizedSender: context.normalizedSender,
          toolCallCount: dataRead.toolCallCount,
          sheetNames: dataRead.sheetNames,
          toolError: dataRead.toolError,
        });
      } else {
        logger.info('ai.data_read_skipped', {
          messageId: context.messageId,
          chatJid: context.chatJid,
          senderJid: context.senderJid,
          normalizedSender: context.normalizedSender,
          reason: 'not_used_by_ai',
        });
      }
      logger.info('ai.responded', {
        messageId: context.messageId,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        modelName: aiResponse.modelName,
        replyPreview: previewText(aiResponse.text),
        dataReadUsed: dataRead.used,
        dataReadSheetNames: dataRead.sheetNames,
        dataReadToolCallCount: dataRead.toolCallCount,
        dataReadToolError: dataRead.toolError,
        outputSafetyRewriteApplied: outputSafety.rewriteApplied,
        legacyCapabilityFallbackDetected: outputSafety.legacyCapabilityFallbackDetected,
        capabilityRepairApplied: outputSafety.capabilityRepairApplied,
      });

      await sendReply(context.chatJid, aiResponse.text, message);
      logger.info('ai.replied', {
        messageId: context.messageId,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        modelName: aiResponse.modelName,
      });

      const memoryUpdate = conversationStore.rememberExchange(
        context.chatJid,
        userText,
        aiResponse.text,
        respondedAt,
        preparedContext.contextSource,
      );
      if (memoryUpdate.summaryUpdated && memoryUpdate.summary) {
        logger.info('ai.context.summary_updated', {
          messageId: context.messageId,
          chatJid: context.chatJid,
          senderJid: context.senderJid,
          normalizedSender: context.normalizedSender,
        });
      }

      await runtimeStateStore.update({
        aiGatewayReady: true,
        aiModelName: aiResponse.modelName,
        dynamicPromptRegistryReady: true,
        activeDynamicPromptCount: dynamicPromptResolution.activeCount,
        lastDynamicPromptAppliedAt:
          dynamicPromptResolution.overlayText ? respondedAt : runtimeStateStore.getSnapshot().lastDynamicPromptAppliedAt,
        lastDynamicPromptAuditAt: dynamicPromptResolution.lastAuditAt,
        lastDynamicPromptError: null,
        webSearchReady: inspection.webSearchReady,
        lastAiReplyAt: respondedAt,
        lastAiSender: context.normalizedSender ?? context.senderJid,
        lastAiChatJid: context.chatJid,
        lastAiError: null,
        lastWebSearchAt: aiResponse.webSearch.used ? respondedAt : runtimeStateStore.getSnapshot().lastWebSearchAt,
        lastWebSearchQuery: aiResponse.webSearch.query,
        lastWebSearchUsed: aiResponse.webSearch.used,
        lastWebSearchError: null,
        lastWebSearchResultCount: aiResponse.webSearch.resultCount,
        lastContextUpdatedAt: respondedAt,
        activeConversationCount: memoryUpdate.activeConversationCount,
      });

      return {
        handled: true,
        replied: true,
        skipped: null,
        error: null,
      };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      if (inspection.webSearchReady) {
        logger.error('ai.web_search_failed', {
          messageId: context.messageId,
          chatJid: context.chatJid,
          senderJid: context.senderJid,
          normalizedSender: context.normalizedSender,
          message: messageText,
          error,
        });
      }
      await runtimeStateStore.update({
        aiGatewayReady: true,
        aiModelName: inspection.modelName,
        dynamicPromptRegistryReady: true,
        activeDynamicPromptCount: dynamicPromptResolution.activeCount,
        lastDynamicPromptAuditAt: dynamicPromptResolution.lastAuditAt,
        lastDynamicPromptError: null,
        webSearchReady: inspection.webSearchReady,
        lastAiSender: context.normalizedSender ?? context.senderJid,
        lastAiChatJid: context.chatJid,
        lastAiError: messageText,
        lastWebSearchQuery: null,
        lastWebSearchUsed: false,
        lastWebSearchError: inspection.webSearchReady ? messageText : runtimeStateStore.getSnapshot().lastWebSearchError,
        lastWebSearchResultCount: 0,
        activeConversationCount: conversationStore.getActiveConversationCount(),
      });
      logger.error('ai.error', {
        messageId: context.messageId,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        modelName: inspection.modelName,
        message: messageText,
        error,
      });
      return {
        handled: true,
        replied: false,
        skipped: null,
        error: messageText,
      };
    }
  }
}

function resolveMessageContext(
  message: WAMessage,
  resolvedIdentity: RuntimeIdentityResolutionSnapshot | null,
  accessDecision: AccessDecision,
): RuntimeMessageContext {
  return {
    messageId: message.key?.id ?? null,
    chatJid: accessDecision.chatJid ?? resolvedIdentity?.chatJid ?? message.key?.remoteJid ?? null,
    senderJid: accessDecision.senderJid ?? resolvedIdentity?.senderJid ?? null,
    normalizedSender: accessDecision.normalizedSender ?? resolvedIdentity?.normalizedSender ?? null,
  };
}

function describeVoiceFailureReply(errorMessage: string): string {
  const lower = errorMessage.toLowerCase();

  if (lower.includes('too large')) {
    return 'File voice note-nya terlalu besar.';
  }

  if (lower.includes('too long')) {
    return 'Voice note-nya kepanjangan buat diproses.';
  }

  if (lower.includes('download')) {
    return 'Voice note-nya gagal diunduh.';
  }

  return 'Voice note-nya gagal diproses.';
}

function describeImageFailureReply(errorMessage: string): string {
  const lower = errorMessage.toLowerCase();

  if (lower.includes('too large')) {
    return 'File gambarnya terlalu besar.';
  }

  if (lower.includes('edge limit') || lower.includes('dimensions')) {
    return 'Resolusi gambarnya terlalu besar.';
  }

  if (lower.includes('download')) {
    return 'Gambarnya gagal diunduh.';
  }

  return 'Gambarnya gagal diproses.';
}

function previewText(text: string): string {
  const compact = text.trim().replace(/\s+/gu, ' ');
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}
