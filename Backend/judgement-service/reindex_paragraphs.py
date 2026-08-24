"""Backfill the paragraph index from judgments already in the library.

Every judgment in `ik_judgments` is split into legal chunks and bulk-added
to `ik_judgment_paragraphs`. Deterministic ids + create-only make this
idempotent — re-running never duplicates a chunk.

Run:  .\\venv\\Scripts\\python.exe reindex_paragraphs.py
"""

from __future__ import annotations

import warnings

warnings.filterwarnings("ignore")

from config import get_settings  # noqa: E402
from stores import elastic  # noqa: E402
from tools import build_paragraph_rows  # noqa: E402


def main() -> None:
    client = elastic._get()
    if client is None:
        raise SystemExit("Elasticsearch unavailable — check ELASTICSEARCH_URL/credentials")
    index = get_settings().elastic_index
    total_docs = client.count(index=index)["count"]
    print(f"{total_docs} judgment(s) in '{index}' — building paragraph chunks…")

    done = chunks = 0
    search_after = None
    while True:
        body = {
            "query": {"match_all": {}},
            "sort": [{"tid": "asc"}],
            "size": 25,
            "_source": ["tid", "title", "text", "docsource",
                        "publishdate", "bench"],
        }
        if search_after:
            body["search_after"] = search_after
        resp = client.search(index=index, **body)
        hits = resp["hits"]["hits"]
        if not hits:
            break
        for hit in hits:
            src = hit["_source"]
            doc_id = str(src.get("tid") or hit["_id"])
            rows = build_paragraph_rows(doc_id, src)
            added = elastic.index_paragraphs(doc_id, rows)
            done += 1
            chunks += added
            print(f"  [{done}/{total_docs}] {doc_id}: "
                  f"{added or 'already indexed —'} chunk(s)")
        search_after = hits[-1]["sort"]

    para_index = get_settings().elastic_paragraph_index
    client.indices.refresh(index=para_index)
    total_paras = client.count(index=para_index)["count"]
    print(f"done: {done} judgment(s) processed, {chunks} new chunk(s); "
          f"'{para_index}' now holds {total_paras} paragraph(s)")


if __name__ == "__main__":
    main()
