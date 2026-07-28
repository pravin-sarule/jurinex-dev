from __future__ import annotations

import asyncio
import unittest
from collections import defaultdict

from app.services.deep_research.source_validation import (
    HttpResponse,
    HttpxTransport,
    RequestNetworkError,
    RequestTimeoutError,
    SourceAuthority,
    SourceRecord,
    SourceValidationConfig,
    SourceValidator,
    URLNormalizationError,
    ValidationState,
    classify_authority,
    is_safe_public_ip,
    normalize_url,
)


PUBLIC_IP = "93.184.216.34"


class FakeResolver:
    def __init__(self, mapping=None, *, default=(PUBLIC_IP,)):
        self.mapping = mapping or {}
        self.default = default
        self.calls: list[tuple[str, int]] = []

    async def resolve(self, host: str, port: int):
        self.calls.append((host, port))
        outcome = self.mapping.get(host, self.default)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


class ScriptedTransport:
    def __init__(self, script=None, *, default=None, delay_s: float = 0.0):
        self.script = {
            key: list(outcomes) for key, outcomes in (script or {}).items()
        }
        self.default = default or HttpResponse(
            200, {"content-type": "text/html; charset=utf-8"}, body_sample=b"valid article text"
        )
        self.delay_s = delay_s
        self.calls: list[dict] = []
        self._indices = defaultdict(int)
        self.active = 0
        self.max_active = 0

    async def request(
        self,
        method,
        url,
        *,
        headers,
        timeout_s,
        max_response_bytes,
        resolved_addresses,
    ):
        self.calls.append(
            {
                "method": method,
                "url": url,
                "headers": dict(headers),
                "timeout_s": timeout_s,
                "max_response_bytes": max_response_bytes,
                "resolved_addresses": tuple(resolved_addresses),
            }
        )
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            if self.delay_s:
                await asyncio.sleep(self.delay_s)
            key = (method, url)
            outcomes = self.script.get(key)
            if outcomes is None:
                outcome = self.default
            else:
                index = self._indices[key]
                self._indices[key] += 1
                outcome = outcomes[min(index, len(outcomes) - 1)]
            if isinstance(outcome, BaseException):
                raise outcome
            return outcome
        finally:
            self.active -= 1


async def no_sleep(_delay: float) -> None:
    return None


