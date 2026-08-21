"""Throwaway: timing + noise check for the chronology OCR sweep."""
import random
import time

from app.services.chronology.sweep import sweep_events

random.seed(7)

filler = (
    "The petitioners submit that the said land is in their possession and that "
    "the respondents have no right to interfere with the same. It is submitted "
    "that the balance of convenience lies in favour of the petitioners. "
)
statutory = [
    "The Draft Development Plan was published in the Official Gazette on 10.08.2022 under Section 26(1).",
    "A corrigendum dated 25.08.2022 was issued thereafter.",
    "We have perused the order dated 16.01.2024 passed in W.P. No. 553/2024.",
    "The State Government issued the impugned notification dated 15.04.2025 under Section 31(1) of the MRTP Act.",
    "The petitioners submitted representations dated 02.02.2024, 09.07.2024 and 29.08.2024.",
    "The Development Plan was sanctioned under Section 31 on 18.04.2001.",
    "By Resolution No. 2648 dated 08.08.2022 the Corporation decided to publish the plan.",
]

pages = []
for page in range(1, 121):
    body = filler * 6
    if page % 17 == 0:
        body += " " + statutory[(page // 17) % len(statutory)]
    pages.append(f"[PAGE {page}]\n{body}")
source = "\n\n".join(pages)

start = time.perf_counter()
events = sweep_events(source, document_name="writ.pdf")
elapsed = time.perf_counter() - start

print(f"chars={len(source):,}  elapsed={elapsed * 1000:.1f} ms  swept={len(events)}")
for event in events:
    print(f"  {event.display_date}  [{event.extra.get('rule')}]  {event.title}")
    print(f"      quote: {event.source_quote[:110]}...")
