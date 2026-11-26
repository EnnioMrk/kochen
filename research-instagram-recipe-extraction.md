# Instagram recipe extraction: how the apps do it

**Research date:** 15 November 2026  
**Question:** How do apps turn an Instagram link into a structured recipe?  
**Scope:** Public posts and Reels. iOS and Android share flow. English-language sources.  
**Method:** Platform documentation, vendor documentation, app listings, open-source extractor code, and one live test of an Instagram embed page.

## Answer

The apps do not read recipes from an Instagram API. Instagram has no public recipe API. The apps take the shared URL, fetch the public caption, download the Reel when the caption is incomplete, transcribe the audio, read text from frames and carousel images, and give all of that to a large language model. The model fills a recipe schema. The app shows an editable draft. The caption is the lowest-cost source. Video and images are the fallback. The model is the last step.

## 1. What Instagram provides

### 1.1 No general read API

The Instagram Platform serves professional accounts. A permission allows access to data created by the app user who granted it. A few endpoints expose limited public data [1]. The IG Media endpoint returns only media owned by professional accounts. It cannot return media owned by personal accounts [2].

The old Instagram Basic Display API stopped on 4 December 2024. All requests now return an error [3]. That removed the old consumer-facing read API.

### 1.2 oEmbed is for display only

The oEmbed endpoint returns embed HTML and basic metadata. It supports photos, videos, Reels, and feed posts. It does not support Stories, private accounts, inactive accounts, or age-restricted accounts. It allows 1,000 requests per hour [4].

The terms are explicit. The endpoint is only for embedding. The terms prohibit "consuming, manipulating, extracting, or persisting" the metadata or content [4]. Since 15 May 2026, the endpoint works without an access token [3]. Since 3 November 2025, it no longer returns author or thumbnail fields [3]. So oEmbed is a display widget, not a recipe source.

### 1.3 The captioned embed page is the common shortcut

For a public post, the URL `https://www.instagram.com/{p|reel|tv}/{shortcode}/embed/captioned/` returns HTML. The HTML contains a `div class="Caption"` block with the author name and the caption text [5].

In a test on 15 November 2026, a plain fetch of a public Reel returned the caption block without a login. The page also returned a thumbnail. It did not return a video file URL. The page is undocumented. Instagram can change it, rate-limit it, or serve a login wall.

### 1.4 The logged-out GraphQL route returns media

yt-dlp sends a `PolarisLoggedOutDesktopWWWPostRootContentQuery` request with a `doc_id` and the web app ID. The response contains the caption and the video versions [6]. This is how a downloader can get a Reel without a login.

The route is rate-limited. yt-dlp warns: "You have exceeded the rate-limit for accessing posts anonymously" [6]. When Instagram serves a login page, yt-dlp stops and asks for cookies.

### 1.5 Business Discovery is the official route to another professional account's public media

Business Discovery returns public fields for other Instagram professional accounts. It needs a professional account token. It does not work for personal accounts. It omits `media_url` for videos with licensed audio, and for Reels whose owner disabled downloads [7].

The documented purpose is "basic metadata and metrics" [7]. Meta's Platform Terms limit processing to the permitted purposes in the developer documentation [8]. Building a recipe library is not the documented use case.

### 1.6 Scraper APIs sell the same data

Apify's Instagram Scraper returns captions, video URLs, audio URLs, carousel children, and comments. It costs from USD 1.50 per 1,000 results [9]. It describes itself as the "unofficial Instagram API" for data that Instagram cut off from the official API in 2020 [9]. Many similar providers exist.

### 1.7 Route comparison

