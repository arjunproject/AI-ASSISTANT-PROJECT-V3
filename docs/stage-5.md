# Stage 5

Tahap 5 final adalah satu pipeline AI dasar yang menerima input text, voice, dan image melalui orchestrator yang sama.

Komponen resmi Tahap 5:

- gateway AI text resmi
- store memory konteks ringan per chat
- web search resmi di gateway AI yang sama
- registry, validator, assembler, dan audit prompt dinamis resmi
- command WhatsApp resmi untuk kelola prompt dinamis
- gateway transkripsi voice resmi
- gateway analisis image resmi
- runtime state dan health resmi di `.runtime`

Prinsip final Tahap 5:

- AI tetap menjadi pengambil keputusan utama
- memory hanya alat bantu konteks per chat
- dynamic prompt hanya overlay
- voice dan image tidak punya pipeline AI kedua
- web search tetap tool bantu yang diputuskan AI
- access gate, command admin, group whitelist, dan mode akses DM/group tetap berada di depan pipeline AI

Jalur resmi Tahap 5:

- text: WhatsApp -> access gate -> command check -> orchestrator AI -> reply text
- voice: WhatsApp -> access gate -> command check -> download audio -> transcribe gateway -> orchestrator AI -> reply text
- image: WhatsApp -> access gate -> command check -> download image -> image gateway -> orchestrator AI -> reply text

Memory final:

- satu store resmi per chat
- recent transcript pendek sebagai konteks utama
- archived snippet ringan sebagai cadangan konteks lama
- metadata web search tidak masuk ke memory
- tidak ada state topik paksa di luar AI

Web search final:

- satu jalur resmi di gateway AI text
- AI memutuskan sendiri kapan search dipakai
- search tidak menentukan topik final user
- sumber hasil search hanya ditambahkan ringan pada reply akhir bila memang dipakai

Dynamic prompt core final:

- satu registry resmi di `.runtime/ai/dynamic-prompts.json`
- satu audit resmi di `.runtime/ai/dynamic-prompt-audit.json`
- selection deterministik berdasarkan target, mode, priority, `updatedAt`, dan `id`
- prompt nonaktif tidak ikut apply
- overlay tidak boleh mengalahkan reasoning AI, memory, atau keputusan web search

Dynamic prompt via WhatsApp final:

- dikelola hanya lewat command resmi super admin
- command resmi: `Prompt list`, `Prompt show`, `Prompt add`, `Prompt edit`, `Prompt on`, `Prompt off`, `Prompt remove`
- help resmi tetap terpusat di `Admin help`
- jalur command tetap resmi dan tidak bocor ke AI

Voice final:

- satu gateway transkripsi resmi
- model transkripsi dari `OPENAI_TRANSCRIBE_MODEL`
- hasil transkripsi diperlakukan sebagai pesan user normal
- output Tahap 5 tetap teks

Image final:

- satu gateway analisis image resmi
- model chat vision tetap mengikuti `OPENAI_TEXT_MODEL`
- caption ikut menjadi konteks input image
- hasil analisis diperlakukan sebagai konteks visual netral untuk pipeline AI yang sama
- output Tahap 5 tetap teks

Env resmi Tahap 5:

- `OPENAI_API_KEY`
- `OPENAI_TEXT_MODEL`
- `OPENAI_TRANSCRIBE_MODEL`
- `AI_SESSION_MAX_TURNS`
- `AI_REQUEST_TIMEOUT_MS`
- `VOICE_TRANSCRIBE_TIMEOUT_MS`
- `VOICE_MAX_AUDIO_SECONDS`
- `VOICE_MAX_FILE_BYTES`
- `IMAGE_ANALYSIS_TIMEOUT_MS`
- `IMAGE_MAX_FILE_BYTES`
- `IMAGE_MAX_EDGE_PIXELS`

Source resmi Tahap 5:

- `src/ai/ai-orchestrator.ts`
- `src/ai/openai-text-gateway.ts`
- `src/ai/conversation-session-store.ts`
- `src/ai/web-search-formatter.ts`
- `src/ai/dynamic-prompt-types.ts`
- `src/ai/dynamic-prompt-validator.ts`
- `src/ai/dynamic-prompt-assembler.ts`
- `src/ai/dynamic-prompt-registry.ts`
- `src/ai/openai-voice-gateway.ts`
- `src/ai/openai-image-gateway.ts`
- `src/whatsapp/message-audio.ts`
- `src/whatsapp/message-image.ts`

Runtime artefact resmi Tahap 5:

- `.runtime/status/runtime-state.json`
- `.runtime/logs/runtime.log`
- `.runtime/lock/runtime.lock.json`
- `.runtime/ai/dynamic-prompts.json`
- `.runtime/ai/dynamic-prompt-audit.json`
- `.runtime/access/admin-registry.json`
- `.runtime/access/official-group-whitelist.json`

State dan health final Tahap 5:

- AI: `aiGatewayReady`, `aiModelName`, `lastAiRequestAt`, `lastAiReplyAt`, `lastAiError`
- memory: `activeConversationCount`, `lastContextUpdatedAt`
- web search: `webSearchReady`, `lastWebSearchAt`, `lastWebSearchUsed`, `lastWebSearchError`, `lastWebSearchResultCount`
- dynamic prompt: `dynamicPromptRegistryReady`, `activeDynamicPromptCount`, `lastDynamicPromptAppliedAt`, `lastDynamicPromptAuditAt`, `lastDynamicPromptError`
- voice: `voiceGatewayReady`, `lastVoiceMessageAt`, `lastVoiceTranscriptionAt`, `lastVoiceSender`, `lastVoiceChatJid`, `lastVoiceError`, `lastVoiceTranscriptPreview`, `lastVoiceDurationSeconds`, `lastVoiceInputMode`
- image: `imageGatewayReady`, `lastImageMessageAt`, `lastImageAnalysisAt`, `lastImageSender`, `lastImageChatJid`, `lastImageError`, `lastImageCaptionPreview`, `lastImageInputMode`
- runtime utama: `connectionState`, `socketState`, `syncState`, `deviceActivityState`, `messageFlowState`, `inboundReady`, `lastError`

Event log utama Tahap 5:

- AI: `ai.context.loaded`, `ai.context.summary_updated`, `ai.handoff`, `ai.requested`, `ai.responded`, `ai.replied`, `ai.error`
- web search: `ai.web_search_skipped`, `ai.web_search_requested`, `ai.web_search_completed`, `ai.web_search_failed`
- dynamic prompt: `dynamic_prompt.applied`, `dynamic_prompt.audit_recorded`
- voice: `voice.received`, `voice.downloaded`, `voice.transcription_requested`, `voice.transcription_completed`, `voice.transcription_failed`, `voice.handoff`
- image: `image.received`, `image.downloaded`, `image.analysis_requested`, `image.analysis_completed`, `image.analysis_failed`, `image.handoff`

Catatan runtime resmi:

- `runtime.log` boleh tetap menyimpan jejak historis dari run lama untuk audit
- runtime state resmi hanya membaca field snapshot yang masih valid
- field state usang dibuang saat snapshot ditulis ulang
- jalur voice dan image saat ini berbasis buffer in-memory, jadi event cleanup file sementara tidak diharapkan pada run normal

Hal yang belum termasuk Tahap 5:

- mirror
- spreadsheet
- autostart
- tool bisnis lain
- image generation
- image editing
- TTS atau voice reply
- memory global lintas chat
- retrieval atau vector database
