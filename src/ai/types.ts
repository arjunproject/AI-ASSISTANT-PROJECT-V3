export interface AiConversationTurn {
  role: 'user' | 'assistant';
  text: string;
  observedAt: string;
}

export type AiInputMode = 'text' | 'voice_note' | 'audio' | 'image';

export interface AiGatewayInspection {
  ready: boolean;
  modelName: string | null;
  error: string | null;
  webSearchReady: boolean;
  webSearchError: string | null;
}

export interface AiGatewayRequest {
  userText: string;
  inputMode: AiInputMode;
  chatJid: string;
  senderJid: string | null;
  normalizedSender: string | null;
  summary: string | null;
  transcript: AiConversationTurn[];
  webSearchAvailable: boolean;
  dynamicPromptOverlay: string | null;
}

export interface AiGatewayWebSearchSource {
  url: string | null;
  title: string | null;
  label: string | null;
}

export interface AiGatewayWebSearchResult {
  requested: boolean;
  used: boolean;
  query: string | null;
  resultCount: number;
  sources: AiGatewayWebSearchSource[];
}

export interface AiGatewayDataReadResult {
  toolAvailable: boolean;
  requested: boolean;
  used: boolean;
  toolCallCount: number;
  sheetNames: string[];
  toolError: string | null;
}

export interface AiGatewayOutputSafetyResult {
  internalLeakageDetected: boolean;
  rewriteApplied: boolean;
  legacyCapabilityFallbackDetected: boolean;
  capabilityRepairApplied: boolean;
}

export interface AiGatewayResponse {
  modelName: string;
  text: string;
  webSearch: AiGatewayWebSearchResult;
  dataRead?: AiGatewayDataReadResult;
  outputSafety?: AiGatewayOutputSafetyResult;
}

export interface AiTextGateway {
  inspect(): AiGatewayInspection;
  generateReply(request: AiGatewayRequest): Promise<AiGatewayResponse>;
}

export interface AiVoiceGatewayInspection {
  ready: boolean;
  modelName: string | null;
  error: string | null;
}

export interface AiVoiceTranscriptionRequest {
  audioBuffer: Buffer;
  mimeType: string | null;
  durationSeconds: number | null;
  fileSizeBytes: number | null;
  inputMode: Extract<AiInputMode, 'voice_note' | 'audio'>;
}

export interface AiVoiceTranscriptionResult {
  text: string;
  durationSeconds: number | null;
  fileSizeBytes: number;
}

export interface AiVoiceGateway {
  inspect(): AiVoiceGatewayInspection;
  transcribe(request: AiVoiceTranscriptionRequest): Promise<AiVoiceTranscriptionResult>;
}

export interface AiImageGatewayInspection {
  ready: boolean;
  modelName: string | null;
  error: string | null;
}

export interface AiImageAnalysisRequest {
  imageBuffer: Buffer;
  mimeType: string | null;
  caption: string | null;
  fileSizeBytes: number | null;
  widthPixels: number | null;
  heightPixels: number | null;
  inputMode: Extract<AiInputMode, 'image'>;
}

export interface AiImageAnalysisResult {
  text: string;
  caption: string | null;
  fileSizeBytes: number;
  widthPixels: number | null;
  heightPixels: number | null;
}

export interface AiImageGateway {
  inspect(): AiImageGatewayInspection;
  analyze(request: AiImageAnalysisRequest): Promise<AiImageAnalysisResult>;
}

export interface AiContextPreparation {
  summary: string | null;
  transcript: AiConversationTurn[];
  contextLoaded: boolean;
  contextSource: 'none' | 'current' | 'archived';
  archivedSnippetCount: number;
}

export interface AiConversationSessionStore {
  prepareContext(chatJid: string, userText: string): AiContextPreparation;
  rememberExchange(
    chatJid: string,
    userText: string,
    assistantText: string,
    observedAt: string,
    contextSource: AiContextPreparation['contextSource'],
  ): {
    summaryUpdated: boolean;
    summary: string | null;
    activeConversationCount: number;
  };
  getActiveConversationCount(): number;
}

export interface AiOrchestratorResult {
  handled: boolean;
  replied: boolean;
  skipped: 'non_text' | null;
  error: string | null;
}