class URLAndAuthorityTests(unittest.TestCase):
    def test_normalization_defaults_to_https_and_removes_fragment(self):
        self.assertEqual(
            normalize_url(" Example.COM/a b?term=legal research#section "),
            "https://example.com/a%20b?term=legal%20research",
        )

    def test_unsafe_scheme_and_credentials_are_rejected(self):
        with self.assertRaises(URLNormalizationError) as scheme:
            normalize_url("file:///etc/passwd")
        self.assertEqual(scheme.exception.state, ValidationState.BLOCKED_SCHEME)

        with self.assertRaises(URLNormalizationError):
            normalize_url("https://user:password@example.com/article")

    def test_bombay_high_court_old_host_is_exactly_recanonicalized(self):
        source = SourceRecord.from_url(
            "http://WWW.BombayHighCourt.nic.in/orders/a b.pdf#page=2"
        )
        self.assertEqual(
            source.normalized_url,
            "http://www.bombayhighcourt.nic.in/orders/a%20b.pdf",
        )
        self.assertEqual(
            source.canonical_url,
            "https://bombayhighcourt.gov.in/orders/a%20b.pdf",
        )
        self.assertEqual(
            source.authority, SourceAuthority.PRIMARY_LEGAL_AUTHORITY
        )

        spoof = SourceRecord.from_url(
            "https://bombayhighcourt.nic.in.attacker.example/order"
        )
        self.assertEqual(
            spoof.canonical_url,
            "https://bombayhighcourt.nic.in.attacker.example/order",
        )
        self.assertEqual(spoof.authority, SourceAuthority.OTHER)

    def test_authority_classification_uses_exact_maintained_hosts(self):
        cases = {
            "https://www.sci.gov.in/judgements-case-no/": SourceAuthority.PRIMARY_LEGAL_AUTHORITY,
            "https://www.indiacode.nic.in/": SourceAuthority.PRIMARY_LEGAL_AUTHORITY,
            "https://egazzete.mahaonline.gov.in/": SourceAuthority.PRIMARY_LEGAL_AUTHORITY,
            "https://www.pib.gov.in/AllRelease.aspx": SourceAuthority.OFFICIAL_GOVERNMENT,
            "https://maharashtra.gov.in/": SourceAuthority.OFFICIAL_GOVERNMENT,
            "https://igrmaharashtra.gov.in/": SourceAuthority.OFFICIAL_GOVERNMENT,
            "https://indiankanoon.org/doc/1/": SourceAuthority.SECONDARY_LEGAL_DATABASE,
            "https://prsindia.org/billtrack": SourceAuthority.LEGISLATIVE_RESEARCH,
            "https://www.barandbench.com/news": SourceAuthority.SPECIALIST_LEGAL_REPORTING,
            "https://www.livelaw.in/": SourceAuthority.SPECIALIST_LEGAL_REPORTING,
            "https://www.reuters.com/world/india/": SourceAuthority.NEWSWIRE,
            "https://www.ptinews.com/": SourceAuthority.NEWSWIRE,
            "https://www.thehindu.com/news/national/": SourceAuthority.GENERAL_NEWS,
            "https://indianexpress.com/section/legal-news/": SourceAuthority.GENERAL_NEWS,
            "https://pib.gov.in.attacker.example/": SourceAuthority.OTHER,
            "https://random.gov.in/": SourceAuthority.OTHER,
        }
        for url, expected in cases.items():
            with self.subTest(url=url):
                self.assertEqual(classify_authority(url), expected)

    def test_non_public_and_metadata_addresses_are_unsafe(self):
        unsafe = (
            "0.0.0.0",
            "10.0.0.1",
            "127.0.0.1",
            "169.254.1.1",
            "169.254.169.254",
            "100.100.100.200",
            "224.0.0.1",
            "240.0.0.1",
            "::",
            "::1",
            "fe80::1",
            "ff02::1",
            "fd00:ec2::254",
        )
        for address in unsafe:
            with self.subTest(address=address):
                self.assertFalse(is_safe_public_ip(address))
        self.assertTrue(is_safe_public_ip("8.8.8.8"))
        self.assertTrue(is_safe_public_ip("2606:4700:4700::1111"))


