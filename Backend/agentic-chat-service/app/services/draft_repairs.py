"""Deterministic (zero-LLM) repair chain for monolithic drafts.

After the one-shot draft streams, ``_monolithic_deterministic_repairs`` runs
an ORDERED chain of pure-text repairs — cause-title dedupe, option-menu
narrowing, annexure re-marking, prayer/placeholder cleanup, chronology merge,
continuous body renumbering, verification/statement-of-truth rebuild and
more. Order is semantics: structural deletions run BEFORE renumbering so the
attestation ranges are computed from the final paragraph layout; the
annexure renumber and List-of-Documents rebuild each intentionally run twice.

Also home to the deterministic post-draft lints (``_factual_strength_lint``,
``_table_mark_collisions``) that queue findings for the revision pass.

Everything here is deterministic and free — no model calls, guaranteed
behavior, unit-tested in ``tests/test_monolithic_repairs.py``.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Optional

from app.services.draft_facts import (
    _build_doc_state,
    _digits_only,
    _extract_inventory_block,
    _extract_matrix_rows,
    _plan_exhibits,
    _strip_markdown_artifacts,
    _ws_norm,
)

logger = logging.getLogger(__name__)

_PARA_LINE_FULL_RE = re.compile(r"(?m)^(\s{0,8})(\d{1,3})(?:\.(\d{1,2}))?([.)])(\s)")


_PARA_REF_RE = re.compile(r"\b([Pp]aragraphs?\s+)((?:\d+(?:\.\d+)?)(?:\s*(?:,|and|to|–|-)\s*\d+(?:\.\d+)?)*)")


_ANNEX_FIRST_RE = re.compile(
    r"(annexed\s+here(?:to|with)\s+and\s+marked\s+as\s+|annexed\s+as\s+|marked\s+as\s+)"
    r"(\*\*)?(ANNEXURE)\s+([A-Z]{1,2})[-\u2011 ]?(\d+)",
    re.IGNORECASE,
)


def _renumber_annexures(text: str) -> tuple[str, dict[str, Any]]:
    """One document = one mark, enforced deterministically.

    The model sometimes collapses many documents onto few marks (P-1 used for
    five different documents). Every first-reliance site ("… marked as
    ANNEXURE P-x") is re-marked sequentially in order of appearance; later
    bare citations are remapped to the nearest preceding introduction mark.
    Collective exhibits ("Colly") are left untouched — collapsing is legitimate there."""
    if re.search(r"\bcolly\b", text, re.IGNORECASE):
        return text, {}
    firsts = list(_ANNEX_FIRST_RE.finditer(text))
    if not firsts:
        return text, {}
    letter = firsts[0].group(4).upper()
    old_marks = [f"{m.group(4).upper()}-{m.group(5)}" for m in firsts]
    expected = [f"{letter}-{i + 1}" for i in range(len(firsts))]
    if old_marks == expected:
        return text, {}

    old_to_new: dict[str, set[str]] = {}
    register: list[tuple[str, str]] = []
    parts: list[str] = []
    cursor = 0
    for i, m in enumerate(firsts):
        new_mark = f"{letter}-{i + 1}"
        old_to_new.setdefault(old_marks[i], set()).add(new_mark)
        bold = m.group(2) or ""
        parts.append(text[cursor:m.start()])
        parts.append(f"{m.group(1)}{bold}ANNEXURE \x00{new_mark}\x00")
        cursor = m.end()
        sent_start = max(text.rfind("\n", 0, m.start()), text.rfind(". ", 0, m.start()) + 1, 0)
        register.append((new_mark, text[sent_start:m.start()].strip()[:90]))
    parts.append(text[cursor:])
    out = "".join(parts)

    ambiguous = sorted(o for o, news in old_to_new.items() if len(news) > 1)
    # Unambiguous old marks: global remap is safe
    for old, news in old_to_new.items():
        if len(news) == 1:
            out = re.sub(
                rf"ANNEXURE\s+{re.escape(old.split('-')[0])}[-\u2011 ]?{old.split('-')[1]}\b",
                f"ANNEXURE \x00{next(iter(news))}\x00", out,
            )
    # Ambiguous (and any leftover bare cites): nearest preceding introduction
    if ambiguous:
        out = _remap_bare_annexure_citations(out)
    out = re.sub(r"\x00([A-Z]{1,2}-\d+)\x00", r"\1", out)
    return out, {"count": len(firsts), "ambiguous": ambiguous, "register": register}


def _reconcile_interim_relief(text: str) -> tuple[str, list[str]]:
    """When the body declares no interim relief is sought, DELETE leftover
    template prayer clauses asking for ad-interim relief / a receiver, then
    reletter the remaining clauses. Permanent-injunction prayers stay — they
    are final relief and do not contradict the declaration."""
    if not re.search(r"no\s+(?:ad[- ]?)?interim\s+relief\s+is\s+(?:being\s+)?sought",
                     text, re.IGNORECASE):
        return text, []
    pm = re.search(r"^\s*(?:\*\*)?\s*PRAYER", text, re.MULTILINE | re.IGNORECASE) \
        or re.search(r"(?:most\s+respectfully|humbly)\s+prays?|prays?\s+(?:that|as\s+follows)",
                     text, re.IGNORECASE)
    if not pm:
        return text, []
    start = pm.start()
    endm = re.search(
        r"\n\s*(?:\*\*)?\s*(VERIFICATION|STATEMENT\s+OF\s+TRUTH|Place\s*:|Dated?\s*[:.])",
        text[start:], re.IGNORECASE,
    )
    end = start + endm.start() if endm else len(text)
    region = text[start:end]
    starts = list(re.finditer(r"^\s*\(([a-z])\)", region, re.MULTILINE))
    if not starts:
        return text, []
    bad = re.compile(
        r"ad[- ]?interim|court\s+receiver|receiver\s+be\s+appointed"
        r"|appointment\s+of\s+a?\s*receiver"
        r"|interim\s+(?:injunction|relief|protection|order)",
        re.IGNORECASE,
    )
    kept: list[str] = []
    removed: list[str] = []
    for i, sm in enumerate(starts):
        seg_end = starts[i + 1].start() if i + 1 < len(starts) else len(region)
        seg = region[sm.start():seg_end]
        if bad.search(seg):
            removed.append(sm.group(1))
        else:
            kept.append(seg)
    if not removed:
        return text, []
    relettered = [
        re.sub(r"\(([a-z])\)", f"({chr(ord('a') + i)})", seg, count=1)
        for i, seg in enumerate(kept)
    ]
    new_region = region[:starts[0].start()] + "".join(relettered)
    return text[:start] + new_region + text[end:], removed


_CAPTION_HEADER_RE = re.compile(
    r"(?im)^[ \t>*_#]*(?:IN\s+THE|BEFORE\s+THE)\b[^\n]*?"
    r"(?:COURT|TRIBUNAL|COMMISSION|FORUM|AUTHORITY|ARBITRATOR)\b[^\n]*$")


_BODY_BOUNDARY_RE = re.compile(
    r"(?im)^[ \t>*_#]*(?:PLAINT|PETITION|APPLICATION|WRITTEN\s+STATEMENT|"
    r"STATEMENT\s+OF\s+FACTS|FACTS\s+IN\s+BRIEF|COMPLAINT)\s*(?:\*\*)?\s*$")


_PARTY_TOKEN_RE = re.compile(
    r"\b(?:versus|vs\.?|plaintiff|defendant|petitioner|respondent|applicant|appellant)\b",
    re.IGNORECASE)


def _norm_caption_line(ln: str) -> str:
    """Markdown/whitespace/dot-leader-insensitive caption-line fingerprint."""
    return re.sub(r"\s+", " ", re.sub(r"[*_#>|]|\.{3,}|\u2026", " ", ln)).strip().lower()


def _shingle_containment(sample: str, corpus: str, size: int = 8, step: int = 4) -> float:
    """Fraction of `sample`'s normalized `size`-word shingles present in `corpus`."""
    s_words = re.sub(r"[^a-z0-9]+", " ", (sample or "").lower()).split()
    c_norm = " ".join(re.sub(r"[^a-z0-9]+", " ", (corpus or "").lower()).split())
    if not s_words:
        return 0.0
    if len(s_words) < size:
        return 1.0 if " ".join(s_words) in c_norm else 0.0
    shingles = [" ".join(s_words[i:i + size]) for i in range(0, len(s_words) - size + 1, step)]
    return sum(1 for s in shingles if s in c_norm) / len(shingles)


def _strip_restarted_document(text: str) -> tuple[str, int]:
    """Cut appended re-drafts of the WHOLE document (returns (text, removed)).

    A continuation call that restarts from the caption instead of appending
    produces: [complete draft][same draft again]…. `_dedupe_cause_title` only
    guards the caption area (first ~15k chars); this net finds a later
    re-match of the document's opening line and, when the following content is
    substantially a replay of everything before it (8-word-shingle containment
    ≥60 % over a ≥500-char sample), truncates there. Near Memo of Parties /
    affidavit / vakalatnama / verification the bar rises to 90 % so a
    court-header-first annexed filing is preserved while a verbatim whole-
    document restart after VERIFICATION (containment ≈1.0) is still cut. The
    heading guard looks BOTH before and after the re-match (standard Indian
    layout puts the instrument title under the court header). Repeats until
    no restart remains; single-copy documents are returned untouched.
    """
    _HEAD_RE = r"(?i)memo\s+of\s+parties|affidavit|vakalatnama|verification"
    removed = 0
    if not text or len(text) < 400:
        return text, 0
    while True:
        anchor_words: list[str] = []
        for line in text.splitlines():
            words = re.findall(r"[A-Za-z0-9]+", line)
            if len(words) >= 4:
                anchor_words = words[:8]
                break
        if not anchor_words:
            break
        pattern = r"[\W_]*".join(re.escape(w) for w in anchor_words)
        matches = list(re.finditer(pattern, text, re.IGNORECASE))
        if len(matches) < 2:
            break
        opening_has_head = bool(re.search(_HEAD_RE, text[:400]))
        cut_at = None
        for m in matches[1:]:
            pos = m.start()
            if pos < len(text) * 0.3:
                continue  # caption area — _dedupe_cause_title's territory
            # Guard window: 250 chars BEFORE + 400 AFTER. After-pos only when
            # the opening is not itself a memo/affidavit (else every true
            # restart of such a document would look "guarded").
            pre = text[max(0, pos - 250):pos]
            post = text[pos:pos + 400]
            guarded = bool(
                re.search(_HEAD_RE, pre)
                or (re.search(_HEAD_RE, post) and not opening_has_head)
            )
            sample = text[pos:pos + 4000]
            if len(sample) < 500:
                continue
            # Near a protected heading demand near-verbatim replay; elsewhere
            # the looser 0.6 bar catches lightly reworded restarts.
            bar = 0.9 if guarded else 0.6
            if _shingle_containment(sample, text[:pos]) >= bar:
                cut_at = pos
                break
        if cut_at is None:
            break
        line_start = text.rfind("\n", 0, cut_at) + 1
        # Only cut at the line boundary when nothing substantive precedes the
        # anchor on its own line (e.g. '**' bold markers).
        prefix = text[line_start:cut_at]
        if re.sub(r"[\W_]+", "", prefix):
            line_start = cut_at
        text = text[:line_start].rstrip() + "\n"
        removed += 1
        logger.info("Stripped a restarted duplicate document copy at char %s", line_start)
    return text, removed


def _dedupe_cause_title(text: str) -> tuple[str, bool]:
    """Delete caption blocks that REPLAY the first one (court header + party
    blocks), anywhere before the body boundary. Markdown-, case- and
    dot-leader-insensitive; a legitimate MEMO OF PARTIES restatement and
    annexed-affidavit captions after the body are preserved."""
    changed = False
    heads = list(_CAPTION_HEADER_RE.finditer(text))
    body_m = _BODY_BOUNDARY_RE.search(text)
    scan_end = body_m.end() if body_m else min(len(text), 15000)
    first_sig: list[str] = []
    if len(heads) >= 2:
        first_sig = [l for l in (_norm_caption_line(x) for x in
                     text[heads[0].start():heads[1].start()].splitlines()) if l]
    # Pass 1: delete later caption blocks that replay the first, line-by-line
    # (>=4 matched normalized lines incl. a party/VERSUS token).
    for h in (reversed(heads[1:]) if first_sig else ()):
        if h.start() > scan_end:
            continue
        # A Memo of Parties legitimately restates the caption — keep it.
        # Heading-anchored: an INDEX row merely MENTIONING "Memo of Parties"
        # must not shield a genuine duplicate.
        if re.search(r"(?im)^[ 	>*_#]*MEMO\s+OF\s+PARTIES[ 	*_#:]*$",
                     text[max(0, h.start() - 200):h.start()]):
            continue
        consumed = matched = k = 0
        saw_party = False
        for ln in text[h.start():].splitlines(keepends=True):
            n = _norm_caption_line(ln)
            if not n:
                consumed += len(ln)
                continue
            if k < len(first_sig) and n == first_sig[k]:
                step = 1
            elif k + 1 < len(first_sig) and n == first_sig[k + 1]:
                step = 2  # one-line skip tolerance
            else:
                break
            matched += 1
            k += step
            consumed += len(ln)
            saw_party = saw_party or bool(_PARTY_TOKEN_RE.search(n))
        if matched >= 4 and saw_party:
            text = text[:h.start()] + text[h.start() + consumed:]
            changed = True
    # Pass 2: a second bare VERSUS + replayed party tail inside the first
    # caption (the shape the old implementation targeted).
    heads = list(_CAPTION_HEADER_RE.finditer(text))
    if heads:
        body_m = _BODY_BOUNDARY_RE.search(text)
        cap_end = body_m.end() if body_m else (
            heads[1].start() if len(heads) > 1 else min(len(text), 15000))
        text2, trimmed = _trim_repeated_versus_tail(text, heads[0].start(), cap_end)
        if trimmed:
            text, changed = text2, True
    return text, changed


def _trim_repeated_versus_tail(text: str, cap_start: int, cap_end: int) -> tuple[str, bool]:
    """Trim a second VERSUS line + replay of already-seen party lines."""
    lines = text[cap_start:cap_end].splitlines(keepends=True)
    norms = [_norm_caption_line(l) for l in lines]
    vi = [i for i, n in enumerate(norms) if re.fullmatch(r"versus|vs\.?", n)]
    if len(vi) < 2:
        return text, False
    seen = {n for n in norms[:vi[1]] if n}
    i, j, replayed = vi[1], vi[1] + 1, 0
    while j < len(lines) and (not norms[j] or norms[j] in seen):
        replayed += bool(norms[j])
        j += 1
    if not replayed:
        return text, False
    return text[:cap_start] + "".join(lines[:i] + lines[j:]) + text[cap_end:], True


def _strip_prayer_placeholders(text: str) -> tuple[str, list[str]]:
    """Remove prayer sub-clauses that still contain [DATA NOT PROVIDED] markers."""
    pm = re.search(r"^\s*(?:\*\*)?\s*PRAYER", text, re.MULTILINE | re.IGNORECASE) \
        or re.search(r"(?:most\s+respectfully|humbly)\s+prays?|prays?\s+(?:that|as\s+follows)",
                     text, re.IGNORECASE)
    if not pm:
        return text, []
    start = pm.start()
    endm = re.search(
        r"\n\s*(?:\*\*)?\s*(VERIFICATION|STATEMENT\s+OF\s+TRUTH|Place\s*:|Dated?\s*[:.])",
        text[start:], re.IGNORECASE,
    )
    end = start + endm.start() if endm else len(text)
    region = text[start:end]
    starts = list(re.finditer(r"^\s*\(([a-z])\)", region, re.MULTILINE))
    if not starts:
        return text, []
    ph_re = re.compile(r"\[DATA NOT PROVIDED:[^\]]*\]|\[MISSING:[^\]]*\]", re.I)
    kept: list[str] = []
    removed: list[str] = []
    for i, sm in enumerate(starts):
        seg_end = starts[i + 1].start() if i + 1 < len(starts) else len(region)
        seg = region[sm.start():seg_end]
        if ph_re.search(seg):
            removed.append(sm.group(1))
        else:
            kept.append(seg)
    if not removed:
        return text, []
    relettered = [
        re.sub(r"\(([a-z])\)", f"({chr(ord('a') + i)})", seg, count=1)
        for i, seg in enumerate(kept)
    ]
    new_region = region[:starts[0].start()] + "".join(relettered)
    return text[:start] + new_region + text[end:], removed


def _fix_admitted_dues_wording(text: str, facts_digest: str = "") -> tuple[str, bool]:
    """Use 'claimed/outstanding dues' when liability was denied in the reply."""
    new, changed = _fix_overstated_defendant_reply(text, facts_digest)
    return new, changed


def _fix_proceedings_placeholder(text: str) -> tuple[str, bool]:
    """Replace '[particulars, if any]' with a negative averment when appropriate."""
    patterns = (
        r"save\s+and\s+except\s+\[particulars,?\s*if\s+any\]",
        r"\[particulars,?\s*if\s+any\]",
        r"save\s+and\s+except\s+_{3,}",
    )
    repl = (
        "save and except that there are no other proceedings pending between the parties "
        "relating to the subject matter of this suit"
    )
    new = text
    for pat in patterns:
        new = re.sub(pat, repl, new, flags=re.I)
    return new, new != text


def _sanitize_statute_years(text: str, facts_digest: str = "") -> tuple[str, bool]:
    """Correct wrong statute years when the digest states the authoritative year."""
    digest = facts_digest or ""
    # Build Act → year map from digest (Companies Act, LLP Act, etc.)
    act_years: dict[str, str] = {}
    for act, year in re.findall(
        r"((?:Companies|Limited Liability Partnership|Partnership|Arbitration|Contract)\s+Act),?\s*(\d{4})",
        digest,
        re.I,
    ):
        act_years[act.strip().lower()] = year
    if not act_years:
        return text, False
    new = text
    for act_key, year in act_years.items():
        # act_key like "companies act"
        short = act_key.replace(" act", "")
        pat = rf"({re.escape(short)}\s+Act,?\s*)(\d{{4}})"
        new = re.sub(
            pat,
            lambda mo, y=year: f"{mo.group(1)}{y}" if mo.group(2) != y else mo.group(0),
            new,
            flags=re.I,
        )
    return new, new != text


def _fix_deponent_age_placeholder(text: str) -> tuple[str, bool]:
    """Neutralize missing age/designation/date slots in sworn / signature blocks."""
    new = text
    # aged [DATA NOT PROVIDED: …] → drop the aged clause (age unknown)
    new = re.sub(
        r",?\s*aged\s*\[DATA NOT PROVIDED:\s*[^\]]*\]",
        "",
        new,
        flags=re.I,
    )
    new = re.sub(
        r"\[DATA NOT PROVIDED:\s*(?:Deponent Age|Age of Deponent|Signatory Age|"
        r"Age|Designation|Deponent Designation|Signatory Designation|"
        r"Date|Dated|Verification Date|Place)[^\]]*\]",
        "____",
        new,
        flags=re.I,
    )
    # Common sworn blanks left empty mid-sentence: "aged ," / "designation ,"
    new = re.sub(r",?\s*aged\s*,", ",", new, flags=re.I)
    new = re.sub(
        r"(designation\s*(?:of\s*)?(?:the\s+)?(?:deponent|signatory)?\s*:?\s*),",
        r"\1____,",
        new,
        flags=re.I,
    )
    new = re.sub(r"(?im)^(Place\s*:?\s*)$", r"\1 ____", new)
    new = re.sub(r"(?im)^(Dated?\s*:?\s*)$", r"\1 ____", new)
    new = re.sub(r"(?im)^(Place\s*:?\s*)\[DATA NOT PROVIDED:[^\]]*\]", r"\1____", new)
    new = re.sub(r"(?im)^(Dated?\s*:?\s*)\[DATA NOT PROVIDED:[^\]]*\]", r"\1____", new)
    return new, new != text


def _fix_unsupported_authorized_signatory(
    text: str, facts_digest: str = "",
) -> tuple[str, bool]:
    """Downgrade 'authorized/authorised signatory' when inventory does not support it.

    Classic defect: naming a project contact (e.g. Kavya Mehta) as the Plaintiff's
    authorized signatory when the digest only records a job title / correspondence role.
    """
    if not text or not re.search(r"authori[sz]ed\s+signator", text, re.I):
        return text, False
    digest = facts_digest or ""
    digest_l = digest.lower()
    # Names the inventory explicitly marks as authorized signatory
    authorized_names: set[str] = set()
    for m in re.finditer(
        r"(?im)^[-•*]?\s*Authori[sz]ed\s+Signatory(?:\s+Name)?\s*:\s*(.+)$",
        digest,
    ):
        name = re.sub(r"\[Source:[^\]]*\]", "", m.group(1), flags=re.I).strip(" .;")
        if len(name) >= 4 and "required-but-absent" not in name.lower():
            authorized_names.add(name.lower())
    for m in re.finditer(
        r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+).{0,40}authori[sz]ed\s+signator",
        digest,
        re.I,
    ):
        authorized_names.add(m.group(1).strip().lower())

    # Title map: person → best non-signatory title from digest
    title_map: dict[str, str] = {}
    for m in re.finditer(
        r"([A-Z][a-z]+(?:\s+[A-Z][a-z.]+)+)\s*[,–—-]\s*"
        r"((?:Head|Director|Manager|Officer|CEO|CFO|CTO|Company Secretary|"
        r"Partner|Proprietor)[^.\n,]{0,60})",
        digest,
    ):
        title_map[m.group(1).strip().lower()] = m.group(2).strip()

    changed = False
    new = text

    def _rewrite(m: re.Match[str]) -> str:
        nonlocal changed
        full = m.group(0)
        # Extract a nearby proper name
        name_m = re.search(
            r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b",
            full,
        )
        if not name_m:
            return full
        name = name_m.group(1)
        if name.lower() in authorized_names:
            return full
        # Inventory does not support this person as authorized signatory
        title = title_map.get(name.lower())
        changed = True
        if title:
            return re.sub(
                r"authori[sz]ed\s+signatory",
                title,
                full,
                count=1,
                flags=re.I,
            )
        return re.sub(
            r"(?:duly\s+)?authori[sz]ed\s+signatory",
            "representative",
            full,
            count=1,
            flags=re.I,
        )

    # Patterns covering "X, the authorized signatory" and "authorized signatory … X"
    new = re.sub(
        r"[^.!\n]{0,80}authori[sz]ed\s+signator(?:y|ies)[^.!\n]{0,80}",
        _rewrite,
        new,
        flags=re.I,
    )
    return new, changed or new != text


