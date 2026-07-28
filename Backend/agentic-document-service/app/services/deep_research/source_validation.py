"""Bounded, SSRF-aware source validation for Deep Research citations.

This module is deliberately isolated from ``grounding_links.py`` and is not imported by
the Deep Research agent yet.  It provides a small, dependency-injectable API that can be
wired into the Deep Research pipeline separately:

    validator = SourceValidator()
    results = await validator.validate_many([SourceRecord("example.com/article")])

Security invariants:

* a missing scheme defaults to HTTPS;
* only HTTP(S) URLs and ports 80/443 are accepted;
* DNS is checked before every request and every redirect;
* if any address for a hostname is non-public, the hostname is rejected;
* redirects are followed manually, with a hard hop limit;
* response reads are streamed and capped;
* proxy environment variables are ignored by the default HTTP client.

The resolver and transport are protocols.  Unit tests, callers with an existing HTTP
pool, and a future DNS-pinning transport can inject implementations without real network
access.  Validated addresses are passed to the transport on every request for that reason.
"""

from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from contextlib import asynccontextmanager
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from enum import StrEnum
from typing import (
    AsyncIterator,
    Awaitable,
    Callable,
    Iterable,
    Mapping,
    Protocol,
    Sequence,
)
from urllib.parse import quote, urljoin, urlsplit, urlunsplit


class SourceAuthority(StrEnum):
    """Conservative authority classes used for legal-source ranking."""

    PRIMARY_LEGAL_AUTHORITY = "primary_legal_authority"
    OFFICIAL_GOVERNMENT = "official_government"
    SECONDARY_LEGAL_DATABASE = "secondary_legal_database"
    LEGISLATIVE_RESEARCH = "legislative_research"
    SPECIALIST_LEGAL_REPORTING = "specialist_legal_reporting"
    NEWSWIRE = "newswire"
    GENERAL_NEWS = "general_news"
    OTHER = "other"


class ValidationState(StrEnum):
    """Explicit, non-overlapping outcomes for one source."""

    VALID = "valid"
    INVALID_URL = "invalid_url"
    BLOCKED_SCHEME = "blocked_scheme"
    BLOCKED_PORT = "blocked_port"
    BLOCKED_HOST = "blocked_host"
    BLOCKED_ADDRESS = "blocked_address"
    DNS_FAILURE = "dns_failure"
    TIMEOUT = "timeout"
    NETWORK_ERROR = "network_error"
    TOO_MANY_REDIRECTS = "too_many_redirects"
    INVALID_REDIRECT = "invalid_redirect"
    NOT_FOUND = "not_found"
    ACCESS_RESTRICTED = "access_restricted"
    RATE_LIMITED = "rate_limited"
    UPSTREAM_ERROR = "upstream_error"
    HTTP_ERROR = "http_error"
    UNSUPPORTED_MEDIA_TYPE = "unsupported_media_type"
    MISSING_MEDIA_TYPE = "missing_media_type"
    EMPTY_RESPONSE = "empty_response"
    SOURCE_LIMIT_EXCEEDED = "source_limit_exceeded"


class URLNormalizationError(ValueError):
    """A URL could not be safely normalized."""

    def __init__(self, message: str, state: ValidationState = ValidationState.INVALID_URL):
        super().__init__(message)
        self.state = state


class RequestTimeoutError(Exception):
    """Transport-level request timeout, suitable for deterministic retry handling."""


class RequestNetworkError(Exception):
    """Transport-level connection/protocol failure, suitable for retry handling."""


@dataclass(frozen=True, slots=True)
class SourceRecord:
    """A citation source and its deterministic, pre-network representation."""

    original_url: str
    citation_id: str | None = None
    title: str | None = None
    normalized_url: str | None = None
    canonical_url: str | None = None
    authority: SourceAuthority = SourceAuthority.OTHER

    @classmethod
    def from_url(
        cls,
        url: str,
        *,
        citation_id: str | None = None,
        title: str | None = None,
        max_length: int = 8192,
    ) -> "SourceRecord":
        normalized = normalize_url(url, max_length=max_length)
        canonical = recanonicalize_url(normalized)
        return cls(
            original_url=url,
            citation_id=citation_id,
            title=title,
            normalized_url=normalized,
            canonical_url=canonical,
            authority=classify_authority(canonical),
        )


@dataclass(frozen=True, slots=True)
class ValidationResult:
    """Network validation evidence for one ``SourceRecord``."""

    source: SourceRecord
    state: ValidationState
    final_url: str | None = None
    final_authority: SourceAuthority = SourceAuthority.OTHER
    status_code: int | None = None
    mime_type: str | None = None
    content_length: int | None = None
    body_sample: bytes = b""
    sampled_bytes: int = 0
    body_truncated: bool = False
    redirect_chain: tuple[str, ...] = ()
    resolved_addresses: tuple[str, ...] = ()
    attempts: int = 0
    reason: str | None = None

    @property
    def is_valid(self) -> bool:
        return self.state is ValidationState.VALID


@dataclass(frozen=True, slots=True)
class HttpResponse:
    """Transport-neutral response metadata plus a bounded body sample."""

    status_code: int
    headers: Mapping[str, str] = field(default_factory=dict)
    body_sample: bytes = b""
    body_truncated: bool = False