| Route | Auth | What you get | Main limit | Fit for recipe import |
|---|---|---|---|---|
| oEmbed | App token, or none since May 2026 | Embed HTML, basic metadata | Display only. No extraction. No separate caption field. | Bad |
| Captioned embed page | None | Caption, author, thumbnail | Undocumented. Public posts only. No media file. | Good first step |
| Logged-out GraphQL | App ID and `doc_id` | Caption, media URLs | Rate limits. Changes often. | Good for media |
| Business Discovery | Professional account token | Public media fields for professional accounts | Professional accounts only. Purpose limit. | Legitimate but narrow |
| yt-dlp | None, or cookies | Metadata, audio, video | Blocks. Login walls. Breaks when Instagram changes. | Good fallback |
| Scraper API | API key | Caption, media, comments | Cost. Dependency. Terms risk. | Good for scale |

## 2. The pipeline

### 2.1 Capture the link

The user taps Share in Instagram and selects the recipe app. On Android, the app registers an `ACTION_SEND` intent filter for `text/plain`. The URL arrives in `EXTRA_TEXT` [10]. On iOS, the app provides a share extension. ReciMe's instructions show the same flow: Share, Share to, ReciMe [11].

The share sheet passes a URL, not the video. The app must fetch the content itself.

The app should then:

- Resolve `instagram.com/share/...` redirects.
- Accept `/p/`, `/reel/`, `/reels/`, and `/tv/` URLs.
- Extract the shortcode.
- Remove tracking parameters.
- Deduplicate by shortcode.

### 2.2 Fetch the caption first

The caption is the cheapest source. It is one HTTP request. It needs no media download, no speech recognition, and no OCR. ReciMe says it works best when the recipe is written in the caption [11]. Pluck says most Reels captions are incomplete: ingredients without quantities, or no instructions [12].

Caption-first is a cost decision, not a quality guarantee.

Implementation:

- Fetch the captioned embed page.
- Parse the `.Caption` block.
- Store the author, caption, canonical URL, and a hash of the raw HTML.
- Check for quantities, units, and step verbs.
- Continue to media or the creator's website when the caption is thin.

### 2.3 Fetch media only when needed

Triggers:

- No ingredient list.
- No quantities.
- No steps.
- A caption that only says "recipe in comments" or "full recipe on my blog".

Options:

- yt-dlp with stored cookies.
- Logged-out GraphQL.
- A third-party scraper API.

Limits:

- Duration cap.
- Byte cap.
- Audio only, plus sampled frames.
- Do not download 4K video to read text.

### 2.4 Turn media into text

**Speech.** Transcribe the narration. OpenAI's file transcription accepts common audio formats up to 25 MB and returns text [13]. ReciMe and Deglaze say they use the audio [11][14]. Pluck says ReciMe, Honeydew, and Deglaze use the audio transcript [12].

**On-screen text.** Run OCR on sampled frames. Google Cloud Vision `TEXT_DETECTION` extracts text and word boxes from any image [15]. Deglaze says it reads text overlays and scenes [14]. Pluck says it reads on-screen text and frames [12].

**Carousel slides.** OCR each slide. Pluck says carousel posts with the recipe spread across slides are read as one recipe [12]. A CookBook guide tells users to screenshot carousel slides and use the scanner [16].

**Comments.** Read the author's first comment or pinned comment. If a creator puts the list there, the import misses it when the app reads only the caption. At least one major app, ReciMe, does not read pinned comments, according to one comparison [16]. That is a gap, not a universal rule.

**Creator website.** Find a URL in the caption or bio. Fetch the page. Parse its Recipe JSON-LD. ReciMe says it does this when the caption and audio fail [11]. This is the highest-confidence fallback, because food blogs usually publish schema.org Recipe markup [17]. Schema.org reports that Recipe markup appears on 10,000 to 100,000 domains, based on Google's index [17].

### 2.5 Extract with a schema

The documented apps describe AI extraction. The standard way to make it reliable is a large language model with a strict JSON schema. OpenAI Structured Outputs constrains output to a supplied JSON Schema [18]. The schema should map to schema.org Recipe:

- `name`
- `recipeIngredient`
- `recipeInstructions`
- `recipeYield`
- `prepTime`
- `cookTime`
- `totalTime`
- `recipeCategory`
- `recipeCuisine`
- `suitableForDiet`
- `nutrition`
- `image`
- `author`