class SourceValidatorTests(unittest.IsolatedAsyncioTestCase):
    async def test_bombay_alias_is_applied_before_dns_and_http(self):
        canonical = "https://bombayhighcourt.gov.in/orders/42"
        resolver = FakeResolver()
        transport = ScriptedTransport(
            {
                ("HEAD", canonical): [
                    HttpResponse(200, {"content-type": "application/pdf"})
                ]
            }
        )
        result = await SourceValidator(
            resolver=resolver, transport=transport
        ).validate("bombayhighcourt.nic.in/orders/42")

        self.assertEqual(result.state, ValidationState.VALID)
        self.assertEqual(result.final_url, canonical)
        self.assertEqual(
            result.final_authority, SourceAuthority.PRIMARY_LEGAL_AUTHORITY
        )
        self.assertEqual(resolver.calls, [("bombayhighcourt.gov.in", 443)])
        self.assertEqual(transport.calls[0]["url"], canonical)

    async def test_mixed_public_private_dns_answer_blocks_without_http(self):
        resolver = FakeResolver(
            {"mixed.example": (PUBLIC_IP, "127.0.0.1")}
        )
        transport = ScriptedTransport()
        result = await SourceValidator(
            resolver=resolver, transport=transport
        ).validate("https://mixed.example/article")

        self.assertEqual(result.state, ValidationState.BLOCKED_ADDRESS)
        self.assertEqual(transport.calls, [])

    async def test_direct_metadata_address_blocks_without_dns_or_http(self):
        resolver = FakeResolver()
        transport = ScriptedTransport()
        result = await SourceValidator(
            resolver=resolver, transport=transport
        ).validate("https://169.254.169.254/latest/meta-data/")

        self.assertEqual(result.state, ValidationState.BLOCKED_ADDRESS)
        self.assertEqual(resolver.calls, [])
        self.assertEqual(transport.calls, [])

    async def test_nonstandard_port_is_blocked(self):
        resolver = FakeResolver()
        transport = ScriptedTransport()
        result = await SourceValidator(
            resolver=resolver, transport=transport
        ).validate("https://example.com:8443/article")

        self.assertEqual(result.state, ValidationState.BLOCKED_PORT)
        self.assertEqual(transport.calls, [])

    async def test_every_redirect_target_is_revalidated(self):
        first = "https://start.example/"
        private = "https://127.0.0.1/admin"
        resolver = FakeResolver({"start.example": (PUBLIC_IP,)})
        transport = ScriptedTransport(
            {
                ("HEAD", first): [
                    HttpResponse(302, {"location": private})
                ]
            }
        )
        result = await SourceValidator(
            resolver=resolver, transport=transport
        ).validate(first)

        self.assertEqual(result.state, ValidationState.BLOCKED_ADDRESS)
        self.assertEqual(result.redirect_chain, (first, private))
        self.assertEqual(len(transport.calls), 1)

    async def test_public_redirect_is_followed_manually(self):
        first = "https://start.example/"
        final = "https://publisher.example/article"
        resolver = FakeResolver()
        transport = ScriptedTransport(
            {
                ("HEAD", first): [
                    HttpResponse(301, {"location": final})
                ],
                ("HEAD", final): [
                    HttpResponse(
                        200,
                        {
                            "content-type": "text/html; charset=utf-8",
                            "content-length": "1234",
                        },
                    )
                ],
            }
        )
        result = await SourceValidator(
            resolver=resolver, transport=transport
        ).validate(first)

        self.assertEqual(result.state, ValidationState.VALID)
        self.assertEqual(result.final_url, final)
        self.assertEqual(result.redirect_chain, (first, final))
        self.assertEqual(
            [call["method"] for call in transport.calls], ["HEAD", "HEAD", "GET"]
        )

    async def test_redirect_limit_and_loop_are_explicit(self):
        first = "https://one.example/"
        second = "https://two.example/"
        third = "https://three.example/"
        resolver = FakeResolver()
        limited_transport = ScriptedTransport(
            {
                ("HEAD", first): [HttpResponse(302, {"location": second})],
                ("HEAD", second): [HttpResponse(302, {"location": third})],
            }
        )
        limited = await SourceValidator(
            config=SourceValidationConfig(max_redirects=1, backoff_base_s=0),
            resolver=resolver,
            transport=limited_transport,
        ).validate(first)
        self.assertEqual(limited.state, ValidationState.TOO_MANY_REDIRECTS)

        loop_transport = ScriptedTransport(
            {
                ("HEAD", first): [HttpResponse(302, {"location": second})],
                ("HEAD", second): [HttpResponse(302, {"location": first})],
            }
        )
        loop = await SourceValidator(
            resolver=FakeResolver(), transport=loop_transport
        ).validate(first)
        self.assertEqual(loop.state, ValidationState.INVALID_REDIRECT)
        self.assertIn("loop", loop.reason or "")

    async def test_head_falls_back_to_bounded_get(self):
        url = "https://court.example/order.pdf"
        resolver = FakeResolver()
        transport = ScriptedTransport(
            {
                ("HEAD", url): [HttpResponse(405, {})],
                ("GET", url): [
                    HttpResponse(
                        200,
                        {
                            "content-type": "application/pdf",
                            "content-length": "1000000",
                        },
                        body_sample=b"x" * 16,
                        body_truncated=True,
                    )
                ],
            }
        )
        result = await SourceValidator(
            config=SourceValidationConfig(
                max_response_bytes=16, backoff_base_s=0
            ),
            resolver=resolver,
            transport=transport,
        ).validate(url)

        self.assertEqual(result.state, ValidationState.VALID)
        self.assertEqual(result.body_sample, b"x" * 16)
        self.assertEqual(result.sampled_bytes, 16)
        self.assertTrue(result.body_truncated)
        self.assertEqual(
            [call["method"] for call in transport.calls], ["HEAD", "GET"]
        )
        self.assertEqual(transport.calls[1]["headers"]["Range"], "bytes=0-15")
        self.assertEqual(transport.calls[1]["max_response_bytes"], 16)

    async def test_supported_head_fetches_bounded_sample_by_default(self):
        url = "https://publisher.example/article"
        transport = ScriptedTransport(
            {
                ("HEAD", url): [
                    HttpResponse(200, {"content-type": "text/html"})
                ],
                ("GET", url): [
                    HttpResponse(
                        206,
                        {"content-type": "text/html"},
                        body_sample=b"quoted text",
                    )
                ],
            }
        )
        result = await SourceValidator(
            config=SourceValidationConfig(
                max_response_bytes=32, backoff_base_s=0
            ),
            resolver=FakeResolver(),
            transport=transport,
        ).validate(url)

        self.assertEqual(result.state, ValidationState.VALID)
        self.assertEqual(result.body_sample, b"quoted text")
        self.assertLessEqual(len(result.body_sample), 32)
        self.assertEqual(
            [call["method"] for call in transport.calls], ["HEAD", "GET"]
        )


    async def test_empty_and_soft_error_pages_are_not_valid(self):
        url = "https://publisher.example/article"
        for body, expected in (
            (b"", ValidationState.EMPTY_RESPONSE),
            (b"<html><title>404 - Page not found</title></html>", ValidationState.NOT_FOUND),
            (b"<html><title>Attention Required</title>Verify you are human</html>", ValidationState.ACCESS_RESTRICTED),
        ):
            with self.subTest(expected=expected):
                transport = ScriptedTransport({
                    ("HEAD", url): [HttpResponse(200, {"content-type": "text/html"})],
                    ("GET", url): [HttpResponse(200, {"content-type": "text/html"}, body_sample=body)],
                })
                result = await SourceValidator(
                    config=SourceValidationConfig(max_retries=0, backoff_base_s=0),
                    resolver=FakeResolver(),
                    transport=transport,
                ).validate(url)
                self.assertEqual(result.state, expected)

    async def test_status_and_mime_states_are_distinct(self):
        url = "https://publisher.example/article"
        scenarios = (
            (
                [HttpResponse(404, {"content-type": "text/html"})],
                None,
                ValidationState.NOT_FOUND,
            ),
            (
                [HttpResponse(200, {"content-type": "image/png"})],
                None,
                ValidationState.UNSUPPORTED_MEDIA_TYPE,
            ),
            (
                [HttpResponse(204, {"content-type": "text/html"})],
                None,
                ValidationState.EMPTY_RESPONSE,
            ),
            (
                [HttpResponse(200, {})],
                [HttpResponse(200, {})],
                ValidationState.MISSING_MEDIA_TYPE,
            ),
            (
                [HttpResponse(403, {})],
                [HttpResponse(403, {"content-type": "text/html"})],
                ValidationState.ACCESS_RESTRICTED,
            ),
        )
        for head_outcomes, get_outcomes, expected in scenarios:
            with self.subTest(expected=expected):
                script = {("HEAD", url): head_outcomes}
                if get_outcomes is not None:
                    script[("GET", url)] = get_outcomes
                result = await SourceValidator(
                    config=SourceValidationConfig(
                        max_retries=0, backoff_base_s=0
                    ),
                    resolver=FakeResolver(),
                    transport=ScriptedTransport(script),
                ).validate(url)
                self.assertEqual(result.state, expected)

    async def test_timeout_is_retried_then_succeeds(self):
        url = "https://publisher.example/"
        transport = ScriptedTransport(
            {
                ("HEAD", url): [
                    RequestTimeoutError(),
                    RequestTimeoutError(),
                    HttpResponse(200, {"content-type": "text/html"}),
                ]
            }
        )
        result = await SourceValidator(
            config=SourceValidationConfig(
                max_retries=2, backoff_base_s=0
            ),
            resolver=FakeResolver(),
            transport=transport,
            sleep=no_sleep,
        ).validate(url)

        self.assertEqual(result.state, ValidationState.VALID)
        self.assertEqual(result.attempts, 4)

    async def test_exhausted_timeout_is_not_reported_as_dead(self):
        url = "https://publisher.example/"
        transport = ScriptedTransport(
            {
                ("HEAD", url): [
                    RequestTimeoutError(),
                    RequestTimeoutError(),
                ]
            }
        )
        result = await SourceValidator(
            config=SourceValidationConfig(
                max_retries=1, backoff_base_s=0
            ),
            resolver=FakeResolver(),
            transport=transport,
            sleep=no_sleep,
        ).validate(url)

        self.assertEqual(result.state, ValidationState.TIMEOUT)
        self.assertEqual(result.attempts, 2)
        self.assertFalse(result.is_valid)

    async def test_batch_concurrency_is_bounded_and_order_is_preserved(self):
        urls = [f"https://source-{index}.example/article" for index in range(8)]
        transport = ScriptedTransport(delay_s=0.01)
        validator = SourceValidator(
            config=SourceValidationConfig(
                max_concurrency=2, backoff_base_s=0
            ),
            resolver=FakeResolver(),
            transport=transport,
        )
        results = await validator.validate_many(urls, concurrency=20)

        self.assertLessEqual(transport.max_active, 2)
        self.assertEqual(
            [result.source.original_url for result in results], urls
        )
        self.assertTrue(all(result.state is ValidationState.VALID for result in results))

    async def test_sources_over_per_call_limit_are_explicitly_skipped(self):
        urls = [f"https://source-{index}.example/" for index in range(3)]
        transport = ScriptedTransport()
        results = await SourceValidator(
            config=SourceValidationConfig(
                max_sources_per_call=2, max_concurrency=2, backoff_base_s=0
            ),
            resolver=FakeResolver(),
            transport=transport,
        ).validate_many(urls)

        self.assertEqual(
            [result.state for result in results],
            [
                ValidationState.VALID,
                ValidationState.VALID,
                ValidationState.SOURCE_LIMIT_EXCEEDED,
            ],
        )
        self.assertEqual(len(transport.calls), 4)


