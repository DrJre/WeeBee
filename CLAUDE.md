# WeeBee — Project Notes for Claude

## Pending Features
- [ ] **Upload WeeBee logo/fonts** — branding assets to replace the plain text logo
- [ ] **BuzzWord: Dragon Ball Characters** — new BuzzWord game

## Next Patch Notes
<!-- Add entries here as features are completed. Claude will append to this after each task. -->

🐉 BuzzWord: Dragon Ball Characters
New BuzzWord game! Guess the daily Dragon Ball character across 7 columns: Gender, Race, Origin, Affiliation, Transforms, Debut Series, and Debut Arc. 50 characters from DB, DBZ, and DBS — main cast, Ginyu Force, Androids, Universe 6 Saiyans, and divine beings.

🏯 Naruto BuzzWord — Category Overhaul
The Naruto BuzzWord game has been significantly improved:
- Village is now Affiliation, showing each character's full faction history (e.g. Itachi = Leaf, Missing-nin, Akatsuki)
- Added Kekkei Genkai column (Yes/No) — bloodline limits are now their own category
- Attribute column cleaned up — Kekkei Genkai and Missing-nin removed, only role-based traits remain
- Land of Waves arc merged into Introduction — Zabuza and Haku now debut in the correct era
- Nature column no longer includes Wood or Ice (those are Kekkei Genkai, not basic natures)
- Info tooltips added to Affiliation, Jutsu Type, Nature, Attribute, and Kekkei Genkai columns

🔧 Add Friend Button Fix
The Add Friend button on user profiles was sending the request correctly but not updating to "Pending" after clicking. Now works as expected.

🛠️ Admin Panel Fix
The Post Patch Notes panel on the News tab now appears reliably regardless of when you navigate to the tab after logging in.

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