def _fix_overstated_defendant_reply(
    text: str, facts_digest: str = "",
) -> tuple[str, bool]:
    """Neutralize overstated 'Defendant admitted …' when liability was denied."""
    digest_l = (facts_digest or "").lower()
    denied = any(
        p in digest_l
        for p in (
            "denied liability", "denies liability", "deny liability",
            "disputed liability", "disputes liability", "not admitted",
            "without admitting liability", "denied the claim", "denies the claim",
            "disputed the amount", "denies obligation", "denied the dues",
        )
    )
    if not denied:
        return text, False
    new = text
    reps = (
        (r"\badmitted\s+dues\b", "outstanding dues"),
        (r"\badmitted\s+amount\b", "claimed amount"),
        (r"\badmitted\s+(?:its\s+)?(?:the\s+)?(?:liability|debt|obligation)s?\b",
         "disputed liability"),
        (r"\b(?:the\s+)?Defendant\s+admitted\s+(?:the\s+)?(?:dues|debt|liability|claim)\b",
         "the Defendant disputed the claim"),
        (r"\b(?:the\s+)?Defendant\s+admitted\b", "the Defendant acknowledged"),
        (r"\badmitted\s+by\s+(?:the\s+)?Defendant\b", "acknowledged by the Defendant"),
        (r"\ban\s+admission\s+of\s+(?:liability|debt|dues)\b",
         "an acknowledgment without admission of liability"),
    )
    for pat, repl in reps:
        new = re.sub(pat, repl, new, flags=re.I)
    return new, new != text


