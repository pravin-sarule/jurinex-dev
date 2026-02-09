# Agent Architecture - Google ADK Integration

## Overview

All agents in the JuriNex system are managed through the **ADKClient**, which provides a unified interface for both tool-based agents and LLM-powered agents using **Google ADK (Gemini)**.

## Agent Types

### 1. Tool-Based Agents (No LLM)

These agents perform deterministic operations and don't require LLM capabilities:

#### **Ingestion Agent**
- **Purpose**: Convert uploaded documents into searchable text and vector data
- **Implementation**: Python pipeline
- **Operations**:
  - Upload to Google Cloud Storage
  - Extract text using Document AI (OCR)
  - Chunk text for retrieval
  - Generate embeddings
  - Store in PostgreSQL database
- **Google ADK Usage**: ❌ Not needed (pure data pipeline)
- **Mode**: `use_local_ingestion=True` (default)

#### **Librarian Agent**
- **Purpose**: Retrieve relevant document chunks via vector search
- **Implementation**: Python retrieval pipeline
- **Operations**:
  - Embed user query
  - Perform vector similarity search
  - Return top-k relevant chunks
- **Google ADK Usage**: ❌ Not needed (pure retrieval)
- **Mode**: `use_local_librarian=True` (default)

### 2. LLM-Powered Agents (Google ADK)

These agents use **Google's Gemini model** via ADK for intelligent content generation and analysis:

#### **Drafter Agent** 🤖
- **Purpose**: Generate legal draft documents from retrieved context
- **Implementation**: Google ADK with Gemini
- **Model**: `gemini-2.5-pro` (configurable)
- **System Prompt**: `/instructions/drafter.txt`
- **Operations**:
  - Receive relevant chunks from Librarian
  - Draft legal document section-by-section
  - Maintain template structure
  - Apply legal writing style
- **Google ADK Usage**: ✅ **YES** - Uses Gemini LLM
- **Mode**: `use_local_drafter=False` (default)

#### **Critic Agent** 🤖
- **Purpose**: Validate drafts for legal correctness and completeness
- **Implementation**: Google ADK with Gemini
- **Model**: `gemini-2.5-pro` (configurable)
- **System Prompt**: `/instructions/critic.txt`
- **Operations**:
  - Review draft text
  - Identify contradictions and missing clauses
  - Check compliance requirements
  - Return validation issues list
- **Google ADK Usage**: ✅ **YES** - Uses Gemini LLM
- **Mode**: `use_local_critic=False` (default)

#### **Assembler Agent** 🤖
- **Purpose**: Assemble final document with proper formatting
- **Implementation**: Google ADK with Gemini
- **Model**: `gemini-2.5-pro` (configurable)
- **System Prompt**: `/instructions/assembler.txt`
- **Operations**:
  - Fetch HTML/CSS template from database
  - Convert draft to TipTap-compatible structure
  - Inject content into template
  - Output formatted document (HTML or TipTap JSON)
- **Google ADK Usage**: ✅ **YES** - Uses Gemini LLM
- **Mode**: `use_local_assembler=False` (default)

## Google ADK Configuration

### Requirements

```bash
pip install google-genai
```

### API Key Setup

Set your Google API key in `.env`:

```env
GOOGLE_API_KEY=your_gemini_api_key_here
```

Or use environment variable:

```bash
export GOOGLE_API_KEY=your_gemini_api_key_here
```

### ADKClient Initialization

```python
from services.adk_client import ADKClient, ADKAgentConfig

# Initialize with Google API key
client = ADKClient(
    api_key=os.getenv("GOOGLE_API_KEY"),
    use_local_ingestion=True,    # Use Python pipeline (recommended)
    use_local_librarian=True,    # Use Python retrieval (recommended)
    use_local_drafter=False,     # Use Google ADK/Gemini ✅
    use_local_critic=False,      # Use Google ADK/Gemini ✅
    use_local_assembler=False,   # Use Google ADK/Gemini ✅
)

# Create agents with instructions
for agent_name in ["drafter", "critic", "assembler"]:
    system_prompt = load_prompt(agent_name)  # From instructions/*.txt
    client.create_agent(
        ADKAgentConfig(
            name=agent_name,
            system_prompt=system_prompt,
            model="gemini-2.5-pro"  # Or gemini-1.5-flash for faster/cheaper
        )
    )
```