Set temperature low. Validate required fields and business rules. Flag missing quantities. Do not invent them.

Input order matters:

1. Caption.
2. Transcript.
3. OCR text with timestamps.
4. Short instruction: use only the supplied text; leave a missing quantity null.

Ask for a confidence score per field, not one global score. Pluck describes a confidence score per extraction, then a review step [12].

### 2.6 Review

The documented apps show an editable draft. Extraction from social video is probabilistic. A wrong quantity is worse than a blank field. The review screen is part of the product, not a debug view.

## 3. What the apps say they do

| App | What it says it reads | Fallback | Source |
|---|---|---|---|
| ReciMe | Caption first. Audio if there is no written recipe. | Creator's original website | [11] |
| Deglaze | Caption, audio, on-screen text, scenes | Website and photo import | [14] |
| Pluck | Caption, narration, on-screen text, frames | JSON-LD for websites | [12] |
| Pestle | Share to app. Import from Instagram, TikTok, Facebook, YouTube. | Bookmarks when extraction fails | [19] |
| Just the Recipe | Share or paste. Transcribes the video. | Website extraction | [20] |
| Mela | Share extension. Website extraction where supported. | None stated for social video | [21] |
| Cookpad | Share or paste a link from Instagram, TikTok, X, or a website. | Photo scan | [22] |

These are vendor claims. I found no independent, methodical accuracy benchmark.

## 4. Analysis

**Caption-first is rational.** A caption fetch is one request. A video pipeline is a download, a speech-recognition call, an OCR pass, and a larger model call. If most recipes are in captions, the cheap path handles most volume. The expensive path exists for the rest.

**The advantage is retrieval and fallback, not the model.** Any team can call a language model with a schema. The differentiators are:

- Can you get the caption when Instagram changes its HTML?
- Can you get the video when yt-dlp is blocked?
- Can you find the creator's website?
- Can you read a carousel?
- Can you do all of that at a low cost per import?

**The official API cannot support the product.** oEmbed is display-only [4]. Business Discovery is narrow [7]. The IG Media endpoint is for owned media [2]. A product built on the official API cannot import an arbitrary public recipe. A consumer importer for arbitrary public posts must depend on undocumented endpoints, downloaders, or scrapers. That is a platform risk. The mitigation is user-initiated, low-volume, cached, and easy to disable per source.

**On-device versus server is a real split.** Server-side pipelines can use large speech and vision models. On-device pipelines protect privacy and avoid per-import cost, but they handle less ambiguity. Pluck reports that Mela and Pestle parse captions with on-device machine learning [23]. Mela's own listing says website extraction works only where the site supports it [21]. The exact split is unclear. For a small app, server-side is simpler to improve.

**Unit economics (inference).** Apify's caption-level data costs about USD 0.0015 per result at the 1,000-result rate [9]. Speech recognition and model tokens likely dominate the cost. That is a plausible reason free tiers are small. ReciMe limits its free plan to 5 imports per week [24]. The scrape is not the largest cost. The multimodal model call is.

**The source limits quality.** A Reel with no caption, loud music, no on-screen text, and no spoken quantities cannot produce a reliable recipe. The best apps return a partial draft and say so. The worst apps invent amounts. The review UI and the confidence flags are the safety layer.

## 5. Legal and platform risk

**Meta's terms.** The Meta Terms of Service, effective 1 January 2025, prohibit access to or collection of data from Meta Products "using automated means (without our prior permission)" and say this applies "regardless of whether such automated access or collection is undertaken while logged-in" [25]. Instagram is a Meta product and has its own Terms of Use with a comparable prohibition [26]. A recipe importer that fetches Instagram pages at scale conflicts with these terms, even when the data is public.

**oEmbed terms.** The oEmbed documentation is explicit. The endpoint is only for embedding. It prohibits "consuming, manipulating, extracting, or persisting" the metadata and content [4]. Do not use oEmbed HTML as a recipe source.

