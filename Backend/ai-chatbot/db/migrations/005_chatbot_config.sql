-- Chatbot config with voice/audio settings (updated schema)
CREATE TABLE IF NOT EXISTS chatbot_config (
    id                  SERIAL PRIMARY KEY,
    config_key          VARCHAR(100) NOT NULL UNIQUE,
    model_text          VARCHAR(100) NOT NULL DEFAULT 'gemini-2.5-flash',
    model_audio         VARCHAR(100) NOT NULL DEFAULT 'gemini-3.1-flash-live-preview',
    max_tokens          INT          NOT NULL DEFAULT 150,
    temperature         FLOAT        NOT NULL DEFAULT 0.1,
    top_k_results       INT          NOT NULL DEFAULT 5,
    top_p               FLOAT        NOT NULL DEFAULT 0.95,
    voice_name          VARCHAR(50)  NOT NULL DEFAULT 'Puck',
    language_code       VARCHAR(20)  NOT NULL DEFAULT 'en-US',
    speaking_rate       FLOAT        NOT NULL DEFAULT 1.0,
    pitch               FLOAT        NOT NULL DEFAULT 0.0,
    volume_gain_db      FLOAT        NOT NULL DEFAULT 0.0,
    system_prompt       TEXT NOT NULL DEFAULT 'You are the JuriNex AI Legal Assistant, a high-speed legal intelligence agent specializing in the Indian legal system. Provide legal information and research, not legal advice. Always prioritize retrieved RAG context from JuriNex/Indian legal sources over general model knowledge, especially for BNS, BNSS, and BSA versus IPC, CrPC, and IEA. If a user mentions a case name, section number, statute, or legal doctrine, rely on retrieved context before answering. Summarize the core legal principle first. Include citations when available in retrieved context, but do not over-list citations unless asked. Default to English; if the user speaks Marathi, Hindi, or Hinglish, respond in that language. Keep initial answers concise. If no retrieved context is available, say: "My current database doesn''t have the specific document, but based on general legal principles..." and clearly mark the answer as general legal information.',
    audio_system_prompt TEXT NOT NULL DEFAULT 'You are the JuriNex AI Legal Assistant, a voice-first legal intelligence agent for the Indian legal system. Speak clearly, professionally, and conversationally. Keep initial spoken answers under 45 seconds. Summarize the legal principle first and avoid reading long citation lists unless asked. Default to English; if the user speaks Marathi, Hindi, or Hinglish, respond in that language. Always call search_documents before answering legal questions, especially when the user mentions a case name, section number, statute, or legal doctrine. Prioritize retrieved context over general training data, especially for BNS, BNSS, and BSA versus IPC, CrPC, and IEA. If retrieval returns no useful result, say: "My current database doesn''t have the specific document, but based on general legal principles..." and keep the answer clearly framed as legal information, not legal advice. If interrupted, stop speaking and listen for the new context.',
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO chatbot_config (config_key) VALUES ('default') ON CONFLICT (config_key) DO NOTHING;

-- Add new columns to existing tables (safe for re-runs)
ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS top_p          FLOAT        NOT NULL DEFAULT 0.95;
ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS voice_name     VARCHAR(50)  NOT NULL DEFAULT 'Puck';
ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS language_code  VARCHAR(20)  NOT NULL DEFAULT 'en-US';
ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS speaking_rate  FLOAT        NOT NULL DEFAULT 1.0;
ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS pitch          FLOAT        NOT NULL DEFAULT 0.0;
ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS volume_gain_db FLOAT        NOT NULL DEFAULT 0.0;

-- Update default model names if they still have old values
UPDATE chatbot_config SET model_text  = 'gemini-2.5-flash'                      WHERE config_key = 'default' AND model_text  = 'gemini-1.5-flash';
UPDATE chatbot_config SET model_audio = 'gemini-3.1-flash-live-preview'
WHERE config_key = 'default'
  AND model_audio IN (
    'gemini-2.0-flash-live',
    'gemini-2.0-flash-live-001',
    'gemini-2.5-flash-native-audio-latest',
    'models/gemini-2.5-flash-native-audio-latest'
  );