def _restart_inline_attestation_numbering(text: str) -> tuple[str, bool]:
    """Restart Verification / Statement of Truth paragraph numbers at 1 inside one blob.

    Monolithic drafts put attestation inside the same __document__ section, so
    section-heading-based normalization never sees them — SoT often continues as 49…
    """
    if not text:
        return text or "", False
    head_re = re.compile(
        r"(?im)^[ \t>*_#]*(?:\*\*)?(STATEMENT\s+OF\s+TRUTH|VERIFICATION|AFFIDAVIT"
        r"(?:\s+OF\s+[A-Z][^\n*]{0,40})?)(?:\*\*)?\s*$"
    )
    stops = re.compile(
        r"(?im)^[ \t>*_#]*(?:\*\*)?(STATEMENT\s+OF\s+TRUTH|VERIFICATION|AFFIDAVIT|"
        r"LIST\s+OF\s+DOCUMENTS|INDEX|PRAYER|SCHEDULE|ANNEXURE|PLACE\s*:|DATED?\s*:)"
        r"(?:\*\*)?\s*"
    )
    matches = list(head_re.finditer(text))
    if not matches:
        return text, False
    pieces: list[str] = []
    cursor = 0
    changed = False
    for i, hm in enumerate(matches):
        # Region starts at first numbered para after the heading
        region_start = hm.end()
        # End at next attestation/major heading or EOF
        region_end = len(text)
        for sm in stops.finditer(text, region_start):
            # skip the heading we just matched
            if sm.start() <= hm.start():
                continue
            # Don't stop on Place:/Dated: that are part of this block if they
            # appear after numbered paras — only stop on other instrument heads
            label = sm.group(1).upper() if sm.lastindex else sm.group(0).upper()
            if label.startswith("PLACE") or label.startswith("DATED"):
                continue
            region_end = sm.start()
            break
        # Also stop before next attestation heading from matches
        if i + 1 < len(matches):
            region_end = min(region_end, matches[i + 1].start())

        pieces.append(text[cursor:region_start])
        region = text[region_start:region_end]
        para_matches = list(_PARA_LINE_FULL_RE.finditer(region))
        if para_matches and int(para_matches[0].group(2)) != 1:
            a_counter_box = [0]
            a_map_box: dict[int, int] = {}

            def _renum(m: re.Match[str]) -> str:
                om = int(m.group(2))
                if om not in a_map_box:
                    a_counter_box[0] += 1
                    a_map_box[om] = a_counter_box[0]
                nm = a_map_box[om]
                sub = m.group(3)
                mid = f"{nm}.{sub}" if sub else f"{nm}"
                return f"{m.group(1)}{mid}{m.group(4)}{m.group(5)}"

            region = _PARA_LINE_FULL_RE.sub(_renum, region)
            changed = True
        pieces.append(region)
        cursor = region_end
    pieces.append(text[cursor:])
    return "".join(pieces), changed


def _remap_bare_annexure_citations(text: str) -> str:
    """After first-reliance remapping, point bare ANNEXURE P-n cites at nearest intro."""
    # Protected marks use \x00P-n\x00
    protected = [
        (m.start(), m.group(1))
        for m in re.finditer(r"\x00([A-Z]{1,2}-\d+)\x00", text)
    ]
    if not protected:
        return text

    def _bare(m: re.Match[str]) -> str:
        pos = m.start()
        letter = m.group(1).upper()
        # Find nearest preceding protected mark with same letter
        best = None
        for ppos, mark in protected:
            if ppos > pos:
                break
            if mark.startswith(f"{letter}-"):
                best = mark
        if best:
            return f"ANNEXURE \x00{best}\x00"
        return m.group(0)

    return re.sub(
        r"ANNEXURE\s+([A-Z]{1,2})[-\u2011 ]?(\d+)\b",
        _bare,
        text,
        flags=re.I,
    )


_INTERNAL_NOTE_RE = re.compile(
    r"(?is)(?:^|\n)\s*(?:\d{1,3}[.)]\s*)?(?:"
    r"\[?\s*(?:INTERNAL\s+)?(?:DRAFTING\s+)?NOTE\b|"
    r"NOTE\s+TO\s+(?:DRAFTER|SELF|REVIEWER)\b|"
    r"TODO\s*:|FIXME\s*:|"
    r"\(?(?:as\s+an?\s+AI|I\s+should|the\s+model\s+should|"
    r"this\s+paragraph\s+is\s+a\s+placeholder|"
    r"internal\s+comment)\b"
    r").*?(?=\n\s*\d{1,3}[.)]\s|\n\s*(?:\*\*)?(?:PRAYER|VERIFICATION|STATEMENT\s+OF\s+TRUTH|LIST\s+OF)|$)",
)


_CORRUPT_TABLE_LINE_RE = re.compile(
    r"(?m)^[ \t]*\|[ \t]*(?:[-:|=+*_ ]{8,}|[-–—]{3,})[ \t]*\|?[ \t]*$"
)


def _paragraph_span(text: str, para_num: int) -> Optional[tuple[int, int]]:
    """Return [start, end) of numbered paragraph para_num through next main para/heading."""
    matches = list(_PARA_LINE_FULL_RE.finditer(text))
    for i, m in enumerate(matches):
        if int(m.group(2)) != para_num or m.group(3):
            continue
        start = m.start()
        end = len(text)
        for nxt in matches[i + 1:]:
            if not nxt.group(3):  # next main paragraph
                end = nxt.start()
                break
        # Also stop at major instrument headings
        stop = re.search(
            r"(?im)^[ \t]*(?:\*\*)?(?:PRAYER|VERIFICATION|STATEMENT\s+OF\s+TRUTH|"
            r"LIST\s+OF\s+DOCUMENTS|SCHEDULE)\b",
            text[start + 1:end],
        )
        if stop:
            end = start + 1 + stop.start()
        return start, end
    return None


