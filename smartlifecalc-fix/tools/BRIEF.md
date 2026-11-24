# Writer brief — new, post-specific content for calculator blog posts

Context: two Blogger sites (English: smartlifecalc.com; Japanese: daily-glow-up.blogspot.com 「くらしの計算ツール」) were rejected by AdSense for "low value content". Analysis showed every post follows the identical template, repeats its own FAQ 2–3 times, cites no sources, and has empty image alt text. Your job: for each post in your batch, write the *post-specific* additions that make the page genuinely different from the other posts and from generic calculator sites. A separate script will merge your output into the existing HTML (dedupe is handled; do NOT rewrite the existing text).

Input: your batch JSON file has `all_titles` (every post on that blog with its URL) and `posts` (each with id, title, url, meta, labels, headings, text = the current full text of the post). Read each post's `text` first so you do not repeat what is already there.

Write ONE JSON file (UTF-8, valid JSON, nothing else in the file) at the output path you were given:
{
  "<post id>": {
    "alt": "descriptive image alt text, 6–14 words (EN) / 15–30 chars (JP), names the calculator and what it shows",
    "meta": "new search description, 120–155 chars EN / 70–110 chars JP, specific, no clickbait, mentions a concrete feature or number",
    "article_h2": "a specific, non-template article heading (EN: 6–12 words; JP: 15–30 chars). Must NOT start with 'How to' or contain 'calculator' alone. JP must not start with '使い方'. Each post gets a different *kind* of heading (a question, a claim, a scenario...).",
    "faq_heading": "a varied phrasing for the FAQ section, different for every post (EN e.g. 'Questions people ask about tipping', 'Common questions on car loans'; JP e.g. '割り勘でよくある疑問', '読者からの質問'). Never the bare 'Frequently asked questions' / 'よくある質問'.",
    "sections": [
      {"h": "section heading (specific)", "html": "<p>…</p> plain HTML: p, ul/ol/li, b, table (inline style: border:1px solid #ccc;padding:6px)"},
      {"h": "...", "html": "..."}
    ],
    "sources": [ {"name": "Source name – page", "url": "https://..."} , ... ],
    "related": ["exact title of another post on the same blog", "...", "..."],
    "disclaimer": "one sentence, worded differently per post, saying results are estimates / not professional advice (EN ≤25 words, JP ≤60 chars)"
  }, ...
}

Rules for `sections` (the most important part):
- Exactly 2 sections per post. Together 220–320 English words, or 450–700 Japanese characters. Concrete, specific, useful: a realistic scenario with real numbers worked through, a regional/legal nuance, a comparison table with 4–6 rows, a decision rule, a common misconception explained with a number. No filler, no 'In today's fast-paced world', no restating what the calculator does.
- Each section heading must be unique across the whole batch and must not match any heading already in that post's `headings`.
- Vary the *form* across posts in your batch: at least one post gets a comparison table, one gets a numbered decision checklist, one gets a myth-vs-fact list, one gets a 'what changes in 2026' or regional note, one gets a short worked case study. Do not give every post the same two section types.
- Numbers must be arithmetically correct — check your own math. Do not invent statistics you are not sure about; prefer ranges and rules that are stable (formulas, legal thresholds you are confident of, standard conventions). If unsure of a figure, leave it out.
- English: U.S. context, plain English, no em-dashes. Japanese: 丁寧語（です・ます）, no 中国語簡体字, use full-width 「」 and ・.
- Never mention AdSense, SEO, Google, or 'this article was updated'.

Rules for `sources`: 2 or 3 per post, chosen ONLY from the whitelist file you were given (copy URLs exactly). Pick the ones that genuinely back something on that page (formula, legal rule, rate, health standard). `name` should say what the page is.

Rules for `related`: 3 titles copied EXACTLY from `all_titles`, excluding the post itself, chosen for real topical closeness.

Quality bar: a human reviewer should be able to read any one of these posts and find something they could not find on a generic calculator site. Write at the level of a careful consumer-finance / lifestyle journalist.
