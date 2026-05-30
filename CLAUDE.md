# WeeBee — Project Notes for Claude

## Pending Features
- [ ] **Upload WeeBee logo/fonts** — branding assets to replace the plain text logo

## Next Patch Notes

🗃️ WeeBee Character Database
WeeBee now has its own character database — 800+ characters pulled from the top 50 most popular anime, each with a name, image, and series. Character searches in tier lists and brackets now hit this local database first (instant results), fall back to AniList for anything not found, and auto-save new results for next time. MAL is still used for all anime data; only character lookups have moved to AniList.

⭐ WeeBee Original Templates
- 5 bracket tournament templates: Top Aura Farmer, The GOAT Debate, Greatest Villain, Best Swordsman, Best Sensei — each with 16 characters pre-loaded
- 5 tier list templates: Power Rankings, Shonen Protagonists, Best Rivals, Greatest Villains, Best Sensei — each with 20+ characters ready to rank
- Templates appear in the WeeBee Originals section when creating a bracket or tier list

🔍 Smarter Character Search
- When building a character tier list with a source anime selected, search results now prioritize characters from that anime — type "Guy" in a Naruto tier list and Might Guy appears first
- "Narrator" and other non-character entries are filtered out of all results
- Source anime character pools are now capped at 50 (main cast first) instead of loading hundreds

🃏 Bracket Templates
Bracket tournament templates now feature 16 characters each, giving you a full bracket right out of the box.

🟣 Tier List Card Color
Tier list posts on the feed now use a purple-blue tint instead of solid blue, matching the tier list page banner color.

🐛 Like Count Fix
Liking a tier list post on the Community page now correctly updates the count shown on screen. (The same post appearing in multiple feeds simultaneously was causing the wrong counter to update.)

🐝 Followers Tab
- The Followers count on user profiles is now clickable — tap it to jump straight to the Followers tab
- New Followers tab on every profile showing the full list of followers, each clickable to visit their profile

📊 Dual Scores on Search & Top 10
- Anime search results now show both a WeeBee score and a MAL score side by side, each labeled
- The Discover page Top 10 list and podium now show both scores too — WeeBee badge in its tier color, MAL badge in blue

🗂️ Profile Tab Reorder
Tabs are now in a more logical order: Reviews → Tier Lists → Achievements → Friends → Following → Followers

🖼️ Sharper Profile Banners
Banner uploads now preserve significantly more detail — max resolution bumped from 1400px to 2400px, and JPEG quality raised from 85% to 92%. Re-upload your banner to get the improvement.

🃏 Tier List Templates
- Every tier list card on the home feed now has a "Make One" button in the top corner
- The tier list viewer has "Use as Template" and "Start Fresh" buttons in the header
- Both options pre-load the tier structure (categories and colors) from the original, but start with empty slots

🔧 Follow Button Restored
The Follow button on user profiles had gone missing after a previous redesign. It's back in the top-right of the banner alongside the Message and Add Friend buttons, and includes the notification bell for accounts you follow.

🐉 BuzzWord: Dragon Ball Characters
New BuzzWord game! Guess the daily Dragon Ball character across 7 columns: Gender, Race, Origin, Affiliation, Transforms, Debut Series, and Debut Arc. 50 characters spanning DB, DBZ, and DBS — main cast, Ginyu Force, Androids, Universe 6 Saiyans, and divine beings.

🏯 Naruto BuzzWord — Category Overhaul
- Village is now Affiliation, showing each character's full faction history (e.g. Itachi = Leaf, Missing-nin, Akatsuki)
- Added Kekkei Genkai column (Yes/No) — bloodline limits are now their own category
- Attribute column cleaned up — role-based traits only
- Land of Waves arc merged into Introduction — Zabuza and Haku now debut in the correct era
- Nature column no longer includes Wood or Ice (those are Kekkei Genkai, not basic natures)
- Info tooltips added to Affiliation, Jutsu Type, Nature, Attribute, and Kekkei Genkai columns

🩸 Bleach BuzzWord — Image Fix
Characters from Thousand-Year Blood War Parts 2 & 3 (Yhwach, Jugram, Pernida, etc.) now load their images correctly.

🏴‍☠️ One Piece BuzzWord — Marco Added
Marco the Phoenix is now in the One Piece BuzzWord character pool.