### Running Agents

```python
# Tool-based agents (local)
ingestion_result = client.run_agent("ingestion", {
    "user_id": "123",
    "file_content": base64_file,
    "originalname": "document.pdf"
})

librarian_result = client.run_agent("librarian", {
    "user_id": "123",
    "query": "relevant case law",
    "top_k": 10
})

# LLM-powered agents (Google ADK/Gemini)
draft_result = client.run_agent("drafter", {
    "chunks": librarian_result["chunks"],
    "embeddings": librarian_result["embeddings"]
})

critic_result = client.run_agent("critic", {
    "draft": draft_result["draft"]
})

assembler_result = client.run_agent("assembler", {
    "draft": draft_result["draft"],
    "template_html": "<html>...</html>"
})
```

## Agent Flow

```
User Upload → Ingestion (Python) → PostgreSQL Database
                                        ↓
User Query → Librarian (Python) → Retrieved Chunks
                                        ↓
                               Drafter (Gemini ADK) → Draft
                                        ↓
                               Critic (Gemini ADK) → Validation
                                        ↓
                               Assembler (Gemini ADK) → Final Document
```

## Model Selection

You can configure different Gemini models for different agents:

- **`gemini-2.5-pro`**: Most capable, best for complex legal drafting
- **`gemini-1.5-pro`**: Balanced performance and cost
- **`gemini-1.5-flash`**: Faster and cheaper, good for validation tasks

Example:

```python
# Use pro for drafting, flash for validation
client.create_agent(ADKAgentConfig(
    name="drafter",
    system_prompt=drafter_prompt,
    model="gemini-2.5-pro"  # Best quality
))

client.create_agent(ADKAgentConfig(
    name="critic",
    system_prompt=critic_prompt,
    model="gemini-1.5-flash"  # Faster validation
))
```

## Testing Mode

For testing without API calls, enable local mode for all agents:

```python
client = ADKClient(
    use_local_ingestion=True,
    use_local_librarian=True,
    use_local_drafter=True,      # Mock drafter
    use_local_critic=True,       # Mock critic
    use_local_assembler=True,    # Mock assembler
)
```

Or use the `MockADKClient` from `main.py`:

```bash
JURYNEX_MODE=mock python main.py
```

## Cost Optimization

To minimize Google API costs:

1. **Use local agents** for ingestion and librarian (already default)
2. **Choose appropriate models**: Use flash models for simpler tasks
3. **Implement caching**: Cache system prompts and frequent queries
4. **Batch operations**: Process multiple drafts in sequence
5. **Set token limits**: Configure max output tokens per agent

## Error Handling

All agents raise `ADKClientError` for failures:

```python
from services.adk_client import ADKClientError

try:
    result = client.run_agent("drafter", payload)
except ADKClientError as e:
    logger.error(f"Agent failed: {e}")
    # Handle error (retry, fallback, etc.)
```

## System Prompts

Each agent's behavior is defined by its system prompt in `/instructions/{agent_name}.txt`:

- `instructions/drafter.txt` - Legal drafting instructions
- `instructions/critic.txt` - Validation criteria
- `instructions/assembler.txt` - Formatting requirements

Modify these files to customize agent behavior without changing code.

## Summary

| Agent | Google ADK | Model | Purpose |
|-------|-----------|-------|---------|
| **Ingestion** | ❌ No | Python Pipeline | Upload & process documents |
| **Librarian** | ❌ No | Python Retrieval | Search & retrieve chunks |
| **Drafter** | ✅ **YES** | Gemini 2.5 Pro | Generate legal drafts |
| **Critic** | ✅ **YES** | Gemini 2.5 Pro | Validate drafts |
| **Assembler** | ✅ **YES** | Gemini 2.5 Pro | Format final documents |

**Three agents use Google ADK/Gemini** for intelligent legal document processing! 🚀