**The Bright Data ruling does not give permission.** In January 2024, a US court held that Meta's terms, as then written, did not bar logged-off scraping of public data by a party with no active account [27]. The court did not hold that scraping is allowed. Meta's 2025 terms now address logged-out access [25]. The ruling is a contract decision, not a permission from Instagram.

**Copyright.** A mere listing of ingredients is not protected by copyright. Directions with substantial literary expression, and collections of recipes, may be protected. Photographs and videos are protected [28]. Do not rehost the creator's video or photos. Store the recipe text, the source URL, and a short attribution.

**Privacy.** In the EU, public captions and usernames can still be personal data. The EDPB's 2026 draft guidelines on web scraping say that the GDPR applies when scraping processes personal data, and that purpose limitation and transparency apply [29]. If you store creator handles or captions, you need a lawful basis, a retention rule, and a deletion path.

**Practical rules:**

- Import only on a user action. One URL per action.
- Do not crawl profiles, hashtags, or feeds.
- Cache by shortcode. Do not re-fetch the same post.
- Back off on 429 and login walls. Do not rotate proxies to evade limits.
- Do not import private, inactive, or age-restricted posts.
- Keep the source URL and creator handle. Link back.
- Delete media after extraction. Keep text only.
- Give a takedown path.

This is not legal advice.

## 6. What this means for your importer

Your code already implements the same shape:

- Instagram caption: `public-video.ts` renders `/{p|reel|tv}/{shortcode}/embed/captioned/` and parses `.Caption` [30].
- Video: `video.ts` uses yt-dlp for metadata, captions, audio, and one frame every 5 seconds, with a 12-frame cap [30].
- Speech: `import.ts` transcribes the audio and passes the transcript plus frames to the model [30].
- Links: `link.ts` reads Recipe JSON-LD first, then Readability text [30].
- Failure: when media is blocked, `import.ts` falls back to title and caption and marks a warning [30].

That is a solid caption-first design. The gaps against the documented leaders are:

1. **Carousel slides.** You handle video frames, but not still carousel images. Recipe cards often live on slides. Add image extraction and OCR for carousel posts.
2. **Explicit OCR.** You send frames to a multimodal model. That can read text, but you have no separate OCR text, no timestamps, and no testable OCR step. Add an OCR pass for on-screen text and merge it with the transcript.
3. **Pinned or first comment.** The `authorComment` field is filled from the description, not from a comment. You do not fetch the author's comment. ReciMe does not either, according to one comparison [16]. That is an opportunity: read the author's first comment and include it.
4. **Creator website fallback.** ReciMe locates the original recipe site when caption and audio fail [11]. You already have a JSON-LD parser in `link.ts`. Add URL extraction from the caption and bio, then call `prepareLink`.
5. **Caption completeness signal.** Do not send a 40-character caption to the model and hope. Check for quantities, units, and step verbs. If they are missing, continue to media or the website.
6. **Confidence and missing fields.** Ask the model for per-field confidence and a list of missing quantities. Show both in review. Do not fill gaps silently.
7. **Cache and queue.** A Chromium render and a video download per import are heavy. Cache by shortcode, deduplicate, and keep the queue.

Priority order:

1. Caption completeness and website fallback.
2. Carousel OCR.
3. Author comment.
4. Explicit OCR and timestamps.
5. Confidence.

The first two give the most quality for the least new infrastructure.

Do not add bulk profile or hashtag scraping. It raises cost, legal risk, and blocking risk without improving the one-link user flow.

## 7. Limits and open questions

- No independent accuracy data. Vendor comparisons are marketing.
- The embed page and GraphQL routes are undocumented and can change without notice.
- I did not identify a recipe app named "Rea" in the App Store, Google Play, or general web search. I used ReciMe because it publishes its import method. If "Rea" is a different app, send its link and I will check its flow.
- I did not test a private, age-restricted, or carousel post. The behavior described for those cases comes from documentation, not from my test.
- Legal analysis is a summary, not legal advice.