def _remove_internal_note_paragraphs(text: str) -> tuple[str, list[int]]:
    """Delete paragraphs that are drafting/internal meta-notes (e.g. para 22 notes)."""
    if not text:
        return text or "", []
    removed: list[int] = []
    matches = list(_PARA_LINE_FULL_RE.finditer(text))
    # Walk backwards so indices stay valid
    for i in range(len(matches) - 1, -1, -1):
        m = matches[i]
        if m.group(3):
            continue
        num = int(m.group(2))
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        stop = re.search(
            r"(?im)^[ \t]*(?:\*\*)?(?:PRAYER|VERIFICATION|STATEMENT\s+OF\s+TRUTH|"
            r"LIST\s+OF\s+DOCUMENTS)\b",
            text[start + 1:end],
        )
        if stop:
            end = start + 1 + stop.start()
        body = text[start:end]
        body_l = body.lower()
        # Strip leading "N. " for pattern checks
        body_core = re.sub(r"^\s*\d{1,3}(?:\.\d{1,2})?[.)]\s*", "", body, count=1)
        is_note = bool(re.search(
            r"\binternal\s+note\b|\bdrafting\s+note\b|\bnote\s+to\s+drafter\b|"
            r"\[(?:internal\s+)?note\b|\btodo\s*:|\bfixme\s*:|"
            r"\bas\s+an?\s+ai\b|\bthe\s+model\s+should\b|"
            r"\bplaceholder\s+paragraph\b|\bdo\s+not\s+file\b|"
            r"\bfor\s+internal\s+use\b|\breview\s+comment\b|"
            r"^\s*note\s*[:\[]|"
            r"this\s+paragraph\s+is\s+(?:a\s+)?(?:placeholder|meta|internal)",
            body_l,
        )) or bool(_INTERNAL_NOTE_RE.search(body_core))
        # Short meta-only paragraphs that are just instructional
        if not is_note and len(body) < 400 and re.search(
            r"\b(?:omit|skip|delete)\s+this\s+paragraph\b|\bnot\s+part\s+of\s+the\s+plaint\b",
            body_l,
        ):
            is_note = True
        if is_note:
            text = text[:start] + text[end:]
            removed.append(num)
    return text, sorted(removed)


def _remove_corrupted_tables(text: str) -> tuple[str, int]:
    """Remove broken/degenerate markdown tables (dash floods, empty junk tables)."""
    if not text or "|" not in text:
        return text or "", 0
    removed = 0
    # Find table blocks: consecutive lines starting with |
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    i = 0
    while i < len(lines):
        if not lines[i].lstrip().startswith("|"):
            out.append(lines[i])
            i += 1
            continue
        j = i
        block: list[str] = []
        while j < len(lines) and (lines[j].lstrip().startswith("|") or not lines[j].strip()):
            if lines[j].lstrip().startswith("|"):
                block.append(lines[j])
            elif block:
                # blank inside table — keep scanning a bit
                if j + 1 < len(lines) and lines[j + 1].lstrip().startswith("|"):
                    block.append(lines[j])
                else:
                    break
            j += 1
        if len(block) < 2:
            out.extend(block)
            i = j
            continue
        joined = "".join(block)
        # Corruption signals
        sep_junk = sum(1 for ln in block if _CORRUPT_TABLE_LINE_RE.match(ln.rstrip("\n")))
        long_sep = bool(re.search(r"-{20,}|\|{3,}", joined))
        cells = re.findall(r"\|([^|\n]*)", joined)
        emptyish = sum(1 for c in cells if not c.strip() or set(c.strip()) <= set("-:_= "))
        empty_ratio = (emptyish / len(cells)) if cells else 1.0
        # Tiny 1-row "tables" that are just rules
        if long_sep or sep_junk >= 2 or (len(block) <= 3 and empty_ratio > 0.6) or empty_ratio > 0.75:
            removed += 1
            # Also drop a preceding orphan blank line
            if out and out[-1].strip() == "":
                out.pop()
            i = j
            continue
        out.extend(block)
        i = j
    return "".join(out), removed


def _body_region_bounds(text: str) -> tuple[int, int]:
    """Body numbered paragraphs: first main para → before prayer/verification/SoT/LoD."""
    first = _PARA_LINE_FULL_RE.search(text)
    if not first:
        return 0, 0
    start = first.start()
    end_m = re.search(
        r"(?im)^[ \t]*(?:\*\*)?(?:PRAYER|VERIFICATION|STATEMENT\s+OF\s+TRUTH|"
        r"LIST\s+OF\s+DOCUMENTS|SCHEDULE\s+[A-Z])\b",
        text[start:],
    )
    end = start + end_m.start() if end_m else len(text)
    return start, end


def _renumber_body_paragraphs_continuous(text: str) -> tuple[str, bool]:
    """Force body main paragraphs to 1..N continuous (monolithic blob)."""
    start, end = _body_region_bounds(text)
    if end <= start:
        return text, False
    region = text[start:end]
    matches = [m for m in _PARA_LINE_FULL_RE.finditer(region) if not m.group(3)]
    if len(matches) < 2:
        return text, False
    nums = [int(m.group(2)) for m in matches]
    expected = list(range(1, len(nums) + 1))
    if nums == expected:
        return text, False
    counter = [0]
    mapping: dict[int, int] = {}

    def _line(m: re.Match[str]) -> str:
        om = int(m.group(2))
        sub = m.group(3)
        if sub:
            # sub-para: remap parent if known
            parent = mapping.get(om, om)
            return f"{m.group(1)}{parent}.{sub}{m.group(4)}{m.group(5)}"
        if om not in mapping:
            counter[0] += 1
            mapping[om] = counter[0]
        return f"{m.group(1)}{mapping[om]}{m.group(4)}{m.group(5)}"

    new_region = _PARA_LINE_FULL_RE.sub(_line, region)

    # Remap "paragraph N" references in the whole document using mapping
    def _ref(m: re.Match[str]) -> str:
        def _num(nm: re.Match[str]) -> str:
            token = nm.group(0)
            parts = token.split(".")
            try:
                main = int(parts[0])
            except ValueError:
                return token
            if main in mapping:
                parts[0] = str(mapping[main])
                return ".".join(parts)
            return token
        return m.group(1) + re.sub(r"\d+(?:\.\d+)?", _num, m.group(2))

    new_text = text[:start] + new_region + text[end:]
    new_text = _PARA_REF_RE.sub(_ref, new_text)
    return new_text, True


def _body_para_numbers(text: str) -> list[int]:
    start, end = _body_region_bounds(text)
    if end <= start:
        return []
    return [
        int(m.group(2))
        for m in _PARA_LINE_FULL_RE.finditer(text[start:end])
        if not m.group(3)
    ]


def _classify_para_buckets(text: str) -> dict[str, list[int]]:
    """Split body paras into personal / records / legal for verification ranges."""
    start, end = _body_region_bounds(text)
    region = text[start:end]
    matches = [m for m in _PARA_LINE_FULL_RE.finditer(region) if not m.group(3)]
    personal: list[int] = []
    records: list[int] = []
    legal: list[int] = []
    for i, m in enumerate(matches):
        num = int(m.group(2))
        seg_end = matches[i + 1].start() if i + 1 < len(matches) else len(region)
        seg = region[m.start():seg_end].lower()
        if re.search(
            r"cause\s+of\s+action|jurisdiction|limitation|valuation|court\s+fee|"
            r"maintainability|prayer|relief\s+sought|section\s+12a|commercial\s+court",
            seg,
        ):
            legal.append(num)
        elif re.search(
            r"invoice|rs\.|inr|amount|payment|utr|interest|annexure|agreement|"
            r"purchase\s+order|ledger|account|delivery|gstin|cin\b",
            seg,
        ):
            records.append(num)
        else:
            personal.append(num)
    # Ensure every para is in exactly one bucket
    all_nums = [int(m.group(2)) for m in matches]
    assigned = set(personal + records + legal)
    for n in all_nums:
        if n not in assigned:
            personal.append(n)
    return {"personal": sorted(personal), "records": sorted(records), "legal": sorted(legal)}


def _range_phrase(nums: list[int]) -> str:
    if not nums:
        return "____"
    nums = sorted(nums)
    if len(nums) == 1:
        return str(nums[0])
    # Compress contiguous runs
    runs: list[str] = []
    a = b = nums[0]
    for n in nums[1:]:
        if n == b + 1:
            b = n
        else:
            runs.append(str(a) if a == b else f"{a} to {b}")
            a = b = n
    runs.append(str(a) if a == b else f"{a} to {b}")
    if len(runs) == 1:
        return runs[0]
    return ", ".join(runs[:-1]) + " and " + runs[-1]


def _rebuild_verification_and_sot(text: str) -> tuple[str, bool]:
    """Rewrite Verification + Statement of Truth ranges from final body numbering."""
    buckets = _classify_para_buckets(text)
    if not any(buckets.values()):
        return text, False
    pers = _range_phrase(buckets["personal"])
    recs = _range_phrase(buckets["records"])
    legs = _range_phrase(buckets["legal"])

    def _rewrite_block(block: str) -> str:
        new = block
        # Common Indian verification split patterns
        patterns = [
            (r"(paragraphs?\s+)(\d+(?:\s*(?:to|–|-|and|,)\s*\d+)*)(\s+[^\n]{0,80}personal\s+knowledge)",
             rf"\g<1>{pers}\g<3>"),
            (r"(paragraphs?\s+)(\d+(?:\s*(?:to|–|-|and|,)\s*\d+)*)(\s+[^\n]{0,100}"
             r"(?:books?\s+of\s+account|business\s+records|records\s+of\s+the))",
             rf"\g<1>{recs}\g<3>"),
            (r"(paragraphs?\s+)(\d+(?:\s*(?:to|–|-|and|,)\s*\d+)*)(\s+[^\n]{0,100}"
             r"(?:legal\s+advice|advice\s+received|information\s+received))",
             rf"\g<1>{legs}\g<3>"),
        ]
        for pat, repl in patterns:
            new = re.sub(pat, repl, new, flags=re.I)
        return new

    changed = False
    head_re = re.compile(
        r"(?im)^[ \t>*_#]*(?:\*\*)?(VERIFICATION|STATEMENT\s+OF\s+TRUTH)(?:\*\*)?\s*$"
    )
    matches = list(head_re.finditer(text))
    if not matches:
        return text, False
    pieces: list[str] = []
    cursor = 0
    for i, hm in enumerate(matches):
        region_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        # Prefer stop before Place/Dated of next instrument only — keep Place in block
        stop = re.search(
            r"(?im)^[ \t]*(?:\*\*)?(?:LIST\s+OF\s+DOCUMENTS|PRAYER|SCHEDULE)\b",
            text[hm.end():region_end],
        )
        if stop:
            region_end = hm.end() + stop.start()
        pieces.append(text[cursor:hm.end()])
        region = text[hm.end():region_end]
        rewritten = _rewrite_block(region)
        if rewritten != region:
            changed = True
        pieces.append(rewritten)
        cursor = region_end
    pieces.append(text[cursor:])
    out = "".join(pieces)
    # Ensure attestation numbering starts at 1
    out2, renum = _restart_inline_attestation_numbering(out)
    return out2, changed or renum


