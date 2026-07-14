
import React, { useState, useEffect, useLayoutEffect, useContext, useRef, useMemo, useCallback, startTransition } from "react";
import { FileManagerContext } from "../../context/FileManagerContext";
import documentApi from "../../services/documentApi";
import { API_BASE_URL, DOCS_BASE_URL, CHAT_MODEL_BASE_URL, SECRET_PROMPTS_API_BASE, DOCUMENT_SERVICE_URL, getUserIdForDrafting } from "../../config/apiConfig";
import {
  Plus,
  Search,
  BookOpen,
  ChevronDown,
  MoreVertical,
  MessageSquare,
  Loader2,
  Send,
  Copy,
  Check,
  Square,
  Trash2,
  FileText,
  Download,
  X,
  Mic,
  MicOff,
  Sparkles,
  Settings2,
  PanelRight,
  ChevronLeft,
  Printer,
  Code,
  Pencil,
} from "lucide-react";
import { getCleanText, stripMarkdown, downloadAsPdf, downloadAsHtml, printResponse } from "../../utils/responseExportUtils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { SidebarContext } from "../../context/SidebarContext";
import DownloadPdf from "../DownloadPdf/DownloadPdf";
import BrandingDownloadModal from "../BrandingDownload/BrandingDownloadModal";
import { toast } from "react-toastify";
import "../../styles/ChatInterface.css";
import CitationsPanel from "../AnalysisPage/CitationsPanel";
import apiService from "../../services/api";
import { convertJsonToPlainText } from "../../utils/jsonToPlainText";
import { renderSecretPromptResponse, isStructuredJsonResponse } from "../../utils/renderSecretPromptResponse";
import {
  parseLlmPolicyErrorForUi,
  stringToChatErrorDisplay,
  getUserFriendlyApiErrorMessage,
} from "../../utils/llmQuotaMessages";
import { parseQuotaHttpError, createQuotaError } from "../../utils/quotaError";
import { useTokenQuota } from "../../context/TokenQuotaContext";
import ChatQuotaErrorModal from "../ChatQuotaErrorModal";
import { buildSuggestedQuestions } from "../../utils/suggestedQuestions";
import LearningChatBubble from "./LearningChatBubble";
import LearningDetailPanel from "./LearningDetailPanel";
import AgentStepsPanel from "./AgentStepsPanel";
import ChatSessionList from "./ChatSessionList";
import FormattedAssistantContent from "./FormattedAssistantContent";
import DraftStudioModal from "./DraftStudioModal";
import DraftEditModal from "./DraftEditModal";
import {
  formatChatResponseForDisplay,
  convertMarkdownBoldMarkers,
} from "../../utils/formatChatResponse";
import { useDocumentMicTranscribe } from "../../hooks/useDocumentMicTranscribe";
import PromptChipsBar from "../PromptChipsBar";
import OcrViewer from "../OcrViewer";
import { fetchSecretsList, peekSecretsList, fetchSecretById } from "../../services/secretsService";

const VIEWER_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

const detectViewerFileType = (url = "", mime = "") => {
  const normalizedMime = String(mime || "").toLowerCase();
  if (normalizedMime.includes("pdf")) return "pdf";
  if (normalizedMime.startsWith("image/")) return "image";
  if (normalizedMime.startsWith("text/") || normalizedMime.includes("json")) return "text";

  const cleanUrl = String(url || "").split("?")[0].split("#")[0];
  const extension = cleanUrl.split(".").pop()?.toLowerCase();
  if (extension) {
    if (VIEWER_IMAGE_EXTENSIONS.includes(extension)) return "image";
    if (extension === "pdf") return "pdf";
    if (["txt", "md", "json", "csv", "log"].includes(extension)) return "text";
  }
  return "other";
};

/** Full plain text for chat list preview (not a single 120-char line). */
function plainTextPreviewFromResponse(raw) {
  if (raw == null || raw === "") return "";
  try {
    // If it looks like a learning payload JSON, extract only the feedback text
    const trimmed = String(raw).trim();
    const cleaned = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    if (cleaned.startsWith('{')) {
      try {
        const parsed = JSON.parse(cleaned);
        if (parsed && typeof parsed === 'object' && ('feedback' in parsed || 'question' in parsed)) {
          const parts = [];
          if (parsed.feedback) parts.push(String(parsed.feedback).trim());
          if (parsed.content_hint) parts.push(`?? ${String(parsed.content_hint).trim()}`);
          if (parsed.question) parts.push(String(parsed.question).trim());
          return parts.join('\n\n');
        }
      } catch { /* not valid JSON */ }
    }
    let t = convertJsonToPlainText(raw);
    t = t.replace(/^#+\s*/gm, "").replace(/\*\*/g, "").trim();
    return t;
  } catch {
    return String(raw).slice(0, 2000);
  }
}

/** Extracts a learning payload object from raw LLM output (JSON or code-fenced JSON). */
function extractLearningPayloadFromRaw(raw) {
  if (!raw) return null;
  try {
    const cleaned = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    if (!cleaned.startsWith('{')) return null;
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && ('feedback' in parsed || 'question' in parsed)) {
      return parsed;
    }
  } catch { /* not JSON */ }
  return null;
}

/**
 * Same as extractLearningPayloadFromRaw but tolerates leading/trailing noise (e.g. streamed
 * whitespace or a prefix) by parsing the outermost {...} block. Needed so Learning Mode
 * keeps the structured UI instead of flashing raw markdown during SSE.
 */