class FakeStreamResponse:
    def __init__(self, chunks):
        self.status_code = 200
        self.headers = {"content-type": "text/html"}
        self._chunks = chunks
        self.yielded = 0

    async def aiter_raw(self, chunk_size):
        self.chunk_size = chunk_size
        for chunk in self._chunks:
            self.yielded += 1
            yield chunk


class FakeStreamContext:
    def __init__(self, response):
        self.response = response

    async def __aenter__(self):
        return self.response

    async def __aexit__(self, exc_type, exc, tb):
        return False


class FakeHttpxClient:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def stream(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return FakeStreamContext(self.response)


class HttpxTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_transport_stops_after_bounded_body_sample(self):
        response = FakeStreamResponse([b"a" * 8, b"b" * 8, b"c" * 8])
        client = FakeHttpxClient(response)
        result = await HttpxTransport(client).request(
            "GET",
            "https://example.com/",
            headers={"Accept-Encoding": "identity"},
            timeout_s=1,
            max_response_bytes=10,
            resolved_addresses=(PUBLIC_IP,),
        )

        self.assertEqual(result.body_sample, b"a" * 8 + b"b" * 2)
        self.assertTrue(result.body_truncated)
        self.assertEqual(response.yielded, 2)
        method, requested_url, kwargs = client.calls[0]
        self.assertEqual(method, "GET")
        self.assertEqual(requested_url, f"https://{PUBLIC_IP}/")
        self.assertEqual(kwargs["headers"]["Host"], "example.com")
        self.assertEqual(kwargs["extensions"]["sni_hostname"], "example.com")
        self.assertFalse(kwargs["follow_redirects"])

    async def test_transport_refuses_missing_or_non_public_pinned_addresses(self):
        response = FakeStreamResponse([])
        client = FakeHttpxClient(response)
        for addresses in ((), ("127.0.0.1",), ("not-an-ip",)):
            with self.subTest(addresses=addresses):
                with self.assertRaises(RequestNetworkError):
                    await HttpxTransport(client).request(
                        "HEAD",
                        "https://example.com/",
                        headers={},
                        timeout_s=1,
                        max_response_bytes=10,
                        resolved_addresses=addresses,
                    )
        self.assertEqual(client.calls, [])


if __name__ == "__main__":
    unittest.main()