⏱️ Post Timestamps
Review cards and BuzzWord feed posts now show how long ago they were posted.

💡 BuzzWord Banners (Light Mode)
BuzzWord game banners now use a subtle colored tint in light mode instead of full solid colors, reducing harsh contrast while keeping each game's color theme. Dark mode is unchanged.

📺 Series Review Score Fix
Series-level reviews (the overall score given after reviewing a full series) no longer count toward individual season WeeBee scores. Season scores only reflect per-season reviews.

## Standards
- **Comment sections** — every comment section must include: post comment, edit (with "(edited)" indicator), delete (with confirm), and Enter-to-submit. Use `renderBwComment()` as the template for new comment sections going forward.

## Tech Stack
- **Frontend:** Vanilla JS (ES modules), HTML, CSS
- **Backend:** Firebase Firestore + Firebase Auth (Google + email/password)
- **Anime data:** Jikan API v4 (MyAnimeList wrapper) — rate limit ~400ms between calls; responses cached in `anime_cache` Firestore collection (7-day TTL, stale fallback on outage)
- **Avatars:** DiceBear v9.x `initials` style (`?seed=...&backgroundColor=ffc107&fontColor=333333`)
- **Storage:** Firebase Storage for avatar uploads

## Firestore Collections
- `reviews` — user reviews, suggestions, and series ratings (`type`: quick, in-depth, suggestion, series)
- `follows` — user-to-user and user-to-anime follows
- `anime_lists` — per-user watch list entries
- `top_anime_lists` — per-user personal top anime lists
- `notifications` — user notifications
- `rankHistory/{mal_id}` — permanent achievement badges (hasBeenFirst/Second/Third + dates)
- `meta/rankSnapshot` — previous week's Top 10 rankings for movement indicators
- `profiles/{uid}` — reviewer rank data (reviewCount, displayName, avatar, bio, genres, bannerUrl)
- `profile_comments`, `comments` — profile comments and inline review comments
- `conversations` — DM conversations (subcollection: messages)
- `friends`, `friend_requests` — friends system
- `achievements` — user achievement records
- `seasonal_votes`, `seasonal_vote_records`, `seasonal_winners`, `seasonal_badges` — seasonal voting system
- `tier_lists` — user-created anime/character tier lists
- `patch_notes` — WeeBee update posts (likes/dislikes arrays)
- `bug_reports`, `feature_suggestions`, `direct_suggestions` — user feedback
- `anime_cache` — Jikan API response cache keyed by endpoint (7-day TTL)
- `founders` — founder badge holders

## Completed Features
- [x] Achievement system (37 achievements, 4 categories, profile tab, toast notifications)
- [x] Rank system (Newcomer → Bronze → Silver → Gold → Diamond based on review count)
- [x] Community tab (tier lists feed, coming soon section)
- [x] Edit profile (Display Name, Bio, Avatar upload, Favorite Genres, Profile Banner with presets)
- [x] Upcoming/Seasonal carousels on Discover page
- [x] DM system with privacy settings, unread badge, real-time updates
- [x] Friends system (mutual requests, Accept/Decline in notifications, Friends profile tab)
- [x] Follow system (user + anime follows, state persists on page load)
- [x] User + anime search from top bar
- [x] Live notifications (onSnapshot, real-time badge)
- [x] Seasons & Films tab on anime pages
- [x] Episode ranking
- [x] Tier lists (drag-and-drop, custom tiers/colors, like/share, profile tab, Community feed)
- [x] Seasonal Top 5 voting (admin panel, gold/silver/bronze badges, auto-close)
- [x] News reader (Jikan news, article modal, patch notes system with reactions)
- [x] Profile customization (banner with gradient presets or custom URL)
- [x] Jikan API cache (Firestore-backed, stale fallback on outage)
- [x] Review system (quick, in-depth, editable, one per anime, delete via ⋮ menu)
- [x] Suggested by Friends section (8+ score threshold)
- [x] Completed anime count on profile stats
- [x] Clear All button on notifications dropdown
- [x] Scroll wheel disabled on score fields
- [x] Review card ⋮ menu for delete (replaces aggressive trash icon)
- [x] Patch note reactions (like/dislike stored on patch_notes doc)
- [x] Series reviews — prompt after reviewing a series anime, stored as `type: 'series'`; Series Ratings section on anime pages; ⋮ menu delete; season vs series labeling on cards
