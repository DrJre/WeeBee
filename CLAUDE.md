# WeeBee — Project Notes for Claude

## Pending Features
- [ ] **Upload WeeBee logo/fonts** — branding assets to replace the plain text logo
- [ ] **BuzzWord: Dragon Ball Characters** — new BuzzWord game

## Unpublished Patch Notes (v1.5 — post to News tab when admin panel is working)
```
🏠 Unified Activity Feed
The home page now has a single merged feed showing reviews, tier lists, and BuzzWord results all in one chronological stream. Social posts (from people you follow or are friends with) appear first.

🎨 Color-Coded Post Cards
BuzzWord posts now have a green tint and green border. Tier list posts have a blue tint and blue border — making it easy to tell content types apart at a glance.

📋 Tier Lists on the Feed
Tier list posts now appear on the home feed and community feed as full cards with like, dislike, and comment support — same as review cards.

🖱️ Tier List Drag to Reorder
You can now drag entire tiers up and down to reorder them, and drag items within a tier to rearrange them — all while keeping contents intact.

🏆 Top 10 Podium Fix
The #3 spot on the All-Time Top 10 podium was not displaying correctly. Fixed — the top 3 now always reflect the highest-rated anime with at least 5 reviews.

🎖️ 17 New Achievements
New achievements added across BuzzWord (One Piece, Naruto, Bleach) and the Community tab — including tier list milestones, feed activity, and cross-game challenges.

📌 Badge Showcase
You can now pin up to 3 earned achievements to your profile banner. Select them from the Edit Profile screen.

🖼️ Profile Banner Redesign
The profile banner now fills the full card width. Your info (avatar, name, follow counts, genres) appears in a frosted glass card overlaid on the banner.

🌄 Custom Banner Photos
You can now upload your own banner photo from Edit Profile. Recommended size: 1400×400px.

📰 Patch Notes Format
The News tab now shows the 4 most recent patch notes side by side. Older updates collapse under a "Show more" button. The newest entry is tagged LATEST.

⚔️ BuzzWord: Bleach Characters
New BuzzWord game! Guess the daily Bleach character across 7 columns: Gender, Race, Affiliation, Rank, Zanpakuto Type, Bankai, and Debut Arc. 50 characters from all major factions.
```

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
