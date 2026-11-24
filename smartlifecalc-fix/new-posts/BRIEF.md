# Brief: new explanatory blog posts (no calculator) for two Blogger sites under AdSense review

Sites: English "Smart Life Calc" (https://www.smartlifecalc.com), Japanese 「くらしの計算ツール」 (https://daily-glow-up.blogspot.com).
Both were rejected for "low value content" because every post was a near-identical calculator template. All existing posts were just rewritten. These NEW posts must look and read like genuinely useful, original explainer articles written by a careful human: no calculator widget, a different structure from each other, one worked table computed by you, 2–3 authoritative sources, and 2 internal links to existing calculator posts.

For each assigned post, produce one JSON object. Write all objects for your batch into ONE JSON file (UTF-8, a JSON array, nothing else) at the path you are given. Fields:
- "id": as given (e.g. "N01")
- "title": final post title (EN ≤ 75 chars; JP ≤ 45 chars). Specific, no clickbait, no year unless content is year-specific.
- "slug": permalink slug, lowercase ASCII words with hyphens, ≤ 6 words (e.g. "prorated-rent-mid-month"). Japanese posts also use English/romaji slugs.
- "labels": array of 3–4 Blogger labels. EN reuse existing style: "Calculator" is NOT used (these are guides); use e.g. "Guide", plus topic labels like "Housing", "Mortgage", "Credit Card", "Cooking", "Date", "Pay". JP: use "くらしの知識" plus 2–3 topic labels (e.g. "家賃", "日数計算").
- "meta": search description, EN 120–150 chars, JP 70–110 chars, specific (mention a concrete number or feature), all different.
- "html": the post body as Blogger-ready HTML (see rules).
- "sources": array of {"name","url"} you cited (same as in the html).
- "check": a short plain-text note of every number in the post and how you verified it (Python), for the reviewer.

HTML rules:
- Wrap everything in <div style="font-size:18px;line-height:1.8;max-width:720px;margin:0 auto"> … </div>. Headings: <h2 style="font-size:26px;margin:28px 0 10px">, <h3 style="font-size:21px;margin:22px 0 8px">. Tables wrapped in <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:16px"> with th/td style="border:1px solid #ccc;padding:6px 8px". Lists ul/ol. Bold with <b>. No <script>, no <style>, no images, no iframes, no emoji headings.
- Length: EN 750–1,100 words of body text; JP 2,200–3,200 characters.
- Structure: open with 2–3 sentences answering the question directly. Then sections in an order that fits THIS topic (do not reuse a fixed template: vary between step lists, worked cases, comparison tables, myth/fact, decision checklists). Exactly one "questions" section with 3–4 Q&A as <p><b>Q</b><br>A</p>, headed with a natural, topic-specific heading (never "Frequently asked questions"/"よくある質問").
- Place this AdSense block exactly once, right after the opening paragraph(s) and before the first <h2>:
<!-- Ad (AdSense in-article) -->
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9998285208101924" crossorigin="anonymous"></script>
<ins class="adsbygoogle" style="display:block; text-align:center;" data-ad-layout="in-article" data-ad-format="fluid" data-ad-client="ca-pub-9998285208101924" data-ad-slot="5356922318"></ins>
<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
  (This is the only script allowed.)
- Internal links: exactly 2 links to existing posts, chosen from the existing-posts file (copy URL exactly), placed naturally in the text where a reader would want to calculate their own case, plus a final short "Try it with your numbers" (JP: 「自分の数字で確かめる」) paragraph linking the same or one other calculator. Use <a href="URL">anchor</a>.
- Sources: a section titled "Sources" (JP 「参考資料」) at the end with <ul> of 2–3 links, ONLY from the whitelist file (copy URLs exactly), each genuinely backing a claim in the post. Then one line in <p style="font-size:15px;color:#555">: how the numbers were checked + "Last reviewed: November 2026" (JP: 最終確認：2026年11月) + a one-sentence general-information disclaimer worded for this topic.
- Facts: only state numbers you are confident are correct as of late 2026; compute every example in Python before writing it; if unsure of a figure, leave it out or give a hedged range with "check your lease/employer/official notice". U.S. context for EN, Japan for JP. JP in です・ます調, natural Japanese, no Chinese simplified characters, no Korean.
- No em-dashes in EN. No mention of AdSense, SEO, Google, AI, or "this article".