function extractLearningPayloadLenient(raw) {
  if (!raw) return null;
  const strict = extractLearningPayloadFromRaw(raw);
  if (strict) return strict;
  try {
    let t = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    const parsed = JSON.parse(t.slice(start, end + 1));
    if (parsed && typeof parsed === 'object' && ('feedback' in parsed || 'question' in parsed)) {
      return parsed;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

function sourcePassagesStorageKey(folderName, messageId) {
  return `jurinex.chat.sourcePassages.v1:${String(folderName || "")}:${String(messageId ?? "")}`;
}

function saveSourcePassagesToStorage(folderName, messageId, citations) {
  try {
    if (!folderName || messageId == null) return;
    const key = sourcePassagesStorageKey(folderName, messageId);
    if (!citations?.length) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify({ citations, savedAt: Date.now() }));
  } catch (_) { }
}

function loadSourcePassagesFromStorage(folderName, messageId) {
  try {
    const raw = localStorage.getItem(sourcePassagesStorageKey(folderName, messageId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.citations) ? parsed.citations : null;
  } catch {
    return null;
  }
}

/**
 * When the model omits [1], [2], ? markers, append them to successive paragraph blocks
 * so each paragraph can show an inline link to the matching source (best-effort: order matches citation order).
 */
function injectCitationMarkersIntoParagraphs(text, maxCitations) {
  if (!text || !maxCitations) return text;
  let assigned = 0;
  return text
    .split(/(\n{2,})/g)
    .map((seg) => {
      if (/^\n{2,}$/.test(seg)) return seg;
      const t = seg.trim();
      if (!t) return seg;
      if (t.startsWith("#") || t.startsWith("|") || t.startsWith("```") || t.startsWith("<")) return seg;
      if (/\[\d+\]/.test(seg)) return seg;
      if (assigned >= maxCitations) return seg;
      assigned += 1;
      return seg.replace(/\s*$/, "") + ` [${assigned}]`;
    })
    .join("");
}































































































































































































































































































































































































































































































































































































































































































































































const ChatInterface = () => {
  const {
    selectedFolder,
    chatSessions,
    setChatSessions,
    selectedChatSessionId,
    setSelectedChatSessionId,
    setHasAiResponse,
  } = useContext(FileManagerContext);
  const { setForceSidebarCollapsed } = useContext(SidebarContext);
  const { showQuotaError } = useTokenQuota();
  const [currentChatHistory, setCurrentChatHistory] = useState([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [chatError, setChatError] = useState(null);
  const [chatInput, setChatInput] = useState("");
  // Draft-from-template: an uploaded template file (attached to the model on the next message) + its
  // upload state. The template is NOT ingested into the case RAG — it only rides the chat request.
  const [draftTemplate, setDraftTemplate] = useState(null); // { gcsPath, mimetype, filename }
  const [draftStudio, setDraftStudio] = useState(null); // { question, template, model, folderName, sessionId } | null
  const [editModal, setEditModal] = useState(null);     // { markdown, title, downloadUrl, downloadName } | null
  const [isUploadingTemplate, setIsUploadingTemplate] = useState(false);
  // Draft engine selector (shown only when a template is attached). '' = default (Gemini).
  const [draftModel, setDraftModel] = useState('');
  const [structureModel, setStructureModel] = useState(''); // Stage-A template structure model ('' = default)
  // Stage-D/E guardian: the model that AUDITS and repairs the draft the engine produced.
  // '' = server default (Opus when an Anthropic key is set, else Gemini 3.1 Pro).
  const [guardianModel, setGuardianModel] = useState('');
  const [animatedResponseContent, setAnimatedResponseContent] = useState("");
  const [thinkingContent, setThinkingContent] = useState("");
  const [currentStatus, setCurrentStatus] = useState(null);
  const [isAnimatingResponse, setIsAnimatingResponse] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState(null);
  const [hasResponse, setHasResponse] = useState(false);
  const [secrets, setSecrets] = useState([]);
  const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
  const [selectedSecretId, setSelectedSecretId] = useState(null);
  const [selectedLlmName, setSelectedLlmName] = useState(null);
  const [activeDropdown, setActiveDropdown] = useState("Custom Query");
  const [showStyleDropdown, setShowStyleDropdown] = useState(false);
  const [learningModeActive, setLearningModeActive] = useState(false);
  // Panel state ? mirrors Claude's artifact panel
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelType, setPanelType] = useState(null); // 'learning' | 'response' | 'agentic'
  const [panelData, setPanelData] = useState(null);
  const [newChatMode, setNewChatMode] = useState(false);
  const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState('');
  const [needsHorizontalScroll, setNeedsHorizontalScroll] = useState(false);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const [showCitations, setShowCitations] = useState(false);
  const [citations, setCitations] = useState([]);
  const [loadingCitations, setLoadingCitations] = useState(false);
  const [documentViewer, setDocumentViewer] = useState({ open: false, url: null, filename: null, page: null, loading: false, error: null });
  const [isSmallScreen, setIsSmallScreen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 1024;
  });
  const [openChatMenuId, setOpenChatMenuId] = useState(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionsError, setSessionsError] = useState(null);
  const [chatHistorySidebarOpen, setChatHistorySidebarOpen] = useState(true);
  // Tracks the option key the user last picked (resets when a new pending question starts)
  const [pickedOption, setPickedOption] = useState(null);

  const handleNewMessageRef = useRef(null);
  const chatBodyRefs = useRef({});
  const templateInputRef = useRef(null);
  const [chatCopySuccess, setChatCopySuccess] = useState(null);
  const [downloadModalChatId, setDownloadModalChatId] = useState(null);
  const [wordModalChatId, setWordModalChatId] = useState(null);
  const pdfExportContentRef = useRef({ current: null });
  const wordExportContentRef = useRef({ current: null });

  useLayoutEffect(() => {
    pdfExportContentRef.current.current = downloadModalChatId != null
      ? chatBodyRefs.current[downloadModalChatId] ?? null
      : null;
  }, [downloadModalChatId]);

  useLayoutEffect(() => {
    wordExportContentRef.current.current = wordModalChatId != null
      ? chatBodyRefs.current[wordModalChatId] ?? null
      : null;
  }, [wordModalChatId]);

  const onMicTranscript = useCallback((transcript) => {
    const question = String(transcript || '').trim();
    if (!question || loadingChat || isGenerating) return;
    if (isSecretPromptSelected) {
      setIsSecretPromptSelected(false);
      setActiveDropdown('Custom Query');
      setSelectedSecretId(null);
      setSelectedLlmName(null);
    }
    setChatInput('');
    handleNewMessageRef.current?.(question);
  }, [isSecretPromptSelected, loadingChat, isGenerating]);

  const onMicError = useCallback((err) => {
    toast.error(err?.message || 'Could not transcribe audio. Please try again.');
  }, []);

  const { micStatus, toggleMic, isRecording, isTranscribing } = useDocumentMicTranscribe(
    DOCUMENT_SERVICE_URL,
    { onTranscript: onMicTranscript, onError: onMicError },
  );

  const responseHasTable = useMemo(() => {
    if (!animatedResponseContent) return false;
    const htmlTablePattern = /<table/i.test(animatedResponseContent);
    const markdownTablePattern = /(^|\n)\s*\|.+\|\s*($|\n)/.test(animatedResponseContent);
    return htmlTablePattern || markdownTablePattern;
  }, [animatedResponseContent]);

  const formattedResponseContent = useMemo(() => {
    const rawResponse = animatedResponseContent || '';
    if (!rawResponse) return '';

    const clean = (text) => text
      .replace(/\|\s*\|\s*\|[\s|]*\n/g, '')
      .replace(/^\s*\|\s*[-: ]+\s*\|\s*$/gm, (m) => m);

    let text;
    if (isGenerating) {
      text = clean(convertMarkdownBoldMarkers(rawResponse));
    } else {
      text = clean(formatChatResponseForDisplay(rawResponse));
    }

    // Inline [n] ? clickable link (opens document viewer). Inject [n] per paragraph when missing.
    if (citations && citations.length > 0) {
      text = injectCitationMarkersIntoParagraphs(text, citations.length);
      text = text.replace(/\[(\d+)\]/g, (match, numStr) => {
        const n = parseInt(numStr, 10);
        if (n >= 1 && n <= citations.length) {
          const cite = citations[n - 1];
          const filenameShort = (cite.filename || "document").replace(/\.[^.]+$/, "");
          const pageBit =
            cite.pageLabel ||
            (cite.page || cite.pageStart ? `p. ${cite.page || cite.pageStart}` : "source");
          const safeTitle = `${filenameShort} ? ${pageBit}`.replace(/"/g, "&quot;");
          return (
            `<span class="inline-cite" data-n="${n}" role="link" tabindex="0" title="${safeTitle}" ` +
            `style="font-size:0.92em;color:#1d4ed8;font-weight:600;text-decoration:underline;` +
            `cursor:pointer;white-space:nowrap;margin-left:3px">[${n}]</span>`
          );
        }
        return match;
      });
    }

    return text;
  }, [animatedResponseContent, isGenerating, citations]);

  const selectedMessage = useMemo(
    () => currentChatHistory.find((msg) => msg.id === selectedMessageId) || null,
    [currentChatHistory, selectedMessageId]
  );

  const selectedMessageResponseContent = useMemo(() => {
    if (!selectedMessage) return '';
    const responseText =
      selectedMessage.response || selectedMessage.answer || selectedMessage.message || '';
    if (!responseText) return '';
    return formatChatResponseForDisplay(responseText);
  }, [selectedMessage]);

  const activeResponseContent = useMemo(
    () =>
      formattedResponseContent ||
      animatedResponseContent ||
      selectedMessageResponseContent ||
      panelData?.response ||
      '',
    [formattedResponseContent, animatedResponseContent, selectedMessageResponseContent, panelData]
  );

  const selectedMessageIsLearning = useMemo(() => {
    if (!selectedMessage) return false;
    if (selectedMessage.learning_mode || selectedMessage.learningPayload) return true;

    try {
      const raw = String(selectedMessage.response || '').trim();
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      return !!(parsed && typeof parsed === 'object' && ('feedback' in parsed || 'question' in parsed));
    } catch {
      return false;
    }
  }, [selectedMessage]);

  const suggestedQuestions = useMemo(
    () =>
      buildSuggestedQuestions({
        question: selectedMessage?.question || '',
        response: activeResponseContent || selectedMessage?.response || '',
        promptLabel: selectedMessage?.prompt_label || '',
      }),
    [selectedMessage, activeResponseContent]
  );

  const shouldShowHorizontalScrollbar = useMemo(() => {
    return isSmallScreen && responseHasTable && needsHorizontalScroll;
  }, [isSmallScreen, responseHasTable, needsHorizontalScroll]);
  const responseRef = useRef(null);
  const styleDropdownRef = useRef(null);
  const completeResponseRef = useRef(null);
  const animationFrameRef = useRef(null);
  const markdownOutputRef = useRef(null);
  const horizontalScrollRef = useRef(null);
  const stickyScrollbarRef = useRef(null);
  const streamBufferRef = useRef('');
  const streamThinkingRef = useRef('');
  const streamUpdateTimeoutRef = useRef(null);
  const streamReaderRef = useRef(null);
  const chatMenuRefs = useRef({});
  const panelStatesSetRef = useRef(false);
  const fetchedFoldersRef = useRef(new Set());
  const folderFilesCacheRef = useRef(new Map());

  const getAuthToken = () => {
    const tokenKeys = [
      "authToken",
      "token",
      "accessToken",
      "jwt",
      "bearerToken",
      "auth_token",
      "access_token",
      "api_token",
      "userToken",
    ];
    for (const key of tokenKeys) {
      const token = localStorage.getItem(key);
      if (token) return token;
    }
    return null;
  };

  // Upload a TEMPLATE to GCS for draft-from-template. Reuses the signed-URL flow (generate-upload-url
  // + PUT) but deliberately SKIPS complete-upload, so the template is NOT ingested into the case RAG —
  // it only rides the next chat message as a file the model reads directly.
  const uploadTemplate = async (file) => {
    if (!file) return;
    const folderName = _normalizeFolderName(selectedFolder);
    if (!folderName) {
      alert('Open a case first, then attach a template to draft.');
      return;
    }
    setIsUploadingTemplate(true);
    try {
      const token = getAuthToken();
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const genUrl = `${DOCS_BASE_URL}/${encodeURIComponent(folderName)}/generate-upload-url`;
      const urlResp = await fetch(genUrl, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, mimetype: file.type, size: file.size }),
      });
      if (!urlResp.ok) throw new Error(`Failed to get upload URL (${urlResp.status})`);
      const { signedUrl, gcsPath } = await urlResp.json();
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('load', () =>
          (xhr.status >= 200 && xhr.status < 300)
            ? resolve()
            : reject(new Error(`GCS upload failed (${xhr.status})`)));
        xhr.addEventListener('error', () => reject(new Error('Network error during template upload')));
        xhr.open('PUT', signedUrl);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.send(file);
      });
      // NOTE: no complete-upload on purpose — the template must never enter the RAG index.
      setDraftTemplate({ gcsPath, mimetype: file.type || 'application/pdf', filename: file.name });
    } catch (e) {
      console.error('[uploadTemplate] failed:', e);
      alert(`Template upload failed: ${e.message}`);
      setDraftTemplate(null);
    } finally {
      setIsUploadingTemplate(false);
    }
  };

  const _normalizeFolderName = (folder) =>
    typeof folder === 'string' ? folder : (folder?.originalname || folder?.name || null);

  const _citationFileId = (citation) =>
    citation?.fileId || citation?.file_id || citation?.document_id || null;

  const _citationFilename = (citation) =>
    citation?.filename || citation?.document_name || citation?.documentName || null;

  const resolveCitationFileId = async (citation) => {
    const direct = _citationFileId(citation);
    if (direct) return direct;

    const folderName = _normalizeFolderName(selectedFolder);
    const citationName = String(_citationFilename(citation) || '').trim().toLowerCase();
    if (!folderName || !citationName) return null;

    let folderFiles = folderFilesCacheRef.current.get(folderName);
    if (!Array.isArray(folderFiles)) {
      try {
        const resp = await documentApi.getDocumentsInFolder(folderName);
        folderFiles = Array.isArray(resp?.files)
          ? resp.files
          : (Array.isArray(resp?.documents) ? resp.documents : []);
        folderFilesCacheRef.current.set(folderName, folderFiles);
      } catch (err) {
        console.warn('[Citations] Failed to fetch folder files for citation resolution:', err);
        return null;
      }
    }

    const nameOf = (f) =>
      String(
        f?.originalname ||
        f?.filename ||
        f?.document_name ||
        f?.name ||
        ''
      ).trim().toLowerCase();
    const idOf = (f) => f?.id || f?.file_id || f?.fileId || null;

    const exact = folderFiles.find((f) => nameOf(f) === citationName);
    if (exact) return idOf(exact);

    const contains = folderFiles.find((f) => {
      const n = nameOf(f);
      return n && (n.includes(citationName) || citationName.includes(n));
    });
    return contains ? idOf(contains) : null;
  };

  const fetchDocumentUrl = async (fileId, pageNumber = null, token) => {
    const url = pageNumber
      ? `${DOCS_BASE_URL}/file/${fileId}/view?page=${pageNumber}`
      : `${DOCS_BASE_URL}/file/${fileId}/view`;

    console.log('[Document URL] Fetching from agentic service:', url);

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || `Failed to fetch document: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  };

  const openDocumentAtPage = async (fileId, pageNumber, filename, token) => {
    try {
      const documentData = await fetchDocumentUrl(fileId, pageNumber, token);

      const urlToOpen = documentData.viewUrlWithPage
        || (pageNumber ? `${documentData.viewUrl}#page=${pageNumber}` : documentData.viewUrl)
        || documentData.signedUrl;

      if (!urlToOpen) {
        throw new Error('No view URL available in response');
      }

      const mimeType = documentData.document?.mimetype || documentData.document?.mimeType || '';
      setDocumentViewer({
        open: true,
        url: urlToOpen,
        filename: filename || documentData.document?.name || 'Document',
        page: pageNumber,
        loading: false,
        mimeType,
        fileType: detectViewerFileType(urlToOpen, mimeType),
        ocr: documentData.ocr || null
      });
    } catch (error) {
      console.error('[Document] Error opening document:', error);
      setDocumentViewer({
        open: true,
        url: null,
        filename: filename || 'Document',
        page: pageNumber,
        loading: false,
        error: error.message || 'Failed to load document'
      });
    }
  };

  const handleCopyResponse = async () => {
    try {
      await navigator.clipboard.writeText(activeResponseContent);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
      alert("Failed to copy to clipboard");
    }
  };

  const handleSuggestedQuestionClick = (suggestion) => {
    setChatInput(suggestion);
    setIsSecretPromptSelected(false);
    setActiveDropdown("Custom Query");
    setSelectedSecretId(null);
    setSelectedLlmName(null);
  };

  const skipAnimation = () => {
    console.log('[ChatInterface] skipAnimation called');

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    let completeResponse = '';

    if (completeResponseRef.current) {
      completeResponse = completeResponseRef.current;
      console.log('[ChatInterface] skipAnimation: Found complete response in ref, length:', completeResponse.length);
    }

    if (!completeResponse && selectedMessageId) {
      const selectedMessage = currentChatHistory.find(msg => msg.id === selectedMessageId);
      if (selectedMessage) {
        const rawResponse = selectedMessage.response || selectedMessage.answer || selectedMessage.message || "";
        if (rawResponse) {
          const isStructured = isStructuredJsonResponse(rawResponse);
          completeResponse = isStructured
            ? renderSecretPromptResponse(rawResponse)
            : convertJsonToPlainText(rawResponse);
          console.log('[ChatInterface] skipAnimation: Found response in message, length:', completeResponse.length);
        }
      }
    }

    if (!completeResponse && streamBufferRef.current) {
      const rawResponse = streamBufferRef.current;
      if (rawResponse) {
        const isStructured = isStructuredJsonResponse(rawResponse);
        completeResponse = isStructured
          ? renderSecretPromptResponse(rawResponse)
          : convertJsonToPlainText(rawResponse);
        console.log('[ChatInterface] skipAnimation: Found response in streamBufferRef, length:', completeResponse.length);
      }
    }

    if (!completeResponse && formattedResponseContent) {
      completeResponse = formattedResponseContent;
      console.log('[ChatInterface] skipAnimation: Using formattedResponseContent, length:', completeResponse.length);
    }

    if (completeResponse) {
      setAnimatedResponseContent(completeResponse);
      setIsAnimatingResponse(false);
      setIsGenerating(false);
      completeResponseRef.current = null;
      console.log('[ChatInterface] skipAnimation: Animation skipped, complete response displayed');
    } else {
      console.warn('[ChatInterface] skipAnimation: No response found to skip to');
    }
  };

  useEffect(() => {
    const horizontalElement = horizontalScrollRef.current;
    const contentElement = markdownOutputRef?.current;

    if (!horizontalElement || !contentElement) return undefined;

    const updateScrollbarState = () => {
      const scrollWidth = contentElement.scrollWidth;
      const clientWidth = horizontalElement.clientWidth;
      const needsScroll = scrollWidth > clientWidth + 1;

      setNeedsHorizontalScroll(needsScroll);
      if (needsScroll) {
        setScrollbarWidth(scrollWidth);
      }
    };

    updateScrollbarState();

    const resizeObserver = new ResizeObserver(updateScrollbarState);
    resizeObserver.observe(contentElement);
    resizeObserver.observe(horizontalElement);
    window.addEventListener("resize", updateScrollbarState);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateScrollbarState);
    };
  }, [selectedMessageId, animatedResponseContent, hasResponse]);

  useEffect(() => {
    if (!needsHorizontalScroll) return undefined;

    const horizontalElement = horizontalScrollRef.current;
    const stickyElement = stickyScrollbarRef.current;

    if (!horizontalElement || !stickyElement) return undefined;

    const syncSticky = () => {
      stickyElement.scrollLeft = horizontalElement.scrollLeft;
    };

    const syncContent = () => {
      horizontalElement.scrollLeft = stickyElement.scrollLeft;
    };

    stickyElement.scrollLeft = horizontalElement.scrollLeft;
    horizontalElement.addEventListener("scroll", syncSticky);
    stickyElement.addEventListener("scroll", syncContent);

    return () => {
      horizontalElement.removeEventListener("scroll", syncSticky);
      stickyElement.removeEventListener("scroll", syncContent);
    };
  }, [needsHorizontalScroll, selectedMessageId]);

  useEffect(() => {
    const handleResize = () => {
      setIsSmallScreen(window.innerWidth < 1024);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const loadSecrets = async () => {
    const cached = peekSecretsList();
    if (cached?.length) setSecrets(cached);
    if (!cached?.length) setIsLoadingSecrets(true);
    try {
      setChatError(null);
      const secretsData = await fetchSecretsList();
      setSecrets(secretsData || []);
      setActiveDropdown("Custom Query");
      setSelectedSecretId(null);
      setSelectedLlmName(null);
      setIsSecretPromptSelected(false);
    } catch (error) {
      console.error("Error fetching secrets:", error);
      setChatError(stringToChatErrorDisplay(`Failed to load analysis prompts: ${error.message}`));
    } finally {
      setIsLoadingSecrets(false);
    }
  };

  const fetchSecretValue = async (secretId) => {
    try {
      const existingSecret = secrets.find((secret) => secret.id === secretId);
      if (existingSecret?.value) return existingSecret.value;
      const secretData = await fetchSecretById(secretId);
      const promptValue = secretData.value || secretData.prompt || secretData.content || secretData;
      setSecrets((prevSecrets) =>
        prevSecrets.map((secret) =>
          secret.id === secretId ? { ...secret, value: promptValue } : secret
        )
      );
      return promptValue || "";
    } catch (error) {
      console.error("Error fetching secret value:", error);
      throw new Error("Failed to retrieve analysis prompt");
    }
  };

  const fetchChatHistory = useCallback(async (sessionId, folderName = null) => {
    let folderToFetch = folderName;
    if (!folderToFetch) {
      if (typeof selectedFolder === 'string') {
        folderToFetch = selectedFolder;
      } else if (selectedFolder) {
        folderToFetch = selectedFolder.originalname || selectedFolder.name || null;
      }
    }
    if (!folderToFetch) {
      console.log('[ChatInterface] fetchChatHistory: No folder to fetch, returning early. selectedFolder:', selectedFolder);
      return;
    }
    if (!sessionId) {
      setCurrentChatHistory([]);
      setSelectedMessageId(null);
      setAnimatedResponseContent("");
      setIsAnimatingResponse(false);
      setIsGenerating(false);
      setHasResponse(false);
      setHasAiResponse(false);
      setForceSidebarCollapsed(false);
      return;
    }
    console.log('[ChatInterface] fetchChatHistory: Starting fetch for folder:', folderToFetch, 'sessionId:', sessionId);
    setLoadingChat(true);
    setChatError(null);
    try {
      console.log('[ChatInterface] fetchChatHistory: Calling session API...');
      const data = await documentApi.getFolderChatSessionById(folderToFetch, sessionId);
      console.log('[ChatInterface] fetchChatHistory: API response:', data);
      let chats = Array.isArray(data?.chatHistory)
        ? data.chatHistory
        : Array.isArray(data?.session?.messages)
          ? data.session.messages
          : Array.isArray(data?.messages)
            ? data.messages
            : [];

      // If messages are in raw in-memory format {role, content}, convert to {question, answer}
      if (chats.length > 0 && chats[0]?.role) {
        const pairs = [];
        for (let i = 0; i < chats.length; i++) {
          if (chats[i].role === 'user') {
            const userMsg = chats[i];
            const aiMsg = chats[i + 1]?.role === 'assistant' ? chats[i + 1] : null;
            pairs.push({
              id: userMsg.id || String(Date.now() + i),
              question: userMsg.content,
              response: aiMsg?.content || '',
              answer: aiMsg?.content || '',
              created_at: userMsg.created_at,
              citations: [],
              used_chunk_ids: [],
            });
            if (aiMsg) i++;
          }
        }
        chats = pairs;
      }
      console.log('[ChatInterface] fetchChatHistory: Parsed chats array:', chats);
      console.log('[ChatInterface] fetchChatHistory: Number of chats:', chats.length);

      const chatsWithChunks = chats.map(chat => ({
        ...chat,
        response: chat.response || chat.answer || chat.message || "",
        answer: chat.answer || chat.response || chat.message || "",
        used_chunk_ids: chat.used_chunk_ids || [],
        citations: chat.citations || null,
        chunk_details: chat.chunk_details || null,
        question: chat.question || chat.prompt_label || chat.promptLabel || chat.query || "Untitled",
        prompt_label: chat.prompt_label || chat.promptLabel || null
      }));
      console.log('[ChatInterface] fetchChatHistory: Setting currentChatHistory with', chatsWithChunks.length, 'chats');
      setCurrentChatHistory(chatsWithChunks);
      setSelectedChatSessionId(sessionId);
      // Show all messages inline in main panel ? no auto-open of split panel
      setIsAnimatingResponse(false);
      setIsGenerating(false);
      setCitations([]);
      setShowCitations(false);
      if (chatsWithChunks.length > 0) {
        const selectedChat = chatsWithChunks[chatsWithChunks.length - 1];
        setSelectedMessageId(selectedChat.id);
        setHasResponse(true);
        setHasAiResponse(true); // Hide files sidebar when loading sessions
        setForceSidebarCollapsed(true);
        setAnimatedResponseContent('');
      } else {
        setHasResponse(false);
        setHasAiResponse(false);
        setForceSidebarCollapsed(false);
      }
    } catch (err) {
      console.error("[ChatInterface] fetchChatHistory: Error fetching chats:", err);
      console.error("[ChatInterface] fetchChatHistory: Error details:", err.response?.data || err.message);
      setChatError(stringToChatErrorDisplay('Failed to fetch chat history.'));
    } finally {
      setLoadingChat(false);
      console.log('[ChatInterface] fetchChatHistory: Completed');
    }
  }, [selectedFolder]);

  useEffect(() => {
    const fetchCitations = async () => {
      const toPlainText = (v) => {
        if (v == null) return '';
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
        if (Array.isArray(v)) return v.map(toPlainText).filter(Boolean).join('');
        if (typeof v === 'object') {
          if (typeof v.text === 'string' || typeof v.text === 'number') return String(v.text);
          if (v.type && v.text != null) return toPlainText(v.text);
        }
        try { return JSON.stringify(v); } catch { return String(v); }
      };

      const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
      if (!selectedMessageId || !folderName) {
        console.log('[Citations] Missing selectedMessageId or selectedFolder:', { selectedMessageId, selectedFolder, folderName });
        setCitations([]);
        setLoadingCitations(false);
        return;
      }

      const message = currentChatHistory.find(msg => msg.id === selectedMessageId);
      console.log('[Citations] Selected message:', message);
      console.log('[Citations] Message has chunk_details:', message?.chunk_details);
      console.log('[Citations] Message has citations:', message?.citations);
      console.log('[Citations] Message has used_chunk_ids:', message?.used_chunk_ids);

      if (!message) {
        console.log('[Citations] Message not found in currentChatHistory, currentChatHistory length:', currentChatHistory.length);
        setCitations([]);
        setLoadingCitations(false);
        return;
      }

      if (message.chunk_details && Array.isArray(message.chunk_details) && message.chunk_details.length > 0) {
        console.log('[Citations] Using chunk_details from message:', message.chunk_details);
        const formattedCitations = message.chunk_details.map((chunk) => {
          const page = chunk.page || null;
          const pageLabel = chunk.page_label || (page ? `Page ${page}` : null);
          const filename = chunk.filename || 'document.pdf';
          const fileId = chunk.file_id || chunk.fileId;
          const text = toPlainText(chunk.content_preview || chunk.content || chunk.text || '');

          const source = pageLabel
            ? `${filename} - ${pageLabel}`
            : filename;

          return {
            page: page,
            pageStart: page,
            pageEnd: page,
            pageLabel: pageLabel,
            source: source,
            filename: filename,
            fileId: fileId,
            text: text,
            link: `${filename}#page=${page || 1}`,
            viewUrl: fileId ? `${DOCS_BASE_URL}/file/${fileId}/view?page=${page || 1}` : null
          };
        });
        console.log('[Citations] Formatted citations from chunk_details:', formattedCitations);
        setCitations(formattedCitations);
        saveSourcePassagesToStorage(folderName, message.id, formattedCitations);
        setLoadingCitations(false);
        return;
      }

      if (message.citations && Array.isArray(message.citations) && message.citations.length > 0) {
        console.log('[Citations] Using citations from message metadata:', message.citations);
        const formattedCitations = message.citations.map((citation) => {
          const pageStart = citation.page_start || citation.pageStart;
          const pageEnd = citation.page_end || citation.pageEnd;
          const page = citation.page || pageStart;

          let pageLabel = null;
          if (pageStart && pageEnd && pageStart !== pageEnd) {
            pageLabel = `Pages ${pageStart}-${pageEnd}`;
          } else if (page || pageStart) {
            pageLabel = `Page ${page || pageStart}`;
          }

          const source = pageLabel
            ? `${citation.filename || 'document.pdf'} - ${pageLabel}`
            : (citation.filename || 'document.pdf');

          return {
            page: page || pageStart,
            pageStart: pageStart,
            pageEnd: pageEnd,
            pageLabel: pageLabel,
            source: source,
            filename: citation.filename || citation.document_name || 'document.pdf',
            fileId: citation.fileId || citation.file_id || citation.document_id,
            text: toPlainText(citation.text || citation.content || citation.text_preview || citation.quote || ''),
            link: `${citation.filename || citation.document_name || 'document.pdf'}#page=${page || pageStart || 1}`,
            viewUrl: citation.viewUrl || ((citation.fileId || citation.file_id || citation.document_id) ? `${DOCS_BASE_URL}/file/${citation.fileId || citation.file_id || citation.document_id}/view?page=${page || pageStart || 1}` : null)
          };
        });
        console.log('[Citations] Formatted citations from metadata:', formattedCitations);
        setCitations(formattedCitations);
        saveSourcePassagesToStorage(folderName, message.id, formattedCitations);
        setLoadingCitations(false);
        return;
      }

      if (!message.used_chunk_ids || message.used_chunk_ids.length === 0) {
        console.log('[Citations] No used_chunk_ids or citations in message:', message.used_chunk_ids);
        const cached = loadSourcePassagesFromStorage(folderName, message.id);
        if (cached?.length) {
          setCitations(cached);
        } else {
          setCitations([]);
          saveSourcePassagesToStorage(folderName, message.id, []);
        }
        setShowCitations(false);
        return;
      }

      console.log('[Citations] Fetching chunks for:', message.used_chunk_ids);
      setLoadingCitations(true);
      try {
        const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
        if (!folderName) {
          console.error('[Citations] Invalid folder name:', selectedFolder);
          setCitations([]);
          setLoadingCitations(false);
          return;
        }
        const chunkDetails = await apiService.getFolderChunkDetails(message.used_chunk_ids, folderName);
        console.log('[Citations] Received chunk details:', chunkDetails);

        const formattedCitations = chunkDetails.map((chunk) => {
          let pageLabel = chunk.page_range || null;
          let page = null;
          let pageStart = null;
          let pageEnd = null;

          if (pageLabel) {
            const pageMatch = pageLabel.match(/(?:Pages? )?(\d+)(?:-(\d+))?/i);
            if (pageMatch) {
              pageStart = parseInt(pageMatch[1]);
              pageEnd = pageMatch[2] ? parseInt(pageMatch[2]) : pageStart;
              page = pageStart;

              if (pageStart === pageEnd) {
                pageLabel = `Page ${pageStart}`;
              } else {
                pageLabel = `Pages ${pageStart}-${pageEnd}`;
              }
            }
          }

          const source = pageLabel
            ? `${chunk.filename || 'document.pdf'} - ${pageLabel}`
            : (chunk.filename || 'document.pdf');

          return {
            page: page || pageStart,
            pageStart: pageStart,
            pageEnd: pageEnd,
            pageLabel: pageLabel,
            source: source,
            filename: chunk.filename || 'document.pdf',
            fileId: chunk.file_id || chunk.fileId,
            text: chunk.content || chunk.text || '',
            link: `${chunk.filename || 'document.pdf'}#page=${page || pageStart || 1}`,
            viewUrl: (chunk.file_id || chunk.fileId) ? `${DOCS_BASE_URL}/file/${chunk.file_id || chunk.fileId}/view?page=${page || pageStart || 1}` : null
          };
        });

        console.log('[Citations] Formatted citations:', formattedCitations);
        setCitations(formattedCitations);
        saveSourcePassagesToStorage(folderName, message.id, formattedCitations);
      } catch (error) {
        console.error('[Citations] Failed to fetch citations:', error);
        const cached = loadSourcePassagesFromStorage(folderName, message.id);
        if (cached?.length) {
          setCitations(cached);
        } else {
          setCitations([]);
        }
      } finally {
        setLoadingCitations(false);
      }
    };

    fetchCitations();
  }, [selectedMessageId, selectedFolder, currentChatHistory]);

  const animateResponse = (text, skipAnimation = false, isAlreadyFormatted = false) => {
    const plainText = isAlreadyFormatted ? text : convertJsonToPlainText(text);

    completeResponseRef.current = plainText;

    if (!plainText || typeof plainText !== 'string') {
      setIsAnimatingResponse(false);
      setIsGenerating(false);
      setAnimatedResponseContent(plainText || '');
      completeResponseRef.current = null;
      return;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const contentMatches = animatedResponseContent.trim() === plainText.trim() ||
      animatedResponseContent === plainText ||
      (animatedResponseContent.length > 0 && plainText.startsWith(animatedResponseContent));

    if (contentMatches && !skipAnimation) {
      setIsAnimatingResponse(false);
      setIsGenerating(false);
      if (animatedResponseContent !== plainText) {
        setAnimatedResponseContent(plainText);
      }
      return;
    }

    if (!skipAnimation && !plainText.startsWith(animatedResponseContent) && animatedResponseContent !== plainText) {
      setAnimatedResponseContent("");
    }
    setIsAnimatingResponse(!skipAnimation);
    setIsGenerating(!skipAnimation);

    const words = plainText.split(/(\s+)/);
    let currentIndex = 0;
    let displayedText = '';

    if (words.length <= 3) {
      setIsAnimatingResponse(false);
      setIsGenerating(false);
      setAnimatedResponseContent(plainText);
      return;
    }

    const animateWord = () => {
      if (currentIndex < words.length) {
        displayedText += words[currentIndex];
        setAnimatedResponseContent(displayedText);
        currentIndex++;

        if (responseRef.current) {
          responseRef.current.scrollTop = responseRef.current.scrollHeight;
        }

        const word = words[currentIndex - 1];
        let delay = 15;

        if (word.trim().length === 0) {
          delay = 3;
        } else if (word.length > 15) {
          delay = 25;
        } else if (word.length > 10) {
          delay = 20;
        } else if (/[.!?]\s*$/.test(word)) {
          delay = 40;
        } else if (/[,;:]\s*$/.test(word)) {
          delay = 20;
        } else if (/^[#*`\-]/.test(word)) {
          delay = 8;
        }

        animationFrameRef.current = setTimeout(animateWord, delay);
      } else {
        setIsAnimatingResponse(false);
        setIsGenerating(false);
        completeResponseRef.current = null;
        setAnimatedResponseContent(plainText);
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = setTimeout(animateWord, 20);
  };

  const handleStopGeneration = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamBufferRef.current) {
      const isStructured = isStructuredJsonResponse(streamBufferRef.current);
      const formattedResponse = isStructured
        ? renderSecretPromptResponse(streamBufferRef.current)
        : convertJsonToPlainText(streamBufferRef.current);
      setAnimatedResponseContent(formattedResponse);
    }
    setIsAnimatingResponse(false);
    setIsGenerating(false);
    setLoadingChat(false);
    setPendingQuestion('');
  };

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        clearTimeout(animationFrameRef.current);
      }
      if (streamReaderRef.current) {
        streamReaderRef.current.cancel().catch(() => { });
      }
      if (streamUpdateTimeoutRef.current) {
        clearTimeout(streamUpdateTimeoutRef.current);
      }
    };
  }, []);

  const extractStreamErrorMessage = async (response) => {
    const fallbackMessage = `HTTP error! status: ${response.status}`;

    try {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const payload = await response.json();
        return payload?.message || payload?.error || payload?.details || fallbackMessage;
      }

      const rawText = await response.text();
      if (!rawText) {
        return fallbackMessage;
      }

      try {
        const parsed = JSON.parse(rawText);
        return parsed?.message || parsed?.error || parsed?.details || rawText || fallbackMessage;
      } catch (parseError) {
        return rawText || fallbackMessage;
      }
    } catch (error) {
      return fallbackMessage;
    }
  };

  const chatWithAI = async (folder, secretId, currentSessionId) => {
    setAnimatedResponseContent('');
    setThinkingContent('');
    setCurrentStatus(null);
    streamBufferRef.current = '';
    streamThinkingRef.current = '';
    setChatError(null);
    setLoadingChat(true);
    setIsGenerating(true);
    setIsAnimatingResponse(false);

    if (streamReaderRef.current) {
      try {
        await streamReaderRef.current.cancel();
      } catch (e) {
      }
      streamReaderRef.current = null;
    }

    if (streamUpdateTimeoutRef.current) {
      clearTimeout(streamUpdateTimeoutRef.current);
      streamUpdateTimeoutRef.current = null;
    }

    try {
      const isContinuingSession = currentChatHistory.length > 0;
      if (!isContinuingSession && !panelStatesSetRef.current) {
        setHasResponse(true);
        setHasAiResponse(true);
        setForceSidebarCollapsed(true);
        panelStatesSetRef.current = true;
      }
      const selectedSecret = secrets.find((s) => s.id === secretId);
      if (!selectedSecret) throw new Error("No prompt found for selected analysis type");
      const promptLabel = selectedSecret.name;
      setPendingQuestion(`Analysis: ${promptLabel}`);
      // Server loads the secret body from document-service (same as SecretManager flow).
      // Do not send the full preset text in `question` ? DB and UI store the prompt name only.

      const token = getAuthToken();
      const response = await fetch(`${DOCS_BASE_URL}/${encodeURIComponent(folder)}/intelligent-chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          question: '',
          prompt_label: promptLabel,
          secret_id: secretId,
          session_id: currentSessionId,
          llm_name: 'gemini',
          learning_mode: learningModeActive,
        }),
      });

      if (!response.ok) {
        let errBody = {};
        try {
          errBody = await response.json();
        } catch {
          errBody = {};
        }
        const quota = parseQuotaHttpError(response.status, errBody);
        if (quota && showQuotaError(createQuotaError(quota, response.status))) {
          setHasResponse(false);
          setHasAiResponse(false);
          setForceSidebarCollapsed(false);
          return;
        }
        setChatError(parseLlmPolicyErrorForUi(response.status, errBody));
        setHasResponse(false);
        setHasAiResponse(false);
        setForceSidebarCollapsed(false);
        return;
      }

      const reader = response.body.getReader();
      streamReaderRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';
      let newSessionId = currentSessionId;
      let finalMetadata = null;
      let messageId = Date.now().toString();
      let streamHadError = false;
      let streamErrorMessage = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          if (streamHadError) {
            console.warn('[ChatInterface] Secret prompt stream stopped after error:', streamErrorMessage);
            setCurrentStatus(null);
            break;
          }
          setLoadingChat(false);
          const isStructured = isStructuredJsonResponse(streamBufferRef.current);
          let finalResponse = isStructured
            ? renderSecretPromptResponse(streamBufferRef.current)
            : convertJsonToPlainText(streamBufferRef.current);
          if (finalMetadata) {
            newSessionId = finalMetadata.session_id || finalMetadata.sessionId || newSessionId;
            messageId = finalMetadata.message_id || finalMetadata.id || messageId;
          }

          let usedChunkIds = finalMetadata?.used_chunk_ids || [];
          if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
            usedChunkIds = finalMetadata.citations.map(cit => cit.chunk_id || cit.id).filter(Boolean);
          }

          const newMessage = {
            id: messageId,
            question: promptLabel,
            prompt_label: promptLabel,
            response: finalResponse,
            timestamp: new Date().toISOString(),
            created_at: new Date().toISOString(),
            isSecretPrompt: true,
            used_secret_prompt: true,
            used_chunk_ids: usedChunkIds,
            citations: finalMetadata?.citations || null,
            chunk_details: finalMetadata?.chunk_details || null,
            learning_mode: !!learningModeActive,
            learningPayload: learningModeActive
              ? (finalMetadata?.learning_payload || extractLearningPayloadLenient(streamBufferRef.current) || null)
              : null,
          };
          const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
          setCurrentChatHistory(history);
          setPendingQuestion('');

          if (newSessionId) {
            setSelectedChatSessionId(newSessionId);
            fetchChatSessions().catch(() => { });
          }

          if (finalResponse && finalResponse.trim()) {
            setSelectedMessageId(messageId);
            if (!panelStatesSetRef.current) {
              setHasResponse(true);
              setHasAiResponse(true);
              setForceSidebarCollapsed(true);
              panelStatesSetRef.current = true;
            }
            if (finalResponse && finalResponse.trim()) {
              setAnimatedResponseContent(finalResponse);
              setIsAnimatingResponse(false);
              setIsGenerating(false);
            } else {
              setIsAnimatingResponse(false);
              setIsGenerating(false);
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;

          const data = line.replace(/^data: /, '').trim();

          if (data === '[PING]') {
            continue;
          }

          if (data === '[DONE]') {
            if (streamHadError) {
              console.warn('[ChatInterface] Secret prompt stream received DONE after error:', streamErrorMessage);
              setLoadingChat(false);
              setCurrentStatus(null);
              return;
            }
            setLoadingChat(false);
            const isStructured = isStructuredJsonResponse(streamBufferRef.current);
            let finalResponse = isStructured
              ? renderSecretPromptResponse(streamBufferRef.current)
              : convertJsonToPlainText(streamBufferRef.current);
            if (finalMetadata) {
              newSessionId = finalMetadata.session_id || finalMetadata.sessionId || newSessionId;
              messageId = finalMetadata.message_id || finalMetadata.id || messageId;
            }

            let usedChunkIds = finalMetadata?.used_chunk_ids || [];
            if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
              usedChunkIds = finalMetadata.citations.map(cit => cit.chunk_id || cit.id).filter(Boolean);
            }

            const newMessage = {
              id: messageId,
              question: promptLabel,
              prompt_label: promptLabel,
              response: finalResponse,
              timestamp: new Date().toISOString(),
              created_at: new Date().toISOString(),
              isSecretPrompt: true,
              used_secret_prompt: true,
              used_chunk_ids: usedChunkIds,
              citations: finalMetadata?.citations || null,
              chunk_details: finalMetadata?.chunk_details || null,
              learning_mode: !!learningModeActive,
              learningPayload: learningModeActive
                ? (finalMetadata?.learning_payload || extractLearningPayloadLenient(streamBufferRef.current) || null)
                : null,
            };
            const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
            setCurrentChatHistory(history);
            setPendingQuestion('');

            if (newSessionId) {
              setSelectedChatSessionId(newSessionId);
              fetchChatSessions().catch(() => { });
            }

            if (finalResponse && finalResponse.trim()) {
              setSelectedMessageId(messageId);
              if (!panelStatesSetRef.current) {
                setHasResponse(true);
                setHasAiResponse(true);
                setForceSidebarCollapsed(true);
                panelStatesSetRef.current = true;
              }
              if (finalResponse && finalResponse.trim()) {
                setAnimatedResponseContent(finalResponse);
                setIsAnimatingResponse(false);
                setIsGenerating(false);
              } else {
                setIsAnimatingResponse(false);
                setIsGenerating(false);
              }
            }
            return;
          }

          try {
            const parsed = JSON.parse(data);

            if (parsed.type === 'metadata') {
              console.log('Stream metadata:', parsed);
              const metaSid = parsed.session_id || parsed.sessionId;
              if (metaSid) {
                newSessionId = metaSid;
                setSelectedChatSessionId(metaSid);
              }
              messageId = parsed.message_id || parsed.id || messageId;
              if (!finalMetadata) finalMetadata = {};
              finalMetadata = { ...finalMetadata, ...parsed };
            } else if (parsed.type === 'status') {
              setCurrentStatus({
                status: parsed.status,
                message: parsed.message || parsed.status,
              });
              console.log('Status:', parsed.status, parsed.message);
            } else if (parsed.type === 'thinking') {
              const thinkingText = parsed.text || '';
              if (thinkingText) {
                streamThinkingRef.current += thinkingText;
                if (streamUpdateTimeoutRef.current) {
                  clearTimeout(streamUpdateTimeoutRef.current);
                }
                streamUpdateTimeoutRef.current = setTimeout(() => {
                  setThinkingContent(streamThinkingRef.current);
                }, 10);
              }
            } else if (parsed.type === 'chunk') {
              const chunkText = parsed.text || '';
              if (chunkText) {
                if (streamThinkingRef.current || thinkingContent) {
                  streamThinkingRef.current = '';
                  setThinkingContent('');
                }
                streamBufferRef.current += chunkText;
                setHasResponse(true);
                setHasAiResponse(true);
                if (!panelStatesSetRef.current) {
                  setForceSidebarCollapsed(true);
                  panelStatesSetRef.current = true;
                }
                const raw = streamBufferRef.current;
                const live = isStructuredJsonResponse(raw)
                  ? raw
                  : convertJsonToPlainText(raw);
                setAnimatedResponseContent(live);
                setIsGenerating(true);
                setIsAnimatingResponse(true);
              }
            } else if (parsed.type === 'done') {
              finalMetadata = { ...finalMetadata, ...parsed };
              const doneSid = finalMetadata.session_id || finalMetadata.sessionId;
              if (doneSid) {
                newSessionId = doneSid;
                setSelectedChatSessionId(doneSid);
              }
              console.log('[ChatInterface] Done metadata (secret prompt):', finalMetadata);
              console.log('[ChatInterface] used_chunk_ids:', finalMetadata?.used_chunk_ids);
              console.log('[ChatInterface] citations:', finalMetadata?.citations);
              console.log('[ChatInterface] chunk_details:', finalMetadata?.chunk_details);

              let usedChunkIds = finalMetadata?.used_chunk_ids || [];
              if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
                usedChunkIds = finalMetadata.citations.map(cit => cit.chunk_id || cit.id).filter(Boolean);
              }

              const isStructured = isStructuredJsonResponse(streamBufferRef.current);
              let finalResponse = isStructured
                ? renderSecretPromptResponse(streamBufferRef.current)
                : convertJsonToPlainText(streamBufferRef.current);
              setLoadingChat(false);
              setCurrentStatus(null);
              if (streamThinkingRef.current) {
                setThinkingContent(streamThinkingRef.current);
              }

              const resolvedMsgId = finalMetadata?.message_id || finalMetadata?.id || messageId;
              const newMessage = {
                id: resolvedMsgId,
                question: promptLabel,
                prompt_label: promptLabel,
                response: finalResponse,
                timestamp: new Date().toISOString(),
                created_at: new Date().toISOString(),
                isSecretPrompt: true,
                used_secret_prompt: true,
                used_chunk_ids: usedChunkIds,
                citations: finalMetadata?.citations || null,
                chunk_details: finalMetadata?.chunk_details || null,
                learning_mode: !!learningModeActive,
                learningPayload: learningModeActive
                  ? (finalMetadata?.learning_payload || extractLearningPayloadLenient(streamBufferRef.current) || null)
                  : null,
                draftDownloadUrl: finalMetadata?.draft_download_url || null,
                draftFilename: finalMetadata?.draft_filename || null,
              };
              const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
              setCurrentChatHistory(history);
              setPendingQuestion('');
              setSelectedMessageId(newMessage.id);
              setAnimatedResponseContent(finalResponse);
              setIsAnimatingResponse(false);
              setIsGenerating(false);
              // No auto-open panel - user manually opens split view if needed
              if (newSessionId) {
                fetchChatSessions().catch(() => { });
              }
            } else if (parsed.type === 'error') {
              streamHadError = true;
              streamErrorMessage = parsed.message || parsed.error || 'An error occurred';
              console.error('[ChatInterface] Secret prompt stream error payload:', parsed);
              setChatError(
                stringToChatErrorDisplay(
                  streamErrorMessage
                )
              );
              setCurrentStatus(null);
              setLoadingChat(false);
            }
          } catch (e) {
          }
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      if (!showQuotaError(error)) {
        setChatError(
          stringToChatErrorDisplay(
            getUserFriendlyApiErrorMessage(error, 'Analysis could not complete. Please try again.')
          )
        );
      }
      setHasResponse(false);
      setHasAiResponse(false);
      setForceSidebarCollapsed(false);
      throw error;
    } finally {
      setLoadingChat(false);
      setIsGenerating(false);
      setPendingQuestion('');
      streamReaderRef.current = null;
    }
  };

  const handleNewMessage = async (forcedQuestion = null) => {
    if (!selectedFolder) return;
    if (isSecretPromptSelected) {
      if (!selectedSecretId) {
        setChatError(stringToChatErrorDisplay('Please select an analysis type.', 'Missing selection'));
        return;
      }
      await chatWithAI(selectedFolder, selectedSecretId, selectedChatSessionId);
      setChatInput("");
      setIsSecretPromptSelected(false);
      setActiveDropdown("Custom Query");
      setSelectedSecretId(null);
      setSelectedLlmName(null);
    } else {
      const questionText = String(forcedQuestion ?? chatInput).trim();
      if (!questionText) return;

      // Draft-from-template → open the dedicated Draft Studio popup (section-by-section
      // generation + a Create button that merges into the final court-styled draft),
      // instead of streaming the draft into the shared chat panel.
      if (draftTemplate) {
        const dfName = typeof selectedFolder === 'string'
          ? selectedFolder
          : (selectedFolder?.originalname || selectedFolder?.name || null);
        if (dfName) {
          setDraftStudio({
            question: questionText,
            template: draftTemplate,
            model: draftModel,
            structureModel: structureModel,
            guardianModel: guardianModel,
            folderName: dfName,
            sessionId: selectedChatSessionId || null,
          });
          setChatInput('');
          return;
        }
      }

      setAnimatedResponseContent('');
      setThinkingContent('');
      streamBufferRef.current = '';
      streamThinkingRef.current = '';
      setChatError(null);
      setLoadingChat(true);
      setIsGenerating(true);
      setPendingQuestion(questionText);
      setPickedOption(null);
      setIsAnimatingResponse(false);
      panelStatesSetRef.current = false;

      if (streamReaderRef.current) {
        try {
          await streamReaderRef.current.cancel();
        } catch (e) {
        }
        streamReaderRef.current = null;
      }

      if (streamUpdateTimeoutRef.current) {
        clearTimeout(streamUpdateTimeoutRef.current);
        streamUpdateTimeoutRef.current = null;
      }

      const isContinuingSession = currentChatHistory.length > 0;
      if (!isContinuingSession && !panelStatesSetRef.current) {
        setHasResponse(true);
        setHasAiResponse(true);
        setForceSidebarCollapsed(true);
        panelStatesSetRef.current = true;
      }

      try {
        const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
        if (!folderName) {
          setChatError("Missing folder information.");
          setLoadingChat(false);
          setIsGenerating(false);
          return;
        }

        const token = getAuthToken();
        const response = await fetch(`${DOCS_BASE_URL}/${encodeURIComponent(folderName)}/intelligent-chat/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : '',
            'Accept': 'text/event-stream',
          },
          body: JSON.stringify({
            question: questionText,
            session_id: selectedChatSessionId || undefined,
            llm_name: 'gemini',
            learning_mode: learningModeActive,
            // Draft-from-template: when a template is attached, tell the backend to fill it from the
            // case's documents (the backend attaches the template file to the model).
            ...(draftTemplate
              ? {
                  draft_mode: true,
                  template_gcs_path: draftTemplate.gcsPath,
                  template_mimetype: draftTemplate.mimetype,
                  ...(draftModel ? { draft_model: draftModel } : {}),
                }
              : {}),
          }),
        });

        if (!response.ok) {
          let errBody = {};
          try {
            errBody = await response.json();
          } catch {
            errBody = {};
          }
          const quota2 = parseQuotaHttpError(response.status, errBody);
          if (quota2 && showQuotaError(createQuotaError(quota2, response.status))) {
            setHasResponse(false);
            setHasAiResponse(false);
            setForceSidebarCollapsed(false);
            setPendingQuestion('');
            setIsGenerating(false);
            return;
          }
          setChatError(parseLlmPolicyErrorForUi(response.status, errBody));
          setHasResponse(false);
          setHasAiResponse(false);
          setForceSidebarCollapsed(false);
          setPendingQuestion('');
          setIsGenerating(false);
          return;
        }

        const reader = response.body.getReader();
        streamReaderRef.current = reader;
        const decoder = new TextDecoder();
        let buffer = '';
        let newSessionId = selectedChatSessionId;
        let finalMetadata = null;
        let messageId = Date.now().toString();
        let streamHadError = false;
        let streamErrorMessage = '';

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            if (streamHadError) {
              console.warn('[ChatInterface] Folder chat stream stopped after error:', streamErrorMessage);
              setLoadingChat(false);
              setCurrentStatus(null);
              setChatInput(questionText);
              break;
            }
            setLoadingChat(false);
            const isStructured = isStructuredJsonResponse(streamBufferRef.current);
            let finalResponse = isStructured
              ? renderSecretPromptResponse(streamBufferRef.current)
              : convertJsonToPlainText(streamBufferRef.current);
            if (finalMetadata) {
              newSessionId = finalMetadata.session_id || finalMetadata.sessionId || newSessionId;
              messageId = finalMetadata.message_id || finalMetadata.id || messageId;
            }

            let usedChunkIds = finalMetadata?.used_chunk_ids || [];

            if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
              usedChunkIds = finalMetadata.citations
                .map(cit => cit.chunk_id || cit.id || cit.chunkId)
                .filter(Boolean);
            }

            const newMessage = {
              id: messageId,
              question: questionText,
              response: finalResponse,
              timestamp: new Date().toISOString(),
              created_at: new Date().toISOString(),
              isSecretPrompt: false,
              used_chunk_ids: usedChunkIds,
              citations: finalMetadata?.citations || null,
              learning_mode: !!learningModeActive,
              learningPayload: learningModeActive
                ? (finalMetadata?.learning_payload || extractLearningPayloadLenient(streamBufferRef.current) || null)
                : null,
            };
            const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
            setCurrentChatHistory(history);
            setPendingQuestion('');

            if (newSessionId) {
              setSelectedChatSessionId(newSessionId);
              fetchChatSessions().catch(() => { });
            }

            if (finalResponse && finalResponse.trim()) {
              setSelectedMessageId(messageId);
              if (!panelStatesSetRef.current) {
                setHasResponse(true);
                setHasAiResponse(true);
                setForceSidebarCollapsed(true);
                panelStatesSetRef.current = true;
              }
              if (finalResponse && finalResponse.trim()) {
                setAnimatedResponseContent(finalResponse);
                setIsAnimatingResponse(false);
                setIsGenerating(false);
              } else {
                setIsAnimatingResponse(false);
                setIsGenerating(false);
              }
            }
            setChatInput("");
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim() || !line.startsWith('data: ')) continue;

            const data = line.replace(/^data: /, '').trim();

            if (data === '[PING]') {
              continue;
            }

            if (data === '[DONE]') {
              if (streamHadError) {
                console.warn('[ChatInterface] Folder chat stream received DONE after error:', streamErrorMessage);
                setLoadingChat(false);
                setCurrentStatus(null);
                setChatInput(questionText);
                return;
              }
              setLoadingChat(false);
              const isStructured = isStructuredJsonResponse(streamBufferRef.current);
              let finalResponse = isStructured
                ? renderSecretPromptResponse(streamBufferRef.current)
                : convertJsonToPlainText(streamBufferRef.current);
              if (finalMetadata) {
                newSessionId = finalMetadata.session_id || finalMetadata.sessionId || newSessionId;
                messageId = finalMetadata.message_id || finalMetadata.id || messageId;
              }

              let usedChunkIds = finalMetadata?.used_chunk_ids || [];

              if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
                usedChunkIds = finalMetadata.citations
                  .map(cit => cit.chunk_id || cit.id || cit.chunkId)
                  .filter(Boolean);
                console.log('[ChatInterface] Extracted chunk IDs from citations:', usedChunkIds);
              }

              const newMessage = {
                id: messageId,
                question: questionText,
                response: finalResponse,
                timestamp: new Date().toISOString(),
                created_at: new Date().toISOString(),
                isSecretPrompt: false,
                used_chunk_ids: usedChunkIds,
                citations: finalMetadata?.citations || null,
                chunk_details: finalMetadata?.chunk_details || null,
                learning_mode: !!learningModeActive,
                learningPayload: learningModeActive
                  ? (finalMetadata?.learning_payload || extractLearningPayloadLenient(streamBufferRef.current) || null)
                  : null,
              };
              const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
              setCurrentChatHistory(history);
              setPendingQuestion('');

              if (newSessionId) {
                setSelectedChatSessionId(newSessionId);
                fetchChatSessions(); // Update session list with new session
              }

              if (finalResponse && finalResponse.trim()) {
                setSelectedMessageId(messageId);
                setHasResponse(true);
                setHasAiResponse(true);
                setForceSidebarCollapsed(true);
                setAnimatedResponseContent(finalResponse);
                setIsAnimatingResponse(false);
                setIsGenerating(false);
              }
              setChatInput("");
              return;
            }

            try {
              const parsed = JSON.parse(data);

              if (parsed.type === 'metadata') {
                console.log('Stream metadata:', parsed);
                const metaSid = parsed.session_id || parsed.sessionId;
                if (metaSid) {
                  newSessionId = metaSid;
                  setSelectedChatSessionId(metaSid);
                }
                messageId = parsed.message_id || parsed.id || messageId;
              } else if (parsed.type === 'status') {
                setCurrentStatus({
                  status: parsed.status,
                  message: parsed.message || parsed.status,
                });
                console.log('Status:', parsed.status, parsed.message);
              } else if (parsed.type === 'chunk') {
                const chunkText = parsed.text || '';
                if (chunkText) {
                  if (streamThinkingRef.current || thinkingContent) {
                    streamThinkingRef.current = '';
                    setThinkingContent('');
                  }
                  streamBufferRef.current += chunkText;
                  setHasResponse(true);
                  setHasAiResponse(true);
                  if (!panelStatesSetRef.current) {
                    setForceSidebarCollapsed(true);
                    panelStatesSetRef.current = true;
                  }
                  const raw = streamBufferRef.current;
                  const live = isStructuredJsonResponse(raw)
                    ? raw
                    : convertJsonToPlainText(raw);
                  setAnimatedResponseContent(live);
                  setIsGenerating(true);
                  setIsAnimatingResponse(true);
                }
              } else if (parsed.type === 'done') {
                finalMetadata = parsed;
                const doneSessionId = finalMetadata.session_id || finalMetadata.sessionId;
                if (doneSessionId) {
                  newSessionId = doneSessionId;
                  setSelectedChatSessionId(doneSessionId);
                }
                console.log('[ChatInterface] Final metadata received:', finalMetadata);
                console.log('[ChatInterface] used_chunk_ids:', finalMetadata?.used_chunk_ids);
                console.log('[ChatInterface] citations:', finalMetadata?.citations);
                console.log('[ChatInterface] chunk_details:', finalMetadata?.chunk_details);

                let usedChunkIds = finalMetadata?.used_chunk_ids || [];

                if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
                  usedChunkIds = finalMetadata.citations.map(cit => cit.chunk_id || cit.id).filter(Boolean);
                  console.log('[ChatInterface] Extracted chunk IDs from citations:', usedChunkIds);
                }

                if (!usedChunkIds.length && finalMetadata?.citations) {
                  const citations = Array.isArray(finalMetadata.citations)
                    ? finalMetadata.citations
                    : Object.values(finalMetadata.citations || {});
                  usedChunkIds = citations.map(cit => cit.chunk_id || cit.id).filter(Boolean);
                }

                const isStructured = isStructuredJsonResponse(streamBufferRef.current);
                let finalResponse = isStructured
                  ? renderSecretPromptResponse(streamBufferRef.current)
                  : convertJsonToPlainText(streamBufferRef.current);
                setLoadingChat(false);
                setCurrentStatus(null);
                if (streamThinkingRef.current) {
                  setThinkingContent(streamThinkingRef.current);
                }

                const newMessage = {
                  id: finalMetadata.message_id || finalMetadata.id || messageId,
                  question: questionText,
                  response: finalResponse,
                  timestamp: new Date().toISOString(),
                  created_at: new Date().toISOString(),
                  isSecretPrompt: false,
                  used_chunk_ids: usedChunkIds,
                  citations: finalMetadata?.citations || null,
                  chunk_details: finalMetadata?.chunk_details || null,
                  learning_mode: !!learningModeActive,
                  learningPayload: learningModeActive
                    ? (finalMetadata?.learning_payload || extractLearningPayloadLenient(streamBufferRef.current) || null)
                    : null,
                  draftDownloadUrl: finalMetadata?.draft_download_url || null,
                  draftFilename: finalMetadata?.draft_filename || null,
                };
                const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
                setCurrentChatHistory(history);
                setPendingQuestion('');
                setSelectedMessageId(newMessage.id);
                setAnimatedResponseContent(finalResponse);
                setIsAnimatingResponse(false);
                setIsGenerating(false);
                if (doneSessionId) {
                  fetchChatSessions();
                }
              } else if (parsed.type === 'error') {
                streamHadError = true;
                streamErrorMessage = parsed.message || parsed.error || 'An error occurred';
                console.error('[ChatInterface] Folder chat stream error payload:', parsed);
                setChatError(
                  stringToChatErrorDisplay(
                    streamErrorMessage
                  )
                );
                setCurrentStatus(null);
                setLoadingChat(false);
              }
            } catch (e) {
            }
          }
        }
      } catch (err) {
        console.error("Error sending message:", err);
        setChatError(
          stringToChatErrorDisplay(
            err.message || "Couldn't send your message. Please try again."
          )
        );
        setHasResponse(false);
        setHasAiResponse(false);
        setForceSidebarCollapsed(false);
        setPendingQuestion('');
        setIsGenerating(false);
      } finally {
        setLoadingChat(false);
        streamReaderRef.current = null;
      }
    }
  };

  useEffect(() => {
    handleNewMessageRef.current = handleNewMessage;
  }, [handleNewMessage]);

  const handleLearningOptionSelect = useCallback(async (optionText) => {
    if (!optionText || loadingChat || isGenerating) return;
    setIsSecretPromptSelected(false);
    setSelectedSecretId(null);
    setSelectedLlmName(null);
    setActiveDropdown("Custom Query");
    await handleNewMessage(String(optionText));
  }, [loadingChat, isGenerating, handleNewMessage]);

  const openPanel = useCallback((type, data) => {
    setPanelType(type);
    setPanelData(data);
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setPanelData(null);
    setPanelType(null);
  }, []);

  const handleSelectChat = (chat) => {
    console.log('[ChatInterface] handleSelectChat called with chat:', chat);
    console.log('[ChatInterface] Chat has chunk_details:', chat?.chunk_details);
    console.log('[ChatInterface] Chat has citations:', chat?.citations);
    console.log('[ChatInterface] Chat has used_chunk_ids:', chat?.used_chunk_ids);
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    const responseText = chat.response || chat.answer || chat.message || "";
    const isStructured = isStructuredJsonResponse(responseText);
    const formattedResponse = isStructured
      ? renderSecretPromptResponse(responseText)
      : convertJsonToPlainText(responseText);
    const chatIsLearning = !!(chat?.learning_mode || chat?.learningPayload);
    startTransition(() => {
      setSelectedMessageId(chat.id);
      setAnimatedResponseContent(formattedResponse);
      setIsAnimatingResponse(false);
      setIsGenerating(false);
      setHasResponse(true);
      // Don't force sidebar collapsed - only collapse if panel is already open
    });
    setCitations([]);
    setShowCitations(false);
    setLoadingCitations(true);
    if (chatIsLearning) {
      closePanel();
    }
  };

  const handleDeleteChat = async (chatId, e) => {
    if (e) {
      e.stopPropagation();
    }

    setOpenChatMenuId(null);

    const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
    if (!folderName || !chatId) {
      console.error('[ChatInterface] handleDeleteChat: Missing folderName or chatId', { selectedFolder, folderName, chatId });
      return;
    }

    if (!window.confirm('Are you sure you want to delete this chat? This action cannot be undone.')) {
      return;
    }

    try {
      setLoadingChat(true);
      setChatError(null);

      console.log('[ChatInterface] handleDeleteChat: Deleting chat', chatId, 'from folder', folderName);
      const deletePromise = documentApi.deleteSingleFolderChat(folderName, chatId);

      toast.promise(deletePromise, {
        pending: 'Deleting chat...',
        success: 'Chat deleted successfully!',
        error: {
          render({ data }) {
            const errorMessage = data?.response?.data?.error || data?.message || 'Failed to delete chat';
            return errorMessage;
          },
        },
      });

      await deletePromise;
      console.log(`? Successfully deleted chat ${chatId}`);

      setCurrentChatHistory(prev => prev.filter(chat => chat.id !== chatId));

      if (selectedMessageId === chatId) {
        setSelectedMessageId(null);
        setAnimatedResponseContent("");
        setHasResponse(false);
        setHasAiResponse(false);
        setForceSidebarCollapsed(false);
      }

      if (folderName) {
        await fetchChatHistory(null, folderName);
      }
    } catch (err) {
      console.error("? Error deleting chat:", err);
      const errorMessage = err?.response?.data?.error || err?.message || 'Failed to delete chat';
      setChatError(stringToChatErrorDisplay(errorMessage));
    } finally {
      setLoadingChat(false);
    }
  };

  const handleChatMenuToggle = (chatId, e) => {
    if (e) {
      e.stopPropagation();
    }
    setOpenChatMenuId(openChatMenuId === chatId ? null : chatId);
  };

  const handleCopyChatResponse = async (chatId, rawResponse) => {
    try {
      const text = getCleanText(chatBodyRefs.current[chatId], rawResponse);
      await navigator.clipboard.writeText(text.trim());
      setChatCopySuccess(chatId);
      setTimeout(() => setChatCopySuccess(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleDownloadChatPdf = (chatId) => {
    if (!chatBodyRefs.current[chatId]) return;
    setDownloadModalChatId(chatId);
  };

  const handleDownloadChatWord = (chatId) => {
    setWordModalChatId(chatId);
  };

  const handleNewChat = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setCurrentChatHistory([]);
    setSelectedChatSessionId(null);
    setHasResponse(false);
    setHasAiResponse(false);
    setForceSidebarCollapsed(false);
    setChatInput("");
    setSelectedMessageId(null);
    setAnimatedResponseContent("");
    setIsAnimatingResponse(false);
    setIsGenerating(false);
    setPendingQuestion('');
    setIsSecretPromptSelected(false);
    setSelectedSecretId(null);
    setSelectedLlmName(null);
    setActiveDropdown("Custom Query");
    setNewChatMode(true);
    closePanel();
  };

  const handleSelectChatSession = useCallback((sessionId) => {
    setSelectedChatSessionId(sessionId);
    setHasAiResponse(true);
    setNewChatMode(false);
  }, [setSelectedChatSessionId, setHasAiResponse]);

  const handleDeleteSession = useCallback(async (sessionId) => {
    const folderName = typeof selectedFolder === 'string'
      ? selectedFolder
      : (selectedFolder?.originalname || selectedFolder?.name || null);

    if (!folderName || !sessionId) return;
    if (!window.confirm('Are you sure you want to delete this session? This action cannot be undone.')) {
      return;
    }

    try {
      setLoadingSessions(true);
      setSessionsError(null);

      const deletePromise = documentApi.deleteFolderChatSession(folderName, sessionId);

      toast.promise(deletePromise, {
        pending: 'Deleting session...',
        success: 'Session deleted successfully!',
        error: {
          render({ data }) {
            const errorMessage = data?.response?.data?.error || data?.message || 'Failed to delete session';
            return errorMessage;
          },
        },
      });

      await deletePromise;

      setChatSessions((prev) => prev.filter((session) => session.sessionId !== sessionId));

      if (selectedChatSessionId === sessionId) {
        setSelectedChatSessionId(null);
        setCurrentChatHistory([]);
        setSelectedMessageId(null);
        setAnimatedResponseContent("");
        setHasResponse(false);
        setHasAiResponse(false);
        setForceSidebarCollapsed(false);
        closePanel();
      }
    } catch (err) {
      console.error('[ChatInterface] Error deleting session:', err);
      setSessionsError('Failed to delete session.');
    } finally {
      setLoadingSessions(false);
    }
  }, [
    selectedFolder,
    selectedChatSessionId,
    setChatSessions,
    setSelectedChatSessionId,
    setHasAiResponse,
    setForceSidebarCollapsed,
    closePanel,
  ]);

  const handleDeleteAllChats = async () => {
    if (!selectedFolder) return;

    const chatCount = selectedChatSessionId ? currentChatHistory.length : chatSessions.length;
    if (chatCount === 0) {
      toast.info("No chats to delete.");
      return;
    }

    if (!window.confirm(`Are you sure you want to delete all ${chatCount} chat(s) in this folder? This action cannot be undone.`)) {
      return;
    }

    try {
      setLoadingChat(true);
      setChatError(null);

      const deletePromise = documentApi.deleteAllFolderChats(selectedFolder);

      toast.promise(deletePromise, {
        pending: 'Deleting all chats...',
        success: `All ${chatCount} chat(s) deleted successfully!`,
        error: {
          render({ data }) {
            const errorMessage = data?.response?.data?.error || data?.message || 'Failed to delete all chats';
            return errorMessage;
          },
        },
      });

      await deletePromise;
      console.log(`? Successfully deleted all chats from folder ${selectedFolder}`);

      setCurrentChatHistory([]);
      setSelectedChatSessionId(null);
      setHasResponse(false);
      setHasAiResponse(false);
      setForceSidebarCollapsed(false);
      setSelectedMessageId(null);
      setAnimatedResponseContent("");
      setIsAnimatingResponse(false);
      setIsGenerating(false);
      setChatSessions([]);
      closePanel();

      const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
      if (folderName) {
        await fetchChatSessions(folderName);
      }
    } catch (err) {
      console.error("? Error deleting all chats:", err);
      const errorMessage = err?.response?.data?.error || err?.message || 'Failed to delete all chats';
      setChatError(stringToChatErrorDisplay(errorMessage));
    } finally {
      setLoadingChat(false);
    }
  };

  const handleDropdownSelect = async (secretName, secretId, llmName) => {
    if (loadingChat || isGenerating || isRecording || isTranscribing || !selectedFolder || !secretId) {
      return;
    }
    setActiveDropdown(secretName);
    setSelectedSecretId(secretId);
    setSelectedLlmName(llmName);
    setChatInput("");
    try {
      await chatWithAI(selectedFolder, secretId, selectedChatSessionId);
    } catch (err) {
      console.error("[ChatInterface] Prompt analysis failed:", err);
    } finally {
      setIsSecretPromptSelected(false);
      setActiveDropdown("Custom Query");
      setSelectedSecretId(null);
      setSelectedLlmName(null);
    }
  };

  const handleChatInputChange = (e) => {
    setChatInput(e.target.value);
    if (e.target.value && isSecretPromptSelected) {
      setIsSecretPromptSelected(false);
      setActiveDropdown("Custom Query");
      setSelectedSecretId(null);
      setSelectedLlmName(null);
    }
    if (!e.target.value && !isSecretPromptSelected) {
      setActiveDropdown("Custom Query");
    }
  };

  const getRelativeTime = (dateString) => {
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffInSeconds = Math.floor((now - date) / 1000);
      if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
      if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
      if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
      return `${Math.floor(diffInSeconds / 86400)}d ago`;
    } catch {
      return "Unknown time";
    }
  };

  const formatDate = (dateString) => {
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return "Invalid date";
    }
  };

  const getSessionIdFromSummary = (session) =>
    session?.sessionId || session?.session_id || session?.id || null;

  // Helper: extract raw text from rehype node children (used for option detection)
  const extractNodeText = (nodeChildren = []) => {
    return nodeChildren.map(n => {
      if (n.type === 'text') return n.value || '';
      if (n.children) return extractNodeText(n.children);
      return '';
    }).join('');
  };

  // Legal-draft line alignment (Indian court/legal format). Content-driven so it works
  // for live AND reloaded-from-history drafts: centers the ALL-CAPS document title /
  // "IN THE COURT OF" / suit-no / "IN THE MATTER OF" / VERSUS lines, right-aligns
  // trailing party-role labels ("...Plaintiff", "…LANDLORD/LESSOR"). Returns null for
  // ordinary text, so normal chat paragraphs are unaffected.
  const _draftLineAlign = (t0) => {
    const s = String(t0 || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    if (!s || s.length > 160) return null;
    if (/(\.{2,}|…)\s*["'“”]?(the\s+)?(first|second|third|1st|2nd|3rd)?\s*(plaintiff|defendant|petitioner|respondent|appellant|applicant|complainant|landlord|tenant|lessor|lessee|licensor|licensee|vendor|purchaser|party|witnesse?s?)(\s*\/\s*[a-z]+)?["'“”]?\.?$/i.test(s)) return 'right';
    if (/^(versus|vs\.?|v\/s\.?)$/i.test(s)) return 'center';
    if (/^in the (court|high court|hon.?ble|matter of)\b/i.test(s)) return 'center';
    if (s.length < 90 && /\b(suit|petition|application|appeal|complaint|case|criminal|civil|writ|misc)\s*(no\.?|number)\b/i.test(s)) return 'center';
    if (/^[A-Z][A-Z0-9 ,.'&()\/-]*\b(AGREEMENT|DEED|PLAINT|PETITION|AFFIDAVIT|WILL|TESTAMENT|MEMORANDUM|SUIT|APPLICATION|NOTICE|CONTRACT|VAKALATNAMA|INDENTURE|LEASE|CONVEYANCE|BOND|UNDERTAKING)\b/.test(s.split(/\(/)[0].trim())) return 'center';
    if (/^\(\s*(to be (executed|stamped|typed)|on (a )?non-judicial|stamp paper)/i.test(s)) return 'center';
    return null;
  };

  // Shared ReactMarkdown component overrides ? clean serif style matching the site theme.
  // ? Option paragraphs (A) ? D)) ? interactive clickable choice cards
  // ? Bold text ? site teal, no chip
  // ? Questions (ending with ?) ? bold body text (no callout box)
  const aiMarkdownComponents = {
    p: ({ node, children, ...props }) => {
      const rawText = extractNodeText(node?.children || []);

      // ?? Option card detection: "A) ?", "B) ?", "C) ?", "D) ?" (or A. B. C. D.)
      const optionMatch = rawText.match(/^([A-Da-d])[).]\s+/);
      if (optionMatch) {
        const letter = optionMatch[1].toUpperCase();
        const optKey = `opt-${letter}`;
        const isPicked = pickedOption === optKey;
        const disabled = loadingChat || isGenerating;

        return (
          <div
            onClick={() => {
              if (disabled) return;
              setPickedOption(optKey);
              handleLearningOptionSelect(rawText);
            }}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              padding: '13px 18px',
              margin: '8px 0',
              background: isPicked ? '#f0fdfa' : '#fafafa',
              border: `1.5px solid ${isPicked ? '#21C1B6' : '#e2e8f0'}`,
              borderRadius: '12px',
              cursor: disabled ? 'default' : 'pointer',
              transition: 'all 0.18s ease',
              boxShadow: isPicked ? '0 0 0 3px rgba(33,193,182,0.15)' : 'none',
              opacity: disabled ? 0.7 : 1,
            }}
            onMouseEnter={e => { if (!disabled && !isPicked) e.currentTarget.style.borderColor = '#21C1B6'; }}
            onMouseLeave={e => { if (!disabled && !isPicked) e.currentTarget.style.borderColor = '#e2e8f0'; }}
          >
            {/* Letter badge */}
            <span style={{
              minWidth: '32px', height: '32px',
              borderRadius: '50%',
              background: isPicked ? '#21C1B6' : '#fff',
              border: `2px solid ${isPicked ? '#21C1B6' : '#cbd5e1'}`,
              color: isPicked ? '#fff' : '#64748b',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: '14px', flexShrink: 0,
              transition: 'all 0.18s ease',
            }}>
              {isPicked ? '?' : letter}
            </span>
            {/* Option content */}
            <span style={{
              flex: 1, fontSize: '15px', lineHeight: '1.65',
              fontFamily: 'Inter, system-ui, sans-serif',
              color: isPicked ? '#0f766e' : '#1a1a1a',
              fontWeight: isPicked ? 600 : 400,
            }}>
              {children}
            </span>
          </div>
        );
      }

      // ?? Question paragraph (ends with ?)
      const isQuestion = (() => {
        const last = node?.children?.[node.children.length - 1];
        const text = last?.value || extractNodeText(last?.children || []);
        return text.trimEnd().endsWith('?');
      })();
      if (isQuestion) {
        return (
          <p style={{
            margin: '0 0 14px',
            fontWeight: 600,
            color: '#1a1a1a',
            fontSize: '15px',
            lineHeight: '1.75',
            fontFamily: 'Inter, system-ui, sans-serif',
          }} {...props}>
            {children}
          </p>
        );
      }

      // ? Normal paragraph (legal-draft lines get court alignment; ordinary text stays left)
      return (
        <p style={{
          margin: '0 0 14px',
          fontSize: '15px',
          lineHeight: '1.75',
          color: '#232323',
          fontFamily: 'Inter, system-ui, sans-serif',
          textAlign: _draftLineAlign(rawText) || undefined,
        }} {...props}>
          {children}
        </p>
      );
    },

    strong: ({ children, ...props }) => (
      <strong style={{ fontWeight: 700, color: '#0f766e' }} {...props}>{children}</strong>
    ),
    h1: ({ node, ...p }) => <h1 style={{ fontSize: '20px', fontWeight: 700, margin: '20px 0 8px', color: '#111', fontFamily: 'Inter, system-ui, sans-serif', textAlign: _draftLineAlign(extractNodeText(node?.children || [])) || undefined }} {...p} />,
    h2: ({ node, ...p }) => <h2 style={{ fontSize: '17px', fontWeight: 700, margin: '16px 0 6px', color: '#111', fontFamily: 'Inter, system-ui, sans-serif', textAlign: _draftLineAlign(extractNodeText(node?.children || [])) || undefined }} {...p} />,
    h3: ({ node, ...p }) => <h3 style={{ fontSize: '15px', fontWeight: 700, margin: '14px 0 4px', color: '#222', fontFamily: 'Inter, system-ui, sans-serif', textAlign: _draftLineAlign(extractNodeText(node?.children || [])) || undefined }} {...p} />,
    blockquote: (p) => (
      <blockquote style={{
        margin: '14px 0 16px', padding: '6px 0 6px 14px',
        borderLeft: '3px solid #21C1B6', background: '#f0fdfa',
        color: '#134e4a', fontStyle: 'italic', borderRadius: '0 6px 6px 0',
        fontSize: '14px', lineHeight: '1.65', fontFamily: 'Inter, system-ui, sans-serif',
      }} {...p} />
    ),
    ul: (p) => <ul style={{ margin: '0 0 14px', paddingLeft: '22px' }} {...p} />,
    ol: (p) => <ol style={{ margin: '0 0 14px', paddingLeft: '22px' }} {...p} />,
    li: (p) => <li style={{ marginBottom: '6px', fontSize: '15px', lineHeight: '1.65', fontFamily: 'Inter, system-ui, sans-serif' }} {...p} />,
    hr: (p) => <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '16px 0' }} {...p} />,
    table: ({ children, ...props }) => (
      <div style={{ overflowX: 'auto', margin: '18px 0', WebkitOverflowScrolling: 'touch' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '17px',
            lineHeight: '1.5',
            fontFamily: '"Crimson Text", "Times New Roman", Times, serif',
          }}
          {...props}
        >
          {children}
        </table>
      </div>
    ),
    thead: (p) => <thead style={{ background: '#f8fafc' }} {...p} />,
    tbody: (p) => <tbody {...p} />,
    tr: (p) => <tr style={{ borderBottom: '1px solid #e2e8f0' }} {...p} />,
    th: (p) => (
      <th
        style={{
          border: '1px solid #cbd5e1',
          padding: '10px 12px',
          textAlign: 'left',
          fontWeight: 700,
          color: '#0f172a',
        }}
        {...p}
      />
    ),
    td: (p) => (
      <td
        style={{
          border: '1px solid #e2e8f0',
          padding: '10px 12px',
          verticalAlign: 'top',
          color: '#1e293b',
        }}
        {...p}
      />
    ),
    code: ({ node, inline, children, ...props }) =>
      inline ? (
        <code style={{
          background: '#f0fdfa', border: '1px solid #99f6e4',
          borderRadius: '5px', padding: '2px 6px', fontSize: '14px',
          color: '#0f766e', fontFamily: '"IBM Plex Mono", "Courier New", monospace',
        }} {...props}>{children}</code>
      ) : (
        <code {...props}>{children}</code>
      ),
  };

  const normalizeSessionSummary = (session) => {
    const messages = Array.isArray(session?.messages)
      ? session.messages
      : Array.isArray(session?.chatHistory)
        ? session.chatHistory
        : [];
    const firstMessage = messages[0] || {};
    const lastMessage = messages[messages.length - 1] || {};
    const derivedTitle =
      session?.title ||
      session?.name ||
      session?.question ||
      firstMessage?.question ||
      firstMessage?.prompt_label ||
      firstMessage?.query ||
      "Untitled session";

    return {
      ...session,
      sessionId: getSessionIdFromSummary(session),
      messages,
      title: String(derivedTitle).trim(),
      lastMessageAt:
        session?.updated_at ||
        session?.updatedAt ||
        lastMessage?.updated_at ||
        lastMessage?.created_at ||
        lastMessage?.timestamp ||
        firstMessage?.created_at ||
        session?.created_at ||
        null,
    };
  };

  const fetchChatSessions = useCallback(async (folderName = null) => {
    let folderToFetch = folderName;
    if (!folderToFetch) {
      if (typeof selectedFolder === 'string') {
        folderToFetch = selectedFolder;
      } else if (selectedFolder) {
        folderToFetch = selectedFolder.originalname || selectedFolder.name || null;
      }
    }
    if (!folderToFetch) {
      setChatSessions([]);
      return;
    }

    setLoadingSessions(true);
    setSessionsError(null);
    try {
      // Use getFolderChats which returns persisted history from the database
      const data = await documentApi.getFolderChats(folderToFetch);
      const sessions = Array.isArray(data?.chats)
        ? data.chats.map(normalizeSessionSummary)
        : Array.isArray(data)
          ? data.map(normalizeSessionSummary)
          : [];
      setChatSessions(sessions);
    } catch (err) {
      console.error('[ChatInterface] Failed to fetch chat sessions:', err);
      setSessionsError('Failed to fetch chat sessions.');
      setChatSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  }, [selectedFolder, setChatSessions]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (styleDropdownRef.current && !styleDropdownRef.current.contains(event.target)) {
        setShowStyleDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openChatMenuId && chatMenuRefs.current[openChatMenuId]) {
        if (!chatMenuRefs.current[openChatMenuId].contains(event.target)) {
          setOpenChatMenuId(null);
        }
      }
    };

    if (openChatMenuId) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [openChatMenuId]);

  useEffect(() => {
    loadSecrets();
  }, []);

  // Auto-scroll when a new prompt starts or when chat history updates with a response.
  useEffect(() => {
    if (responseRef.current && pendingQuestion) {
      setTimeout(() => {
        if (responseRef.current) {
          responseRef.current.scrollTop = responseRef.current.scrollHeight;
        }
      }, 50);
    }
  }, [pendingQuestion]);

  useEffect(() => {
    if (responseRef.current && currentChatHistory.length > 0) {
      setTimeout(() => {
        if (responseRef.current) {
          responseRef.current.scrollTop = responseRef.current.scrollHeight;
        }
      }, 50);
    }
  }, [currentChatHistory.length]);

  useEffect(() => {
    console.log('[ChatInterface] useEffect triggered, selectedFolder:', selectedFolder);
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setChatSessions([]);
    setSelectedChatSessionId(null);
    setHasResponse(false);
    setHasAiResponse(false);
    setForceSidebarCollapsed(false);
    setAnimatedResponseContent("");
    setPendingQuestion('');
    setIsGenerating(false);
    setSelectedMessageId(null);
    setIsAnimatingResponse(false);
    setActiveDropdown("Custom Query");
    setSelectedSecretId(null);
    setSelectedLlmName(null);
    setIsSecretPromptSelected(false);
    setChatInput("");

    const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
    if (folderName) {
      const folderKey = `${folderName}`;
      fetchedFoldersRef.current.delete(folderKey);
      fetchedFoldersRef.current.add(folderKey);
      fetchChatSessions(folderName).catch(err => {
        console.error('[ChatInterface] Error in fetchChatSessions:', err);
        fetchedFoldersRef.current.delete(folderKey);
        setChatSessions([]);
      });
    } else {
      console.log('[ChatInterface] Skipping fetchChatSessions - folder is:', selectedFolder);
      if (selectedFolder === null || selectedFolder === undefined) {
        console.log('[ChatInterface] selectedFolder is null/undefined - will fetch sessions when folder is set');
      } else {
        fetchedFoldersRef.current.clear();
        setCurrentChatHistory([]);
      }
    }
  }, [selectedFolder, fetchChatSessions, setChatSessions]);

  useEffect(() => {
    const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
    if (!folderName || !selectedChatSessionId) {
      setCurrentChatHistory([]);
      return;
    }
    fetchChatHistory(selectedChatSessionId, folderName).catch((err) => {
      console.error('[ChatInterface] Error loading selected session:', err);
    });
  }, [selectedFolder, selectedChatSessionId, fetchChatHistory]);

  useEffect(() => {
    setHasAiResponse(panelOpen);
  }, [panelOpen, setHasAiResponse]);

  // Clear newChatMode once a session becomes active
  useEffect(() => {
    if (selectedChatSessionId) setNewChatMode(false);
  }, [selectedChatSessionId]);

  // Must run before any conditional return ? same hook order when folder is null vs set.
  const threadUsesLearningLayout = useMemo(
    () =>
      learningModeActive ||
      (Array.isArray(currentChatHistory) && currentChatHistory.some((c) => !!c.learning_mode)),
    [learningModeActive, currentChatHistory]
  );

  if (!selectedFolder) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-white gap-3">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#f0fdfb' }}>
          <MessageSquare className="w-7 h-7" style={{ color: '#21C1B6' }} />
        </div>
        <p className="text-gray-500 text-sm font-medium">Select a folder to start chatting</p>
        <p className="text-gray-400 text-xs">Choose a case folder from the sidebar</p>
      </div>
    );
  }

  const buttonClass = isGenerating
    ? "p-2.5 bg-gray-500 hover:bg-gray-600 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-full transition-colors"
    : "p-2.5 bg-[#21C1B6] hover:bg-[#1AA49B] disabled:bg-gray-300 disabled:cursor-not-allowed rounded-full transition-colors";

  // ?? Pagination helpers ??????????????????????????????????????????????????????
  const paginateContent = (text) => {
    const raw = text || '';
    const hasInlineCiteHtml = /class\s*=\s*["'][^"']*inline-cite/.test(raw);
    const normalized = (hasInlineCiteHtml ? raw : convertJsonToPlainText(raw)).replace(/\r\n/g, '\n').trim();
    if (!normalized) return [''];
    const explicitPages = normalized
      .split(/\n\s*(?:\f|---\s*PAGE BREAK\s*---|PAGE_BREAK|PAGE BREAK)\s*\n/gi)
      .map(c => c.trim())
      .filter(Boolean);
    if (explicitPages.length > 1) return explicitPages;
    const blocks = normalized.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
    const pages = [];
    let currentBlocks = [];
    let currentWeight = 0;
    const maxWeight = 2900;
    blocks.forEach(block => {
      const isHeading = /^#{1,6}\s/.test(block) || /^<h[1-6][\s>]/i.test(block);
      const isCode = /^```/.test(block) || /^<pre/i.test(block);
      const weight = Math.max(180, block.length + (isHeading ? 240 : 0) + (isCode ? 280 : 0));
      if (currentBlocks.length && currentWeight + weight > maxWeight) {
        pages.push(currentBlocks.join('\n\n'));
        currentBlocks = [];
        currentWeight = 0;
      }
      currentBlocks.push(block);
      currentWeight += weight;
    });
    if (currentBlocks.length) pages.push(currentBlocks.join('\n\n'));
    return pages.length ? pages : [''];
  };

  // ????????????????????????????????????????????????????????????????????????????
  // showMainArea: show the messages+input panel only when actively chatting
  const hasSessions = chatSessions && chatSessions.length > 0;
  const showMainArea = !!(selectedChatSessionId || pendingQuestion || hasResponse || loadingChat || !hasSessions || newChatMode);

  /** Normal mode: wider reading column; learning mode stays compact. */
  const messagesColumnMaxWidth = threadUsesLearningLayout ? '620px' : 'min(880px, 100%)';

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden relative" style={{ background: '#fff' }}>
      <ChatQuotaErrorModal
        error={chatError}
        onDismiss={() => setChatError(null)}
        onTopupSuccess={() => setChatError(null)}
      />

      {/* ?? Chat Session Sidebar (Left) ? full list or collapsed rail ?? */}
      {hasSessions && chatHistorySidebarOpen && (
        <div
          className={`flex-shrink-0 flex flex-col border-r border-gray-100 ${!showMainArea ? 'flex-1' : ''}`}
          style={{ width: showMainArea ? '272px' : undefined, height: '100%', background: '#fafafa' }}
        >
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2" style={{ background: '#fff' }}>
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2 min-w-0">
              <MessageSquare className="w-3.5 h-3.5 text-[#21C1B6] flex-shrink-0" />
              <span className="truncate">Chat History</span>
            </h3>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                type="button"
                onClick={handleNewChat}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
                style={{ background: '#21C1B6' }}
                title="Start New Chat"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Chat</span>
              </button>
              {showMainArea && (
                <button
                  type="button"
                  onClick={() => setChatHistorySidebarOpen(false)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
                  title="Hide chat history"
                  aria-label="Hide chat history"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 scrollbar-custom">
            {loadingSessions ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-[#21C1B6]" />
              </div>
            ) : sessionsError ? (
              <div className="px-3 py-4 text-xs text-red-500 text-center">{sessionsError}</div>
            ) : (
              <ChatSessionList
                sessions={chatSessions}
                selectedSessionId={selectedChatSessionId}
                onSelectSession={handleSelectChatSession}
                onDeleteSession={handleDeleteSession}
              />
            )}
          </div>
        </div>
      )}
      {hasSessions && !chatHistorySidebarOpen && showMainArea && (
        <div className="flex-shrink-0 flex flex-col items-center border-r border-gray-100 bg-white w-10 py-3 gap-2">
          <button
            type="button"
            onClick={() => setChatHistorySidebarOpen(true)}
            className="p-2 rounded-xl hover:bg-gray-50 text-gray-400 hover:text-[#21C1B6] transition-colors"
            title="Show chat history"
            aria-label="Show chat history"
          >
            <MessageSquare className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ?? MAIN CONTENT AREA (messages + input) ? only when actively chatting ?? */}
      {showMainArea && <div className="flex flex-1 min-w-0 h-full overflow-hidden relative bg-white">
        {/* Chat message panel (60% or 100% of available space) */}
        <div style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
          background: '#ffffff'
        }}>

          {/* top bar */}
          <div className="flex items-center justify-between px-5 py-2.5 border-b border-gray-100 flex-shrink-0 bg-white">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: '#21C1B6' }} />
              <span className="text-xs font-semibold text-gray-600 truncate">
                {selectedChatSessionId ? (chatSessions.find(s => s.sessionId === selectedChatSessionId)?.title || "Active Chat") : "New Conversation"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {(chatSessions.length > 0 || currentChatHistory.length > 0) && (
                <button onClick={handleDeleteAllChats} disabled={loadingChat} title="Clear all"
                  className="p-1.5 rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Messages Area */}
          <div
            className={`flex-1 overflow-y-auto py-8 scrollbar-custom bg-white ${threadUsesLearningLayout ? 'px-5 sm:px-6' : 'px-8'}`}
            ref={responseRef}
          >
            <div style={{
              maxWidth: messagesColumnMaxWidth,
              margin: '0 auto',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '32px',
            }}
            >
              {!selectedChatSessionId && !pendingQuestion ? (
                <div className="flex flex-col items-center justify-center h-full text-center pt-20">
                  <div className="w-16 h-16 bg-[#F0FDF9] rounded-2xl flex items-center justify-center mb-4">
                    <MessageSquare className="h-8 w-8 text-[#21C1B6]" />
                  </div>
                  <h2 className="text-xl font-bold text-gray-800 mb-2">How can I help you today?</h2>
                  <p className="text-gray-500 text-sm max-w-sm mx-auto">
                    Ask a question above to start a new analysis session or select an existing one from the history.
                  </p>
                </div>
              ) : (loadingChat && currentChatHistory.length === 0) ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-7 w-7 animate-spin text-[#21C1B6]" />
                </div>
              ) : (currentChatHistory.length === 0 && !pendingQuestion) ? (
                <div className="flex flex-col items-center justify-center h-full text-center pt-20">
                  <MessageSquare className="h-10 w-10 mb-3 text-gray-200" />
                  <p className="text-gray-400 text-sm">This session has no messages yet</p>
                </div>
              ) : (
                <>
                  {currentChatHistory.map((chat, idx) => {
                    let resolvedPayload = chat.learningPayload || null;
                    if (!resolvedPayload && (learningModeActive || chat.learning_mode)) {
                      const raw = String(chat.response || '').trim();
                      resolvedPayload =
                        extractLearningPayloadLenient(raw) ||
                        extractLearningPayloadFromRaw(raw) ||
                        null;
                      if (!resolvedPayload) {
                        try {
                          const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
                          const parsed = JSON.parse(cleaned);
                          if (parsed && typeof parsed === 'object' && ('feedback' in parsed || 'question' in parsed)) {
                            resolvedPayload = parsed;
                          }
                        } catch { /* not JSON */ }
                      }
                    }
                    const isLearning = !!(learningModeActive || chat.learning_mode);

                    return (
                      <div key={chat.id != null ? `${String(chat.id)}-${idx}` : `chat-${idx}`} className="flex flex-col gap-3">
                        {/* User question ? same card layout as AI response */}
                        <div className="chat-thread-card chat-thread-card--user">
                          <div className="chat-thread-card__label">You</div>
                          <div className="chat-thread-card__body">
                            {(chat.used_secret_prompt || chat.isSecretPrompt) && (chat.prompt_label || chat.promptLabel)
                              ? `Analysis: ${chat.prompt_label || chat.promptLabel}`
                              : (chat.question || chat.prompt_label || chat.promptLabel || chat.query || "Untitled")}
                          </div>
                        </div>

                        {/* AI response */}
                        {(chat.response || ((loadingChat || isGenerating) && !pendingQuestion && idx === currentChatHistory.length - 1)) && (
                          isLearning ? (
                            <div style={{ display: 'flex', justifyContent: 'flex-start', width: '100%' }}>
                              <div style={{ width: '100%', padding: '4px 0' }}>
                                {(loadingChat || isGenerating) && idx === currentChatHistory.length - 1 && !resolvedPayload && !pendingQuestion ? (
                                  <div className="flex items-center gap-2 text-gray-500 text-sm">
                                    <Loader2 className="h-4 w-4 animate-spin text-[#21C1B6]" />
                                    <span style={{ whiteSpace: 'pre-wrap' }}>{(thinkingContent && thinkingContent.trim().split('\n').filter(Boolean).slice(-1)[0]) || 'Thinking...'}</span>
                                  </div>
                                ) : resolvedPayload ? (
                                  <LearningChatBubble
                                    data={resolvedPayload}
                                    isStreaming={(loadingChat || isGenerating) && idx === currentChatHistory.length - 1 && !pendingQuestion}
                                    optionsInteractionLocked={idx !== currentChatHistory.length - 1}
                                    onOptionClick={handleLearningOptionSelect}
                                    onViewFull={null}
                                  />
                                ) : (
                                  <FormattedAssistantContent raw={chat.response} markdownComponents={aiMarkdownComponents} />
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="chat-thread-card">
                              <div className="chat-thread-card__label">Assistant</div>
                              {!chat.response ? (
                                <div className="flex items-center gap-2 text-gray-500 text-sm py-4 px-5">
                                  <Loader2 className="h-4 w-4 animate-spin text-[#21C1B6]" />
                                  <span style={{ whiteSpace: 'pre-wrap' }}>{(thinkingContent && thinkingContent.trim().split('\n').filter(Boolean).slice(-1)[0]) || 'Thinking...'}</span>
                                </div>
                              ) : (
                                <>
                                  <div
                                    className="chat-thread-card__body"
                                    ref={el => { if (el) chatBodyRefs.current[chat.id] = el; else delete chatBodyRefs.current[chat.id]; }}
                                  >
                                    <FormattedAssistantContent raw={chat.response} markdownComponents={aiMarkdownComponents} />
                                  </div>
                                  <div className="chat-thread-card__footer">
                                    {chat.draftDownloadUrl && (
                                      <a
                                        href={chat.draftDownloadUrl}
                                        download={chat.draftFilename || 'draft.docx'}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 p-1 px-2 text-[11px] font-semibold text-white bg-[#21C1B6] border border-[#21C1B6] rounded hover:bg-[#1aa79d] transition-colors cursor-pointer"
                                        title="Download the court-formatted draft (Word .docx) — Times New Roman, A4, 1 inch margins"
                                      >
                                        <Download className="h-3 w-3" />
                                        Download draft (.docx)
                                      </a>
                                    )}
                                    <button
                                      onClick={() => handleCopyChatResponse(chat.id, chat.response)}
                                      className="inline-flex items-center gap-1 p-1 px-2 text-[11px] font-medium text-gray-500 border border-gray-200 rounded hover:bg-gray-50 hover:text-gray-700 transition-colors cursor-pointer"
                                      title="Copy response"
                                    >
                                      <Copy className="h-3 w-3" />
                                      {chatCopySuccess === chat.id ? 'Copied!' : 'Copy'}
                                    </button>
                                    <button
                                      onClick={() => handleDownloadChatPdf(chat.id)}
                                      className="inline-flex items-center gap-1 p-1 px-2 text-[11px] font-medium text-gray-500 border border-gray-200 rounded hover:bg-gray-50 hover:text-gray-700 transition-colors cursor-pointer"
                                      title="Download as PDF"
                                    >
                                      <Download className="h-3 w-3" />
                                      PDF
                                    </button>
                                    <button
                                      onClick={() => handleDownloadChatWord(chat.id)}
                                      className="inline-flex items-center gap-1 p-1 px-2 text-[11px] font-medium text-gray-500 border border-gray-200 rounded hover:bg-gray-50 hover:text-gray-700 transition-colors cursor-pointer"
                                      title="Download as Word"
                                    >
                                      <FileText className="h-3 w-3" />
                                      Word
                                    </button>
                                    <button
                                      onClick={() => downloadAsHtml(chatBodyRefs.current[chat.id], `AI_Response_${new Date().toISOString().slice(0, 10)}.html`)}
                                      className="inline-flex items-center gap-1 p-1 px-2 text-[11px] font-medium text-gray-500 border border-gray-200 rounded hover:bg-gray-50 hover:text-gray-700 transition-colors cursor-pointer"
                                      title="Download as HTML"
                                    >
                                      <Code className="h-3 w-3" />
                                      HTML
                                    </button>
                                    <button
                                      onClick={() => printResponse(chatBodyRefs.current[chat.id])}
                                      className="inline-flex items-center gap-1 p-1 px-2 text-[11px] font-medium text-gray-500 border border-gray-200 rounded hover:bg-gray-50 hover:text-gray-700 transition-colors cursor-pointer"
                                      title="Print response"
                                    >
                                      <Printer className="h-3 w-3" />
                                      Print
                                    </button>
                                    <button
                                      onClick={() => setEditModal({
                                        markdown: chat.response || '',
                                        title: (chat.draftFilename ? chat.draftFilename.replace(/\.[^.]+$/, '') : 'Draft'),
                                        downloadUrl: chat.draftDownloadUrl || null,
                                        downloadName: chat.draftFilename || null,
                                      })}
                                      className="inline-flex items-center gap-1 p-1 px-2 text-[11px] font-semibold text-[#0d9488] border border-[#9fe6df] bg-[#f0fdfa] rounded hover:bg-[#ccfbf1] transition-colors cursor-pointer"
                                      title="Edit this response in the rich editor"
                                    >
                                      <Pencil className="h-3 w-3" />
                                      Edit
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          )
                        )}

                        {/* Menu */}
                        {(
                          <div className="mt-1 flex justify-end">
                            <div className="relative" ref={(el) => (chatMenuRefs.current[chat.id] = el)}>
                              <button onClick={(e) => handleChatMenuToggle(chat.id, e)} className="p-1 text-gray-300 hover:text-gray-500 transition-colors">
                                <MoreVertical className="h-3.5 w-3.5" />
                              </button>
                              {openChatMenuId === chat.id && (
                                <div className="absolute right-0 bottom-6 w-36 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                                  <button onClick={(e) => handleDeleteChat(chat.id, e)} className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 rounded-lg">
                                    <Trash2 className="w-4 h-4" /> Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Pending Question */}
                  {pendingQuestion && (
                    <div className="flex flex-col gap-3">
                      <div className="chat-thread-card chat-thread-card--user">
                        <div className="chat-thread-card__label">You</div>
                        <div className="chat-thread-card__body">{pendingQuestion}</div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        {learningModeActive ? (
                          <div style={{ width: '100%', maxWidth: '560px', margin: '0 auto' }}>
                            {(() => {
                              const livePayload =
                                extractLearningPayloadLenient(animatedResponseContent) ||
                                extractLearningPayloadFromRaw(animatedResponseContent);
                              if (livePayload) {
                                return (
                                  <LearningChatBubble
                                    data={livePayload}
                                    isStreaming={loadingChat || isGenerating}
                                    optionsInteractionLocked={false}
                                    onOptionClick={handleLearningOptionSelect}
                                    onViewFull={null}
                                  />
                                );
                              }
                              if (loadingChat || isGenerating) {
                                return (
                                  <div className="flex items-center gap-2 text-gray-500 text-sm">
                                    <Loader2 className="h-4 w-4 animate-spin text-[#21C1B6]" />
                                    <span style={{ whiteSpace: 'pre-wrap' }}>{(thinkingContent && thinkingContent.trim().split('\n').filter(Boolean).slice(-1)[0]) || 'Thinking...'}</span>
                                  </div>
                                );
                              }
                              if (animatedResponseContent) {
                                return (
                                  <FormattedAssistantContent raw={animatedResponseContent} markdownComponents={aiMarkdownComponents} />
                                );
                              }
                              return (
                                <div className="flex items-center gap-2 text-gray-500 text-sm">
                                  <Loader2 className="h-4 w-4 animate-spin text-[#21C1B6]" />
                                  <span style={{ whiteSpace: 'pre-wrap' }}>{(thinkingContent && thinkingContent.trim().split('\n').filter(Boolean).slice(-1)[0]) || 'Thinking...'}</span>
                                </div>
                              );
                            })()}
                          </div>
                        ) : (
                          <div style={{ maxWidth: '100%', margin: '0 auto', width: '100%', fontSize: '16px', lineHeight: '1.65', color: '#111827', fontFamily: 'Inter, system-ui, sans-serif' }}>
                            {animatedResponseContent ? (
                              <FormattedAssistantContent raw={animatedResponseContent} markdownComponents={aiMarkdownComponents} />
                            ) : (
                              <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
                                <Loader2 className="h-4 w-4 animate-spin text-[#21C1B6]" />
                                <span style={{ whiteSpace: 'pre-wrap' }}>{(thinkingContent && thinkingContent.trim().split('\n').filter(Boolean).slice(-1)[0]) || 'Thinking...'}</span>
                              </div>
                            )}
                            {isGenerating && <span className="inline-block w-0.5 h-4 bg-gray-500 ml-1 animate-pulse" />}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

            </div>
          </div>

          {/* Input Area */}
          <div className="flex-shrink-0 border-t border-gray-100 px-3 py-3" style={{ background: '#f8fafc' }}>
            {/* Voice session status bar */}
            {(isRecording || isTranscribing) && (
              <div className={`flex items-center gap-2 px-3 py-1.5 mb-2 rounded-xl text-xs font-medium
                ${isRecording ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-teal-50 text-teal-700 border border-teal-100'}`}>
                {isRecording && <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />}
                {isRecording ? 'Recording - tap mic when done speaking' : 'Transcribing and sending your message...'}
              </div>
            )}
            {(isLoadingSecrets || secrets.length > 0) && (
              <PromptChipsBar
                secrets={secrets}
                isLoading={isLoadingSecrets}
                selectedSecretId={selectedSecretId}
                activeLabel={isSecretPromptSelected ? activeDropdown : null}
                onSelect={(s) => handleDropdownSelect(s.name, s.id, s.llm_name)}
                disabled={loadingChat || isRecording || isTranscribing}
                className="mb-1"
              />
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (isGenerating) handleStopGeneration();
                else handleNewMessage().catch(console.error);
              }}
              className="flex items-center gap-2 bg-white rounded-2xl border border-gray-200 px-3 py-2.5 shadow-sm"
              style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
            >
              <div className="relative flex-shrink-0" ref={styleDropdownRef}>
                <button
                  type="button"
                  onClick={() => setShowStyleDropdown(!showStyleDropdown)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-gray-600 bg-gray-50 border border-gray-200 rounded-xl hover:border-[#21C1B6] hover:text-[#21C1B6] transition-colors"
                  title="Mode settings"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  {learningModeActive ? (
                    <Sparkles className="h-3.5 w-3.5 text-[#21C1B6]" />
                  ) : (
                    <MessageSquare className="h-3.5 w-3.5 text-[#21C1B6]" />
                  )}
                </button>
                {showStyleDropdown && (
                  <div className="absolute bottom-full left-0 mb-2 w-44 bg-white border border-gray-100 rounded-2xl shadow-xl z-20 overflow-hidden py-1">
                    <button
                      type="button"
                      onClick={() => { setLearningModeActive(false); setShowStyleDropdown(false); closePanel(); }}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      <span className="flex items-center gap-2">
                        <MessageSquare className="h-3.5 w-3.5 text-[#21C1B6]" />
                        Normal
                      </span>
                      {!learningModeActive && <Check className="h-3.5 w-3.5 text-[#21C1B6]" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setLearningModeActive(true); setShowStyleDropdown(false); }}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      <span className="flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 text-[#21C1B6]" />
                        Learning
                      </span>
                      {learningModeActive && <Check className="h-3.5 w-3.5 text-[#21C1B6]" />}
                    </button>
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="w-px h-5 bg-gray-200 flex-shrink-0" />

              <button
                type="button"
                onClick={toggleMic}
                disabled={loadingChat || isTranscribing || !_normalizeFolderName(selectedFolder)}
                className={`relative flex-shrink-0 p-2 rounded-xl transition-all duration-200
                  ${isRecording
                    ? 'text-white shadow-md scale-110'
                    : 'text-[#21C1B6] hover:bg-teal-50 disabled:opacity-40 disabled:cursor-not-allowed'
                  }`}
                style={isRecording ? { background: '#ef4444' } : {}}
                title={isRecording ? 'Stop recording ? your words will be sent to chat' : isTranscribing ? 'Transcribing and sending...' : 'Voice input (Google Speech-to-Text)'}
              >
                {isTranscribing
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : isRecording
                    ? <MicOff className="h-4 w-4" />
                    : <Mic className="h-4 w-4" />
                }
                {isRecording && (
                  <span className="absolute inset-0 rounded-xl animate-ping bg-red-400 opacity-40 pointer-events-none" />
                )}
              </button>

              {/* Draft from template: fill an uploaded template from this case's documents */}
              <input
                ref={templateInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.doc,.docx,.txt"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadTemplate(f); e.target.value = ''; }}
              />
              {draftTemplate ? (
                <>
                  <span className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-full bg-teal-50 text-[#0f766e] text-xs font-medium max-w-[170px]">
                    <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">{draftTemplate.filename}</span>
                    <button type="button" onClick={() => setDraftTemplate(null)} className="flex-shrink-0 hover:text-red-600" title="Remove template">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                  <select
                    value={draftModel}
                    onChange={(e) => setDraftModel(e.target.value)}
                    title="Draft engine — which AI model writes the draft"
                    className="flex-shrink-0 text-xs rounded-lg border border-gray-200 bg-white text-gray-700 px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-[#21C1B6] cursor-pointer"
                  >
                    <option value="">Gemini (default)</option>
                    <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    <option value="claude-opus-4-8">Claude Opus</option>
                    <option value="claude-sonnet-5">Claude Sonnet</option>
                    <option value="gemma-4-31b-it">Gemma 4 31B</option>
                    <option value="gemma-4-26b-a4b-it">Gemma 4 26B</option>
                  </select>
                  <select
                    value={structureModel}
                    onChange={(e) => setStructureModel(e.target.value)}
                    title="Structure model (Stage A) — analyses the template layout into sections"
                    className="flex-shrink-0 text-xs rounded-lg border border-gray-200 bg-white text-gray-700 px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-[#21C1B6] cursor-pointer"
                  >
                    <option value="">Structure: Gemini 3.1 Pro (default)</option>
                    <option value="gemini-3.5-flash">Structure: Gemini 3.5 Flash</option>
                    <option value="gemini-2.5-flash">Structure: Gemini 2.5 Flash</option>
                    <option value="claude-opus-4-8">Structure: Claude Opus</option>
                    <option value="claude-sonnet-5">Structure: Claude Sonnet</option>
                    <option value="gemma-4-31b-it">Structure: Gemma 4 31B</option>
                    <option value="gemma-4-26b-a4b-it">Structure: Gemma 4 26B</option>
                  </select>
                  <select
                    value={guardianModel}
                    onChange={(e) => setGuardianModel(e.target.value)}
                    title="Guardian (Stage D/E) — audits the finished draft against the case facts, repairs flagged sections and recovers unfilled slots. This model is billed on every draft."
                    className="flex-shrink-0 text-xs rounded-lg border border-gray-200 bg-white text-gray-700 px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-[#21C1B6] cursor-pointer"
                  >
                    <option value="">Guardian: auto (default)</option>
                    <option value="claude-opus-4-8">Guardian: Claude Opus</option>
                    <option value="claude-sonnet-5">Guardian: Claude Sonnet</option>
                    <option value="gemini-3.1-pro-preview">Guardian: Gemini 3.1 Pro</option>
                    <option value="gemini-2.5-flash">Guardian: Gemini 2.5 Flash</option>
                    <option value="gemma-4-31b-it">Guardian: Gemma 4 31B</option>
                    <option value="gemma-4-26b-a4b-it">Guardian: Gemma 4 26B</option>
                  </select>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => templateInputRef.current?.click()}
                  disabled={isUploadingTemplate || !_normalizeFolderName(selectedFolder)}
                  title="Draft from template — fill an uploaded template from this case's documents"
                  className="flex-shrink-0 p-2 rounded-xl text-[#21C1B6] hover:bg-teal-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isUploadingTemplate ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                </button>
              )}

              <input
                type="text"
                value={chatInput}
                onChange={handleChatInputChange}
                placeholder={isSecretPromptSelected ? `Analysis: ${activeDropdown}` : "How can I help you today?"}
                className="flex-grow bg-transparent border-none outline-none text-gray-800 text-sm py-1 min-w-0 placeholder-gray-400"
                disabled={loadingChat || isRecording || isTranscribing}
              />
              <button
                type="submit"
                disabled={!isGenerating && (loadingChat || isRecording || isTranscribing || (!chatInput.trim() && !isSecretPromptSelected))}
                className="flex-shrink-0 p-2 text-white rounded-xl transition-all disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: (!isGenerating && (loadingChat || (!chatInput.trim() && !isSecretPromptSelected))) ? '#d1d5db' : '#21C1B6' }}
                title={isGenerating ? "Stop" : loadingChat ? "Sending?" : "Send"}
              >
                {isGenerating ? (
                  <X className="h-4 w-4" />
                ) : loadingChat ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </form>
          </div>
        </div>
        {hasResponse && showCitations && (
          <div className="absolute" style={{ right: '16px', top: '16px', bottom: '16px', width: '380px', zIndex: 50 }}>
            <CitationsPanel
              citations={citations || []}
              folderName={selectedFolder}
              onClose={() => setShowCitations(false)}
              onCitationClick={async (citation) => {
                const page = citation.page || citation.pageStart || 1;
                const fileId = await resolveCitationFileId(citation);

                if (!fileId) {
                  console.error('[Citations] Invalid citation: missing fileId', citation);
                  toast.error('Document link is not available for this citation.');
                  return;
                }

                console.log(`[Citations] Opening: ${fileId}, page ${page}`);

                setDocumentViewer({
                  open: true,
                  url: null,
                  filename: citation.filename || 'Document',
                  page: page,
                  loading: true
                });

                try {
                  const token = getAuthToken();
                  await openDocumentAtPage(fileId, page, citation.filename, token);
                } catch (error) {
                  console.error('[Citations] Error fetching document:', error);
                  setDocumentViewer({
                    open: true,
                    url: null,
                    filename: citation.filename || 'Document',
                    page: page,
                    loading: false,
                    error: error.message || 'Failed to load document'
                  });
                }
              }}
            />
          </div>
        )}

        {documentViewer.open && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-white"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setDocumentViewer({ open: false, url: null, filename: null, page: null, loading: false, error: null });
              }
            }}
          >
            <div className="bg-white rounded-lg shadow-2xl w-[95vw] h-[95vh] flex flex-col border border-gray-200" style={{ maxWidth: '1400px' }}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-blue-600" />
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{documentViewer.filename}</h3>
                    {documentViewer.page && (
                      <p className="text-sm text-gray-500">Page {documentViewer.page}</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setDocumentViewer({ open: false, url: null, filename: null, page: null, loading: false, error: null })}
                  className="p-2 hover:bg-gray-200 rounded-md transition-colors"
                  aria-label="Close document viewer"
                >
                  <X className="h-5 w-5 text-gray-600" />
                </button>
              </div>

              <div className="flex-1 overflow-hidden bg-white relative">
                {documentViewer.loading ? (
                  <div className="flex flex-col items-center justify-center h-full">
                    <div className="animate-spin h-10 w-10 border-4 border-gray-200 border-t-blue-600 rounded-full mb-4"></div>
                    <p className="text-gray-600">Loading document...</p>
                  </div>
                ) : documentViewer.error ? (
                  <div className="flex flex-col items-center justify-center h-full p-6">
                    <div className="text-red-500 mb-4">
                      <FileText className="h-12 w-12 mx-auto mb-2" />
                      <p className="text-lg font-semibold">Failed to load document</p>
                    </div>
                    <p className="text-gray-600 text-center mb-4">{documentViewer.error}</p>
                    <button
                      onClick={() => setDocumentViewer({ open: false, url: null, filename: null, page: null, loading: false, error: null })}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                    >
                      Close
                    </button>
                  </div>
                ) : documentViewer.url ? (
                  <OcrViewer
                    fileType={documentViewer.fileType || detectViewerFileType(documentViewer.url, documentViewer.mimeType)}
                    fileUrl={documentViewer.url}
                    ocrStructure={documentViewer.ocr}
                    ocrText={documentViewer.ocr?.extractedText}
                    filename={documentViewer.filename || 'Document'}
                    className="h-full"
                    onError={(message) => setDocumentViewer((prev) => ({ ...prev, error: message || 'Failed to load document' }))}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full">
                    <p className="text-gray-600">No document URL available</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Crimson+Text:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700&family=Inter:wght@100..900&display=swap');

        .scrollbar-custom::-webkit-scrollbar {
          width: 8px;
        }
        .scrollbar-custom::-webkit-scrollbar-track {
          background: #f1f1f1;
          border-radius: 4px;
        }
        .scrollbar-custom::-webkit-scrollbar-thumb {
          background: #a0aec0;
          border-radius: 4px;
        }
        .scrollbar-custom::-webkit-scrollbar-thumb:hover {
          background: #718096;
        }

        .horizontal-scroll-container {
          overflow-x: auto;
          overflow-y: hidden;
          scrollbar-width: none;
        }

        .horizontal-scroll-container::-webkit-scrollbar {
          display: none;
        }

        :global(.analysis-page-ai-response) {
          font-family: "Crimson Text", Georgia, "Times New Roman", serif !important;
          font-size: 22px;
          line-height: 1.8;
          color: #111;
        }

        :global(.response-content h2) {
          font-size: 1.75rem;
          font-weight: 700;
          color: #1a202c;
          margin-top: 2rem;
          margin-bottom: 1rem;
        }

        :global(.response-content h3) {
          font-size: 1.4rem;
          font-weight: 600;
          color: #1a202c;
          margin-top: 1.5rem;
          margin-bottom: 0.75rem;
        }

        :global(.response-content p) {
          margin-bottom: 1rem;
          font-size: 20px;
          line-height: 1.8;
          color: #111827;
        }

        :global(.analysis-table) {
          width: 100%;
          border-collapse: collapse;
          margin: 1.5rem 0;
          font-family: "Inter", sans-serif;
          font-size: 17px;
          background-color: #ffffff;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
          overflow: hidden;
        }

        :global(.analysis-table thead) {
          background-color: #f9fafb;
        }

        :global(.analysis-table th) {
          padding: 0.9rem 1rem;
          border: 1px solid #e5e7eb;
          font-weight: 600;
          color: #374151;
          font-size: 16px;
          text-align: left;
          background-color: #f3f4f6;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        :global(.analysis-table td) {
          padding: 0.8rem 1rem;
          border: 1px solid #e5e7eb;
          color: #111827;
          vertical-align: middle;
          background-color: #ffffff;
          transition: background-color 0.2s ease-in-out;
          font-size: 16px;
        }

        :global(.analysis-table tbody tr:nth-child(even) td) {
          background-color: #fafafa;
        }

        :global(.analysis-table tbody tr:hover td) {
          background-color: #f1f5f9;
        }

        :global(.analysis-table tr:first-child th:first-child) {
          border-top-left-radius: 8px;
        }
        :global(.analysis-table tr:first-child th:last-child) {
          border-top-right-radius: 8px;
        }
        :global(.analysis-table tr:last-child td:first-child) {
          border-bottom-left-radius: 8px;
        }
        :global(.analysis-table tr:last-child td:last-child) {
          border-bottom-right-radius: 8px;
        }

        :global(.prose table),
        :global(.prose th),
        :global(.prose td) {
          font-family: "Crimson Text", Georgia, "Times New Roman", serif !important;
        }

        :global(.prose table) {
          font-size: 20px !important;
        }

        :global(.prose th) {
          font-size: 18px !important;
          font-weight: 600 !important;
        }

        :global(.prose td) {
          font-size: 18px !important;
        }

        :global(.analysis-table-wrapper) {
          overflow-x: auto;
          margin: 1rem 0;
          border-radius: 8px;
        }

        :global(.analysis-table td span) {
          display: inline-block;
          background-color: #fef2f2;
          color: #b91c1c;
          padding: 3px 8px;
          border-radius: 6px;
          font-weight: 500;
          font-size: 14px;
          line-height: 1.3;
        }

        :global(.response-content ul),
        :global(.response-content ol) {
          margin: 12px 0;
          padding-left: 28px;
          font-family: "Crimson Text", Georgia, "Times New Roman", serif;
          font-size: 20px;
        }

        :global(.response-content li) {
          margin: 8px 0;
          line-height: 1.8;
          font-size: 20px;
        }

        :global(.response-content strong) {
          font-weight: 700;
          color: #111827;
        }

        :global(.response-content code) {
          background-color: #f3f4f6;
          color: #dc2626;
          padding: 3px 8px;
          border-radius: 4px;
          font-family: 'Courier New', monospace;
          font-size: 16px;
        }

        :global(.response-content pre) {
          background-color: #1f2937;
          color: #f9fafb;
          padding: 20px;
          border-radius: 8px;
          overflow-x: auto;
          margin: 20px 0;
          font-family: 'Courier New', monospace;
          font-size: 15px;
        }

        :global(.response-content pre code) {
          background-color: transparent;
          color: #f9fafb;
          padding: 0;
        }

        :global(.response-content blockquote) {
          border-left: 4px solid #3b82f6;
          padding: 12px 16px;
          margin: 16px 0;
          background-color: #eff6ff;
          color: #1e40af;
          font-style: italic;
          border-radius: 0 6px 6px 0;
        }

        :global(.response-content a) {
          color: #2563eb;
          text-decoration: underline;
          font-weight: 500;
        }

        :global(.response-content hr) {
          border: none;
          border-top: 2px solid #e5e7eb;
          margin: 24px 0;
        }

        @keyframes statusSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }

        .inline-cite {
          display: inline-block;
          color: #1d4ed8;
          cursor: pointer;
          font-size: 10.5px;
          font-weight: 700;
          font-family: Inter, sans-serif;
          margin-left: 2px;
          padding: 0 3px;
          border-radius: 3px;
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          vertical-align: super;
          line-height: 1.2;
          transition: background 0.15s, color 0.15s;
          user-select: none;
        }
        .inline-cite:hover {
          background: #dbeafe;
          color: #1e40af;
        }
        .inline-cite .inline-cite-page {
          font-weight: 500;
          font-size: 9px;
          color: #1e3a8a;
          margin-left: 2px;
        }
      `}</style>
      </div>}

      <BrandingDownloadModal
        isOpen={downloadModalChatId != null}
        onClose={() => setDownloadModalChatId(null)}
        contentRef={pdfExportContentRef.current}
        filename={`AI_Response_${new Date().toISOString().slice(0, 10)}.pdf`}
        format="pdf"
        module="chat"
      />
      <BrandingDownloadModal
        isOpen={wordModalChatId != null}
        onClose={() => setWordModalChatId(null)}
        contentRef={wordExportContentRef.current}
        filename={`AI_Response_${new Date().toISOString().slice(0, 10)}.docx`}
        format="word"
        module="chat"
      />
      {draftStudio && (
        <DraftStudioModal
          open={!!draftStudio}
          onClose={() => setDraftStudio(null)}
          baseUrl={DOCS_BASE_URL}
          folderName={draftStudio.folderName}
          question={draftStudio.question}
          template={draftStudio.template}
          draftModel={draftStudio.model}
          structureModel={draftStudio.structureModel}
          guardianModel={draftStudio.guardianModel}
          sessionId={draftStudio.sessionId}
          authToken={getAuthToken()}
          onSaved={(sid) => {
            // The draft was persisted server-side — refresh the chat thread so it shows
            // up in this session's history (the backend may have created a new session).
            const resolved = sid || draftStudio.sessionId;
            if (resolved) fetchChatHistory(resolved, draftStudio.folderName);
          }}
        />
      )}

      {editModal && (
        <DraftEditModal
          open
          onClose={() => setEditModal(null)}
          initialMarkdown={editModal.markdown}
          title={editModal.title}
          baseUrl={DOCS_BASE_URL}
          folderName={_normalizeFolderName(selectedFolder)}
          sessionId={selectedChatSessionId}
          authToken={getAuthToken()}
          downloadUrl={editModal.downloadUrl}
          downloadName={editModal.downloadName}
          onSaved={(sid) => {
            const resolved = sid || selectedChatSessionId;
            if (resolved) fetchChatHistory(resolved, _normalizeFolderName(selectedFolder));
          }}
        />
      )}
    </div>
  );
};

export default ChatInterface;