class DNSResolver(Protocol):
    async def resolve(self, host: str, port: int) -> Sequence[str]:
        """Return all IP addresses the hostname currently resolves to."""


class HttpTransport(Protocol):
    async def request(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str],
        timeout_s: float,
        max_response_bytes: int,
        resolved_addresses: Sequence[str],
    ) -> HttpResponse:
        """Make one non-redirecting request and return a bounded response."""


@dataclass(frozen=True, slots=True)
class SourceValidationConfig:
    """Operational and security limits for one validator."""

    max_redirects: int = 5
    max_response_bytes: int = 64 * 1024
    fetch_body_sample: bool = True
    max_url_length: int = 8192
    max_sources_per_call: int = 100
    max_concurrency: int = 8
    max_retries: int = 2
    request_timeout_s: float = 6.0
    dns_timeout_s: float = 3.0
    total_timeout_s: float = 20.0
    backoff_base_s: float = 0.2
    max_retry_after_s: float = 2.0
    allowed_ports: frozenset[int] = frozenset({80, 443})
    retryable_statuses: frozenset[int] = frozenset(
        {408, 425, 429, 500, 502, 503, 504}
    )
    head_fallback_statuses: frozenset[int] = frozenset({400, 403, 405, 406, 501})
    allowed_mime_types: frozenset[str] = frozenset(
        {
            "text/html",
            "text/plain",
            "text/xml",
            "text/csv",
            "application/xhtml+xml",
            "application/pdf",
            "application/json",
            "application/ld+json",
            "application/xml",
            "application/rtf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.oasis.opendocument.text",
        }
    )
    user_agent: str = "Jurinex-DeepResearch-SourceValidator/1.0"

    def __post_init__(self) -> None:
        positive_ints = {
            "max_response_bytes": self.max_response_bytes,
            "max_url_length": self.max_url_length,
            "max_sources_per_call": self.max_sources_per_call,
            "max_concurrency": self.max_concurrency,
        }
        for name, value in positive_ints.items():
            if value < 1:
                raise ValueError(f"{name} must be at least 1")
        if self.max_redirects < 0:
            raise ValueError("max_redirects cannot be negative")
        if self.max_retries < 0:
            raise ValueError("max_retries cannot be negative")
        for name in ("request_timeout_s", "dns_timeout_s", "total_timeout_s"):
            if getattr(self, name) <= 0:
                raise ValueError(f"{name} must be positive")
        if self.backoff_base_s < 0 or self.max_retry_after_s < 0:
            raise ValueError("retry delays cannot be negative")
        if not self.allowed_ports:
            raise ValueError("allowed_ports cannot be empty")


# Hostnames are matched exactly.  We intentionally do not infer trust from suffixes such as
# ".gov.in": a government-looking hostname is not enough to assign legal authority.
_AUTHORITY_BY_HOST: dict[str, SourceAuthority] = {
    # Courts, judgments, legislation, and Gazette publications.
    "sci.gov.in": SourceAuthority.PRIMARY_LEGAL_AUTHORITY,
    "www.sci.gov.in": SourceAuthority.PRIMARY_LEGAL_AUTHORITY,
    "scr.sci.gov.in": SourceAuthority.PRIMARY_LEGAL_AUTHORITY,
    "verdictfinder.sci.gov.in": SourceAuthority.PRIMARY_LEGAL_AUTHORITY,
    "judgments.ecourts.gov.in": SourceAuthority.PRIMARY_LEGAL_AUTHORITY,
    "ecourts.gov.in": SourceAuthority.PRIMARY_LEGAL_AUTHORITY,
    "www.ecourts.gov.in": SourceAuthority.PRIMARY_LEGAL_AUTHORITY,
    "indiacode.nic.in": SourceAuthority.PRIMARY_LEGAL_AUTHORITY,
    "www.indiacode.nic.in": SourceAuthority.PRIMARY_LEGAL_AUTHORITY,
    "egazette.gov.in": SourceAuthority.PRIMARY_LEGAL_AUTHORITY,
    "www.egazette.gov.in": SourceAuthority.PRIMARY_LEGAL_AUTHORITY,
    "bombayhighcourt.gov.in": SourceAuthority.PRIMARY_LEGAL_AUTHORITY,
    "www.bombayhighcourt.gov.in": SourceAuthority.PRIMARY_LEGAL_AUTHORITY,
    "egazzete.mahaonline.gov.in": SourceAuthority.PRIMARY_LEGAL_AUTHORITY,
    # First-party government communications (not, by themselves, binding law).
    "pib.gov.in": SourceAuthority.OFFICIAL_GOVERNMENT,
    "www.pib.gov.in": SourceAuthority.OFFICIAL_GOVERNMENT,
    "legislative.gov.in": SourceAuthority.OFFICIAL_GOVERNMENT,
    "www.legislative.gov.in": SourceAuthority.OFFICIAL_GOVERNMENT,
    "maharashtra.gov.in": SourceAuthority.OFFICIAL_GOVERNMENT,
    "www.maharashtra.gov.in": SourceAuthority.OFFICIAL_GOVERNMENT,
    "gr.maharashtra.gov.in": SourceAuthority.OFFICIAL_GOVERNMENT,
    "lj.maharashtra.gov.in": SourceAuthority.OFFICIAL_GOVERNMENT,
    "mahaonline.gov.in": SourceAuthority.OFFICIAL_GOVERNMENT,
    "www.mahaonline.gov.in": SourceAuthority.OFFICIAL_GOVERNMENT,
    "igrmaharashtra.gov.in": SourceAuthority.OFFICIAL_GOVERNMENT,
    "www.igrmaharashtra.gov.in": SourceAuthority.OFFICIAL_GOVERNMENT,
    # Searchable legal databases and legislative research are valuable secondary sources,
    # but neither is promoted to the status of an official judgment or Gazette publication.
    "indiankanoon.org": SourceAuthority.SECONDARY_LEGAL_DATABASE,
    "www.indiankanoon.org": SourceAuthority.SECONDARY_LEGAL_DATABASE,
    "prsindia.org": SourceAuthority.LEGISLATIVE_RESEARCH,
    "www.prsindia.org": SourceAuthority.LEGISLATIVE_RESEARCH,
    # Specialist legal reporting.
    "barandbench.com": SourceAuthority.SPECIALIST_LEGAL_REPORTING,
    "www.barandbench.com": SourceAuthority.SPECIALIST_LEGAL_REPORTING,
    "livelaw.in": SourceAuthority.SPECIALIST_LEGAL_REPORTING,
    "www.livelaw.in": SourceAuthority.SPECIALIST_LEGAL_REPORTING,
    "hindi.livelaw.in": SourceAuthority.SPECIALIST_LEGAL_REPORTING,
    # Newswires.
    "reuters.com": SourceAuthority.NEWSWIRE,
    "www.reuters.com": SourceAuthority.NEWSWIRE,
    "ptinews.com": SourceAuthority.NEWSWIRE,
    "www.ptinews.com": SourceAuthority.NEWSWIRE,
    # National newspapers.
    "thehindu.com": SourceAuthority.GENERAL_NEWS,
    "www.thehindu.com": SourceAuthority.GENERAL_NEWS,
    "indianexpress.com": SourceAuthority.GENERAL_NEWS,
    "www.indianexpress.com": SourceAuthority.GENERAL_NEWS,
}