def _ensure_company_registration_in_body(text: str, facts_digest: str = "") -> tuple[str, bool]:
    """If inventory has company registration/CIN details missing from body, append a short para."""
    if not facts_digest or not text:
        return text, False
    if re.search(r"company\s+registration|certificate\s+of\s+incorporation|CIN\s*:?\s*[UL]\d", text, re.I):
        return text, False
    parties = _extract_inventory_block(facts_digest, "PARTIES") or facts_digest
    cin_m = re.search(r"[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}", parties)
    act_m = re.search(r"Companies\s+Act,?\s*\d{4}", parties, re.I)
    name_m = re.search(
        r"(?:Full\s+Name|Name)\s*:\s*([^\n]+)|([A-Z][A-Za-z0-9&.,'()\- ]{6,60}(?:Pvt\.?\s*Ltd\.?|Limited))",
        parties,
    )
    if not (cin_m or act_m):
        # Still try DOCUMENT REFERENCES for registration certificate
        refs = _extract_inventory_block(facts_digest, "DOCUMENT REFERENCES") or ""
        if not re.search(r"registrat|incorporat|master\s+data", refs, re.I):
            return text, False
    name = ""
    if name_m:
        name = (name_m.group(1) or name_m.group(2) or "").strip()
        name = re.sub(r"\[Source:[^\]]*\]", "", name, flags=re.I).strip(" .;")
    cin = cin_m.group(0) if cin_m else ""
    act = act_m.group(0) if act_m else "Companies Act, 2013"
    bits = []
    if name:
        bits.append(name)
    bits.append(f"incorporated under the {act}")
    if cin:
        bits.append(f"bearing CIN {cin}")
    sentence = (
        "The Plaintiff company's registration particulars are as follows: "
        + ", ".join(bits)
        + ". A copy of the Company Registration / Certificate of Incorporation "
        "is annexed hereto and marked as ANNEXURE P-99."
    )
    # Insert before PRAYER / VERIFICATION
    start, end = _body_region_bounds(text)
    if end <= start:
        return text, False
    # Use next body number
    nums = _body_para_numbers(text)
    next_n = (max(nums) + 1) if nums else 1
    insert = f"\n{next_n}. {sentence}\n"
    return text[:end] + insert + text[end:], True


_RELIEF_ZONE_MARKERS = ("prayer", "relief", "order sought", "remedy", "prays")


def _relief_zone(text: str) -> str:
    low = text.lower()
    start = len(text)
    for marker in _RELIEF_ZONE_MARKERS:
        pos = low.find(marker)
        if pos != -1:
            start = min(start, pos)
    return text[start:].lower() if start < len(text) else ""


def _slash_menu_focus_corpus(
    text: str,
    facts_digest: str = "",
    user_instructions: str = "",
) -> str:
    """Corpus used to decide which slash-menu relief options this matter uses."""
    parts = [
        (user_instructions or "").lower(),
        _relief_zone(text),
    ]
    # Prefer AMOUNTS / ADMISSIONS / prayer-relevant inventory over full digest noise
    digest = facts_digest or ""
    for block in ("AMOUNTS", "ADMISSIONS AND DENIALS", "TERMS AND CONDITIONS", "OTHER FACTS"):
        try:
            body = _extract_inventory_block(digest, block)
        except Exception:
            body = ""
        if body:
            parts.append(body.lower()[:3000])
    parts.append(digest.lower()[:4000])
    return "\n".join(p for p in parts if p)


def _narrow_slash_option_menus(
    text: str,
    facts_digest: str = "",
    user_instructions: str = "",
) -> tuple[str, bool]:
    """Narrow slash-separated template option menus to segments this matter uses.

    Handles multi-line wrapped titles (e.g. '…MONEY / DAMAGES\\n/ DECLARATION /…')
    which previously escaped line-local narrowing.
    """
    if not text or text.count("/") < 2:
        return text, False

    # Collapse slash-wraps in the caption/title region so a menu split across
    # lines is treated as one option list (template titles often wrap after
    # each "/ OPTION").
    head_end = min(len(text), 8000)
    head = text[:head_end]
    tail = text[head_end:]
    head_work = re.sub(r"\n([ \t]*)/", " /", head)
    head_work = re.sub(r"/\s*\n\s*", "/ ", head_work)

    focus = _slash_menu_focus_corpus(text, facts_digest, user_instructions)
    user_l = (user_instructions or "").lower()
    # User explicitly naming reliefs → strongest signal
    user_named = {
        w for w in (
            "recovery of money", "damages", "declaration", "injunction",
            "specific performance", "mandatory injunction", "permanent injunction",
            "interim injunction", "account", "rendition",
        )
        if w in user_l
    }

    def _keep_segment(part: str, is_first: bool) -> bool:
        pl = part.lower().strip()
        if pl in ("other commercial reliefs", "other reliefs", "other commercial relief"):
            return False  # never keep catch-all menu residue
        if user_named:
            return any(u in pl or pl in u for u in user_named) or (
                is_first and "recovery" in pl and any("money" in u or "recovery" in u for u in user_named)
            )
        words = [w for w in re.findall(r"[a-z]{4,}", pl) if w not in ("other", "commercial", "reliefs", "relief")]
        if not words:
            return is_first
        # Money-recovery matters: keep RECOVERY OF MONEY; drop unused menu items
        # unless the prayer/focus actually seeks them as relief (not mere mentions).
        if is_first and "recovery" in pl and "money" in pl:
            return True
        if is_first:
            # Keep the first menu option when it matches focus, else still keep
            # as the default narrowed title (never leave an empty title).
            if any(w in focus for w in words if len(w) >= 5):
                return True
            return True
        # Require a strong hit in the prayer zone / user focus — not just any
        # occurrence of "damages" in a costs clause.
        strong = (
            f"for {words[0]}" in focus
            or f"decree of {words[0]}" in focus
            or f"decree for {words[0]}" in focus
            or f"prays? for {words[0]}" in focus
            or f"relief of {words[0]}" in focus
            or f"claim for {words[0]}" in focus
            or f"claiming {words[0]}" in focus
            or f"writ of {words[0]}" in focus
            or (user_l and any(w in user_l for w in words))
        )
        if strong:
            return True
        # Specific performance / injunction / declaration need explicit support
        if any(k in pl for k in ("specific performance", "injunction", "declaration")):
            return any(k in focus for k in (
                "specific performance", "permanent injunction", "mandatory injunction",
                "declaratory", "declaration that", "injunction restraining",
            ))
        if "damages" in pl:
            return bool(re.search(
                r"\b(?:claim|seek|pray|decree|award).{0,40}\bdamages\b"
                r"|\bdamages\b.{0,40}\b(?:claim|sought|prayed)\b",
                focus,
            ))
        return False

    changed = False
    new_lines: list[str] = []
    for line in head_work.splitlines():
        if line.count("/") < 2:
            new_lines.append(line)
            continue
        # Only touch lines that look like relief/title option menus
        if not re.search(
            r"recovery|damages|declaration|injunction|specific\s+performance|relief|"
            r"mandamus|certiorari|habeas|prohibition|quo\s+warranto",
            line, re.I,
        ):
            new_lines.append(line)
            continue
        parts = [p.strip() for p in re.split(r"\s*/\s*", line) if p.strip()]
        if len(parts) < 3:
            new_lines.append(line)
            continue
        kept = [p for i, p in enumerate(parts) if _keep_segment(p, is_first=(i == 0))]
        if not kept:
            kept = [parts[0]]
        if len(kept) < len(parts):
            changed = True
            # Preserve leading markdown/bold wrappers on the first segment if present
            joined = " / ".join(kept)
            new_lines.append(joined)
        else:
            new_lines.append(line)
    if not changed:
        # Still return collapsed-wrap version if wraps were fixed even without narrowing
        if head_work != head:
            return head_work + tail, True
        return text, False
    return "\n".join(new_lines) + tail, True


def _reconcile_interim_relief_extended(text: str) -> tuple[str, list[str]]:
    """Broader interim-relief reconciliation including attachment/disclosure/deposit."""
    text, removed = _reconcile_interim_relief(text)
    if not re.search(r"no\s+(?:ad[- ]?)?interim\s+relief\s+is\s+(?:being\s+)?sought",
                     text, re.IGNORECASE):
        return text, removed
    extra_bad = re.compile(
        r"attachment\s+before\s+judgment|asset\s+disclosure|deposit\s+in\s+court"
        r"|restrain(?:ing)?\s+the\s+defendant|protective\s+order"
        r"|injunction\s+restraining|direction\s+to\s+disclose",
        re.I,
    )
    pm = re.search(r"^\s*(?:\*\*)?\s*PRAYER", text, re.MULTILINE | re.IGNORECASE) \
        or re.search(r"(?:most\s+respectfully|humbly)\s+prays?", text, re.IGNORECASE)
    if not pm:
        return text, removed
    start = pm.start()
    endm = re.search(
        r"\n\s*(?:\*\*)?\s*(VERIFICATION|STATEMENT\s+OF\s+TRUTH|Place\s*:|Dated?\s*[:.])",
        text[start:], re.IGNORECASE,
    )
    end = start + endm.start() if endm else len(text)
    region = text[start:end]
    starts = list(re.finditer(r"^\s*\(([a-z])\)", region, re.MULTILINE))
    if not starts:
        return text, removed
    kept: list[str] = []
    for i, sm in enumerate(starts):
        seg_end = starts[i + 1].start() if i + 1 < len(starts) else len(region)
        seg = region[sm.start():seg_end]
        if extra_bad.search(seg):
            removed.append(sm.group(1))
        else:
            kept.append(seg)
    if len(kept) == len(starts):
        return text, removed
    relettered = [
        re.sub(r"\(([a-z])\)", f"({chr(ord('a') + i)})", seg, count=1)
        for i, seg in enumerate(kept)
    ]
    new_region = region[:starts[0].start()] + "".join(relettered)
    return text[:start] + new_region + text[end:], removed


