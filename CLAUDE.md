# WeeBee — Project Notes for Claude

## Feature Backlog
These are features Jesse wants to build (no particular order):

- [x] **Achievement system** — 37 achievements across 4 categories (Critic, Social, Collector, Special); profile tab, toast notifications, grayed-out locked state
- [x] **Rank system** — users rank up based on reviews written: Newcomer → Bronze (5) → Silver (15) → Gold (40) → Diamond (100)
- [x] **Community tab** — sidebar Community button currently shows "Coming Soon" popup; needs a full page
- [ ] **Upload WeeBee logo/fonts** — branding assets to replace the plain text logo
- [x] **Edit profile function** — Display Name (unique, transaction-backed), Bio, Avatar URL, Favorite Genres (up to 3); uniqueness enforced via usernames collection
- [x] **Upcoming/Seasonal categories** — carousels live on Discover page
- [x] **DM notifications** — red badge on chat bubble; DM list highlights unread conversations; notification writes to notifications collection, cleared on open
- [x] **Follow button state** — fixed: profile page checks myFollowedUserIds on render; fetchMyFollows patches visible buttons after load
- [x] **User search** — search bar now searches both anime and profiles by display name
- [x] **Dark mode as default** — currently defaults to light mode; flip the default to dark
- [x] **Friends system** — mutual friend requests with Accept/Decline in notification bell; Friends tab on profiles; friend count shown on profile header; Add Friend / Pending / Friends button states
- [x] **DM privacy settings** — Settings toggle (off by default); only friends can DM you unless "Messages from Followers" is enabled
- [x] **Following tab usernames** — fixed: batch-fetches real display names from profiles collection; patches corrupted follow docs
- [x] **Live notifications** — converted to onSnapshot; notification badge and panel update in real-time without refresh
- [x] **Profile pic click goes to profile** — avatar now goes directly to profile; dropdown only opens on chevron click
- [x] **Followers / Following counts on profiles** — shown below join date on profile header
- [x] **Add to list from anime page** — "Add to List" button added to anime detail sidebar
- [x] **Comment count bug** — fixed: submitInlineComment now increments commentCount on the review doc and updates the DOM counter
- [x] **Back arrow not working** — fixed: History API (pushState/popstate) added so browser back navigates between WeeBee views instead of leaving the site
- [x] **Refresh restores last view** — sessionStorage saves current view/profile/anime on navigation; onAuthStateChanged restores it after page reload
- [x] **Founder badge order on posts** — review and suggestion cards now show: display name → founder badge → rank badge
- [x] **Top 3 review threshold** — 5 review minimum required for podium; badges auto-revoked if anime drops below threshold
- [x] **Rename Guestbook to Comments** — renamed to "Profile Comments", moved out of tab to bottom of profile, owner can delete comments
- [ ] **Group anime seasons** — group all seasons of an anime under its first season rather than listing them separately
- [x] **Review notifications for follows** — bell toggle on profiles (on by default when following); followers get a notification linking to the anime when a new review is posted
- [x] **Seasons tab on anime pages** — "Seasons & Films" tab on anime detail pages; fetches Jikan relations endpoint, shows all related anime with cover art loading progressively
- [x] **Report a bug feature** — bug report + feature suggestion buttons in Settings; each opens a modal and writes to Firestore (bug_reports / feature_suggestions)
- [x] **Share lists / view friends lists / make private** — Private List toggle in Settings; friends can always view; View List button on each friend card; non-friends blocked by lock screen
- [x] **Post reviews from My List page** — rate_review button on each list row; triggers existing review modal including already-reviewed check
- [x] **"See full list" button on profile not working** — navigates to My List for own profile; shows grouped list modal for other users
- [x] **Reviews showing "null" rating** — unscored categories now hidden on review cards; validation warns if user comments on a category without scoring it
- [x] **One review per person per anime** — checks for existing review on open; shows "Already Reviewed" modal with Edit / Keep options
- [x] **Editable reviews** — quick and in-depth review forms pre-fill with existing data when editing; uses updateDoc instead of addDoc
- [x] **Duplicate anime in carousels** — fixed: fetchAndRenderCarousel now deduplicates by mal_id using a Set
- [x] **Seasonal Top 5** — community vote for Anime of the Season; top 3 get gold/silver/bronze seasonal badges on their anime page; admin panel to start/end votes; auto-closes on expiry; shown on Discover and News
- [x] **News articles on WeeBee** — fetches top 5 seasonal anime news via Jikan; article reader modal shows full excerpt, image, and anime link natively; "Read on MAL" fallback
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