# The Bombay High Court moved from the NIC hostname to its current GOV.IN hostname.  This
# mapping is exact so a hostname such as "bombayhighcourt.nic.in.attacker.example" is never
# rewritten or promoted to primary authority.
_CANONICAL_HOST_ALIASES: dict[str, str] = {
    "bombayhighcourt.nic.in": "bombayhighcourt.gov.in",
    "www.bombayhighcourt.nic.in": "bombayhighcourt.gov.in",
    "www.bombayhighcourt.gov.in": "bombayhighcourt.gov.in",
}

_CONTROL_CHAR_RE = re.compile(r"[\x00-\x1f\x7f]")
_SOFT_NOT_FOUND_RE = re.compile(
    r"(?is)<title[^>]*>[^<]*(?:404|page\s+not\s+found|not\s+found)|"
    r"\b(?:404\s*[-:–—]?\s*)?page\s+not\s+found\b"
)
_ACCESS_GATE_RE = re.compile(
    r"(?is)<title[^>]*>[^<]*(?:access\s+denied|attention\s+required|captcha)|"
    r"\b(?:verify\s+you(?:'|’)?re?\s+human|captcha|cloudflare\s+ray\s+id|"
    r"access\s+denied|enable\s+javascript\s+and\s+cookies)\b"
)
_DOMAIN_LABEL_RE = re.compile(r"^[a-z0-9-]+$")
_EXPLICIT_UNSAFE_SCHEME_RE = re.compile(
    r"^(?:data|file|ftp|gopher|javascript|mailto|ssh|telnet):", re.IGNORECASE
)
_BLOCKED_HOST_SUFFIXES = (".internal", ".local", ".localhost", ".home", ".lan")
_BLOCKED_HOSTS = frozenset({"localhost", "localhost.localdomain"})
_METADATA_ADDRESSES = frozenset(
    {
        ipaddress.ip_address("169.254.169.254"),
        ipaddress.ip_address("100.100.100.200"),
        ipaddress.ip_address("fd00:ec2::254"),
    }
)


def normalize_url(url: str, *, max_length: int = 8192) -> str:
    """Return a deterministic HTTP(S) URL without applying authority aliases."""

    if not isinstance(url, str):
        raise URLNormalizationError("URL must be a string")
    candidate = url.strip()
    if not candidate:
        raise URLNormalizationError("URL is empty")
    if len(candidate) > max_length:
        raise URLNormalizationError("URL exceeds the configured length limit")
    if _CONTROL_CHAR_RE.search(candidate):
        raise URLNormalizationError("URL contains control characters")
    if _EXPLICIT_UNSAFE_SCHEME_RE.match(candidate):
        raise URLNormalizationError(
            "URL scheme is not allowed", ValidationState.BLOCKED_SCHEME
        )

    if candidate.startswith("//"):
        candidate = f"https:{candidate}"
    elif "://" not in candidate:
        candidate = f"https://{candidate}"

    try:
        parsed = urlsplit(candidate)
    except ValueError as exc:
        raise URLNormalizationError("URL cannot be parsed") from exc

    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        raise URLNormalizationError(
            "URL scheme is not allowed", ValidationState.BLOCKED_SCHEME
        )
    if parsed.username is not None or parsed.password is not None:
        raise URLNormalizationError("Credentials in source URLs are not allowed")

    raw_host = parsed.hostname
    if not raw_host:
        raise URLNormalizationError("URL has no hostname")
    host = _normalize_host(raw_host)

    try:
        port = parsed.port
    except ValueError as exc:
        raise URLNormalizationError("URL port is invalid") from exc

    default_port = 443 if scheme == "https" else 80
    rendered_host = _render_host(host)
    netloc = rendered_host if port is None or port == default_port else f"{rendered_host}:{port}"

    path = quote(parsed.path or "/", safe="/:@!$&'()*+,;=-._~%")
    query = quote(parsed.query, safe="=&?/:;+,%@!$'()*-._~")
    normalized = urlunsplit((scheme, netloc, path, query, ""))
    if len(normalized) > max_length:
        raise URLNormalizationError("Normalized URL exceeds the configured length limit")
    return normalized