_PLACEHOLDER_RE = re.compile(
    r"\[DATA NOT PROVIDED:\s*([^\]]+)\]|\[MISSING:\s*([^\]]+)\]",
    re.I,
)


_CHRONO_HEADING_RE = re.compile(
    r"(?is)(list\s+of\s+dates|dates\s+and\s+events|chronolog(?:y|ical)|timeline\s+of\s+events)"
)


_LOD_HEADING_RE = re.compile(
    r"(?is)(list\s+of\s+documents|index\s+of\s+documents|accompanying\s+filings|schedule\s+of\s+documents)"
)


_TABLE_ROW_RE = re.compile(r"^\s*\|")


_REF_CODE_RE = re.compile(r"\b[A-Z]{2,}[A-Z0-9]*(?:[/-][A-Z0-9]{2,}){1,6}\b")


def _normalize_date_token(s: str) -> str:
    """Loose date normalizer for chronology matching."""
    s = (s or "").strip().lower()
    s = re.sub(r"(\d+)(st|nd|rd|th)", r"\1", s)
    s = re.sub(r"\s+", " ", s)
    return s


def _matrix_row_date_particulars(row: str) -> tuple[str, str]:
    cells = [c.strip() for c in row.strip().strip("|").split("|")]
    if len(cells) >= 3:
        return _normalize_date_token(cells[1]), cells[2][:120].lower()
    if len(cells) == 2:
        return _normalize_date_token(cells[0]), cells[1][:120].lower()
    return "", row.lower()[:120]


def _find_markdown_table_span(text: str, start: int) -> Optional[tuple[int, int, list[str]]]:
    """From *start*, find a markdown table; return (abs_start, abs_end, lines)."""
    lines = text[start:].splitlines()
    if not lines or not _TABLE_ROW_RE.match(lines[0]):
        return None
    tbl: list[str] = []
    for i, ln in enumerate(lines):
        if _TABLE_ROW_RE.match(ln):
            tbl.append(ln)
        elif tbl:
            break
        elif i > 0:
            break
    if len(tbl) < 2:
        return None
    consumed = sum(len(ln) + 1 for ln in tbl)
    return start, start + consumed, tbl


def _find_region_after_heading(text: str, heading_re: re.Pattern[str]) -> int:
    m = heading_re.search(text)
    return m.start() if m else -1


def _chrono_row_present(date_tok: str, partic: str, table_body: str) -> bool:
    # A dated row is decided by its DATE alone — generic-word overlap
    # ("notice", "section", …) was masking rows like the s.12A pair.
    if date_tok:
        return date_tok in _normalize_date_token(table_body)
    body_l = table_body.lower()
    # Undated rows: match on distinctive words from particulars.
    words = [w for w in re.findall(r"[a-z0-9]{5,}", partic) if w not in ("dated", "party", "parties")]
    if words and sum(1 for w in words[:6] if w in body_l) >= min(2, len(words)):
        return True
    return False


def _merge_chronology_from_digest(text: str, facts_digest: str) -> tuple[str, list[int]]:
    """Inject missing chronological-matrix rows into the list-of-dates table."""
    matrix = _extract_matrix_rows(facts_digest)
    if not matrix:
        return text, []
    pos = _find_region_after_heading(text, _CHRONO_HEADING_RE)
    if pos < 0:
        return text, []
    span = _find_markdown_table_span(text, pos)
    if not span:
        # scan forward for first table after heading
        for m in re.finditer(r"(?m)^\s*\|", text[pos:pos + 8000]):
            span = _find_markdown_table_span(text, pos + m.start())
            if span:
                break
    if not span:
        return text, []
    t_start, t_end, tbl_lines = span
    if len(tbl_lines) < 2:
        return text, []
    header, sep = tbl_lines[0], tbl_lines[1]
    body_lines = tbl_lines[2:]
    body_blob = "\n".join(body_lines)
    missing_snos: list[int] = []
    new_rows: list[str] = []
    for sn in sorted(matrix):
        row = matrix[sn]
        date_tok, partic = _matrix_row_date_particulars(row)
        if _chrono_row_present(date_tok, partic, body_blob):
            continue
        missing_snos.append(sn)
        cells = [c.strip() for c in row.strip().strip("|").split("|")]
        # Reformat to match header column count if possible
        n_cols = max(1, header.count("|") - 1)
        if len(cells) >= n_cols:
            new_rows.append("| " + " | ".join(cells[:n_cols]) + " |")
        elif len(cells) == 3:
            new_rows.append(row if row.startswith("|") else f"| {cells[0]} | {cells[1]} | {cells[2]} |")
        else:
            new_rows.append(row)
    if not new_rows:
        return text, []
    merged_tbl = "\n".join([header, sep, *body_lines, *new_rows])
    return text[:t_start] + merged_tbl + text[t_end:], missing_snos


def _rebuild_list_of_documents(text: str, facts_digest: str = "") -> tuple[str, bool]:
    """Derive List of Documents rows from the body's annexure register + digest gaps."""
    lod_pos = _find_region_after_heading(text, _LOD_HEADING_RE)
    lod_region_end = len(text)
    state_text = text
    if lod_pos >= 0:
        next_head = re.search(
            r"(?im)\n\s*(?:\*\*)?(VERIFICATION|STATEMENT\s+OF\s+TRUTH|AFFIDAVIT|PRAYER|"
            r"IDENTIFIED\s+BY|Place\s*:|Dated?\s*:)",
            text[lod_pos:],
        )
        lod_region_end = lod_pos + next_head.start() if next_head else len(text)
        state_text = text[:lod_pos] + text[lod_region_end:]
    state = _build_doc_state([{"content": state_text, "heading": "", "section_id": "doc"}])
    annexures = list(state.get("annexures") or [])
    planned = _plan_exhibits(facts_digest) if facts_digest else []
    if not annexures and planned:
        annexures = [{"mark": e["mark"], "desc": e["desc"]} for e in planned]
    elif planned and annexures:
        # Append inventory documents never cited in the body (e.g. Company Registration)
        body_blob = " ".join(
            (a.get("desc") or "") for a in annexures
        ).lower() + "\n" + state_text.lower()
        letter = "P"
        m0 = re.search(r"\b([A-Z]{1,2})-\d+\b", annexures[0].get("mark", "P-1"))
        if m0:
            letter = m0.group(1)
        next_n = 1
        for a in annexures:
            mm = re.search(r"-(\d+)$", a.get("mark") or "")
            if mm:
                next_n = max(next_n, int(mm.group(1)) + 1)
        for e in planned:
            desc = (e.get("desc") or "").strip()
            if len(desc) < 8:
                continue
            # Significant tokens from planned desc
            tokens = [
                t for t in re.findall(r"[a-z0-9]{5,}", desc.lower())
                if t not in ("dated", "annexure", "document", "company", "private", "limited")
            ]
            # Always try to include registration / incorporation certificates
            is_reg = bool(re.search(
                r"registrat|incorporat|certificate\s+of\s+incorporat|roc\b|master\s+data|"
                r"company\s+registration|cin\s*cert",
                desc, re.I,
            ))
            covered = (
                sum(1 for t in tokens[:4] if t in body_blob) >= min(2, len(tokens[:4]))
                if tokens else False
            )
            if is_reg:
                covered = bool(re.search(
                    r"registrat|incorporat|certificate\s+of\s+incorporat|roc\b|master\s+data|"
                    r"company\s+registration",
                    body_blob, re.I,
                ))
            if covered:
                continue
            annexures.append({"mark": f"{letter}-{next_n}", "desc": desc[:110]})
            next_n += 1
    if not annexures:
        return text, False
    pos = lod_pos
    if pos < 0:
        return text, False
    first_pipe = re.search(r"(?m)^\s*\|", text[pos:lod_region_end])
    if first_pipe:
        t_start = pos + first_pipe.start()
        t_end = lod_region_end
        tbl_lines = [
            ln for ln in text[t_start:t_end].splitlines()
            if ln.strip().startswith("|")
        ]
    else:
        # Insert a fresh table immediately after the LoD heading line.
        heading_end = text.find("\n", pos, lod_region_end)
        t_start = (heading_end + 1) if heading_end != -1 else lod_region_end
        t_end = t_start
        tbl_lines = []

    def _is_sep(ln: str) -> bool:
        return bool(re.match(r"^\s*\|(\s*:?-{2,}:?\s*\|?)+\s*$", ln or ""))

    header_raw = (
        tbl_lines[0] if tbl_lines and not _is_sep(tbl_lines[0])
        else "| S.No | Particulars of Document | Annexure | Status |"
    )
    header_cells = [c.strip() for c in header_raw.strip().strip("|").split("|")]
    while len(header_cells) < 4:
        header_cells.append(("Annexure", "Status")[len(header_cells) - 2] if len(header_cells) >= 2 else f"Col {len(header_cells) + 1}")
    header = "| " + " | ".join(header_cells[:4]) + " |"
    n_cols = len(header_cells[:4])
    sep = "|" + "|".join(":-----" for _ in range(n_cols)) + "|"
    new_rows: list[str] = []
    for i, a in enumerate(annexures, 1):
        mark = a.get("mark", f"P-{i}")
        desc = (a.get("desc") or f"Document {i}").strip()
        desc = re.sub(r"\s+", " ", desc)[:100]
        if n_cols >= 4:
            new_rows.append(f"| {i} | {desc} | ANNEXURE {mark} | Annexed herewith |")
        elif n_cols == 3:
            new_rows.append(f"| {i} | {desc} | Annexed as ANNEXURE {mark} |")
        else:
            new_rows.append(f"| {desc} (ANNEXURE {mark}) |")
    trailing_newline = "\n" if t_end > t_start and text[t_end - 1:t_end] == "\n" else ""
    new_tbl = "\n".join([header, sep, *new_rows]) + trailing_newline
    if new_tbl == "\n".join(tbl_lines):
        return text, False
    return text[:t_start] + new_tbl + text[t_end:], True


