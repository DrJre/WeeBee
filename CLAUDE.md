# WeeBee — Project Notes for Claude

## Feature Backlog
These are features Jesse wants to build (no particular order):

- [x] **Achievement system** — 37 achievements across 4 categories (Critic, Social, Collector, Special); profile tab, toast notifications, grayed-out locked state
- [x] **Rank system** — users rank up based on reviews written: Newcomer → Bronze (5) → Silver (15) → Gold (40) → Diamond (100)
- [x] **Community tab** — sidebar Community button currently shows "Coming Soon" popup; needs a full page
- [ ] **Upload WeeBee logo/fonts** — branding assets to replace the plain text logo
- [x] **Edit profile function** — Display Name (unique, transaction-backed), Bio, Avatar URL, Favorite Genres (up to 3); uniqueness enforced via usernames collection
- [x] **Upcoming/Seasonal categories** — carousels live on Discover page
- [ ] **DM notifications** — users aren't getting notified when they receive a message; DM dropdown shows "failed to load"
- [ ] **Follow button state** — users still see Follow button after already following someone; state not persisting correctly
- [ ] **User search** — search bar only searches anime; should also be able to search for other users by display name
- [ ] **Dark mode as default** — currently defaults to light mode; flip the default to dark
- [ ] **Friends system** — separate from Follow; users can "friend" people (mutual, requires acceptance) vs "follow" (one-way); Friends tab on profiles
- [ ] **DM privacy settings** — toggleable setting so only friends (not all followers) can message you
- [ ] **Following tab usernames** — Following tab on user profiles not displaying usernames correctly
- [ ] **Live notifications** — currently requires refresh to see new notifications; should update in real-time via onSnapshot
- [ ] **Profile pic click goes to profile** — clicking avatar in topbar should go directly to profile; dropdown should only trigger on the arrow chevron
- [ ] **Followers / Following counts on profiles** — show follower and following counts on profile pages
- [ ] **Add to list from anime page** — ability to add an anime to your list directly from its detail page
- [ ] **Comment count bug** — posts show 0 comments but comments are there when you click; count not updating correctly
- [ ] **Back arrow not working** — back navigation broken on anime detail / profile pages
- [ ] **Top 3 review threshold** — anime shouldn't reach top 3 unless it has at least 10 reviews
- [ ] **Rename Guestbook to Comments** — on user profile pages
- [ ] **Group anime seasons** — group all seasons of an anime under its first season rather than listing them separately
- [ ] **Review notifications for follows** — ability to toggle notifications on/off per followed user; notifies you when that person writes a new review
- [ ] **Seasons tab on anime pages** — dedicated tab on anime detail pages showing all seasons of that series
- [ ] **Report a bug feature** — in-app bug reporting so users can flag issues without leaving the site
- [ ] **Share lists / view friends lists / make private** — ability to share your anime list, browse friends' lists, and toggle list visibility (public vs private)
- [ ] **Post reviews from My List page** — write a review directly from an entry in your list without navigating to the anime's page
- [ ] **"See full list" button on profile not working** — button exists but does nothing; needs to navigate to the user's full anime list
- [ ] **Reviews showing "null" rating** — when a rating isn't entered the display shows "null" instead of hiding or showing N/A
- [ ] **One review per person per anime** — prevent a user from submitting multiple reviews on the same anime; prompt to edit existing instead
- [ ] **Editable reviews** — allow a user to edit or update their own review after submitting
- [ ] **Duplicate anime in carousels** — two Dr. Stones appearing in Trending; need to deduplicate Jikan results by mal_id
- [ ] **Seasonal Top 5** — a WeeBee-voted Top 5 for the current season; winners get a permanent seasonal badge similar to the all-time Top 3 gems
- [ ] **News articles on WeeBee** — display anime news articles natively on the site rather than linking out; likely pull from Jikan's news endpoint and render on a News page
- [ ] **Tier lists** — ability to create anime tier lists (S/A/B/C/D ranks), comment on them, like them, and share them with the community
- [x] **Black text in search bar** — fixed
- [x] **Episode ranking** — done
- [x] **Move overall score in review previews** — done
- [x] **Fix review category names** — done
- [x] **Flesh out Discover page** — spotlight hero, 6 new genre carousels, icon section headers
- [x] **Hard cap scores at 10** — validation added to in-depth review categories, list entry score, and fan service fields
- [x] **My List default tab** — fixed: `currentActiveViewId` wasn't being updated in `switchView`, so `renderAnimeList()` never fired on load

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