def recanonicalize_url(normalized_url: str) -> str:
    """Apply exact, maintained authority aliases to an already normalized URL."""

    parsed = urlsplit(normalized_url)
    host = parsed.hostname or ""
    canonical_host = _CANONICAL_HOST_ALIASES.get(host)
    if canonical_host is None:
        return normalized_url

    # The maintained canonical authority endpoint is HTTPS.  Keep only a genuinely
    # non-standard port so the validator can reject it explicitly rather than silently
    # changing its meaning.
    port = parsed.port
    netloc = canonical_host
    if port not in (None, 80, 443):
        netloc = f"{canonical_host}:{port}"
    return urlunsplit(("https", netloc, parsed.path, parsed.query, ""))


def classify_authority(url: str) -> SourceAuthority:
    """Classify a URL by an exact normalized hostname lookup."""

    try:
        host = _normalize_host(urlsplit(url).hostname or "")
    except (URLNormalizationError, ValueError):
        return SourceAuthority.OTHER
    return _AUTHORITY_BY_HOST.get(host, SourceAuthority.OTHER)


def is_safe_public_ip(address: str | ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Return ``True`` only for a globally routable, non-metadata address."""

    try:
        ip = address if isinstance(address, (ipaddress.IPv4Address, ipaddress.IPv6Address)) else ipaddress.ip_address(address)
    except ValueError:
        return False
    if ip in _METADATA_ADDRESSES:
        return False
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _normalize_host(raw_host: str) -> str:
    host = raw_host.rstrip(".").lower()
    if not host:
        raise URLNormalizationError("URL hostname is empty")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        try:
            host = host.encode("idna").decode("ascii").lower()
        except UnicodeError as exc:
            raise URLNormalizationError("URL hostname is invalid") from exc
        if len(host) > 253:
            raise URLNormalizationError("URL hostname is too long")
        labels = host.split(".")
        if any(
            not label
            or len(label) > 63
            or label.startswith("-")
            or label.endswith("-")
            or not _DOMAIN_LABEL_RE.fullmatch(label)
            for label in labels
        ):
            raise URLNormalizationError("URL hostname is invalid")
        return host
    return ip.compressed


def _render_host(host: str) -> str:
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return host
    return f"[{ip.compressed}]" if ip.version == 6 else ip.compressed


class SystemDNSResolver:
    """Asynchronous system DNS resolver used by the default validator."""

    async def resolve(self, host: str, port: int) -> Sequence[str]:
        loop = asyncio.get_running_loop()
        records = await loop.getaddrinfo(
            host,
            port,
            family=socket.AF_UNSPEC,
            type=socket.SOCK_STREAM,
            proto=socket.IPPROTO_TCP,
        )
        # Preserve resolver order while de-duplicating.
        return tuple(dict.fromkeys(str(record[4][0]) for record in records))


class HttpxTransport:
    """Bounded HTTP adapter that connects only to a prevalidated DNS address.

    The request URL uses the chosen IP address, while ``Host`` and TLS SNI retain the
    original hostname. This closes the DNS-rebinding gap between endpoint validation and
    connection establishment without disabling certificate verification.
    """

    def __init__(self, client) -> None:
        self._client = client

    async def request(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str],
        timeout_s: float,
        max_response_bytes: int,
        resolved_addresses: Sequence[str],
    ) -> HttpResponse:
        import httpx

        if not resolved_addresses:
            raise RequestNetworkError("request has no prevalidated destination address")
        try:
            parsed = urlsplit(url)
            original_host = _normalize_host(parsed.hostname or "")
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
        except (URLNormalizationError, ValueError) as exc:
            raise RequestNetworkError("request URL endpoint is invalid") from exc

        default_port = 443 if parsed.scheme == "https" else 80
        host_header = _render_host(original_host)
        if port != default_port:
            host_header = f"{host_header}:{port}"
        request_headers = dict(headers)
        request_headers["Host"] = host_header
        request_headers["Connection"] = "close"

        last_error: Exception | None = None
        timed_out = False
        for raw_address in resolved_addresses:
            try:
                address = ipaddress.ip_address(raw_address)
            except ValueError:
                continue
            if not is_safe_public_ip(address):
                continue
            rendered_address = _render_host(address.compressed)
            connect_netloc = rendered_address
            if port != default_port:
                connect_netloc = f"{connect_netloc}:{port}"
            connect_url = urlunsplit(
                (parsed.scheme, connect_netloc, parsed.path, parsed.query, "")
            )
            try:
                async with self._client.stream(
                    method,
                    connect_url,
                    headers=request_headers,
                    timeout=timeout_s,
                    follow_redirects=False,
                    extensions={"sni_hostname": original_host},
                ) as response:
                    response_headers = {
                        str(key).lower(): str(value)
                        for key, value in response.headers.items()
                    }
                    sample = bytearray()
                    truncated = False
                    if method.upper() == "GET" and not (300 <= response.status_code < 400):
                        async for chunk in response.aiter_raw(chunk_size=16 * 1024):
                            if not chunk:
                                continue
                            remaining = max_response_bytes - len(sample)
                            if remaining <= 0:
                                truncated = True
                                break
                            sample.extend(chunk[:remaining])
                            if len(chunk) > remaining:
                                truncated = True
                                break
                    return HttpResponse(
                        status_code=int(response.status_code),
                        headers=response_headers,
                        body_sample=bytes(sample),
                        body_truncated=truncated,
                    )
            except httpx.TimeoutException as exc:
                timed_out = True
                last_error = exc
            except httpx.RequestError as exc:
                last_error = exc

        if timed_out:
            raise RequestTimeoutError("HTTP request timed out") from last_error
        raise RequestNetworkError("HTTP request failed") from last_error


@dataclass(frozen=True, slots=True)
class _EndpointCheck:
    state: ValidationState | None
    addresses: tuple[str, ...] = ()
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class _RequestOutcome:
    response: HttpResponse | None
    state: ValidationState | None
    attempts: int
    reason: str | None = None


class SourceValidator:
    """Validate individual or batched Deep Research sources within strict bounds."""

    def __init__(
        self,
        *,
        config: SourceValidationConfig | None = None,
        resolver: DNSResolver | None = None,
        transport: HttpTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.config = config or SourceValidationConfig()
        self._resolver = resolver or SystemDNSResolver()
        self._transport = transport
        self._sleep = sleep

    async def validate(self, source: SourceRecord | str) -> ValidationResult:
        """Validate one source."""

        return (await self.validate_many([source]))[0]

    async def validate_many(
        self,
        sources: Iterable[SourceRecord | str],
        *,
        concurrency: int | None = None,
    ) -> list[ValidationResult]:
        """Validate sources in input order with a per-call worker bound.

        Entries beyond ``max_sources_per_call`` are returned as explicit
        ``SOURCE_LIMIT_EXCEEDED`` results; they are never silently dropped.
        """

        records = [self._coerce_record(source) for source in sources]
        if not records:
            return []

        requested_concurrency = (
            self.config.max_concurrency if concurrency is None else concurrency
        )
        if requested_concurrency < 1:
            raise ValueError("concurrency must be at least 1")
        worker_count = min(
            requested_concurrency,
            self.config.max_concurrency,
            self.config.max_sources_per_call,
            len(records),
        )

        results: list[ValidationResult | None] = [None] * len(records)
        permitted_count = min(len(records), self.config.max_sources_per_call)
        for index in range(permitted_count, len(records)):
            record = records[index]
            results[index] = ValidationResult(
                source=record,
                state=ValidationState.SOURCE_LIMIT_EXCEEDED,
                reason=(
                    "source was not checked because the per-call source limit "
                    f"is {self.config.max_sources_per_call}"
                ),
            )

        async with self._transport_scope(worker_count) as transport:
            next_index = 0
            index_lock = asyncio.Lock()

            async def worker() -> None:
                nonlocal next_index
                while True:
                    async with index_lock:
                        if next_index >= permitted_count:
                            return
                        index = next_index
                        next_index += 1
                    record = records[index]
                    try:
                        results[index] = await self._validate_bounded(record, transport)
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:
                        # A malformed response or one transport bug must not erase every
                        # other citation result in the batch.
                        results[index] = ValidationResult(
                            source=record,
                            state=ValidationState.NETWORK_ERROR,
                            reason=f"unexpected validator failure: {type(exc).__name__}",
                        )

            await asyncio.gather(*(worker() for _ in range(worker_count)))

        # Every slot is assigned by either a worker or the source-limit branch.
        return [result for result in results if result is not None]

    @staticmethod
    def _coerce_record(source: SourceRecord | str) -> SourceRecord:
        if isinstance(source, SourceRecord):
            return source
        if isinstance(source, str):
            return SourceRecord(original_url=source)
        raise TypeError("sources must be SourceRecord or str instances")

    @asynccontextmanager
    async def _transport_scope(
        self, concurrency: int
    ) -> AsyncIterator[HttpTransport]:
        if self._transport is not None:
            yield self._transport
            return

        import httpx

        limits = httpx.Limits(
            max_connections=concurrency,
            max_keepalive_connections=concurrency,
        )
        async with httpx.AsyncClient(
            follow_redirects=False,
            trust_env=False,
            limits=limits,
        ) as client:
            yield HttpxTransport(client)

    async def _validate_bounded(
        self, source: SourceRecord, transport: HttpTransport
    ) -> ValidationResult:
        try:
            async with asyncio.timeout(self.config.total_timeout_s):
                return await self._validate_source(source, transport)
        except TimeoutError:
            return ValidationResult(
                source=source,
                state=ValidationState.TIMEOUT,
                final_url=source.canonical_url,
                final_authority=source.authority,
                reason="total validation deadline exceeded",
            )

    async def _validate_source(
        self, source: SourceRecord, transport: HttpTransport
    ) -> ValidationResult:
        try:
            normalized = normalize_url(
                source.original_url, max_length=self.config.max_url_length
            )
            canonical = recanonicalize_url(normalized)
        except URLNormalizationError as exc:
            return ValidationResult(source=source, state=exc.state, reason=str(exc))

        prepared = replace(
            source,
            normalized_url=normalized,
            canonical_url=canonical,
            authority=classify_authority(canonical),
        )
        current_url = canonical
        redirect_chain = [current_url]
        seen_urls = {current_url}
        total_attempts = 0

        while True:
            endpoint = await self._check_endpoint(current_url)
            if endpoint.state is not None:
                return self._result(
                    prepared,
                    endpoint.state,
                    current_url,
                    redirect_chain,
                    total_attempts,
                    resolved_addresses=endpoint.addresses,
                    reason=endpoint.reason,
                )

            head = await self._request_with_retries(
                transport,
                "HEAD",
                current_url,
                endpoint.addresses,
            )
            total_attempts += head.attempts
            if head.response is None:
                return self._result(
                    prepared,
                    head.state or ValidationState.NETWORK_ERROR,
                    current_url,
                    redirect_chain,
                    total_attempts,
                    resolved_addresses=endpoint.addresses,
                    reason=head.reason,
                )
            response = head.response
            method = "HEAD"

            head_response = response
            head_mime = _mime_type(response.headers)
            if (
                response.status_code in self.config.head_fallback_statuses
                or (
                    200 <= response.status_code < 300
                    and (
                        head_mime is None
                        or (
                            self.config.fetch_body_sample
                            and response.status_code != 204
                            and head_mime in self.config.allowed_mime_types
                        )
                    )
                )
            ):
                get = await self._request_with_retries(
                    transport,
                    "GET",
                    current_url,
                    endpoint.addresses,
                )
                total_attempts += get.attempts
                if get.response is None:
                    return self._result(
                        prepared,
                        get.state or ValidationState.NETWORK_ERROR,
                        current_url,
                        redirect_chain,
                        total_attempts,
                        resolved_addresses=endpoint.addresses,
                        reason=get.reason,
                    )
                response = get.response
                method = "GET"

            status = response.status_code
            if 300 <= status < 400:
                location = _header(response.headers, "location")
                if not location or _CONTROL_CHAR_RE.search(location):
                    return self._result(
                        prepared,
                        ValidationState.INVALID_REDIRECT,
                        current_url,
                        redirect_chain,
                        total_attempts,
                        status_code=status,
                        resolved_addresses=endpoint.addresses,
                        reason="redirect response has no safe Location header",
                    )
                try:
                    joined = urljoin(current_url, location.strip())
                    next_normalized = normalize_url(
                        joined, max_length=self.config.max_url_length
                    )
                    next_url = recanonicalize_url(next_normalized)
                except URLNormalizationError as exc:
                    return self._result(
                        prepared,
                        exc.state
                        if exc.state is ValidationState.BLOCKED_SCHEME
                        else ValidationState.INVALID_REDIRECT,
                        current_url,
                        redirect_chain,
                        total_attempts,
                        status_code=status,
                        resolved_addresses=endpoint.addresses,
                        reason=f"unsafe redirect target: {exc}",
                    )

                if (
                    urlsplit(current_url).scheme == "https"
                    and urlsplit(next_url).scheme != "https"
                ):
                    return self._result(
                        prepared,
                        ValidationState.INVALID_REDIRECT,
                        current_url,
                        redirect_chain,
                        total_attempts,
                        status_code=status,
                        resolved_addresses=endpoint.addresses,
                        reason="HTTPS-to-HTTP redirect downgrade is not allowed",
                    )
                if next_url in seen_urls:
                    return self._result(
                        prepared,
                        ValidationState.INVALID_REDIRECT,
                        current_url,
                        redirect_chain,
                        total_attempts,
                        status_code=status,
                        resolved_addresses=endpoint.addresses,
                        reason="redirect loop detected",
                    )
                if len(redirect_chain) - 1 >= self.config.max_redirects:
                    return self._result(
                        prepared,
                        ValidationState.TOO_MANY_REDIRECTS,
                        current_url,
                        redirect_chain,
                        total_attempts,
                        status_code=status,
                        resolved_addresses=endpoint.addresses,
                        reason="redirect limit exceeded",
                    )
                seen_urls.add(next_url)
                redirect_chain.append(next_url)
                current_url = next_url
                continue

            state, reason = self._state_for_status(status)
            mime = _mime_type(response.headers)
            if mime is None and method == "GET":
                mime = head_mime
            content_length = _content_length(response.headers)
            if content_length is None and method == "GET":
                content_length = _content_length(head_response.headers)
            if state is None:
                sampled_state, sampled_reason = _sample_page_state(
                    response.body_sample if method == "GET" else b"",
                    mime,
                    require_body=(method == "GET" and self.config.fetch_body_sample),
                )
                if sampled_state is not None:
                    state = sampled_state
                    reason = sampled_reason
                elif status == 204:
                    state = ValidationState.EMPTY_RESPONSE
                    reason = "source returned no content"
                elif mime is None:
                    state = ValidationState.MISSING_MEDIA_TYPE
                    reason = "response has no Content-Type"
                elif mime not in self.config.allowed_mime_types:
                    state = ValidationState.UNSUPPORTED_MEDIA_TYPE
                    reason = f"unsupported Content-Type: {mime}"
                else:
                    state = ValidationState.VALID

            return self._result(
                prepared,
                state,
                current_url,
                redirect_chain,
                total_attempts,
                status_code=status,
                mime_type=mime,
                content_length=content_length,
                body_sample=response.body_sample if method == "GET" else b"",
                sampled_bytes=len(response.body_sample) if method == "GET" else 0,
                body_truncated=response.body_truncated if method == "GET" else False,
                resolved_addresses=endpoint.addresses,
                reason=reason,
            )

    async def _check_endpoint(self, url: str) -> _EndpointCheck:
        try:
            parsed = urlsplit(url)
            host = _normalize_host(parsed.hostname or "")
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
        except (URLNormalizationError, ValueError):
            return _EndpointCheck(
                ValidationState.INVALID_URL, reason="URL endpoint is invalid"
            )

        if port not in self.config.allowed_ports:
            return _EndpointCheck(
                ValidationState.BLOCKED_PORT,
                reason=f"port {port} is not allowed",
            )

        try:
            literal = ipaddress.ip_address(host)
        except ValueError:
            literal = None
        if literal is not None:
            rendered = literal.compressed
            if not is_safe_public_ip(literal):
                return _EndpointCheck(
                    ValidationState.BLOCKED_ADDRESS,
                    addresses=(rendered,),
                    reason="URL resolves to a non-public or metadata address",
                )
            return _EndpointCheck(None, addresses=(rendered,))

        if (
            host in _BLOCKED_HOSTS
            or "." not in host
            or host.endswith(_BLOCKED_HOST_SUFFIXES)
        ):
            return _EndpointCheck(
                ValidationState.BLOCKED_HOST,
                reason="local or internal hostname is not allowed",
            )

        try:
            addresses = await asyncio.wait_for(
                self._resolver.resolve(host, port),
                timeout=self.config.dns_timeout_s,
            )
        except (TimeoutError, OSError, socket.gaierror):
            return _EndpointCheck(
                ValidationState.DNS_FAILURE,
                reason="hostname resolution failed",
            )
        except Exception as exc:
            return _EndpointCheck(
                ValidationState.DNS_FAILURE,
                reason=f"hostname resolution failed: {type(exc).__name__}",
            )

        normalized_addresses: list[str] = []
        for address in addresses:
            try:
                ip = ipaddress.ip_address(address)
            except ValueError:
                return _EndpointCheck(
                    ValidationState.DNS_FAILURE,
                    reason="resolver returned an invalid address",
                )
            rendered = ip.compressed
            if rendered not in normalized_addresses:
                normalized_addresses.append(rendered)
            if not is_safe_public_ip(ip):
                return _EndpointCheck(
                    ValidationState.BLOCKED_ADDRESS,
                    addresses=tuple(normalized_addresses),
                    reason="hostname has a non-public or metadata DNS answer",
                )
        if not normalized_addresses:
            return _EndpointCheck(
                ValidationState.DNS_FAILURE,
                reason="hostname returned no addresses",
            )
        return _EndpointCheck(None, addresses=tuple(normalized_addresses))

    async def _request_with_retries(
        self,
        transport: HttpTransport,
        method: str,
        url: str,
        addresses: Sequence[str],
    ) -> _RequestOutcome:
        attempts = 0
        last_state = ValidationState.NETWORK_ERROR
        last_reason = "request failed"
        for retry_index in range(self.config.max_retries + 1):
            attempts += 1
            headers = {
                "User-Agent": self.config.user_agent,
                "Accept": (
                    "text/html,application/xhtml+xml,application/pdf,"
                    "text/plain,application/json,application/xml;q=0.9,*/*;q=0.1"
                ),
                "Accept-Encoding": "identity",
                "Cookie": "",
            }
            if method == "GET":
                headers["Range"] = f"bytes=0-{self.config.max_response_bytes - 1}"
            try:
                async with asyncio.timeout(self.config.request_timeout_s):
                    response = await transport.request(
                        method,
                        url,
                        headers=headers,
                        timeout_s=self.config.request_timeout_s,
                        max_response_bytes=self.config.max_response_bytes,
                        resolved_addresses=addresses,
                    )
            except (RequestTimeoutError, TimeoutError):
                last_state = ValidationState.TIMEOUT
                last_reason = "request timed out"
            except (RequestNetworkError, OSError):
                last_state = ValidationState.NETWORK_ERROR
                last_reason = "network request failed"
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                last_state = ValidationState.NETWORK_ERROR
                last_reason = f"transport failed: {type(exc).__name__}"
            else:
                if (
                    response.status_code not in self.config.retryable_statuses
                    or retry_index >= self.config.max_retries
                ):
                    return _RequestOutcome(response, None, attempts)
                delay = _retry_delay(
                    response.headers,
                    retry_index,
                    self.config.backoff_base_s,
                    self.config.max_retry_after_s,
                )
                if delay:
                    await self._sleep(delay)
                continue

            if retry_index >= self.config.max_retries:
                return _RequestOutcome(
                    None,
                    last_state,
                    attempts,
                    last_reason,
                )
            delay = min(
                self.config.max_retry_after_s,
                self.config.backoff_base_s * (2**retry_index),
            )
            if delay:
                await self._sleep(delay)

        return _RequestOutcome(None, last_state, attempts, last_reason)

    @staticmethod
    def _state_for_status(
        status_code: int,
    ) -> tuple[ValidationState | None, str | None]:
        if 200 <= status_code < 300:
            return None, None
        if status_code in {404, 410}:
            return ValidationState.NOT_FOUND, f"source returned HTTP {status_code}"
        if status_code in {401, 403, 407, 451}:
            return (
                ValidationState.ACCESS_RESTRICTED,
                f"source access is restricted (HTTP {status_code})",
            )
        if status_code == 429:
            return ValidationState.RATE_LIMITED, "source rate-limited validation"
        if 500 <= status_code < 600:
            return (
                ValidationState.UPSTREAM_ERROR,
                f"source returned HTTP {status_code}",
            )
        return ValidationState.HTTP_ERROR, f"source returned HTTP {status_code}"

    @staticmethod
    def _result(
        source: SourceRecord,
        state: ValidationState,
        final_url: str,
        redirect_chain: Sequence[str],
        attempts: int,
        *,
        status_code: int | None = None,
        mime_type: str | None = None,
        content_length: int | None = None,
        body_sample: bytes = bytes(),
        sampled_bytes: int = 0,
        body_truncated: bool = False,
        resolved_addresses: Sequence[str] = (),
        reason: str | None = None,
    ) -> ValidationResult:
        return ValidationResult(
            source=source,
            state=state,
            final_url=final_url,
            final_authority=classify_authority(final_url),
            status_code=status_code,
            mime_type=mime_type,
            content_length=content_length,
            body_sample=body_sample,
            sampled_bytes=sampled_bytes,
            body_truncated=body_truncated,
            redirect_chain=tuple(redirect_chain),
            resolved_addresses=tuple(resolved_addresses),
            attempts=attempts,
            reason=reason,
        )


def _sample_page_state(
    sample: bytes,
    mime_type: str | None,
    *,
    require_body: bool,
) -> tuple[ValidationState | None, str | None]:
    """Reject empty success pages and obvious soft errors/challenge interstitials."""
    if not require_body:
        return None, None
    if mime_type is None:
        return None, None
    if not sample or not sample.strip():
        return ValidationState.EMPTY_RESPONSE, "source returned an empty response body"
    if mime_type not in {"text/html", "application/xhtml+xml", "text/plain"}:
        return None, None
    preview = sample[:32_768].decode("utf-8", errors="replace")
    if _ACCESS_GATE_RE.search(preview):
        return ValidationState.ACCESS_RESTRICTED, "source returned an access or bot-challenge page"
    if _SOFT_NOT_FOUND_RE.search(preview):
        return ValidationState.NOT_FOUND, "source returned a soft not-found page"
    return None, None


def _header(headers: Mapping[str, str], name: str) -> str | None:
    wanted = name.lower()
    for key, value in headers.items():
        if str(key).lower() == wanted:
            return str(value)
    return None


def _mime_type(headers: Mapping[str, str]) -> str | None:
    value = _header(headers, "content-type")
    if not value:
        return None
    mime = value.split(";", 1)[0].strip().lower()
    return mime or None


def _content_length(headers: Mapping[str, str]) -> int | None:
    value = _header(headers, "content-length")
    if value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _retry_delay(
    headers: Mapping[str, str],
    retry_index: int,
    backoff_base_s: float,
    max_retry_after_s: float,
) -> float:
    retry_after = _header(headers, "retry-after")
    parsed_delay: float | None = None
    if retry_after:
        try:
            parsed_delay = max(0.0, float(retry_after.strip()))
        except ValueError:
            try:
                parsed_date = parsedate_to_datetime(retry_after)
                if parsed_date.tzinfo is None:
                    parsed_date = parsed_date.replace(tzinfo=timezone.utc)
                parsed_delay = max(
                    0.0,
                    (parsed_date - datetime.now(timezone.utc)).total_seconds(),
                )
            except (TypeError, ValueError, OverflowError):
                parsed_delay = None
    if parsed_delay is None:
        parsed_delay = backoff_base_s * (2**retry_index)
    return min(max_retry_after_s, parsed_delay)


__all__ = [
    "DNSResolver",
    "HttpResponse",
    "HttpTransport",
    "HttpxTransport",
    "RequestNetworkError",
    "RequestTimeoutError",
    "SourceAuthority",
    "SourceRecord",
    "SourceValidationConfig",
    "SourceValidator",
    "SystemDNSResolver",
    "URLNormalizationError",
    "ValidationResult",
    "ValidationState",
    "classify_authority",
    "is_safe_public_ip",
    "normalize_url",
    "recanonicalize_url",
]