def _try_resolve_placeholder(label: str, facts_digest: str) -> Optional[str]:
    """Best-effort digest lookup for a [DATA NOT PROVIDED: label] slot."""
    if not facts_digest or not label:
        return None
    label_l = label.lower().strip()
    stop = {"data", "not", "provided", "details", "detail", "the", "of", "and", "for", "a", "an"}
    keys = [w for w in re.findall(r"[a-z]{4,}", label_l) if w not in stop]
    if not keys:
        return None
    # Direct "Not Mentioned" in TIMELINE GAPS → blank
    gaps_m = re.search(r"TIMELINE GAPS.*", facts_digest, re.I | re.S)
    if gaps_m and label_l in gaps_m.group(0).lower():
        return "____"
    best_line = ""
    best_score = 0
    for line in facts_digest.splitlines():
        ll = line.lower()
        if "not mentioned" in ll and any(k in ll for k in keys):
            return "____"
        score = sum(1 for k in keys if k in ll)
        if score > best_score and len(line.strip()) > 12:
            best_score = score
            best_line = line.strip()
    if best_score >= min(2, len(keys)) and best_line:
        # Strip inventory decoration
        val = re.sub(r"\[Source:[^\]]*\]", "", best_line, flags=re.I).strip(" -•|")
        val = re.sub(r"^(PARTIES|AMOUNTS|DOCUMENT REFERENCES|OTHER FACTS)\s*—\s*", "", val, flags=re.I)
        if 3 < len(val) < 200:
            return val
    return None


def _resolve_remaining_placeholders(text: str, facts_digest: str = "") -> tuple[str, int]:
    """Fill or neutralize leftover [DATA NOT PROVIDED] markers from the digest."""
    resolved = 0

    def _sub(m: re.Match[str]) -> str:
        nonlocal resolved
        label = (m.group(1) or m.group(2) or "").strip()
        val = _try_resolve_placeholder(label, facts_digest)
        if val is not None:
            resolved += 1
            return val
        # Sworn/relief zones → blank token; narrative gaps also → blank for filing
        resolved += 1
        return "____"

    new = _PLACEHOLDER_RE.sub(_sub, text)
    # Template instructional placeholders
    new2 = re.sub(r"\[particulars,?\s*if\s+any\]", "nil", new, flags=re.I)
    if new2 != new:
        resolved += 1
    return new2, resolved


def _polish_exhibit_citations(
    text: str,
    facts_digest: str = "",
    exhibit_register: Optional[list[dict[str, str]]] = None,
) -> tuple[str, int]:
    """Add inline ANNEXURE marks at uncited document mentions."""
    refs = exhibit_register or (_plan_exhibits(facts_digest) if facts_digest else [])
    if not refs:
        return text, 0
    polished = 0
    out = text
    for ref in refs:
        mark = ref.get("mark", "")
        desc = ref.get("desc", "")
        if not mark:
            continue
        # Unique reference codes from description (invoice/PO/agreement nos.)
        codes = _REF_CODE_RE.findall(desc.upper())
        needles: list[str] = []
        for c in codes[:3]:
            if c not in needles and c in out.upper():
                needles.append(c)
        # Fallback: significant words from desc
        if not needles:
            words = [w for w in re.findall(r"[A-Za-z]{5,}", desc) if w.lower() not in ("dated", "agreement", "invoice")]
            if words:
                needles.append(words[0])
        cite = f"(ANNEXURE {mark})"
        for needle in needles[:2]:
            for m in re.finditer(re.escape(needle), out, re.I):
                window = out[m.end():m.end() + 90]
                if re.search(rf"\bANNEXURE\s+{re.escape(mark)}\b", window, re.I):
                    continue
                if re.search(r"\bANNEXURE\s+P-\d+", window, re.I):
                    continue
                out = out[:m.end()] + f" {cite}" + out[m.end():]
                polished += 1
                break
    return out, polished


def _strip_all_sworn_placeholders(text: str) -> tuple[str, int]:
    """Final pass: any remaining placeholder markers → template blank."""
    found = _PLACEHOLDER_RE.findall(text)
    if not found:
        return text, 0
    new = _PLACEHOLDER_RE.sub("____", text)
    return new, len(found)


_INVENTORY_SOURCE_TAG_RE = re.compile(
    r"\s*[\[(]\s*Source\s*:\s*[^\]\)]+[)\]]",
    re.I,
)


# Filenames leaked as provenance footnotes, e.g. "(reg.pdf)" / "[invoice_1.docx]"
_INVENTORY_SOURCE_FILENAME_RE = re.compile(
    r"\s*[\[(]\s*[\w.\- ]{1,80}\.(?:pdf|docx?|xlsx?|txt|png|jpe?g)\s*[)\]]",
    re.I,
)


def _strip_inventory_source_mentions(text: str) -> tuple[str, int]:
    """Remove [Source: file.pdf] / (Source: …) tags leaked from the fact inventory."""
    if not text:
        return text or "", 0
    count = 0
    new = text
    for rx in (_INVENTORY_SOURCE_TAG_RE, _INVENTORY_SOURCE_FILENAME_RE):
        hits = len(rx.findall(new))
        if hits:
            new = rx.sub("", new)
            count += hits
    if count:
        new = re.sub(r"[ \t]{2,}", " ", new)
        new = re.sub(r" +([,.;:])", r"\1", new)
    return new, count


def _monolithic_deterministic_repairs(
    text: str,
    facts_digest: str = "",
    exhibit_register: Optional[list[dict[str, str]]] = None,
    user_instructions: str = "",
) -> tuple[str, dict[str, Any]]:
    """Chain all zero-LLM monolithic repairs; return (text, info dict)."""
    info: dict[str, Any] = {}
    # Claude often emits ATX '# heading' markers — strip before other repairs
    cleaned = _strip_markdown_artifacts(text)
    if cleaned != text:
        info["markdown_artifacts_stripped"] = True
    text = cleaned

    # Whole-document restart dedup FIRST — every later repair (numbering,
    # annexures, LoD) must operate on a single copy of the document.
    new_txt, restarts = _strip_restarted_document(text)
    if restarts:
        info["restarted_copies_removed"] = restarts
    text = new_txt

    new_txt, removed_notes = _remove_internal_note_paragraphs(text)
    if removed_notes:
        info["internal_notes_removed"] = removed_notes
    text = new_txt

    new_txt, corrupt_n = _remove_corrupted_tables(text)
    if corrupt_n:
        info["corrupted_tables_removed"] = corrupt_n
    text = new_txt

    new_txt, changed = _dedupe_cause_title(text)
    if changed:
        info["cause_title_deduped"] = True
    text = new_txt

    new_txt, changed = _narrow_slash_option_menus(text, facts_digest, user_instructions)
    if changed:
        info["option_menu_narrowed"] = True
    text = new_txt

    new_txt, changed = _fix_admitted_dues_wording(text, facts_digest)
    if changed:
        info["admitted_dues_fixed"] = True
    text = new_txt

    new_txt, changed = _sanitize_statute_years(text, facts_digest)
    if changed:
        info["statute_year_fixed"] = True
    text = new_txt

    # Field-swap Act years (Companies Act, 2020 ← Date of Incorporation) — free
    try:
        from app.services.draft_provenance import fix_cross_field_act_years
        new_txt, swaps = fix_cross_field_act_years(text, facts_digest)
        if swaps:
            info["field_swaps_fixed"] = swaps
        text = new_txt
    except Exception as exc:
        logger.debug("Field-swap fix skipped: %s", exc)

    new_txt, changed = _fix_proceedings_placeholder(text)
    if changed:
        info["proceedings_placeholder_fixed"] = True
    text = new_txt

    new_txt, changed = _fix_deponent_age_placeholder(text)
    if changed:
        info["deponent_age_fixed"] = True
    text = new_txt

    new_txt, changed = _fix_unsupported_authorized_signatory(text, facts_digest)
    if changed:
        info["unauthorized_signatory_fixed"] = True
    text = new_txt

    new_txt, changed = _ensure_company_registration_in_body(text, facts_digest)
    if changed:
        info["company_registration_added"] = True
    text = new_txt

    new_txt, annex_info = _renumber_annexures(text)
    if annex_info:
        info["annexures"] = annex_info
    text = new_txt

    new_txt, removed_clauses = _reconcile_interim_relief_extended(text)
    if removed_clauses:
        info["interim_prayers_removed"] = removed_clauses
    text = new_txt

    new_txt, removed_ph = _strip_prayer_placeholders(text)
    if removed_ph:
        info["prayer_placeholders_removed"] = removed_ph
    text = new_txt

    new_txt, missing_events = _merge_chronology_from_digest(text, facts_digest)
    if missing_events:
        info["chronology_rows_added"] = missing_events
    text = new_txt

    # Body numbering AFTER structural deletions so Verification ranges are final
    new_txt, changed = _renumber_body_paragraphs_continuous(text)
    if changed:
        info["body_renumbered"] = True
    text = new_txt

    new_txt, lod_changed = _rebuild_list_of_documents(text, facts_digest)
    if lod_changed:
        info["lod_rebuilt"] = True
    text = new_txt

    reg = exhibit_register or (_plan_exhibits(facts_digest) if facts_digest else [])
    new_txt, cite_count = _polish_exhibit_citations(text, facts_digest, reg)
    if cite_count:
        info["exhibit_citations_added"] = cite_count
    text = new_txt

    # Polish can re-introduce colliding marks — compact again
    new_txt, annex_info2 = _renumber_annexures(text)
    if annex_info2:
        info["annexures"] = annex_info2
    text = new_txt

    # LoD again so register matches final marks (incl. missing Co. Registration)
    new_txt, lod_changed2 = _rebuild_list_of_documents(text, facts_digest)
    if lod_changed2:
        info["lod_rebuilt"] = True
    text = new_txt

    new_txt, resolved = _resolve_remaining_placeholders(text, facts_digest)
    if resolved:
        info["placeholders_resolved"] = resolved
    text = new_txt

    new_txt, sworn_fixed = _strip_all_sworn_placeholders(text)
    if sworn_fixed:
        info["sworn_placeholders_neutralized"] = sworn_fixed
    text = new_txt

    new_txt, changed = _fix_deponent_age_placeholder(text)
    if changed:
        info["deponent_age_fixed"] = True
    text = new_txt

    # Final body renumber (in case LoD/polish shifted nothing but notes removed earlier)
    new_txt, changed = _renumber_body_paragraphs_continuous(text)
    if changed:
        info["body_renumbered"] = True
    text = new_txt

    new_txt, changed = _rebuild_verification_and_sot(text)
    if changed:
        info["attestation_rebuilt"] = True
    text = new_txt

    new_txt, changed = _restart_inline_attestation_numbering(text)
    if changed:
        info["attestation_renumbered"] = True
    text = new_txt

    new_txt, src_stripped = _strip_inventory_source_mentions(text)
    if src_stripped:
        info["source_mentions_stripped"] = src_stripped
    text = new_txt

    return text, info


