# WeeBee — Project Notes for Claude

## Feature Backlog
These are features Jesse wants to build (no particular order):

- [ ] **Achievement system** — reward users for milestones (e.g. first review, 10 reviews, 50 reviews, etc.)
- [x] **Rank system** — users rank up based on reviews written: Newcomer → Bronze (5) → Silver (15) → Gold (40) → Diamond (100)
- [x] **Community tab** — sidebar Community button currently shows "Coming Soon" popup; needs a full page
- [ ] **Upload WeeBee logo/fonts** — branding assets to replace the plain text logo
- [ ] **Edit profile function** — "Edit Profile" button on the profile page is a placeholder; needs username, avatar, bio, etc.
- [ ] **Upcoming/Seasonal categories** — mentioned but not fully fleshed out; Discover page already has carousels
- [ ] **Black text in search bar** — search bar input text is hard to read
- [ ] **Episode ranking** — ability to rate/rank individual episodes of an anime
- [ ] **Move overall score in review previews** — overall score should appear to the left of the category scores, not the right
- [ ] **Fix review category names** — category labels on review previews are incorrect/need updating
- [ ] **Flesh out Discover page** — carousels and sections need real data and polish

## Tech Stack
- **Frontend:** Vanilla JS (ES modules), HTML, CSS
- **Backend:** Firebase Firestore + Firebase Auth (Google + email/password)
- **Anime data:** Jikan API v4 (MyAnimeList wrapper) — rate limit ~400ms between calls
- **Avatars:** DiceBear v9.x `initials` style (`?seed=...&backgroundColor=ffc107&fontColor=333333`)

## Firestore Collections
- `reviews` — user reviews and suggestions
- `follows` — user-to-user and user-to-anime follows
- `anime_lists` — per-user watch list entries
- `top_anime_lists` — per-user personal top anime lists
- `notifications` — user notifications
- `rankHistory/{mal_id}` — permanent achievement badges (hasBeenFirst/Second/Third + dates)
- `meta/rankSnapshot` — previous week's Top 10 rankings for movement indicators
- `profiles/{uid}` — reviewer rank data (reviewCount, displayName, avatar)
- `profile_comments`, `comments` — guestbook and inline comments
