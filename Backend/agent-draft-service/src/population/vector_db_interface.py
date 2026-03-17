"""
VectorDBInterface: A dictionary-backed, fuzzy-search wrapper that simulates
a vector database for development/testing.

Swap the backend later for Pinecone, ChromaDB, Weaviate, etc. without
changing the calling code.

Search confidence levels:
  Exact match         → 1.0
  Normalised exact    → 0.98
  Substring match     → 0.85
  Word-overlap fuzzy  → 0.75 * jaccard
  Semantic relevance  → TF-IDF style score
"""

import re
import math
import logging
from typing import Dict, List, Optional, Tuple, Any
from collections import Counter

logger = logging.getLogger(__name__)

STOP_WORDS = {
    "of", "the", "a", "an", "in", "is", "it", "to", "for",
    "on", "at", "by", "and", "or", "with", "from",
}


class VectorDBInterface:
    """
    Wraps a case_context dict and provides Vector-DB–style search.

    Supports:
    * Exact key lookup          → confidence 1.0
    * Substring / fuzzy match   → confidence 0.70–0.98
    * Semantic (word-overlap)   → relevance-ranked chunks

    Usage::

        vdb = VectorDBInterface(case_context)
        value, score = vdb.search("petitioner_name")
        chunks = vdb.semantic_search(["facts", "background"], top_k=5)
    """

    def __init__(self, case_context: Dict[str, Any]):
        self.case_context = case_context
        self._flat: Dict[str, str] = {}       # original_key → str_value
        self._index: Dict[str, str] = {}      # normalised_key → original_key
        self._chunks: List[Dict] = []         # [{text, source_key}]
        self._build_index()
        logger.info(
            "VectorDBInterface ready – %d keys, %d chunks",
            len(self._flat), len(self._chunks),
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def search(self, key: str, threshold: float = 0.70) -> Optional[Tuple[str, float]]:
        """
        Exact / fuzzy search for a key in the case context.

        Returns:
            (value, confidence) tuple, or None if nothing meets threshold.
        """
        # 1. Exact match
        if key in self._flat:
            return self._flat[key], 1.0

        # 2. Normalised exact match
        norm = self._normalise(key)
        if norm in self._index:
            orig = self._index[norm]
            return self._flat[orig], 0.98

        # 3. Best fuzzy match
        best_key: Optional[str] = None
        best_score = 0.0
        for orig_key in self._flat:
            score = self._calculate_similarity(key, orig_key)
            if score > best_score:
                best_score = score
                best_key = orig_key

        if best_score >= threshold and best_key is not None:
            logger.debug("Fuzzy match: '%s' → '%s' (%.2f)", key, best_key, best_score)
            return self._flat[best_key], best_score

        return None

    def semantic_search(
        self,
        queries: List[str],
        top_k: int = 10,
    ) -> List[Dict]:
        """
        Word-overlap semantic search over all text chunks.

        Args:
            queries: List of query strings
            top_k:   Number of results to return

        Returns:
            List of dicts: {text, relevance, source_key}
        """
        if not queries:
            return []

        query_tokens: List[str] = []
        for q in queries:
            query_tokens.extend(self._tokenize(q))

        scored: List[Tuple[float, Dict]] = []
        for chunk in self._chunks:
            score = self._score_relevance(query_tokens, chunk["text"])
            if score > 0:
                scored.append((score, chunk))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [
            {**chunk, "relevance": round(score, 4)}
            for score, chunk in scored[:top_k]
        ]

    def get_all_keys(self) -> List[str]:
        """Return all original keys in the index."""
        return list(self._flat.keys())

    def get_value(self, key: str) -> Optional[str]:
        """Direct key lookup; None if missing."""
        return self._flat.get(key)

    # ------------------------------------------------------------------
    # Index building
    # ------------------------------------------------------------------

    def _build_index(self) -> None:
        self._flat = {}
        self._index = {}
        self._chunks = []

        def _flatten(obj: Any, prefix: str = "") -> None:
            if isinstance(obj, dict):
                for k, v in obj.items():
                    full_key = f"{prefix}.{k}" if prefix else k
                    _flatten(v, full_key)
            elif isinstance(obj, list):
                for i, item in enumerate(obj):
                    _flatten(item, f"{prefix}[{i}]")
            else:
                str_val = str(obj) if obj is not None else ""
                self._flat[prefix] = str_val
                self._index[self._normalise(prefix)] = prefix
                if str_val and len(str_val) > 5:
                    self._chunks.append({"text": str_val, "source_key": prefix})

        _flatten(self.case_context)

    # ------------------------------------------------------------------
    # Similarity & scoring
    # ------------------------------------------------------------------

    def _calculate_similarity(self, key1: str, key2: str) -> float:
        """
        Multi-signal similarity between two key strings.

        Signals (in priority order):
          * Exact normalised  → 0.98
          * Substring         → 0.85
          * Jaccard word-overlap → 0.75 * jaccard
        """
        n1 = self._normalise(key1)
        n2 = self._normalise(key2)

        if n1 == n2:
            return 0.98
        if n1 in n2 or n2 in n1:
            return 0.85

        tokens1 = set(self._tokenize(key1))
        tokens2 = set(self._tokenize(key2))
        if not tokens1 or not tokens2:
            return 0.0

        jaccard = len(tokens1 & tokens2) / len(tokens1 | tokens2)
        return 0.75 * jaccard

    @staticmethod
    def _tokenize(text: str) -> List[str]:
        """Lowercase alpha tokens, stop-words removed."""
        tokens = re.findall(r'[a-z]+', text.lower())
        return [t for t in tokens if t not in STOP_WORDS and len(t) > 1]

    def _score_relevance(self, query_tokens: List[str], text: str) -> float:
        """TF-IDF–style relevance between query tokens and a text chunk."""
        text_tokens = self._tokenize(text)
        if not text_tokens or not query_tokens:
            return 0.0

        text_freq = Counter(text_tokens)
        text_len = len(text_tokens)
        n_docs = max(len(self._chunks), 1)
        score = 0.0

        for qt in set(query_tokens):
            tf = text_freq.get(qt, 0) / text_len
            df = sum(1 for c in self._chunks if qt in c["text"].lower())
            idf = math.log((n_docs + 1) / (df + 1)) + 1
            score += tf * idf

        return score

    @staticmethod
    def _normalise(key: str) -> str:
        return re.sub(r'[^a-z0-9_]', '_', key.lower()).strip('_')