_ROW_MARK_RE = re.compile(r"\b(?:ANNEXURE|EXHIBIT)?\s*([A-Z]{1,2}[-\u2011]\d{1,3})\b")


def _table_mark_collisions(text: str) -> list[tuple[str, list[str]]]:
    """Same exhibit mark in >=2 markdown-table rows that plainly refer to
    DIFFERENT documents (different reference codes, or one row coded and
    another not). Prose guards never see table cells — this one does.
    Colly rows are exempt per-row, not document-wide."""
    mark_code_sets: dict[str, list[frozenset]] = {}
    mark_rows: dict[str, list[str]] = {}
    for ln in text.splitlines():
        s = ln.strip()
        if not s.startswith("|") or set(s) <= set("|-: "):
            continue
        if re.search(r"\bcolly\b", s, re.IGNORECASE):
            continue
        marks = {m.replace("\u2011", "-").upper() for m in _ROW_MARK_RE.findall(s)}
        if not marks:
            continue
        codes = frozenset(
            c for c in _REF_CODE_RE.findall(s.upper())
            if not re.fullmatch(r"[A-Z]{1,2}-\d{1,3}", c)
        )
        for m in marks:
            mark_code_sets.setdefault(m, []).append(codes)
            mark_rows.setdefault(m, []).append(s[:90])
    out: list[tuple[str, list[str]]] = []
    for m, sets in mark_code_sets.items():
        if len(sets) < 2:
            continue
        nonempty = {s for s in sets if s}
        if len(nonempty) > 1 or (len(nonempty) == 1 and any(not s for s in sets)):
            out.append((m, mark_rows[m]))
    return out


_LINT_DATE_TOK_RE = re.compile(
    r"\b\d{1,2}[-./ ](?:[A-Za-z]{3,9}|\d{1,2})[-./ ,]+\d{4}\b"
    r"|\b[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}\b"
)


def _factual_strength_lint(
    text: str,
    facts_digest: str,
    section_id: str = "__document__",
) -> list[Any]:
    """Deterministic pre-audit check: inventory anchors missing from draft."""
    from app.services.drafting_schemas import GroundingViolation

    if not facts_digest or not text:
        return []
    issues: list[Any] = []
    # Boundary-aware number tokens (whole-document digit concatenation let
    # amounts be "found" spanning two unrelated numbers).
    draft_nums = {_digits_only(n) for n in re.findall(r"\d[\d,]*(?:\.\d{2})?", text)}
    text_l = text.lower()

    # Monetary figures from AMOUNTS block
    for amt in re.findall(r"(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)", facts_digest, re.I):
        digits = _digits_only(amt)
        if len(digits) >= 4 and digits not in draft_nums:
            issues.append(GroundingViolation(
                section_id=section_id,
                quote=f"Rs. {amt}",
                problem=(
                    "Inventory amount not found in draft — include this exact figure "
                    "(figures and words if given) in narrative, valuation and prayer."
                ),
            ))

    # CIN / PAN / GSTIN
    for cin in set(re.findall(r"[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}", facts_digest)):
        if cin not in text:
            issues.append(GroundingViolation(
                section_id=section_id,
                quote=cin,
                problem="CIN from inventory missing in draft — copy character-for-character.",
            ))
    for pan in set(re.findall(r"\b[A-Z]{5}\d{4}[A-Z]\b", facts_digest)):
        if pan not in text.upper():
            issues.append(GroundingViolation(
                section_id=section_id,
                quote=pan,
                problem="PAN from inventory missing in draft — copy character-for-character.",
            ))
    for gstin in set(re.findall(
        r"\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b", facts_digest, re.I,
    )):
        if gstin.upper() not in text.upper():
            issues.append(GroundingViolation(
                section_id=section_id,
                quote=gstin,
                problem="GSTIN from inventory missing in draft — copy character-for-character.",
            ))

    # Matrix dates: lint EVERY date token per cell, against the draft
    # EXCLUDING the List-of-Dates table span — otherwise the chronology merge
    # self-satisfies this check and the body/invoice-table never get the event.
    body = text
    pos = _find_region_after_heading(text, _CHRONO_HEADING_RE)
    if pos >= 0:
        span = _find_markdown_table_span(text, pos)
        if not span:
            for m in re.finditer(r"(?m)^\s*\|", text[pos:pos + 8000]):
                span = _find_markdown_table_span(text, pos + m.start())
                if span:
                    break
        if span:
            body = text[:span[0]] + text[span[1]:]
    body_norm = _normalize_date_token(body)
    for row in _extract_matrix_rows(facts_digest).values():
        cells = [c.strip() for c in row.strip().strip("|").split("|")]
        date_cell = cells[1] if len(cells) >= 3 else ""
        if not date_cell or "not mentioned" in date_cell.lower():
            continue
        partic = cells[2][:80] if len(cells) >= 3 else ""
        for d in (_LINT_DATE_TOK_RE.findall(date_cell) or [date_cell]):
            nd = _normalize_date_token(d)
            if nd and nd[:6] not in body_norm:
                issues.append(GroundingViolation(
                    section_id=section_id,
                    quote=d[:40],
                    problem=(
                        f"ADD: this matrix event ({partic or d[:40]}) is absent from the "
                        "document body — narrate it in the factual paragraphs; if it is an "
                        "invoice/payment, also add a row to the invoice table. Presence "
                        "only in the List of Dates does NOT satisfy this."
                    ),
                ))

    # Invoice/document reference codes from the inventory must appear in the
    # draft (a missing invoice-table row was previously invisible).
    doc_refs = _extract_inventory_block(facts_digest, "DOCUMENT REFERENCES") or facts_digest
    for code in set(_REF_CODE_RE.findall(doc_refs.upper())):
        if len(code) >= 6 and code not in text.upper():
            issues.append(GroundingViolation(
                section_id=section_id,
                quote=code,
                problem=(
                    "Invoice/document reference from inventory missing from draft — ADD "
                    "it: one invoice-table row (with its date, amount and ANNEXURE mark) "
                    "and an inline citation."
                ),
            ))

    # Party name cores + labeled party particulars (addresses, business, Act, dates…)
    parties = _extract_inventory_block(facts_digest, "PARTIES")
    _skip_vals = {
        "required-but-absent", "not mentioned", "n/a", "nil", "-", "none", "absent",
    }
    _labeled_must = re.compile(
        r"(?i)^[-•*]?\s*((?:Full\s+Name|Name|Registered Office(?:\s+Address)?|"
        r"Business(?:\s*/\s*Correspondence)?(?:\s+Address)?|Nature of Business|"
        r"Law of Incorporation(?:\s*/\s*Act)?|Act|Date of Incorporation|"
        r"Authorized Signatory(?:\s+Name)?|Authorization Document)"
        r"[^:\n]{0,40})\s*:\s*(.+)$"
    )
    for line in parties.splitlines():
        raw = line.strip()
        if len(raw) < 6:
            continue
        lm = _labeled_must.match(raw)
        if lm:
            label, val = lm.group(1).strip(), lm.group(2).strip()
            val = re.sub(r"\[Source:[^\]]*\]", "", val, flags=re.I).strip(" .;")
            if len(val) < 3 or val.lower() in _skip_vals:
                continue
            # Prefer a distinctive 24-char window so address paraphrases still match
            needle = val if len(val) <= 48 else val[:48]
            if _ws_norm(needle) not in _ws_norm(text):
                # Also try first significant token run for long addresses
                tokens = [t for t in re.findall(r"[A-Za-z0-9]{4,}", val) if t.lower() not in (
                    "private", "limited", "india", "road", "street", "floor", "plot",
                )]
                if tokens and any(t.lower() in text_l for t in tokens[:3]):
                    continue
                issues.append(GroundingViolation(
                    section_id=section_id,
                    quote=f"{label}: {val[:80]}",
                    problem=(
                        f"ADD: inventory party field '{label}' is missing from the draft — "
                        "insert the exact value into the party introduction / caption."
                    ),
                ))
            continue
        # Unlabeled company-name lines (legacy digest format)
        body = raw.lstrip("-•* ").strip()
        m = re.search(
            r"([A-Z][A-Za-z0-9&.,'()\- ]{8,60}(?:Pvt\.?\s*Ltd\.?|Limited|LLP|LLC))",
            body,
        )
        if m:
            name = m.group(1).strip()
            core = name.split()[0].lower()
            if len(core) >= 4 and core not in text_l:
                issues.append(GroundingViolation(
                    section_id=section_id,
                    quote=name[:50],
                    problem="Party name from inventory not found in draft caption/parties.",
                ))

    return issues[:60]

