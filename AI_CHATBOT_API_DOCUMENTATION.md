# JuriNex AI Chatbot Backend API Documentation

This document covers the AI chatbot APIs used by the frontend chatbot widgets:

- In-app help panel: `frontend/src/components/AppAssistant/AppAssistant.jsx`
- Landing-page chatbot: `frontend/src/components/landing/ChatbotWidget.jsx`
- Backend service: `Backend/ai-chatbot`

## Base URL

Local development:

```text
http://localhost:8095
```

Production default used by the in-app frontend config:

```text
https://ai-chatbot-120280829617.asia-south1.run.app
```

Frontend environment variable:

```env
VITE_APP_AI_CHATBOT_URL=http://localhost:8095
```

All HTTP examples below use:

```text
{{base_url}} = http://localhost:8095
```

Authentication: no bearer token is required for the AI chatbot service endpoints currently used by these widgets.

## API Usage Summary

| API | Method | Used By | Purpose |
|---|---:|---|---|
| `/api/chat` | POST | App help panel, landing chatbot | Send text message to AI and receive Markdown/text answer |
| `/ws/audio?mode=app` | WebSocket | App help panel | Voice chat inside logged-in app; app mode disables demo booking flow |
| `/ws/audio` | WebSocket | Landing chatbot | Voice chat on landing page; default mode is `landing` |
| `/ws/audio?mode=booking` | WebSocket | Landing chatbot | Starts voice flow by asking the AI to announce demo slots |
| `/api/demo-slots` | GET | Landing chatbot | Fetch available demo booking slots |
| `/api/book-demo` | POST | Landing chatbot | Book selected demo slot |
| `/api/chat/history/{session_id}` | GET | Backend/Postman/debug | Fetch stored text chat history |
| `/health` | GET | Ops/debug | Health check |
| `/api/admin/config` | GET/PUT | Admin/debug | Read or update chatbot model/config |

## Frontend Mapping

### App Help Panel

File: `frontend/src/components/AppAssistant/AppAssistant.jsx`

Uses:

- `POST {{base_url}}/api/chat`
- `WS {{base_ws_url}}/ws/audio?mode=app`

The help panel injects current page context into every text prompt:

```text
[APP CONTEXT: {full page-specific UI context}]
USER: {user question}
```

This is how the AI answers page-specific questions like where the Upload File button is.

### Landing Chatbot

File: `frontend/src/components/landing/ChatbotWidget.jsx`

Uses:

- `POST {{base_url}}/api/chat`
- `WS {{base_ws_url}}/ws/audio`
- `WS {{base_ws_url}}/ws/audio?mode=booking`
- `GET {{base_url}}/api/demo-slots`
- `POST {{base_url}}/api/book-demo`

The landing chatbot also detects `slot_selection` JSON returned inside `/api/chat` answers and opens the demo slot UI.

## 1. Text Chat

### `POST /api/chat`

Use this API when a user sends a typed chatbot message.

Backend route:

```text
Backend/ai-chatbot/app/api/routes/chat.py
```

Request:

```http
POST {{base_url}}/api/chat
Content-Type: application/json
```

Request body:

```json
{
  "message": "What does JuriNex offer?",
  "session_id": null
}
```

App help panel request body example:

```json
{
  "message": "[APP CONTEXT: user is on the Documents page - the main file manager for uploaded legal documents. Available actions: Upload File, Create Folder, Upload Folder, Search, Rename, Move, Share, Delete.]\nUSER: How do I upload a PDF?",
  "session_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

Fields:

| Field | Type | Required | Description |
|---|---|---:|---|
| `message` | string | Yes | User message. Min 1 char, max 2000 chars. App help panel prefixes this with page context. |
| `session_id` | string/null | No | Existing session id. Send `null` or omit for first message. |

Success response:

```json
{
  "answer": "To upload a PDF, click **Upload File**, choose your PDF, and wait for the upload to complete.",
  "session_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

Fields:

| Field | Type | Description |
|---|---|---|
| `answer` | string | AI answer. Frontend renders it as Markdown. |
| `session_id` | string | Session id to send in follow-up requests. |

Validation error example:

```json
{
  "detail": [
    {
      "type": "string_too_long",
      "loc": ["body", "message"],
      "msg": "String should have at most 2000 characters"
    }
  ]
}
```

Frontend behavior:

- Saves `session_id` in React state.
- Adds `answer` as an assistant message.
- App help panel removes an accidentally echoed `[APP CONTEXT: ...]` prefix before rendering.

## 2. Chat History

### `GET /api/chat/history/{session_id}`

Use this API to fetch previous messages for a chat session. It is not directly used by the current chatbot UI, but exists in the backend and Postman collection.

Request:

```http
GET {{base_url}}/api/chat/history/550e8400-e29b-41d4-a716-446655440000?limit=20
```

Query params:

| Param | Type | Required | Default | Description |
|---|---|---:|---:|---|
| `limit` | integer | No | `20` | Maximum number of messages to return. |

Success response:

```json
[
  {
    "role": "user",
    "content": "What does JuriNex offer?",
    "created_at": "2026-05-06T10:15:00.000Z"
  },
  {
    "role": "assistant",
    "content": "JuriNex offers legal document analysis, drafting, case workflows, and AI assistance.",
    "created_at": "2026-05-06T10:15:02.000Z"
  }
]
```

Not found response:

```json
{
  "detail": "Session not found or empty"
}
```

## 3. Voice Chat WebSocket

### `WS /ws/audio`

Use this API for microphone-based voice chat.

Backend route:

```text
Backend/ai-chatbot/app/api/routes/audio.py
```

Connection URLs:

```text
ws://localhost:8095/ws/audio
ws://localhost:8095/ws/audio?mode=app
ws://localhost:8095/ws/audio?mode=booking
```

Modes:

| Mode | Used By | Description |
|---|---|---|
| `landing` | Landing chatbot default | General public chatbot, search plus demo booking tools. This is default when no mode is provided. |
| `app` | App help panel | In-app assistant voice mode. Search only, no demo booking flow. |
| `booking` | Landing chatbot demo button | Starts by asking the AI to fetch and announce demo slots. |

Client sends audio chunks while recording:

```json
{
  "type": "audio",
  "data": "<base64 PCM-16 mono audio at 16kHz>"
}
```

Client can inject text into the voice session:

```json
{
  "type": "text",
  "content": "The user selected slot_id=12 (Thu, May 7 10:00 AM - 11:00 AM). Ask for their name and email."
}
```

Client ends the current voice turn:

```json
{
  "type": "end"
}
```

Server sends AI audio:

```json
{
  "type": "audio",
  "data": "<base64 PCM audio>",
  "mime_type": "audio/pcm"
}
```

Server sends AI text transcript:

```json
{
  "type": "text",
  "content": "You can upload a PDF from the Documents page by clicking Upload File."
}
```

Server sends user speech transcript:

```json
{
  "type": "input_transcript",
  "content": "How do I upload a PDF?"
}
```

Server sends tool call info:

```json
{
  "type": "tool_call",
  "tool": "search_documents",
  "query": "JuriNex upload PDF Documents page"
}
```

Server signals turn completion:

```json
{
  "type": "turn_complete"
}
```

Server error:

```json
{
  "type": "error",
  "message": "Audio format not supported"
}
```

Frontend behavior:

- Captures browser microphone audio.
- Downsamples to 16 kHz PCM-16.
- Sends base64 chunks through WebSocket.
- Plays returned PCM audio through Web Audio API.
- Merges streamed `text` chunks into one assistant message.

## 4. Demo Slots

### `GET /api/demo-slots`

Use this API to show available product demo slots in the landing chatbot.

Backend route:

```text
Backend/ai-chatbot/app/api/routes/demo.py
```

Request:

```http
GET {{base_url}}/api/demo-slots
```

Success response:

```json
[
  {
    "id": 12,
    "start_time": "2026-05-07T10:00:00+05:30",
    "end_time": "2026-05-07T11:00:00+05:30",
    "label": "Thu, May 7  10:00 AM - 11:00 AM"
  },
  {
    "id": 13,
    "start_time": "2026-05-07T14:00:00+05:30",
    "end_time": "2026-05-07T15:00:00+05:30",
    "label": "Thu, May 7  2:00 PM - 3:00 PM"
  }
]
```

Notes:

- Backend returns up to 10 future unbooked slots.
- If there are no future slots, the service seeds weekday 10 AM and 2 PM slots for the next 14 days.
- If database is unavailable, backend returns an empty array.

## 5. Book Demo

### `POST /api/book-demo`

Use this API after the user selects a demo slot and submits name/email/company in the landing chatbot.

Request:

```http
POST {{base_url}}/api/book-demo
Content-Type: application/json
```

Request body:

```json
{
  "name": "Aarav Mehta",
  "email": "aarav@example.com",
  "company": "Mehta Legal",
  "slot_id": 12
}
```

Fields:

| Field | Type | Required | Description |
|---|---|---:|---|
| `name` | string | Yes | User name. 1 to 100 chars. |
| `email` | string | Yes | User email. 3 to 150 chars. |
| `company` | string/null | No | Company/firm name. Max 150 chars. |
| `slot_id` | integer | Yes | Selected slot id. Must be greater than 0. |

Success response:

```json
{
  "success": true,
  "booking_id": 45,
  "scheduled_at": "2026-05-07T10:00:00+05:30",
  "label": "Thu, May 7  10:00 AM - 11:00 AM",
  "message": "Your demo is confirmed for Thu, May 7  10:00 AM - 11:00 AM. We'll send details to aarav@example.com shortly!"
}
```

Slot unavailable response:

```json
{
  "success": false,
  "error": "Slot is no longer available. Please select another."
}
```

Duplicate booking response:

```json
{
  "success": false,
  "error": "A demo is already booked for this email and slot."
}
```

Validation error example:

```json
{
  "detail": [
    {
      "type": "greater_than",
      "loc": ["body", "slot_id"],
      "msg": "Input should be greater than 0"
    }
  ]
}
```

## 6. Health Check

### `GET /health`

Use this endpoint to check whether the chatbot service and database are reachable.

Request:

```http
GET {{base_url}}/health
```

Success response:

```json
{
  "status": "ok",
  "db": true,
  "service": "ai-chatbot",
  "port": 8095,
  "chatbot_module": "C:\\Users\\ADMIN\\jurinex-dev\\Backend\\ai-chatbot\\app\\services\\chatbot.py",
  "google_genai_version": "1.60.0",
  "min_live_google_genai_version": "1.60.0"
}
```

## 7. Admin Config

These endpoints are present in the backend for runtime chatbot configuration. They are not called by the app help panel or landing chatbot UI.

### `GET /api/admin/config`

Request:

```http
GET {{base_url}}/api/admin/config
```

Success response:

```json
{
  "config_key": "default",
  "model_text": "gemini-2.5-flash",
  "model_audio": "gemini-2.0-flash-live-001",
  "max_tokens": 1024,
  "temperature": 0.7,
  "top_p": 0.95,
  "top_k_results": 5,
  "voice_name": "Aoede",
  "language_code": "en-IN",
  "speaking_rate": 1.0,
  "pitch": 0.0,
  "volume_gain_db": 0.0,
  "system_prompt": "You are JuriNex AI...",
  "audio_system_prompt": "You are a voice-first JuriNex AI assistant..."
}
```

### `PUT /api/admin/config`

Use this API to update any subset of chatbot config fields.

Request:

```http
PUT {{base_url}}/api/admin/config
Content-Type: application/json
```

Request body example:

```json
{
  "model_text": "gemini-2.5-flash",
  "temperature": 0.6,
  "top_k_results": 5,
  "voice_name": "Aoede",
  "language_code": "en-IN"
}
```

Success response is the full updated config object.

No fields error:

```json
{
  "detail": "No fields provided to update"
}
```

Database unavailable error:

```json
{
  "detail": "Database not available"
}
```

Update constraints:

| Field | Type | Constraint |
|---|---|---|
| `max_tokens` | integer | 1 to 8192 |
| `temperature` | float | 0.0 to 2.0 |
| `top_p` | float | 0.0 to 1.0 |
| `top_k_results` | integer | 1 to 20 |
| `speaking_rate` | float | 0.25 to 4.0 |
| `pitch` | float | -20.0 to 20.0 |
| `volume_gain_db` | float | -96.0 to 16.0 |
| `system_prompt` | string | max 4000 chars |
| `audio_system_prompt` | string | max 4000 chars |

## Common Error Format

FastAPI validation errors use this format:

```json
{
  "detail": [
    {
      "type": "missing",
      "loc": ["body", "message"],
      "msg": "Field required"
    }
  ]
}
```

Unhandled server errors use:

```json
{
  "detail": "Internal server error"
}
```

## Postman

Collections already available in this repo:

```text
postman/JuriNex_AIChatbot_Only.postman_collection.json
postman/JuriNex_AI_Chatbot.postman_collection.json
```

Use `JuriNex_AIChatbot_Only` when testing only the `Backend/ai-chatbot` service.