## Sources

1. Meta, "Instagram Platform overview." https://developers.facebook.com/documentation/instagram-platform/overview
2. Meta, "IG Media" reference. https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media
3. Meta, "Changelog for Instagram Platform," entries for 15 May 2026, 3 November 2025, and 4 December 2024. https://developers.facebook.com/documentation/instagram-platform/changelog
4. Meta, "Embed an Instagram Post" (Instagram oEmbed), updated 15 May 2026. https://developers.facebook.com/documentation/instagram-platform/oembed
5. Instagram, captioned embed page for a public Reel, fetched 15 November 2026. https://www.instagram.com/reel/C_qROhnIMcU/embed/captioned/
6. yt-dlp, Instagram extractor source. https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/instagram.py
7. Meta, "Business Discovery." https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-discovery
8. Meta, "Platform Terms," updated 3 February 2026. https://developers.facebook.com/terms/
9. Apify, "Instagram Scraper" actor page, accessed 15 November 2026. https://apify.com/apify/instagram-scraper
10. Android Developers, "Receive data from other apps." https://developer.android.com/training/sharing/receive
11. ReciMe Help, "Import from Instagram," updated 9 August 2026. https://recime.app/help/en/articles/11596425-import-from-instagram
12. Pluck, "How to Save Recipes from Social Media in 2026," updated 12 October 2026. https://pluckrecipes.com/blog/save-recipes-from-social-media
13. OpenAI, "File transcription." https://platform.openai.com/docs/guides/speech-to-text
14. Deglaze, "How to Save Recipes from Instagram (2026 Guide)." https://www.deglaze.app/how-to/save-recipes-from-instagram
15. Google Cloud, "Optical Character Recognition (OCR)." https://cloud.google.com/vision/docs/ocr
16. CookBook, "Best Apps to Save Recipes from TikTok: Six Compared." https://cookbookmanager.com/post/best-apps-to-save-recipes-from-tiktok
17. Schema.org, "Recipe." https://schema.org/Recipe
18. OpenAI, "Structured model outputs." https://platform.openai.com/docs/guides/structured-outputs
19. Apple App Store, "Pestle: Recipe Manager." https://apps.apple.com/us/app/pestle-recipe-manager/id1574776971
20. Apple App Store, "Just the Recipe: Cook smarter." https://apps.apple.com/us/app/just-the-recipe-cook-smarter/id1598423213
21. Apple App Store, "Mela - Recipe Manager." https://apps.apple.com/us/app/mela-recipe-manager/id1548466041
22. Apple App Store, "Cookpad: Recipe & Meal Planner." https://apps.apple.com/us/app/cookpad-recipe-meal-planner/id585332633
23. Pluck, "Best AI Recipe App in 2026." https://pluckrecipes.com/blog/best-ai-recipe-app
24. ReciMe, product site and FAQ, accessed 15 November 2026. https://www.recime.app
25. Meta, "Terms of Service," effective 1 January 2025. https://www.facebook.com/legal/terms
26. Instagram, "Terms of Use." https://help.instagram.com/581066165581870
27. Fenwick & West, "Major Decision Affects Law of Scraping and Online Data Collection, Meta Platforms v. Bright Data," 2024. https://www.fbm.com/publications/major-decision-affects-law-of-scraping-and-online-data-collection-meta-platforms-v-bright-data
28. U.S. Copyright Office, "What Does Copyright Protect?" https://www.copyright.gov/help/faq/faq-protect.html
29. European Data Protection Board, "Guidelines 03/2026 on web scraping in the context of generative AI." https://www.edpb.europa.eu/public-consultations/guidelines-032026-on-web-scraping-in-the-context-of-generative-ai_en
30. Kochen repository, `apps/worker/src/imports/public-video.ts`, `apps/worker/src/imports/video.ts`, `apps/worker/src/jobs/import.ts`, `apps/worker/src/imports/link.ts`, accessed 15 November 2026.
