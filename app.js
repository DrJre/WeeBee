import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, where, deleteDoc, doc, orderBy, limit, startAfter, updateDoc, getDoc, setDoc, increment, runTransaction, onSnapshot, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyBcRQzzJthjzpvsMdlTg_surpbD01NOnm0",
    authDomain: "weebee-fbbd8.firebaseapp.com",
    databaseURL: "https://weebee-fbbd8-default-rtdb.firebaseio.com",
    projectId: "weebee-fbbd8",
    storageBucket: "weebee-fbbd8.firebasestorage.app",
    messagingSenderId: "974032186291",
    appId: "1:974032186291:web:25c92c430ba204b63839c6",
    measurementId: "G-MJS9P8BCMQ"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();

// --- RANK SYSTEM ---
window.myReviewCount = 0;
window.userRankCache = {};
window.userPinnedBadgesCache = {};

window.getRankInfo = function(count) {
    if (count >= 100) return { name: 'Diamond',  icon: 'diamond',           color: '#00BCD4', next: null, min: 100 };
    if (count >= 40)  return { name: 'Gold',     icon: 'workspace_premium', color: '#FFC107', next: 100,  min: 40  };
    if (count >= 15)  return { name: 'Silver',   icon: 'workspace_premium', color: '#9E9E9E', next: 40,   min: 15  };
    if (count >= 5)   return { name: 'Bronze',   icon: 'workspace_premium', color: '#CD7F32', next: 15,   min: 5   };
    return             { name: 'Newcomer', icon: 'grade',             color: '#BDBDBD', next: 5,    min: 0   };
};

window.getRankBadgeHTML = function(count, size = 18) {
    const r = window.getRankInfo(count);
    const tip = r.next ? `${r.name} · ${count}/${r.next} reviews` : `${r.name} · ${count} reviews`;
    return `<span class="material-symbols-outlined" title="${tip}" style="font-size:${size}px; color:${r.color}; cursor:default; vertical-align:middle; line-height:1;">${r.icon}</span>`;
};

window.prefetchRankCache = async function(uids) {
    const unique = [...new Set(uids)].filter(uid => uid && window.userRankCache[uid] === undefined);
    if (!unique.length) return;
    await Promise.all(unique.map(async uid => {
        try {
            const d = await getDoc(doc(db, "profiles", uid));
            window.userRankCache[uid] = d.exists() ? (d.data().reviewCount || 0) : 0;
            window.userPinnedBadgesCache[uid] = d.exists() ? (d.data().pinnedBadges || []) : [];
        } catch(e) { window.userRankCache[uid] = 0; window.userPinnedBadgesCache[uid] = []; }
    }));
};

window.getPinnedBadgesHTML = function(uid, size = 17) {
    const pins = window.userPinnedBadgesCache[uid] || [];
    if (!pins.length) return '';
    return pins.map(id => {
        const ach = ACHIEVEMENTS.find(a => a.id === id);
        if (!ach) return '';
        return `<span class="material-symbols-outlined" title="${ach.name}: ${ach.desc}" style="font-size:${size}px;color:${ach.color};cursor:default;vertical-align:middle;line-height:1;">${ach.icon}</span>`;
    }).join('')
};

window.updateTopbarRank = async function() {
    if (!auth.currentUser) return;
    try {
        const pd = await getDoc(doc(db, "profiles", auth.currentUser.uid));
        const count = pd.exists() ? (pd.data().reviewCount || 0) : 0;
        window.myReviewCount = count;
        window.userRankCache[auth.currentUser.uid] = count;
        const el = document.getElementById('topbar-rank-badge');
        if (el) el.innerHTML = window.getRankBadgeHTML(count, 16);
    } catch(e) {}
};
 
// --- FOUNDER BADGE ---
window.founderUids = new Set();
(async () => {
    try {
        const d = await getDoc(doc(db, "meta", "founders"));
        if (d.exists()) (d.data().uids || []).forEach(uid => window.founderUids.add(uid));
    } catch(e) {}
})();

window.getFounderBadgeHTML = function(uid, size = 15) {
    if (!window.founderUids.has(uid)) return '';
    return `<span class="material-symbols-outlined founder-badge" title="WeeBee Founder · One of the first 25 members" style="font-size:${size}px; color:#FFD700; cursor:default; vertical-align:middle; line-height:1;">workspace_premium</span>`;
};

// --- ACHIEVEMENT SYSTEM ---
const ACHIEVEMENTS = [
    // Critic: Reviews Written
    { id: 'review_1',     name: 'First Word',           desc: 'Wrote your first review',                     icon: 'rate_review',       cat: 'Critic',    color: '#FFC107' },
    { id: 'review_10',    name: 'Budding Critic',        desc: 'Wrote 10 reviews',                           icon: 'edit_note',         cat: 'Critic',    color: '#FFC107' },
    { id: 'review_25',    name: 'Opinion Machine',       desc: 'Wrote 25 reviews',                           icon: 'reviews',           cat: 'Critic',    color: '#FFC107' },
    { id: 'review_50',    name: 'Anime Authority',       desc: 'Wrote 50 reviews',                           icon: 'workspace_premium', cat: 'Critic',    color: '#FFC107' },
    { id: 'review_100',   name: 'Century Critic',        desc: 'Wrote 100 reviews',                          icon: 'emoji_events',      cat: 'Critic',    color: '#FFC107' },
    { id: 'review_250',   name: 'The Analyst',           desc: 'Wrote 250 reviews',                          icon: 'analytics',         cat: 'Critic',    color: '#FFC107' },
    { id: 'review_500',   name: 'Legendary Reviewer',    desc: 'Wrote 500 reviews',                          icon: 'diamond',           cat: 'Critic',    color: '#FFC107' },
    { id: 'review_1000',  name: 'Reviewing God',         desc: 'Wrote 1000 reviews',                         icon: 'auto_awesome',      cat: 'Critic',    color: '#FFC107' },
    // Critic: In-Depth Reviews
    { id: 'indepth_1',    name: 'Deep Thinker',          desc: 'Wrote your first in-depth review',           icon: 'psychology',        cat: 'Critic',    color: '#9C27B0' },
    { id: 'indepth_10',   name: 'The Essayist',          desc: 'Wrote 10 in-depth reviews',                  icon: 'description',       cat: 'Critic',    color: '#9C27B0' },
    { id: 'indepth_25',   name: 'Critical Eye',          desc: 'Wrote 25 in-depth reviews',                  icon: 'visibility',        cat: 'Critic',    color: '#9C27B0' },
    { id: 'indepth_50',   name: 'The Philosopher',       desc: 'Wrote 50 in-depth reviews',                  icon: 'school',            cat: 'Critic',    color: '#9C27B0' },
    { id: 'indepth_100',  name: 'Academic',              desc: 'Wrote 100 in-depth reviews',                 icon: 'local_library',     cat: 'Critic',    color: '#9C27B0' },
    { id: 'indepth_250',  name: 'Grand Critic',          desc: 'Wrote 250 in-depth reviews',                 icon: 'military_tech',     cat: 'Critic',    color: '#9C27B0' },
    { id: 'indepth_500',  name: 'The Maestro',           desc: 'Wrote 500 in-depth reviews',                 icon: 'verified',          cat: 'Critic',    color: '#9C27B0' },
    { id: 'indepth_1000', name: 'Omniscient',            desc: 'Wrote 1000 in-depth reviews',                icon: 'all_inclusive',     cat: 'Critic',    color: '#9C27B0' },
    // Social: Reactions Given
    { id: 'react_1',      name: 'First Impression',      desc: 'Reacted to your first post',                 icon: 'thumb_up',          cat: 'Social',    color: '#4CAF50' },
    { id: 'react_10',     name: 'Social Butterfly',      desc: 'Reacted to 10 posts',                        icon: 'groups',            cat: 'Social',    color: '#4CAF50' },
    { id: 'react_25',     name: 'Engaged',               desc: 'Reacted to 25 posts',                        icon: 'favorite',          cat: 'Social',    color: '#4CAF50' },
    { id: 'react_50',     name: 'Community Pillar',       desc: 'Reacted to 50 posts',                        icon: 'handshake',         cat: 'Social',    color: '#4CAF50' },
    { id: 'react_100',    name: 'The Influencer',         desc: 'Reacted to 100 posts',                       icon: 'trending_up',       cat: 'Social',    color: '#4CAF50' },
    { id: 'react_250',    name: 'Active Voice',           desc: 'Reacted to 250 posts',                       icon: 'campaign',          cat: 'Social',    color: '#4CAF50' },
    { id: 'react_500',    name: 'The Connector',          desc: 'Reacted to 500 posts',                       icon: 'hub',               cat: 'Social',    color: '#4CAF50' },
    { id: 'react_1000',   name: 'Community Legend',       desc: 'Reacted to 1000 posts',                      icon: 'public',            cat: 'Social',    color: '#4CAF50' },
    // Collector: Completed Anime
    { id: 'complete_1',   name: 'First Finish',           desc: 'Completed your first anime',                 icon: 'done_all',          cat: 'Collector', color: '#00BCD4' },
    { id: 'complete_10',  name: 'Casual Viewer',          desc: 'Completed 10 anime',                         icon: 'tv',                cat: 'Collector', color: '#00BCD4' },
    { id: 'complete_25',  name: 'Devoted Fan',            desc: 'Completed 25 anime',                         icon: 'favorite_border',   cat: 'Collector', color: '#00BCD4' },
    { id: 'complete_50',  name: 'Seasoned Watcher',       desc: 'Completed 50 anime',                         icon: 'live_tv',           cat: 'Collector', color: '#00BCD4' },
    { id: 'complete_100', name: 'Century Club',           desc: 'Completed 100 anime',                        icon: 'military_tech',     cat: 'Collector', color: '#00BCD4' },
    { id: 'complete_250', name: 'Anime Veteran',          desc: 'Completed 250 anime',                        icon: 'workspace_premium', cat: 'Collector', color: '#00BCD4' },
    { id: 'complete_500', name: 'Marathon Runner',        desc: 'Completed 500 anime',                        icon: 'sprint',            cat: 'Collector', color: '#00BCD4' },
    { id: 'complete_1000',name: 'The Completionist',      desc: 'Completed 1000 anime',                       icon: 'check_circle',      cat: 'Collector', color: '#00BCD4' },
    // Special
    { id: 'top_reviewer', name: 'Chart Topper',           desc: 'Made it onto the Top Reviewers leaderboard', icon: 'leaderboard',       cat: 'Special',   color: '#FF9800' },
    { id: 'founder',      name: 'Day One',                desc: 'One of the first 25 members of WeeBee',      icon: 'workspace_premium', cat: 'Special',   color: '#FFD700' },
    { id: 'dropout',      name: "It's Not You, It's Me",  desc: 'Dropped 10 anime from your list',            icon: 'heart_broken',      cat: 'Special',   color: '#F44336' },
    { id: 'first_follow', name: 'Making Friends',         desc: 'Followed your first user on WeeBee',         icon: 'person_add',        cat: 'Special',   color: '#E91E63' },
    { id: 'suggestor_5',  name: 'The Recommender',        desc: 'Made 5 anime suggestions to the community',  icon: 'lightbulb',         cat: 'Special',   color: '#FF9800' },
    // Community: BuzzWord — One Piece
    { id: 'bwop_first',      name: "Devil's Luck",    desc: 'Solved your first One Piece BuzzWord puzzle',          icon: 'casino',                cat: 'Community', color: '#8B0000' },
    { id: 'bwop_1guess',     name: 'First Mate',      desc: 'Solved the One Piece puzzle in just 1 guess',          icon: 'anchor',                cat: 'Community', color: '#8B0000' },
    { id: 'bwop_streak_7',   name: 'Straw Hat',       desc: 'Solved the One Piece puzzle 7 days in a row',          icon: 'wb_sunny',              cat: 'Community', color: '#8B0000' },
    { id: 'bwop_total_30',   name: 'Grand Line',      desc: 'Solved the One Piece puzzle 30 times total',           icon: 'explore',               cat: 'Community', color: '#8B0000' },
    { id: 'bwop_streak_100', name: 'The One Piece',   desc: 'Solved the One Piece puzzle 100 days in a row',        icon: 'diamond',               cat: 'Community', color: '#FFD700' },
    // Community: BuzzWord — Naruto
    { id: 'bwnrt_first',     name: 'Genin',           desc: 'Solved your first Naruto BuzzWord puzzle',             icon: 'star',                  cat: 'Community', color: '#FF6B00' },
    { id: 'bwnrt_1guess',    name: 'Dattebayo!',      desc: 'Solved the Naruto puzzle in just 1 guess',             icon: 'bolt',                  cat: 'Community', color: '#FF6B00' },
    { id: 'bwnrt_streak_7',  name: 'Shinobi Way',     desc: 'Solved the Naruto puzzle 7 days in a row',             icon: 'local_fire_department', cat: 'Community', color: '#FF6B00' },
    { id: 'bwnrt_total_30',  name: "Hokage's Path",   desc: 'Solved the Naruto puzzle 30 times total',              icon: 'military_tech',         cat: 'Community', color: '#FF6B00' },
    // Community: BuzzWord — Bleach
    { id: 'bwblc_first',     name: 'Soul Reaper',     desc: 'Solved your first Bleach BuzzWord puzzle',             icon: 'star',                  cat: 'Community', color: '#00BCD4' },
    { id: 'bwblc_1guess',    name: 'Bankai!',         desc: 'Solved the Bleach puzzle in just 1 guess',             icon: 'bolt',                  cat: 'Community', color: '#00BCD4' },
    { id: 'bwblc_streak_7',  name: 'Gotei 13',        desc: 'Solved the Bleach puzzle 7 days in a row',             icon: 'local_fire_department', cat: 'Community', color: '#00BCD4' },
    { id: 'bwblc_total_30',  name: "Captain's Path",  desc: 'Solved the Bleach puzzle 30 times total',              icon: 'military_tech',         cat: 'Community', color: '#00BCD4' },
    // Community: BuzzWord — Dragon Ball
    { id: 'bwdb_first',      name: 'Power Level',     desc: 'Solved your first Dragon Ball BuzzWord puzzle',         icon: 'star',                  cat: 'Community', color: '#FF6F00' },
    { id: 'bwdb_1guess',     name: 'Over 9000!',      desc: 'Solved the Dragon Ball puzzle in just 1 guess',         icon: 'bolt',                  cat: 'Community', color: '#FF6F00' },
    { id: 'bwdb_streak_7',   name: 'Super Saiyan',    desc: 'Solved the Dragon Ball puzzle 7 days in a row',         icon: 'local_fire_department', cat: 'Community', color: '#FF6F00' },
    { id: 'bwdb_total_30',   name: "Limit Breaker",   desc: 'Solved the Dragon Ball puzzle 30 times total',          icon: 'military_tech',         cat: 'Community', color: '#FF6F00' },
    // Community: BuzzWord — General
    { id: 'bw_double_agent', name: 'Double Agent',    desc: 'Solved both BuzzWord puzzles on the same day',         icon: 'join_inner',            cat: 'Community', color: '#6A1B9A' },
    { id: 'bw_multiverse',   name: 'Multiverse',      desc: 'Solved a puzzle from every available BuzzWord game',   icon: 'public',                cat: 'Community', color: '#6A1B9A' },
    // Community: Tier Lists
    { id: 'tl_first',        name: 'Ranked Up',       desc: 'Created your first tier list',                         icon: 'format_list_numbered',  cat: 'Community', color: '#1565C0' },
    { id: 'tl_10',           name: 'Tier Lord',        desc: 'Created 10 tier lists',                               icon: 'leaderboard',           cat: 'Community', color: '#1565C0' },
    { id: 'tl_crowd_pleaser',name: 'Crowd Pleaser',   desc: 'Received 10 likes on a single tier list',              icon: 'favorite',              cat: 'Community', color: '#1565C0' },
    // Community: Feed
    { id: 'feed_showtime',   name: 'Showtime',        desc: 'Posted your first BuzzWord result to the feed',        icon: 'campaign',              cat: 'Community', color: '#2E7D32' },
    { id: 'feed_trending',   name: 'Trending',        desc: 'Received 25 likes across all your BuzzWord posts',     icon: 'trending_up',           cat: 'Community', color: '#2E7D32' },
];

window.awardAchievements = async function(ids) {
    if (!auth.currentUser) return;
    try {
        const uid = auth.currentUser.uid;
        const achDoc = await getDoc(doc(db, "achievements", uid));
        const existing = achDoc.exists() ? achDoc.data() : {};
        const toAward = [...new Set(ids)].filter(id => !existing[id]);
        if (!toAward.length) return;
        const updates = {};
        const now = new Date();
        toAward.forEach(id => { updates[id] = { earnedAt: now }; });
        await setDoc(doc(db, "achievements", uid), updates, { merge: true });
        for (let i = 0; i < toAward.length; i++) {
            const ach = ACHIEVEMENTS.find(a => a.id === toAward[i]);
            if (ach) { if (i > 0) await new Promise(r => setTimeout(r, 3800)); window.showAchievementToast(ach); }
        }
    } catch(e) {}
};

window.getEarnedIds = function(category, count) {
    const t = { review:[1,10,25,50,100,250,500,1000], indepth:[1,10,25,50,100,250,500,1000], react:[1,10,25,50,100,250,500,1000], complete:[1,10,25,50,100,250,500,1000] };
    return (t[category] || []).filter(n => count >= n).map(n => `${category}_${n}`);
};

window.showAchievementToast = function(ach) {
    const toast = document.getElementById('achievement-toast');
    if (!toast) return;
    document.getElementById('toast-ach-icon').innerText = ach.icon;
    document.getElementById('toast-ach-icon').style.color = ach.color;
    document.getElementById('toast-ach-name').innerText = ach.name;
    document.getElementById('toast-ach-desc').innerText = ach.desc;
    toast.style.display = 'flex';
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 4500);
};

window.initUserAchievements = async function() {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    try {
        const [profileDoc, achDoc, foundersDoc] = await Promise.all([
            getDoc(doc(db, "profiles", uid)),
            getDoc(doc(db, "achievements", uid)),
            getDoc(doc(db, "meta", "founders"))
        ]);
        const profile = profileDoc.exists() ? profileDoc.data() : {};
        const existing = achDoc.exists() ? achDoc.data() : {};

        const toCheck = [
            ...window.getEarnedIds('review', profile.reviewCount  || 0),
            ...window.getEarnedIds('indepth',  profile.indepthCount || 0),
            ...window.getEarnedIds('react',    profile.reactionCount|| 0),
            ...window.getEarnedIds('complete', profile.completedCount|| 0),
        ];
        if ((profile.droppedCount || 0) >= 10) toCheck.push('dropout');

        const founders = foundersDoc.exists() ? (foundersDoc.data().uids || []) : [];
        founders.forEach(id => window.founderUids.add(id));
        if (founders.includes(uid)) {
            toCheck.push('founder');
        } else if (founders.length < 25) {
            setDoc(doc(db, "meta", "founders"), { uids: [...founders, uid] }, { merge: true }).catch(() => {});
            toCheck.push('founder');
        }

        const followSnap = await getDocs(query(collection(db, "follows"), where("followerUid", "==", uid), where("type", "==", "user"), limit(1)));
        if (!followSnap.empty) toCheck.push('first_follow');

        const toAward = [...new Set(toCheck)].filter(id => !existing[id]);
        if (toAward.length) {
            const updates = {};
            const now = new Date();
            toAward.forEach(id => { updates[id] = { earnedAt: now }; });
            setDoc(doc(db, "achievements", uid), updates, { merge: true }).catch(() => {});
        }
    } catch(e) {}
    // Check community achievements separately (Tier Lists, Feed)
    window.checkCommunityAchievements().catch(() => {});
};

window.checkCommunityAchievements = async function() {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const ids = [];
    try {
        // Tier list achievements
        const tlSnap = await getDocs(query(collection(db, 'tier_lists'), where('uid', '==', uid)));
        const tlCount = tlSnap.size;
        if (tlCount >= 1) ids.push('tl_first');
        if (tlCount >= 10) ids.push('tl_10');
        tlSnap.forEach(d => { if ((d.data().likes || []).length >= 10) ids.push('tl_crowd_pleaser'); });
        // Feed trending: total likes across bw_posts
        const bwSnap = await getDocs(query(collection(db, 'bw_posts'), where('uid', '==', uid)));
        const totalLikes = bwSnap.docs.reduce((sum, d) => sum + (d.data().likes || []).length, 0);
        if (totalLikes >= 25) ids.push('feed_trending');
        // BuzzWord leaderboard-based (in case missed during solve)
        const [opLb, nrtLb] = await Promise.all([
            getDoc(doc(db, 'bw_op_leaderboard', uid)),
            getDoc(doc(db, 'bw_nrt_leaderboard', uid))
        ]);
        if (opLb.exists()) {
            const d = opLb.data();
            if ((d.totalWins||0) >= 1)  ids.push('bwop_first');
            if ((d.currentStreak||0) >= 7)  ids.push('bwop_streak_7');
            if ((d.currentStreak||0) >= 100) ids.push('bwop_streak_100');
            if ((d.totalWins||0) >= 30) ids.push('bwop_total_30');
            if (nrtLb.exists() && (nrtLb.data().totalWins||0) >= 1) ids.push('bw_multiverse');
        }
        if (nrtLb.exists()) {
            const d = nrtLb.data();
            if ((d.totalWins||0) >= 1)  ids.push('bwnrt_first');
            if ((d.currentStreak||0) >= 7)  ids.push('bwnrt_streak_7');
            if ((d.totalWins||0) >= 30) ids.push('bwnrt_total_30');
        }
    } catch(e) {}
    if (ids.length) window.awardAchievements(ids).catch(() => {});
};

window.loadProfileAchievements = async function(uid) {
    const container = document.getElementById('achievements-grid-container');
    if (!container || !uid) return;
    container.innerHTML = '<div class="loading">Loading achievements...</div>';
    try {
        const achDoc = await getDoc(doc(db, "achievements", uid));
        const earned = achDoc.exists() ? achDoc.data() : {};
        const cats = ['Critic', 'Social', 'Collector', 'Special', 'Community'];
        const fmtDate = ts => { try { const d = ts?.toDate ? ts.toDate() : new Date(ts); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch(e) { return null; }};
        let html = '';
        cats.forEach(cat => {
            const catAchs = ACHIEVEMENTS.filter(a => a.cat === cat);
            const earnedCount = catAchs.filter(a => earned[a.id]).length;
            html += `<div style="margin-bottom:28px;">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
                    <h4 style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:var(--text-muted);">${cat}</h4>
                    <span style="font-size:11px; color:var(--text-muted);">${earnedCount} / ${catAchs.length}</span>
                </div>
                <div class="achievement-grid">`;
            catAchs.forEach(ach => {
                const isEarned = !!earned[ach.id];
                const date = isEarned ? fmtDate(earned[ach.id]?.earnedAt) : null;
                html += `<div class="achievement-card ${isEarned ? 'earned' : 'locked'}" title="${ach.name}: ${ach.desc}">
                    <span class="material-symbols-outlined ach-icon" style="${isEarned ? `color:${ach.color}` : ''}">${ach.icon}</span>
                    <div class="ach-name">${ach.name}</div>
                    <div class="ach-desc">${ach.desc}</div>
                    ${date ? `<div class="ach-date">${date}</div>` : ''}
                </div>`;
            });
            html += `</div></div>`;
        });
        container.innerHTML = html;
    } catch(e) { container.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center;">Failed to load achievements.</p>'; }
};

// Prevent scroll wheel from changing number input values
document.addEventListener('wheel', () => { if (document.activeElement?.type === 'number') document.activeElement.blur(); }, { passive: true });

// --- GLOBAL STATE ---
window.currentActiveViewId = 'home-view';
window.previousViewId = 'home-view';
window.currentAnime = null;
window.currentAnimeId = null;
window.pendingInDepthData = null;
window.isSignUpMode = false;
window.myFollowNotifyMap = new Map();
window.myFriendIds = new Set();
window.myPendingOutIds = new Set();
window.myPendingInIds = new Map(); // uid → requestDocId

// LIST & NOTIF STATE
window.myAnimeList = [];
window.currentListTab = 'all';
window.currentListSort = { key: 'score', desc: true };
window.myFollowedUserIds = new Set();
window.currentListEntryTotalEps = 0; 
window.currentAnimeEpisodes = []; 
window.unreadNotifDocs = [];
window.targetProfileUid = null; 

// --- CONTENT MODERATION ---
const BLOCKED_TERMS = [
    'nigger', 'nigg3r','n1gger','chink','ch1nk','gook','g00k',
    'spic','sp1c','spick','kike','k1ke','wetback','w3tback','beaner',
    'faggot','f4ggot','fag','f4g','dyke','d1ke','tranny','tr4nny',
    'retard','r3tard','retarded','towelhead','sandnigger','coon','c00n',
    'zipperhead','honkey','honky','raghead','slope', 'cunt', 'porch monkey'
];

window.containsBlockedTerm = function(text) {
    if (!text) return false;
    const normalized = text.toLowerCase().replace(/[\s\-_.!@#$%^&*]/g, '');
    return BLOCKED_TERMS.some(term => normalized.includes(term) || text.toLowerCase().includes(term));
};

window.checkTextContent = function(...fields) {
    return fields.some(f => window.containsBlockedTerm(f));
};

// --- JIKAN CACHE ---
const JIKAN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const JIKAN_CAROUSEL_TTL_MS = 24 * 60 * 60 * 1000;

window.jikanFetch = async function(url, cacheKey, ttlMs = JIKAN_TTL_MS) {
    let stalePayload = null;
    try {
        const cSnap = await getDoc(doc(db, "anime_cache", cacheKey));
        if (cSnap.exists()) {
            const cached = cSnap.data();
            const age = Date.now() - (cached.fetchedAt?.toMillis?.() || 0);
            if (age < ttlMs) return cached.payload;
            stalePayload = cached.payload;
        }
    } catch(_) {}
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Jikan ${res.status}`);
        const json = await res.json();
        setDoc(doc(db, "anime_cache", cacheKey), { payload: json, fetchedAt: new Date() }).catch(() => {});
        return json;
    } catch(e) {
        if (stalePayload) return stalePayload;
        throw e;
    }
};

// --- CAROUSEL SCROLLING LOGIC ---
window.scrollCarousel = function(containerId, direction) {
    const container = document.getElementById(containerId);
    if(container) {
        container.scrollBy({ left: direction * 400, behavior: 'smooth' });
    }
};

onAuthStateChanged(auth, (user) => {
    const authSection = document.getElementById('user-auth-section');
    if (user) {
        const avatarUrl = user.photoURL || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(user.displayName)}&backgroundColor=ffc107&fontColor=333333`;
        authSection.innerHTML = `
            <div class="topbar-dm-wrap" style="position:relative; display:flex; align-items:center;" onclick="event.stopPropagation()">
                <span class="material-symbols-outlined" style="font-size:24px; cursor:pointer; color:var(--text-dark);" onclick="toggleDMDropdown(event)">chat_bubble</span>
                <span id="dm-badge" style="display:none; position:absolute; top:-5px; right:-5px; background:#FF4444; color:white; border-radius:50%; min-width:18px; height:18px; font-size:10px; font-weight:bold; align-items:center; justify-content:center; padding:0 3px; pointer-events:none;">0</span>
                <div id="dm-dropdown" class="dropdown-menu notification-menu" style="display:none; right:-10px; top:40px; width:300px; padding:0; max-height:420px; overflow-y:auto; cursor:default;" onclick="event.stopPropagation()">
                    <div style="padding:15px; font-weight:bold; border-bottom:1px solid var(--border-color); position:sticky; top:0; background:var(--bg-white); z-index:10;">Messages</div>
                    <div id="dm-conversation-list"></div>
                </div>
            </div>
            <div class="topbar-notif-wrap" style="position:relative; display:flex; align-items:center;">
                <span class="material-symbols-outlined" style="font-size:24px; cursor:pointer; color:var(--text-dark);" onclick="toggleNotifications(event)">notifications</span>
                <span class="notification-badge" id="notif-badge" style="display:none; position:absolute; top:-5px; right:-5px; background:#FF4444; color:white; border-radius:50%; width:18px; height:18px; font-size:10px; font-weight:bold; align-items:center; justify-content:center; pointer-events:none;">0</span>
                
                <div id="notification-dropdown" class="dropdown-menu notification-menu" style="display: none; right:-10px; top:40px; width:320px; padding:0; max-height:400px; overflow-y:auto; cursor:default;" onclick="event.stopPropagation()">
                    <div class="notif-header" style="padding:12px 15px; font-weight:bold; border-bottom:1px solid #E0E0E0; position:sticky; top:0; background:var(--bg-white); z-index:10; display:flex; align-items:center; justify-content:space-between;">Notifications<button onclick="clearAllNotifications()" style="font-size:11px; font-weight:500; color:var(--text-muted); background:none; border:none; cursor:pointer; padding:4px 8px; border-radius:6px;">Clear All</button></div>
                    <div id="notif-list"><div class="loading" style="font-size:12px; padding: 15px;">Loading...</div></div>
                </div>
            </div>
            <div style="display:flex; align-items:center; gap: 10px;">
                <span class="topbar-display-name" style="font-weight:600; font-size:14px;">${user.displayName}</span><span id="topbar-rank-badge" style="display:inline-flex; align-items:center; margin-left:2px;"></span>
                <img src="${avatarUrl}" alt="User" class="avatar" style="cursor:pointer;" onclick="event.stopPropagation(); viewUserProfile('${user.uid}')">
                <span class="material-symbols-outlined topbar-chevron" style="font-size:18px; cursor:pointer;" onclick="toggleDropdown(event)">expand_more</span>
            </div>
            <div id="profile-dropdown" class="dropdown-menu" style="display: none; right:0; top:50px;">
                <div class="dropdown-item" onclick="viewUserProfile('${user.uid}')"><span class="material-symbols-outlined">person</span> My Profile</div>
                <div class="dropdown-item" onclick="openSettingsModal()"><span class="material-symbols-outlined">settings</span> Settings</div>
                <div class="dropdown-divider"></div>
                <div class="dropdown-item logout" onclick="logoutUser()"><span class="material-symbols-outlined">logout</span> Sign Out</div>
            </div>
        `;
        fetchMyList();
        fetchNotifications();
        fetchMyFollows();
        window.fetchFriendData();
        window.updateTopbarRank();
        // Backfill displayNameLower for case-insensitive search
        if (user.displayName) {
            setDoc(doc(db, "profiles", user.uid), { displayNameLower: user.displayName.toLowerCase() }, { merge: true }).catch(() => {});
        }
        const ADMIN_UIDS = ['XUD3ym2NcdWtrUiPLlFFaO5ufMh1'];
        Promise.all([
            getDoc(doc(db, "admins", user.uid)).then(d => {
                window.isAdmin = d.exists() || ADMIN_UIDS.includes(user.uid);
            }).catch(e => {
                console.warn('Admin check via Firestore failed, falling back to UID list:', e);
                window.isAdmin = ADMIN_UIDS.includes(user.uid);
            }),
            window.loadActiveSeasonalVote(),
            window.loadPatchNotes()
        ]).then(() => {
            window.renderSeasonalVoting();
            window.fetchHomepageTierLists();
            const adminPanel = document.getElementById('patch-notes-admin');
            if (adminPanel) adminPanel.style.display = window.isAdmin ? 'block' : 'none';
        });
        // Handle shared URL params
        const _urlParams = new URLSearchParams(window.location.search);
        const _tlId = _urlParams.get('tl');
        const _animeId = _urlParams.get('anime');
        const _profileId = _urlParams.get('profile');
        if (_tlId) { history.replaceState({}, '', window.location.pathname); setTimeout(() => window.openTierListViewer(_tlId), 600); }
        else if (_animeId) { history.replaceState({}, '', window.location.pathname); setTimeout(() => window.loadAnimeDetails(parseInt(_animeId), true), 300); }
        else if (_profileId) { history.replaceState({}, '', window.location.pathname); setTimeout(() => window.viewUserProfile(_profileId), 300); }
        // Restore last view after login
        const savedView = sessionStorage.getItem('weebee-last-view');
        if (savedView) {
            try {
                const { view, profileUid, animeId } = JSON.parse(savedView);
                if (view && view !== 'home-view') {
                    if (view === 'anime-detail-view' && animeId) { window.loadAnimeDetails(animeId, true); }
                    else if (view === 'profile-view' && profileUid) { window.targetProfileUid = profileUid; switchView('profile-view', false, true); }
                    else { switchView(view, false, true); }
                }
            } catch(e) {}
            sessionStorage.removeItem('weebee-last-view');
        }
        window.initUserAchievements();
        window.subscribeToDMBadge();
    } else {
        authSection.innerHTML = `<button class="action-btn" onclick="openAuthModal()"><span class="material-symbols-outlined">login</span> Sign In</button>`;
        if(window.currentActiveViewId === 'profile-view' || window.currentActiveViewId === 'my-list-view') switchView('home-view');
        window.myAnimeList = [];
    }
    if(window.currentActiveViewId === 'home-view') fetchHomepageReviews();
});

window.toggleDropdown = function(e) {
    e.stopPropagation(); 
    const dd = document.getElementById('profile-dropdown');
    const nd = document.getElementById('notification-dropdown');
    if(nd) nd.style.display = 'none';
    dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
};

window.toggleNotifications = function(e) {
    e.stopPropagation();
    const nd = document.getElementById('notification-dropdown');
    const pd = document.getElementById('profile-dropdown');
    if(pd) pd.style.display = 'none';
    
    if(nd.style.display === 'none' || nd.style.display === '') {
        nd.style.display = 'block';
        const badge = document.getElementById('notif-badge');
        if(badge && badge.style.display !== 'none' && window.unreadNotifDocs && window.unreadNotifDocs.length > 0) {
            badge.style.display = 'none';
            window.unreadNotifDocs.forEach(docId => {
                updateDoc(doc(db, "notifications", docId), { read: true }).catch(console.error);
            });
            window.unreadNotifDocs = [];
            document.querySelectorAll('.notif-item.unread').forEach(el => el.classList.remove('unread'));
        }
    } else { nd.style.display = 'none'; }
};

// --- DIRECT MESSAGES ---
window.currentConversationId = null;
window.currentChatOtherUid = null;
window.dmUnsubscribe = null;
window.dmConvUnsubscribe = null;

window.getConversationId = (a, b) => [a, b].sort().join('_');

window.subscribeToDMBadge = function() {
    if (!auth.currentUser) return;
    if (window.dmConvUnsubscribe) window.dmConvUnsubscribe();
    const uid = auth.currentUser.uid;
    window.dmConvUnsubscribe = onSnapshot(
        query(collection(db, "notifications"), where("targetUid", "==", uid)),
        (snap) => {
            let total = 0;
            snap.forEach(d => { const n = d.data(); if (n.type === 'dm' && !n.read) total++; });
            const badge = document.getElementById('dm-badge');
            if (badge) { badge.innerText = total > 9 ? '9+' : total; badge.style.display = total > 0 ? 'flex' : 'none'; }
        }
    );
};

window.toggleDMDropdown = function(e) {
    e.stopPropagation();
    const dd = document.getElementById('dm-dropdown');
    const nd = document.getElementById('notification-dropdown');
    const pd = document.getElementById('profile-dropdown');
    if (nd) nd.style.display = 'none';
    if (pd) pd.style.display = 'none';
    if (!dd) return;
    const opening = dd.style.display === 'none' || dd.style.display === '';
    dd.style.display = opening ? 'block' : 'none';
    if (opening) window.loadDMList();
};

window.loadDMList = async function() {
    if (!auth.currentUser) return;
    const list = document.getElementById('dm-conversation-list');
    if (!list) return;
    list.innerHTML = '<div class="loading" style="font-size:12px; padding:15px;">Loading...</div>';
    try {
        const uid = auth.currentUser.uid;
        const [snap, notifSnap] = await Promise.all([
            getDocs(query(collection(db, "conversations"), where("participants", "array-contains", uid))),
            getDocs(query(collection(db, "notifications"), where("targetUid", "==", uid)))
        ]);
        if (snap.empty) { list.innerHTML = '<p style="padding:20px; text-align:center; font-size:13px; color:var(--text-muted);">No messages yet.<br>Visit someone\'s profile to start a chat!</p>'; return; }
        const unreadConvIds = new Set();
        notifSnap.forEach(d => { const n = d.data(); if (n.type === 'dm' && !n.read) unreadConvIds.add(d.id.replace(/^dm_/, '')); });
        const sortedDocs = snap.docs.sort((a, b) => (b.data().lastUpdated?.toMillis?.() || 0) - (a.data().lastUpdated?.toMillis?.() || 0)).slice(0, 20);
        list.innerHTML = '';
        sortedDocs.forEach(d => {
            const data = d.data();
            const otherUid = data.participants.find(p => p !== uid);
            const otherName = data.participantNames?.[otherUid] || 'User';
            const otherAvatar = data.participantAvatars?.[otherUid] || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(otherName)}&backgroundColor=ffc107&fontColor=333333`;
            const unread = unreadConvIds.has(d.id) ? 1 : 0;
            const lastMsg = data.lastMessage ? (data.lastMessage.length > 35 ? data.lastMessage.slice(0,35) + '…' : data.lastMessage) : 'Start a conversation';
            list.innerHTML += `
                <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;border-bottom:1px solid var(--bg-gray);${unread ? 'background:var(--accent-yellow-light);' : ''}" onclick="openDMConversation('${otherUid}','${otherName.replace(/'/g,"\\'")}','${otherAvatar}')">
                    <img src="${otherAvatar}" class="avatar" style="width:40px;height:40px;flex-shrink:0;">
                    <div style="flex:1;min-width:0;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <span style="font-weight:600;font-size:14px;">${otherName}</span>
                            ${unread ? `<span style="background:#FF4444;color:white;border-radius:50%;min-width:18px;height:18px;font-size:10px;font-weight:bold;display:flex;align-items:center;justify-content:center;padding:0 3px;">${unread}</span>` : ''}
                        </div>
                        <div style="font-size:12px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${lastMsg}</div>
                    </div>
                </div>`;
        });
    } catch(e) { list.innerHTML = '<p style="padding:15px;font-size:12px;color:var(--text-muted);">Failed to load.</p>'; console.error(e); }
};

window.openDMConversation = async function(otherUid, otherName, otherAvatar) {
    if (!auth.currentUser) return window.openAuthModal();
    if (!window.myFriendIds.has(otherUid)) {
        try {
            const pd = await getDoc(doc(db, "profiles", otherUid));
            const dmOpenToFollowers = pd.exists() ? pd.data().dmOpenToFollowers : false;
            if (!dmOpenToFollowers) {
                alert(`${otherName} only accepts messages from friends.`);
                return;
            }
        } catch(e) {}
    }
    const dd = document.getElementById('dm-dropdown');
    if (dd) dd.style.display = 'none';
    const uid = auth.currentUser.uid;
    const convId = window.getConversationId(uid, otherUid);
    window.currentConversationId = convId;
    window.currentChatOtherUid = otherUid;

    document.getElementById('chat-partner-avatar').src = otherAvatar;
    document.getElementById('chat-partner-name').innerText = otherName;
    document.getElementById('chat-messages').innerHTML = '<div class="loading" style="text-align:center;padding:20px;">Loading...</div>';
    document.getElementById('chat-modal').style.display = 'flex';
    document.getElementById('chat-input').focus();

    if (window.dmUnsubscribe) { window.dmUnsubscribe(); window.dmUnsubscribe = null; }

    const convRef = doc(db, "conversations", convId);
    const myName = auth.currentUser.displayName;
    const myAvatar = auth.currentUser.photoURL || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(myName)}&backgroundColor=ffc107&fontColor=333333`;
    setDoc(convRef, { participants: [uid, otherUid].sort(), participantNames: { [uid]: myName, [otherUid]: otherName }, participantAvatars: { [uid]: myAvatar, [otherUid]: otherAvatar }, [`unreadCount.${uid}`]: 0 }, { merge: true }).catch(() => {});
    setDoc(doc(db, "notifications", `dm_${convId}`), { read: true }, { merge: true }).catch(() => {});

    window.dmUnsubscribe = onSnapshot(query(collection(db, "conversations", convId, "messages"), orderBy("timestamp", "asc"), limit(100)), (snap) => {
        const container = document.getElementById('chat-messages');
        if (!container) return;
        if (snap.empty) { container.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-size:13px;margin-top:40px;">No messages yet — say hello!</p>'; return; }
        container.innerHTML = '';
        snap.forEach(d => {
            const msg = d.data();
            const isMe = msg.senderUid === uid;
            const time = msg.timestamp?.toDate ? msg.timestamp.toDate().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
            container.innerHTML += `
                <div style="display:flex;flex-direction:column;align-items:${isMe ? 'flex-end' : 'flex-start'};margin-bottom:4px;">
                    <div class="chat-bubble ${isMe ? 'chat-bubble-me' : 'chat-bubble-them'}">${msg.text}</div>
                    <span style="font-size:10px;color:var(--text-muted);margin-top:2px;padding:0 4px;">${time}</span>
                </div>`;
        });
        container.scrollTop = container.scrollHeight;
        setDoc(convRef, { [`unreadCount.${uid}`]: 0 }, { merge: true }).catch(() => {});
    });
};

window.sendDM = async function() {
    if (!auth.currentUser || !window.currentConversationId) return;
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    if (window.checkTextContent(text)) return alert('Your message contains language that isn\'t allowed on WeeBee.');
    input.value = '';
    const uid = auth.currentUser.uid;
    const myName = auth.currentUser.displayName || 'Someone';
    const myAvatar = auth.currentUser.photoURL || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(myName)}&backgroundColor=ffc107&fontColor=333333`;
    const convRef = doc(db, "conversations", window.currentConversationId);
    try {
        await addDoc(collection(db, "conversations", window.currentConversationId, "messages"), { text, senderUid: uid, timestamp: new Date() });
        setDoc(convRef, { lastMessage: text, lastSenderUid: uid, lastUpdated: new Date(), [`unreadCount.${window.currentChatOtherUid}`]: increment(1) }, { merge: true }).catch(() => {});
        setDoc(doc(db, "notifications", `dm_${window.currentConversationId}`), {
            targetUid: window.currentChatOtherUid, type: 'dm',
            senderUid: uid, senderName: myName, senderAvatar: myAvatar,
            message: `sent you a message: "${text.length > 40 ? text.slice(0,40) + '…' : text}"`,
            timestamp: new Date(), read: false
        }).catch(() => {});
    } catch(e) { console.error('Send failed:', e); }
};

window.closeChatModal = function() {
    document.getElementById('chat-modal').style.display = 'none';
    if (window.dmUnsubscribe) { window.dmUnsubscribe(); window.dmUnsubscribe = null; }
    window.currentConversationId = null;
    window.currentChatOtherUid = null;
};

window.onclick = function() {
    const dd = document.getElementById('profile-dropdown');
    if (dd && dd.style.display === 'block') dd.style.display = 'none';
    const nd = document.getElementById('notification-dropdown');
    if (nd && nd.style.display === 'block') nd.style.display = 'none';
    const dm = document.getElementById('dm-dropdown');
    if (dm && dm.style.display === 'block') dm.style.display = 'none';
};

window.notifUnsubscribe = null;
window.fetchNotifications = function() {
    if(!auth.currentUser) return;
    if(window.notifUnsubscribe) { window.notifUnsubscribe(); window.notifUnsubscribe = null; }
    const q = query(collection(db, "notifications"), where("targetUid", "==", auth.currentUser.uid));
    window.notifUnsubscribe = onSnapshot(q, (snap) => {
        const list = document.getElementById('notif-list');
        const badge = document.getElementById('notif-badge');
        if(!list || !badge) return;

        let notifs = [];
        snap.forEach(d => notifs.push({ ...d.data(), id: d.id }));
        notifs = notifs.filter(n => n.type !== 'dm');
        notifs.sort((a, b) => (b.timestamp?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || 0));
        notifs = notifs.slice(0, 20);

        list.innerHTML = '';
        let unreadCount = 0;
        window.unreadNotifDocs = [];

        if(notifs.length === 0) {
            list.innerHTML = '<div style="padding:15px; text-align:center; color:var(--text-muted); font-size:13px;">No notifications yet.</div>';
            badge.style.display = 'none';
            return;
        }

        notifs.forEach(n => {
            if(!n.read) { unreadCount++; window.unreadNotifDocs.push(n.id); }
            const dateStr = n.timestamp?.toDate ? new Date(n.timestamp.toDate()).toLocaleDateString() : '';
            const avatar = n.senderAvatar || 'https://api.dicebear.com/9.x/initials/svg?seed=WeeBee&backgroundColor=ffc107&fontColor=333333';

            if (n.type === 'friend_request') {
                const alreadyFriends = window.myFriendIds.has(n.senderUid);
                const reqId = n.requestId || '';
                const actionHtml = alreadyFriends
                    ? `<span style="font-size:12px; color:var(--text-muted);">Already friends</span>`
                    : reqId
                    ? `<div style="display:flex; gap:8px; margin-top:6px;" onclick="event.stopPropagation()">
                           <button onclick="acceptFriendRequest('${n.senderUid}','${reqId}','${n.id}',this)" class="action-btn" style="padding:4px 10px; font-size:12px; background:#4CAF50; color:white;">Accept</button>
                           <button onclick="declineFriendRequest('${n.senderUid}','${reqId}','${n.id}',this)" class="action-btn" style="padding:4px 10px; font-size:12px; background:var(--bg-gray-darker); color:var(--text-dark);">Decline</button>
                       </div>`
                    : `<span style="font-size:12px; color:var(--text-muted);">Request handled</span>`;
                list.innerHTML += `
                    <div class="notif-item ${n.read ? '' : 'unread'}" style="cursor:pointer;" onclick="viewUserProfile('${n.senderUid}')">
                        <img src="${avatar}">
                        <div class="notif-content">
                            <p class="notif-text"><strong>${n.senderName}</strong> ${n.message}</p>
                            ${actionHtml}
                            <span class="notif-time">${dateStr}</span>
                        </div>
                    </div>`;
                return;
            }

            let onClickAction;
            if ((n.type === 'suggestion' || n.type === 'review') && n.linkRef) {
                onClickAction = `onclick="loadAnimeDetails(${n.linkRef})"`;
            } else if (n.type === 'dm') {
                const safeAvatar = (n.senderAvatar || '').replace(/'/g, "\\'");
                const safeName = (n.senderName || '').replace(/'/g, "\\'");
                onClickAction = `onclick="openDMConversation('${n.senderUid}','${safeName}','${safeAvatar}')"`;
            } else {
                onClickAction = `onclick="viewUserProfile('${n.senderUid}')"`;
            }
            list.innerHTML += `
                <div class="notif-item ${n.read ? '' : 'unread'}" style="cursor:pointer;" ${onClickAction}>
                    <img src="${avatar}">
                    <div class="notif-content">
                        <p class="notif-text"><strong>${n.senderName}</strong> ${n.message}</p>
                        <span class="notif-time">${dateStr}</span>
                    </div>
                </div>`;
        });

        if(unreadCount > 0) { badge.innerText = unreadCount; badge.style.display = 'flex'; }
        else { badge.style.display = 'none'; }
    }, (e) => console.error("Notif error", e));
};

window.clearAllNotifications = async function() {
    if (!auth.currentUser) return;
    const snap = await getDocs(query(collection(db, "notifications"), where("targetUid", "==", auth.currentUser.uid)));
    if (snap.empty) return;
    await Promise.all(snap.docs.map(d => deleteDoc(doc(db, "notifications", d.id))));
};

window.closeAllModals = function() { document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none'); };

window.fetchMyFollows = async function() {
    if (!auth.currentUser) { window.myFollowedUserIds.clear(); return; }
    try {
        const snap = await getDocs(query(collection(db, "follows"), where("followerUid", "==", auth.currentUser.uid), where("type", "==", "user")));
        window.myFollowedUserIds.clear();
        window.myFollowNotifyMap.clear();
        snap.forEach(d => {
            const fd = d.data();
            window.myFollowedUserIds.add(fd.targetId);
            window.myFollowNotifyMap.set(fd.targetId, fd.notifyReviews !== false);
        });
        // Update any follow buttons already rendered on screen
        document.querySelectorAll('.card-follow-btn').forEach(btn => {
            const onclickStr = btn.getAttribute('onclick') || '';
            const match = onclickStr.match(/toggleFollow\('([^']+)'/);
            if (!match) return;
            const uid = match[1];
            if (window.myFollowedUserIds.has(uid)) {
                btn.style.background = 'var(--bg-gray-darker)';
                btn.style.color = 'var(--text-dark)';
                btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px;">check</span> <span class="follow-btn-label">Following</span>`;
            }
        });
    } catch(e) {}
};

window.getFollowBtnHTML = function(uid) {
    if (!uid || !auth.currentUser || uid === auth.currentUser.uid) return '';
    if (window.myFollowedUserIds.has(uid)) return '';
    return `<button onclick="event.stopPropagation(); toggleFollow('${uid}', 'user', this)" class="action-btn card-follow-btn" style="padding:4px 10px; font-size:11px; flex-shrink:0;"><span class="material-symbols-outlined" style="font-size:14px;">person_add</span> <span class="follow-btn-label">Follow</span></button>`;
};
window.openAuthModal = function() { window.closeAllModals(); document.getElementById('auth-modal').style.display = 'flex'; };

window.openSettingsModal = function() {
    document.getElementById('profile-dropdown').style.display = 'none';
    window.closeAllModals();
    document.getElementById('settings-modal').style.display = 'flex';
    document.getElementById('dark-mode-toggle').checked = document.body.getAttribute('data-theme') === 'dark';
    if (auth.currentUser) {
        getDoc(doc(db, "profiles", auth.currentUser.uid)).then(pd => {
            const data = pd.exists() ? pd.data() : {};
            const dmT = document.getElementById('dm-followers-toggle');
            const listT = document.getElementById('list-private-toggle');
            if (dmT) dmT.checked = data.dmOpenToFollowers === true;
            if (listT) listT.checked = data.listPrivate === true;
        }).catch(() => {});
    }
};

window.toggleDmFollowers = function() {
    if (!auth.currentUser) return;
    const checked = document.getElementById('dm-followers-toggle').checked;
    setDoc(doc(db, "profiles", auth.currentUser.uid), { dmOpenToFollowers: checked }, { merge: true }).catch(() => {});
};

window.toggleListPrivacy = function() {
    if (!auth.currentUser) return;
    const checked = document.getElementById('list-private-toggle').checked;
    setDoc(doc(db, "profiles", auth.currentUser.uid), { listPrivate: checked }, { merge: true }).catch(() => {});
};

window.toggleDarkMode = function() {
    const newTheme = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem('weebee-theme', newTheme);
};

// --- REVIEW SYSTEM ---
const REVIEW_CATEGORIES = ['Plot', 'Animation', 'Soundtrack', 'Character Development', 'World Building', 'Art Style', 'Pacing', 'Voice Acting', 'Overall Enjoyment'];
const CATEGORY_DESCRIPTIONS = {
    'Plot': 'How well the story is written — its structure, originality, and narrative coherence.',
    'Animation': 'The quality, fluidity, and consistency of the animation throughout the series.',
    'Soundtrack': 'The quality of music and sound effects, and how well they complement each scene.',
    'Character Development': 'How well characters grow, evolve, and are written throughout the story.',
    'World Building': 'The depth, creativity, and consistency of the world and its lore.',
    'Art Style': 'The visual aesthetic, character design, and overall artistic direction.',
    'Pacing': 'How well the story\'s speed is managed — not too rushed, not too slow.',
    'Voice Acting': 'The quality and expressiveness of the voice performances.',
    'Overall Enjoyment': 'Your personal overall enjoyment — how the anime made you feel beyond the individual scores.',
};

window.openReviewModal = async function() {
    if (!auth.currentUser) return window.openAuthModal();
    window.existingReviewId = null;
    window.existingReviewData = null;
    // Check if user already has a review for this anime
    try {
        const existing = await getDocs(query(collection(db, "reviews"),
            where("uid", "==", auth.currentUser.uid),
            where("mal_id", "==", window.currentAnimeId)));
        const nonSuggestion = existing.docs.find(d => d.data().type !== 'suggestion');
        if (nonSuggestion) {
            window.existingReviewId = nonSuggestion.id;
            window.existingReviewData = nonSuggestion.data();
            const score = window.existingReviewData.score;
            document.getElementById('already-reviewed-msg').innerText =
                `You already gave this anime a score of ${score}/10. Would you like to update it?`;
            window.closeAllModals();
            document.getElementById('already-reviewed-modal').style.display = 'flex';
            return;
        }
    } catch(e) { console.error(e); }
    window.closeAllModals();
    document.getElementById('choice-modal').style.display = 'flex';
};

window.proceedToEditReview = function() {
    window.closeAllModals();
    if (window.existingReviewData?.categories) {
        window.pendingInDepthData = {
            categories: window.existingReviewData.categories,
            overallScore: window.existingReviewData.score,
            fanService: window.existingReviewData.fanService || null
        };
    } else {
        window.pendingInDepthData = null;
    }
    document.getElementById('choice-modal').style.display = 'flex';
};

window.openQuickScoreModal = function() {
    window.closeAllModals();
    document.getElementById('quick-score-value').value = window.existingReviewData?.score || '';
    document.getElementById('quick-fanservice-value').value = window.existingReviewData?.fanService || '';
    document.getElementById('quick-score-text').value = window.existingReviewData?.text || '';
    document.getElementById('quick-score-modal').style.display = 'flex';
};

window.openInDepthModal = function() {
    window.closeAllModals();
    const existing = window.pendingInDepthData;
    document.getElementById('in-depth-categories').innerHTML = REVIEW_CATEGORIES.map((cat, i) => `
        <div class="category-block">
            <div class="cat-header">
                <label style="display:flex; align-items:center; gap:5px;">${cat} <span class="material-symbols-outlined tooltip-icon" data-tooltip="${CATEGORY_DESCRIPTIONS[cat]}" style="font-size:14px; color:var(--text-muted);">info</span></label>
                <input type="number" id="cat-score-${i}" min="1" max="10" step="0.1" placeholder="1-10" value="${existing?.categories?.[i]?.score || ''}">
            </div>
            <textarea id="cat-text-${i}" placeholder="Your thoughts on ${cat.toLowerCase()}... (Optional)" rows="2">${existing?.categories?.[i]?.text || ''}</textarea>
        </div>
    `).join('');
    if (existing?.fanService) document.getElementById('in-depth-fanservice-value').value = existing.fanService;
    document.getElementById('in-depth-modal').style.display = 'flex';
};

window.previewInDepthReview = function() {
    const categories = REVIEW_CATEGORIES.map((cat, i) => ({
        label: cat,
        score: parseFloat(document.getElementById(`cat-score-${i}`).value) || null,
        text: document.getElementById(`cat-text-${i}`).value.trim()
    }));
    const scored = categories.filter(c => c.score);
    if (scored.length === 0) return alert('Please score at least one category.');
    const outOfRange = scored.find(c => c.score < 0 || c.score > 10);
    if (outOfRange) return alert(`Scores must be between 0 and 10. Check your "${outOfRange.label}" score.`);
    const textWithoutScore = categories.find(c => c.text && !c.score);
    if (textWithoutScore) return alert(`You left a comment on "${textWithoutScore.label}" but didn't give it a score. Please add a score or remove the comment.`);
    const _fsVal = document.getElementById('in-depth-fanservice-value').value;
    const fanService = _fsVal !== '' ? parseFloat(_fsVal) : null;
    if (fanService !== null && (fanService < 0 || fanService > 10)) return alert('Fan Service score must be between 0 and 10.');
    const overallScore = (scored.reduce((sum, c) => sum + c.score, 0) / scored.length).toFixed(1);
    window.pendingInDepthData = { categories, overallScore, fanService };

    const catBadges = scored.map(c => `
        <div style="display:flex;flex-direction:column;align-items:center;width:75px;">
            <span style="font-size:10px;font-weight:600;margin-bottom:8px;text-align:center;height:24px;display:flex;align-items:flex-end;">${c.label}</span>
            <div class="rating-badge ${window.getScoreTier(c.score)}" style="width:55px;height:55px;font-size:18px;">${c.score}</div>
        </div>`).join('');

    const catDetails = scored.map(c => `
        <div style="background:var(--bg-gray);padding:12px;border-radius:10px;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${c.text ? '8px' : '0'};">
                <strong>${c.label}</strong>
                <div class="rating-badge ${window.getScoreTier(c.score)}" style="width:32px;height:32px;font-size:11px;">${c.score}</div>
            </div>
            ${c.text ? `<p style="font-size:13px;color:var(--text-muted);margin:0;">${c.text}</p>` : ''}
        </div>`).join('');

    document.getElementById('preview-content').innerHTML = `
        <p style="text-align:center;font-size:13px;color:var(--text-muted);margin-bottom:20px;">Reviewing: <strong>${window.currentAnime?.title_english || window.currentAnime?.title || 'Unknown'}</strong></p>
        <div style="display:flex;gap:15px;flex-wrap:wrap;justify-content:center;align-items:flex-end;margin-bottom:20px;">
            ${catBadges}
            <div style="width:1px;height:45px;background:#E0E0E0;margin:0 10px;margin-bottom:5px;"></div>
            <div style="display:flex;flex-direction:column;align-items:center;width:75px;">
                <span style="font-size:10px;font-weight:800;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px;height:24px;display:flex;align-items:flex-end;">Overall</span>
                <div class="rating-badge ${window.getScoreTier(overallScore)}" style="width:55px;height:55px;font-size:18px;">${overallScore}</div>
            </div>
        </div>
        ${catDetails}
        ${fanService ? `<p style="font-size:12px;color:var(--text-muted);text-align:center;margin-top:10px;">Fan Service rating: ${fanService}/10</p>` : ''}`;

    window.closeAllModals();
    document.getElementById('preview-modal').style.display = 'flex';
};

window.submitInDepthReview = async function() {
    if (!auth.currentUser) return window.openAuthModal();
    const { categories, overallScore, fanService } = window.pendingInDepthData;
    const catTexts = (categories || []).map(c => c.text || '');
    if (window.checkTextContent(...catTexts)) return alert('Your review contains language that isn\'t allowed on WeeBee.');
    try {
        if (window.existingReviewId) {
            await updateDoc(doc(db, "reviews", window.existingReviewId), {
                score: parseFloat(overallScore), categories, fanService: fanService !== null ? fanService : null,
                animeTitle: window.currentAnime?.title_english || window.currentAnime?.title,
                animeImage: window.currentAnime?.images?.jpg?.image_url,
                username: auth.currentUser.displayName, avatar: auth.currentUser.photoURL,
                timestamp: new Date()
            });
        } else {
            await addDoc(collection(db, "reviews"), {
                mal_id: window.currentAnimeId,
                animeTitle: window.currentAnime?.title_english || window.currentAnime?.title,
                animeImage: window.currentAnime?.images?.jpg?.image_url,
                type: 'in-depth', score: parseFloat(overallScore), categories,
                fanService: fanService !== null ? fanService : null, text: '',
                username: auth.currentUser.displayName, avatar: auth.currentUser.photoURL,
                uid: auth.currentUser.uid, timestamp: new Date(),
                likes: [], dislikes: [], commentCount: 0
            });
            window.myReviewCount = (window.myReviewCount || 0) + 1;
            window.userRankCache[auth.currentUser.uid] = window.myReviewCount;
            const _avId = auth.currentUser.photoURL || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(auth.currentUser.displayName)}&backgroundColor=ffc107&fontColor=333333`;
            setDoc(doc(db, "profiles", auth.currentUser.uid), { reviewCount: increment(1), indepthCount: increment(1), displayName: auth.currentUser.displayName, avatar: _avId }, { merge: true }).catch(() => {});
            const _tb = document.getElementById('topbar-rank-badge');
            if (_tb) _tb.innerHTML = window.getRankBadgeHTML(window.myReviewCount, 16);
            getDoc(doc(db, "profiles", auth.currentUser.uid)).then(pd => {
                const p = pd.exists() ? pd.data() : {};
                window.awardAchievements([...window.getEarnedIds('review', p.reviewCount || window.myReviewCount), ...window.getEarnedIds('indepth', p.indepthCount || 1)]).catch(() => {});
            }).catch(() => {});
        }
        if (!window.existingReviewId) {
            const _animeTitle = window.currentAnime?.title_english || window.currentAnime?.title;
            window.sendReviewNotifications(_animeTitle, window.currentAnimeId).catch(() => {});
        }
        window.pendingInDepthData = null;
        window.closeAllModals();
        await window.maybeTriggerSeriesPrompt();
    } catch(e) { alert('Failed to submit review.'); console.error(e); }
};

window.submitQuickReview = async function() {
    if (!auth.currentUser) return window.openAuthModal();
    const score = parseFloat(document.getElementById('quick-score-value').value);
    const text = document.getElementById('quick-score-text').value.trim();
    if (window.checkTextContent(text)) return alert('Your review contains language that isn\'t allowed on WeeBee.');
    const _qfsVal = document.getElementById('quick-fanservice-value').value;
    const fanService = _qfsVal !== '' ? parseFloat(_qfsVal) : null;
    if (!score || score < 1 || score > 10) return alert('Please enter a score between 1 and 10.');
    if (fanService !== null && (fanService < 0 || fanService > 10)) return alert('Fan Service score must be between 0 and 10.');
    try {
        if (window.existingReviewId) {
            await updateDoc(doc(db, "reviews", window.existingReviewId), {
                score, fanService, text,
                animeTitle: window.currentAnime?.title_english || window.currentAnime?.title,
                animeImage: window.currentAnime?.images?.jpg?.image_url,
                username: auth.currentUser.displayName, avatar: auth.currentUser.photoURL,
                timestamp: new Date()
            });
        } else {
            await addDoc(collection(db, "reviews"), {
                mal_id: window.currentAnimeId,
                animeTitle: window.currentAnime?.title_english || window.currentAnime?.title,
                animeImage: window.currentAnime?.images?.jpg?.image_url,
                type: 'quick', score, fanService, text,
                username: auth.currentUser.displayName, avatar: auth.currentUser.photoURL,
                uid: auth.currentUser.uid, timestamp: new Date(),
                likes: [], dislikes: [], commentCount: 0
            });
            window.myReviewCount = (window.myReviewCount || 0) + 1;
            window.userRankCache[auth.currentUser.uid] = window.myReviewCount;
            const _avIq = auth.currentUser.photoURL || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(auth.currentUser.displayName)}&backgroundColor=ffc107&fontColor=333333`;
            setDoc(doc(db, "profiles", auth.currentUser.uid), { reviewCount: increment(1), displayName: auth.currentUser.displayName, avatar: _avIq }, { merge: true }).catch(() => {});
            const _tbq = document.getElementById('topbar-rank-badge');
            if (_tbq) _tbq.innerHTML = window.getRankBadgeHTML(window.myReviewCount, 16);
            window.awardAchievements(window.getEarnedIds('review', window.myReviewCount)).catch(() => {});
        }
        if (!window.existingReviewId) {
            const _qTitle = window.currentAnime?.title_english || window.currentAnime?.title;
            window.sendReviewNotifications(_qTitle, window.currentAnimeId).catch(() => {});
        }
        window.closeAllModals();
        await window.maybeTriggerSeriesPrompt();
    } catch(e) { alert('Failed to submit review.'); console.error(e); }
};

window.maybeTriggerSeriesPrompt = async function() {
    if (!auth.currentUser || !window.currentAnime) { window.loadAnimeDetails(window.currentAnimeId); return; }
    const SERIES_RELATIONS = ['Sequel', 'Prequel', 'Parent story', 'Full story'];
    const hasRelations = window.currentAnime.relations?.some(r => SERIES_RELATIONS.includes(r.relation));
    if (!hasRelations) { window.loadAnimeDetails(window.currentAnimeId); return; }
    // Check if user already has a series review anchored to this mal_id
    try {
        const existing = await getDocs(query(collection(db, "reviews"),
            where("uid", "==", auth.currentUser.uid),
            where("mal_id", "==", window.currentAnimeId),
            where("type", "==", "series")));
        if (!existing.empty) { window.loadAnimeDetails(window.currentAnimeId); return; }
    } catch(_) {}
    const title = window.currentAnime.title_english || window.currentAnime.title;
    document.getElementById('series-review-subtitle').innerText =
        `You just reviewed a season of ${title}. Want to also leave an overall series rating?`;
    document.getElementById('series-score-value').value = '';
    document.getElementById('series-score-text').value = '';
    document.getElementById('series-review-modal').style.display = 'flex';
};

window.submitSeriesReview = async function() {
    if (!auth.currentUser) return;
    const score = parseFloat(document.getElementById('series-score-value').value);
    const text = document.getElementById('series-score-text').value.trim();
    if (window.checkTextContent(text)) return alert('Your review contains language that isn\'t allowed on WeeBee.');
    if (!score || score < 1 || score > 10) return alert('Please enter a score between 1 and 10.');
    try {
        await addDoc(collection(db, "reviews"), {
            mal_id: window.currentAnimeId,
            animeTitle: window.currentAnime?.title_english || window.currentAnime?.title,
            animeImage: window.currentAnime?.images?.jpg?.image_url,
            type: 'series', score, text,
            username: auth.currentUser.displayName,
            avatar: auth.currentUser.photoURL,
            uid: auth.currentUser.uid,
            timestamp: new Date(),
            likes: [], commentCount: 0
        });
        window.closeAllModals();
        window.loadAnimeDetails(window.currentAnimeId);
    } catch(e) { alert('Failed to submit series rating.'); console.error(e); }
};

window.toggleAuthMode = function() {
    window.isSignUpMode = !window.isSignUpMode;
    const title = document.getElementById('auth-title');
    const signupFields = document.getElementById('signup-fields');
    if (window.isSignUpMode) { title.innerText = "Create an Account"; signupFields.style.display = 'block'; } 
    else { title.innerText = "Welcome to WeeBee"; signupFields.style.display = 'none'; }
};

window.submitAuth = async function() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const username = document.getElementById('auth-username').value;
    try {
        if (window.isSignUpMode) {
            if (!username.trim()) return document.getElementById('auth-error').innerText = 'Please enter a display name.';
            const normName = username.trim().toLowerCase().replace(/\s+/g, ' ');
            const nameTaken = await getDoc(doc(db, "usernames", normName));
            if (nameTaken.exists()) return document.getElementById('auth-error').innerText = 'That display name is already taken.';

            const userCred = await createUserWithEmailAndPassword(auth, email, password);
            const avatarUrl = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(username.trim())}&backgroundColor=ffc107&fontColor=333333`;
            await updateProfile(userCred.user, { displayName: username.trim(), photoURL: avatarUrl });
            setDoc(doc(db, "usernames", normName), { uid: userCred.user.uid }).catch(() => {});
            setDoc(doc(db, "profiles", userCred.user.uid), { displayName: username.trim(), avatar: avatarUrl, bio: '', genres: [] }, { merge: true }).catch(() => {});

            await addDoc(collection(db, "notifications"), {
                targetUid: userCred.user.uid, type: 'system', senderName: 'WeeBee Team', senderUid: 'system',
                senderAvatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=WeeBee',
                message: 'Welcome to WeeBee! Start tracking and reviewing your favorite anime.',
                timestamp: new Date(), read: false
            });

        } else { await signInWithEmailAndPassword(auth, email, password); }
        window.closeAllModals();
    } catch (e) { document.getElementById('auth-error').innerText = e.message; }
};

window.signInWithGoogle = async function() { try { await signInWithPopup(auth, googleProvider); window.closeAllModals(); } catch (error) { alert(error.message); } };
window.logoutUser = function() {
    if(confirm("Are you sure you want to log out?")) {
        if(window.notifUnsubscribe) { window.notifUnsubscribe(); window.notifUnsubscribe = null; }
        if(window.dmUnsubscribe) { window.dmUnsubscribe(); window.dmUnsubscribe = null; }
        signOut(auth);
    }
};

window.getScoreTier = function(score) {
    const s = parseFloat(score);
    if(s === 10) return 'tier-royal'; if(s >= 9.0) return 'tier-platinum'; if(s >= 8.0) return 'tier-gold';
    if(s >= 7.0) return 'tier-silver'; if(s >= 6.0) return 'tier-bronze'; if(s >= 5.0) return 'tier-iron'; return 'tier-stone';
};

window.toggleFollow = async function(targetId, type, btnElement) {
    if(!auth.currentUser) return window.openAuthModal();
    const q = query(collection(db, "follows"), where("followerUid", "==", auth.currentUser.uid), where("targetId", "==", targetId));
    const snap = await getDocs(q);
    
    let extraData = {};
    if(type === 'anime' && window.currentAnime) {
        extraData.title = window.currentAnime.title_english || window.currentAnime.title;
        extraData.image = window.currentAnime.images.jpg.image_url;
    } else if (type === 'user' && window.targetProfileUid) {
        // Get only the text node from h1, not any icon span text
        const h1 = document.querySelector('.profile-header h1');
        const uName = h1 ? [...h1.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).filter(Boolean).join('') || window.currentProfileName || 'User' : window.currentProfileName || 'User';
        const uImg = document.querySelector('.profile-avatar-large')?.src || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(uName)}&backgroundColor=ffc107&fontColor=333333`;
        extraData.username = uName;
        extraData.avatar = uImg;
    }

    if(snap.empty) {
        await addDoc(collection(db, "follows"), { followerUid: auth.currentUser.uid, targetId: targetId, type: type, notifyReviews: true, ...extraData });
        btnElement.innerHTML = `<span class="material-symbols-outlined">check</span> Following`; btnElement.style.backgroundColor = "var(--bg-gray-darker)";
        if(type === 'user') {
            window.myFollowedUserIds.add(targetId);
            window.myFollowNotifyMap.set(targetId, true);
            window.awardAchievements(['first_follow']).catch(() => {});
            const notifyBtn = document.getElementById('profile-notify-btn');
            if (notifyBtn) notifyBtn.style.display = 'inline-flex';
            if (btnElement.classList.contains('card-follow-btn')) btnElement.style.display = 'none';
        }
        if(type === 'user') {
            await addDoc(collection(db, "notifications"), {
                targetUid: targetId, type: 'follow', senderUid: auth.currentUser.uid,
                senderName: auth.currentUser.displayName, senderAvatar: auth.currentUser.photoURL,
                message: 'started following you!', timestamp: new Date(), read: false
            });
        }
    } else {
        await deleteDoc(doc(db, "follows", snap.docs[0].id));
        btnElement.innerHTML = type === 'anime' ? `<span class="material-symbols-outlined">bookmark_add</span> Follow Anime` : `<span class="material-symbols-outlined">person_add</span> Follow`;
        btnElement.style.backgroundColor = "var(--accent-yellow)";
        if(type === 'user') {
            window.myFollowedUserIds.delete(targetId);
            window.myFollowNotifyMap.delete(targetId);
            const notifyBtn = document.getElementById('profile-notify-btn');
            if (notifyBtn) notifyBtn.style.display = 'none';
        }
    }
};

window.toggleReviewNotify = async function(targetUid, btn) {
    if (!auth.currentUser) return;
    const snap = await getDocs(query(collection(db, "follows"), where("followerUid", "==", auth.currentUser.uid), where("targetId", "==", targetUid), where("type", "==", "user")));
    if (snap.empty) return;
    const currentNotify = snap.docs[0].data().notifyReviews !== false;
    const newNotify = !currentNotify;
    await updateDoc(doc(db, "follows", snap.docs[0].id), { notifyReviews: newNotify });
    window.myFollowNotifyMap.set(targetUid, newNotify);
    btn.title = newNotify ? 'Review notifications on' : 'Review notifications off';
    btn.querySelector('.material-symbols-outlined').textContent = newNotify ? 'notifications_active' : 'notifications_off';
};

window.fetchFriendData = async function() {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    window.myFriendIds.clear(); window.myPendingOutIds.clear(); window.myPendingInIds.clear();
    try {
        const [friendsSnap, sentSnap, receivedSnap] = await Promise.all([
            getDocs(query(collection(db, "friends"), where("uids", "array-contains", uid))),
            getDocs(query(collection(db, "friend_requests"), where("fromUid", "==", uid))),
            getDocs(query(collection(db, "friend_requests"), where("toUid", "==", uid)))
        ]);
        friendsSnap.forEach(d => { const other = d.data().uids.find(u => u !== uid); if (other) window.myFriendIds.add(other); });
        sentSnap.forEach(d => { if (d.data().status === 'pending') window.myPendingOutIds.add(d.data().toUid); });
        receivedSnap.forEach(d => { if (d.data().status === 'pending') window.myPendingInIds.set(d.data().fromUid, d.id); });
    } catch(e) { console.error('fetchFriendData error:', e); }
};

window.sendFriendRequest = async function(toUid, btn) {
    if (!auth.currentUser) return window.openAuthModal();
    btn.disabled = true;
    const myName = auth.currentUser.displayName;
    const myAvatar = auth.currentUser.photoURL || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(myName)}&backgroundColor=ffc107&fontColor=333333`;
    try {
        const reqRef = await addDoc(collection(db, "friend_requests"), {
            fromUid: auth.currentUser.uid, toUid, fromName: myName, fromAvatar: myAvatar, status: 'pending', timestamp: new Date()
        });
        window.myPendingOutIds.add(toUid);
        const area = document.getElementById('profile-friend-btns');
        if (area) area.innerHTML = `<button class="action-btn" style="background:var(--bg-gray-darker); color:var(--text-muted);" disabled><span class="material-symbols-outlined">schedule</span> Pending</button>`;
        await addDoc(collection(db, "notifications"), {
            targetUid: toUid, type: 'friend_request', senderUid: auth.currentUser.uid,
            senderName: myName, senderAvatar: myAvatar,
            message: 'sent you a friend request', requestId: reqRef.id, timestamp: new Date(), read: false
        });
    } catch(e) { btn.disabled = false; console.error(e); }
};

window.acceptFriendRequest = async function(fromUid, requestId, notifId, btn) {
    if (!auth.currentUser) return;
    if (btn) btn.disabled = true;
    try {
        const uid = auth.currentUser.uid;
        const uids = [uid, fromUid].sort();
        await Promise.all([
            updateDoc(doc(db, "friend_requests", requestId), { status: 'accepted' }),
            addDoc(collection(db, "friends"), { uids, timestamp: new Date() })
        ]);
        window.myFriendIds.add(fromUid);
        window.myPendingInIds.delete(fromUid);
        const area = document.getElementById('profile-friend-btns');
        if (area) area.innerHTML = `<button onclick="removeFriend('${fromUid}', this)" class="action-btn" style="background:var(--bg-gray-darker); color:var(--text-dark);"><span class="material-symbols-outlined">people</span> Friends</button>`;
        if (btn && btn.parentElement) btn.parentElement.outerHTML = `<span style="font-size:12px; color:#4CAF50; font-weight:600;">Friends!</span>`;
        if (notifId) setDoc(doc(db, "notifications", notifId), { read: true }, { merge: true }).catch(() => {});
        const myAvatar = auth.currentUser.photoURL || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(auth.currentUser.displayName)}&backgroundColor=ffc107&fontColor=333333`;
        addDoc(collection(db, "notifications"), {
            targetUid: fromUid, type: 'friend_accept', senderUid: uid,
            senderName: auth.currentUser.displayName, senderAvatar: myAvatar,
            message: 'accepted your friend request', timestamp: new Date(), read: false
        }).catch(() => {});
    } catch(e) { if (btn) btn.disabled = false; console.error(e); }
};

window.declineFriendRequest = async function(fromUid, requestId, notifId, btn) {
    if (!auth.currentUser) return;
    try {
        await updateDoc(doc(db, "friend_requests", requestId), { status: 'declined' });
        window.myPendingInIds.delete(fromUid);
        const area = document.getElementById('profile-friend-btns');
        if (area) area.innerHTML = `<button onclick="sendFriendRequest('${fromUid}', this)" class="action-btn"><span class="material-symbols-outlined">person_add</span> Add Friend</button>`;
        if (btn && btn.parentElement) btn.parentElement.outerHTML = `<span style="font-size:12px; color:var(--text-muted);">Request declined</span>`;
        if (notifId) setDoc(doc(db, "notifications", notifId), { read: true }, { merge: true }).catch(() => {});
    } catch(e) { console.error(e); }
};

window.removeFriend = async function(friendUid, btn) {
    if (!auth.currentUser) return;
    if (!confirm('Remove this friend?')) return;
    try {
        const uid = auth.currentUser.uid;
        const snap = await getDocs(query(collection(db, "friends"), where("uids", "array-contains", uid)));
        const friendDoc = snap.docs.find(d => d.data().uids.includes(friendUid));
        if (friendDoc) await deleteDoc(doc(db, "friends", friendDoc.id));
        window.myFriendIds.delete(friendUid);
        const area = document.getElementById('profile-friend-btns');
        if (area) area.innerHTML = `<button onclick="sendFriendRequest('${friendUid}', this)" class="action-btn"><span class="material-symbols-outlined">person_add</span> Add Friend</button>`;
    } catch(e) { console.error(e); }
};

window.loadFriendsTab = async function(uid) {
    const container = document.getElementById('friends-list-container');
    if (!container) return;
    container.innerHTML = '<div class="loading">Loading friends...</div>';
    try {
        const snap = await getDocs(query(collection(db, "friends"), where("uids", "array-contains", uid)));
        if (snap.empty) { container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:30px; font-size:14px;">No friends yet.</p>'; return; }
        const friendUids = snap.docs.map(d => d.data().uids.find(u => u !== uid)).filter(Boolean);
        const profileDocs = await Promise.all(friendUids.map(fuid => getDoc(doc(db, "profiles", fuid))));
        container.innerHTML = '<div style="display:flex; flex-wrap:wrap; gap:10px; padding:16px 0;">' +
            profileDocs.map((pd, i) => {
                const p = pd.exists() ? pd.data() : {};
                const fuid = friendUids[i];
                const fname = p.displayName || 'WeeBee User';
                const favatar = p.avatar || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(fname)}&backgroundColor=ffc107&fontColor=333333`;
                return `<div style="display:flex; align-items:center; gap:10px; padding:10px 14px; border-radius:10px; background:var(--bg-gray);">
                    <img src="${favatar}" class="avatar" style="width:36px; height:36px; flex-shrink:0; cursor:pointer;" onclick="viewUserProfile('${fuid}')">
                    <span style="font-weight:600; font-size:14px; flex:1; cursor:pointer;" onclick="viewUserProfile('${fuid}')">${fname}</span>
                    <button onclick="viewFriendList('${fuid}')" class="action-btn" style="padding:4px 10px; font-size:12px; min-width:unset; background:var(--bg-gray-darker); color:var(--text-dark);" title="View list"><span class="material-symbols-outlined" style="font-size:16px;">list_alt</span></button>
                </div>`;
            }).join('') + '</div>';
    } catch(e) { container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:30px; font-size:14px;">Failed to load friends.</p>'; }
};

window.viewFriendList = function(uid) {
    window.currentProfileUid = uid;
    window.viewFullAnimeList();
};

window.loadFollowersTab = async function(uid) {
    const container = document.getElementById('followers-list-container');
    if (!container) return;
    container.innerHTML = '<div class="loading">Loading followers...</div>';
    try {
        const snap = await getDocs(query(collection(db, "follows"), where("targetId", "==", uid), where("type", "==", "user")));
        if (snap.empty) { container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:30px; font-size:14px;">No followers yet.</p>'; return; }
        const followerUids = snap.docs.map(d => d.data().followerUid).filter(Boolean);
        const profileDocs = await Promise.all(followerUids.map(fuid => getDoc(doc(db, "profiles", fuid))));
        container.innerHTML = '<div style="display:flex; flex-wrap:wrap; gap:10px; padding:16px 0;">' +
            profileDocs.map((pd, i) => {
                const p = pd.exists() ? pd.data() : {};
                const fuid = followerUids[i];
                const fname = p.displayName || 'WeeBee User';
                const favatar = p.avatar || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(fname)}&backgroundColor=ffc107&fontColor=333333`;
                return `<div style="display:flex; align-items:center; gap:10px; padding:10px 14px; border-radius:10px; background:var(--bg-gray);">
                    <img src="${favatar}" class="avatar" style="width:36px; height:36px; flex-shrink:0; cursor:pointer;" onclick="viewUserProfile('${fuid}')">
                    <span style="font-weight:600; font-size:14px; flex:1; cursor:pointer;" onclick="viewUserProfile('${fuid}')">${fname}</span>
                </div>`;
            }).join('') + '</div>';
    } catch(e) { container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:30px; font-size:14px;">Failed to load followers.</p>'; }
};

window.sendReviewNotifications = async function(animeTitle, mal_id) {
    if (!auth.currentUser) return;
    try {
        const snap = await getDocs(query(collection(db, "follows"), where("targetId", "==", auth.currentUser.uid)));
        const followers = [];
        snap.forEach(d => {
            const fd = d.data();
            if (fd.type === 'user' && fd.notifyReviews !== false) followers.push(fd.followerUid);
        });
        if (followers.length === 0) return;
        const myAvatar = auth.currentUser.photoURL || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(auth.currentUser.displayName)}&backgroundColor=ffc107&fontColor=333333`;
        await Promise.all(followers.map(followerUid => addDoc(collection(db, "notifications"), {
            targetUid: followerUid, type: 'review',
            senderUid: auth.currentUser.uid, senderName: auth.currentUser.displayName, senderAvatar: myAvatar,
            message: `reviewed "${animeTitle}"`, linkRef: mal_id, timestamp: new Date(), read: false
        })));
    } catch(e) { console.error('Review notification error:', e); }
};

window.openBugReportModal = function() {
    window.closeAllModals();
    document.getElementById('bug-report-text').value = '';
    document.getElementById('bug-report-modal').style.display = 'flex';
};

window.submitBugReport = async function() {
    if (!auth.currentUser) return window.openAuthModal();
    const text = document.getElementById('bug-report-text').value.trim();
    if (!text) return alert('Please describe the bug before submitting.');
    try {
        await addDoc(collection(db, "bug_reports"), {
            uid: auth.currentUser.uid, displayName: auth.currentUser.displayName,
            text, timestamp: new Date()
        });
        window.closeAllModals();
        alert('Bug report submitted — thanks for helping make WeeBee better!');
    } catch(e) { alert('Failed to submit. Please try again.'); }
};

window.openFeatureSuggestionModal = function() {
    window.closeAllModals();
    document.getElementById('feature-suggestion-text').value = '';
    document.getElementById('feature-suggestion-modal').style.display = 'flex';
};

window.submitFeatureSuggestion = async function() {
    if (!auth.currentUser) return window.openAuthModal();
    const text = document.getElementById('feature-suggestion-text').value.trim();
    if (!text) return alert('Please describe your idea before submitting.');
    try {
        await addDoc(collection(db, "feature_suggestions"), {
            uid: auth.currentUser.uid, displayName: auth.currentUser.displayName,
            text, timestamp: new Date()
        });
        window.closeAllModals();
        alert('Feature suggestion submitted — we love hearing ideas!');
    } catch(e) { alert('Failed to submit. Please try again.'); }
};

// --- MASTER LIST SYSTEM ---
window.addCurrentAnimeToList = function() {
    if (!auth.currentUser) return window.openAuthModal();
    if (!window.currentAnime) return;
    const anime = window.currentAnime;
    const title = anime.title_english || anime.title;
    const img = anime.images.jpg.image_url;
    const eps = anime.episodes || 0;
    window.selectAnimeForList(anime.mal_id, title, img, eps);
};

window.openAddToListModal = function() {
    if(!auth.currentUser) return window.openAuthModal();
    window.closeAllModals();
    document.getElementById('list-search-input').value = '';
    document.getElementById('list-search-results').style.display = 'none';
    document.getElementById('list-search-modal').style.display = 'flex';
};

window.searchListAnime = async function() {
    const q = document.getElementById('list-search-input').value.trim();
    if(!q) return;
    const resContainer = document.getElementById('list-search-results');
    resContainer.style.display = 'block';
    resContainer.innerHTML = '<div class="loading" style="font-size:12px;">Searching Jikan...</div>';
    
    try {
        const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=5`);
        const { data } = await res.json();
        resContainer.innerHTML = '';
        if(data.length === 0) { resContainer.innerHTML = '<p style="font-size:12px;">No results found.</p>'; return; }
        
        data.forEach(anime => {
            const title = anime.title_english || anime.title;
            const img = anime.images.jpg.image_url;
            const eps = anime.episodes || 0; 
            const safeTitle = title.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            
            resContainer.innerHTML += `
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #E0E0E0; padding-bottom:8px; margin-bottom:8px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <img src="${img}" style="width:25px; height:35px; border-radius:4px; object-fit:cover;">
                        <span style="font-size:12px; font-weight:600;">${title}</span>
                    </div>
                    <button onclick="selectAnimeForList(${anime.mal_id}, '${safeTitle}', '${img}', ${eps})" class="action-btn" style="padding:4px 10px; font-size:11px;">Select</button>
                </div>
            `;
        });
    } catch(e) { resContainer.innerHTML = '<p style="color:red; font-size:12px;">Search failed.</p>'; }
};

window.selectAnimeForList = async function(mal_id, title, img, totalEps) {
    document.getElementById('list-search-modal').style.display = 'none';
    window.currentListEntryTotalEps = totalEps; 
    
    const existingEntry = window.myAnimeList.find(a => a.mal_id === mal_id);
    let docId = existingEntry ? existingEntry.id : null;
    let currentScore = existingEntry ? existingEntry.score : '';
    let currentFanService = existingEntry ? existingEntry.fanService : '';
    let currentWatched = existingEntry ? existingEntry.watchedEpisodes : 0;
    let currentStatus = existingEntry ? existingEntry.status : 'watching';

    const hintText = document.getElementById('list-entry-review-hint');
    hintText.style.display = 'none';

    if (!currentScore || !currentFanService) {
        const revQuery = query(collection(db, "reviews"), where("uid", "==", auth.currentUser.uid), where("mal_id", "==", mal_id));
        const revSnap = await getDocs(revQuery);
        if(!revSnap.empty) {
            let foundScore = null;
            let foundFS = null;
            revSnap.forEach(d => { 
                if(d.data().type !== 'suggestion') {
                    if(d.data().score) foundScore = d.data().score;
                    if(d.data().fanService) foundFS = d.data().fanService;
                }
            });
            if(foundScore && !currentScore) { currentScore = foundScore; hintText.style.display = 'block'; }
            if(foundFS && !currentFanService) { currentFanService = foundFS; hintText.style.display = 'block'; }
        }
    }

    document.getElementById('list-entry-title').innerText = title;
    document.getElementById('list-entry-img').src = img;
    document.getElementById('list-entry-score').value = currentScore;
    document.getElementById('list-entry-fanservice').value = currentFanService;
    document.getElementById('list-entry-watched').value = currentWatched;
    document.getElementById('list-entry-total').innerText = totalEps > 0 ? totalEps : '?';
    document.getElementById('list-entry-status').value = currentStatus;
    
    const saveBtn = document.querySelector('#list-entry-modal .submit-btn');
    saveBtn.onclick = () => saveListEntry(docId, mal_id, title, img, totalEps);

    const deleteBtn = document.getElementById('list-entry-delete-btn');
    if(docId) {
        deleteBtn.style.display = 'block';
        deleteBtn.onclick = () => deleteListEntry(docId);
    } else {
        deleteBtn.style.display = 'none';
    }

    document.getElementById('list-entry-modal').style.display = 'flex';
};

window.saveListEntry = async function(docId, mal_id, title, img, totalEps) {
    const status = document.getElementById('list-entry-status').value;
    const scoreVal = document.getElementById('list-entry-score').value;
    const fsVal = document.getElementById('list-entry-fanservice').value;
    
    const score = scoreVal ? parseFloat(scoreVal) : null;
    const fanService = fsVal ? parseFloat(fsVal) : null;
    if (score !== null && (score < 0 || score > 10)) return alert('Score must be between 0 and 10.');
    if (fanService !== null && (fanService < 0 || fanService > 10)) return alert('Fan Service score must be between 0 and 10.');
    let watched = parseInt(document.getElementById('list-entry-watched').value) || 0;

    if (totalEps > 0 && watched > totalEps) watched = totalEps;
    if (status === 'completed' && totalEps > 0) watched = totalEps;

    const entryData = {
        uid: auth.currentUser.uid, mal_id, title, image: img, 
        status, score, fanService, watchedEpisodes: watched, totalEpisodes: totalEps, 
        timestamp: new Date()
    };

    try {
        // Determine if this status change earns achievements
        const prevEntry = window.myAnimeList.find(a => a.mal_id === mal_id);
        const prevStatus = prevEntry?.status;

        if(docId) {
            await updateDoc(doc(db, "anime_lists", docId), entryData);
        } else {
            await addDoc(collection(db, "anime_lists"), entryData);
        }

        // Track completed/dropped counts for achievements
        if (auth.currentUser && status !== prevStatus) {
            const profileUpdates = {};
            if (status === 'completed') profileUpdates.completedCount = increment(1);
            if (status === 'dropped') profileUpdates.droppedCount = increment(1);
            if (Object.keys(profileUpdates).length) {
                setDoc(doc(db, "profiles", auth.currentUser.uid), profileUpdates, { merge: true }).then(() =>
                    getDoc(doc(db, "profiles", auth.currentUser.uid)).then(pd => {
                        const p = pd.exists() ? pd.data() : {};
                        const ids = [...window.getEarnedIds('complete', p.completedCount || 0)];
                        if ((p.droppedCount || 0) >= 10) ids.push('dropout');
                        window.awardAchievements(ids).catch(() => {});
                    })
                ).catch(() => {});
            }
        }

        window.closeAllModals();
        fetchMyList();
        if(window.currentActiveViewId === 'profile-view') fetchUserProfile(window.targetProfileUid);
        const addBtn = document.getElementById('add-to-list-btn');
        if (addBtn) { addBtn.innerHTML = '<span class="material-symbols-outlined">check</span> In My List'; addBtn.style.background = 'var(--bg-gray-darker)'; addBtn.style.color = 'var(--text-muted)'; }
        // Update any quick-add buttons in search results for this anime
        document.querySelectorAll(`.search-quick-add[data-mal="${mal_id}"]`).forEach(btn => {
            btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px;">check</span> In List';
            btn.style.background = 'var(--bg-gray-darker)';
            btn.style.color = 'var(--text-muted)';
        });
    } catch(e) { alert("Failed to save entry"); console.error(e); }
};

window.deleteListEntry = async function(docId) {
    if(!confirm("Remove this anime from your list?")) return;
    try {
        await deleteDoc(doc(db, "anime_lists", docId));
        window.closeAllModals();
        fetchMyList();
        if(window.currentActiveViewId === 'profile-view') fetchUserProfile(window.targetProfileUid);
    } catch(e) { alert("Failed to remove entry"); }
};

window.fetchMyList = async function(targetUid = null) {
    const uidToFetch = targetUid || (auth.currentUser ? auth.currentUser.uid : null);
    if(!uidToFetch) return;
    const [snap, revSnap] = await Promise.all([
        getDocs(query(collection(db, "anime_lists"), where("uid", "==", uidToFetch))),
        getDocs(query(collection(db, "reviews"), where("uid", "==", uidToFetch)))
    ]);
    window.myAnimeList = [];
    snap.forEach(d => window.myAnimeList.push({ ...d.data(), id: d.id }));
    window.myReviewedMalIds = new Set();
    window.myReviewScoreMap = {};
    revSnap.forEach(d => {
        const data = d.data();
        if (data.type !== 'suggestion') {
            window.myReviewedMalIds.add(data.mal_id);
            if (data.score != null) window.myReviewScoreMap[data.mal_id] = data.score;
        }
    });
    if(window.currentActiveViewId === 'my-list-view') renderAnimeList();
};

window.switchListTab = function(event, tabId) {
    document.querySelectorAll('.list-tabs .p-tab').forEach(t => t.classList.remove('active'));
    event.currentTarget.classList.add('active');
    window.currentListTab = tabId;
    
    window.currentListSort = { key: 'score', desc: true };
    renderAnimeList();
};

window.sortAnimeList = function(key) {
    if(window.currentListSort.key === key) {
        window.currentListSort.desc = !window.currentListSort.desc;
    } else {
        window.currentListSort.key = key;
        window.currentListSort.desc = key !== 'title';
    }
    renderAnimeList();
    ['rank', 'title', 'score'].forEach(k => {
        const el = document.getElementById(`sort-icon-${k}`);
        if (!el) return;
        const isActive = window.currentListSort.key === k;
        el.classList.toggle('active', isActive);
        el.innerHTML = `<span class="material-symbols-outlined">${isActive ? (window.currentListSort.desc ? 'arrow_downward' : 'arrow_upward') : 'unfold_more'}</span>`;
    });
};

window.renderAnimeList = function() {
    let filteredList = window.myAnimeList;
    if(window.currentListTab !== 'all') {
        filteredList = window.myAnimeList.filter(a => a.status === window.currentListTab);
    }

    const scoreFor = a => window.myReviewScoreMap?.[a.mal_id] ?? 0;
    let rankedList = [...filteredList].sort((a, b) => scoreFor(b) - scoreFor(a));
    rankedList.forEach((item, index) => item._absoluteRank = index + 1);

    const { key, desc } = window.currentListSort;

    rankedList.sort((a, b) => {
        if(key === 'title') {
            return desc ? b.title.localeCompare(a.title) : a.title.localeCompare(b.title);
        } else if (key === 'score') {
            return desc ? scoreFor(b) - scoreFor(a) : scoreFor(a) - scoreFor(b);
        } else if (key === 'rank') {
            return desc ? b._absoluteRank - a._absoluteRank : a._absoluteRank - b._absoluteRank;
        }
        return 0;
    });

    const tbody = document.getElementById('anime-list-tbody');
    tbody.innerHTML = '';
    
    if(rankedList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-muted);">No anime found in this category.</td></tr>`;
        return;
    }

    const statusClasses = {
        'watching': 'status-watching', 'completed': 'status-completed',
        'on-hold': 'status-on-hold', 'dropped': 'status-dropped', 'plan-to-watch': 'status-plan-to-watch'
    };

    const statusLabels = {
        'watching': 'Watching', 'completed': 'Completed', 'on-hold': 'On Hold',
        'dropped': 'Dropped', 'plan-to-watch': 'Plan to Watch'
    };
    
    const isMyProfile = !window.targetProfileUid || (auth.currentUser && window.targetProfileUid === auth.currentUser.uid);

    rankedList.forEach(anime => {
        const safeTitle = anime.title.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        
        let editHtml = isMyProfile ? `
            <div style="display:flex; gap:4px; justify-content:center;">
                <button class="action-btn" style="padding:6px; min-width:unset; margin:0;" title="Edit entry" onclick="selectAnimeForList(${anime.mal_id}, '${safeTitle}', '${anime.image}', ${anime.totalEpisodes})"><span class="material-symbols-outlined" style="font-size:18px;">edit</span></button>
                <button class="action-btn" style="padding:6px; min-width:unset; margin:0;" title="Write review" onclick="openReviewFromList(${anime.mal_id}, '${safeTitle}', '${anime.image}')"><span class="material-symbols-outlined" style="font-size:18px;">rate_review</span></button>
            </div>` : '';

        tbody.innerHTML += `
            <tr>
                <td style="text-align:center; font-weight:bold; font-size:16px; color:var(--text-muted);">${anime._absoluteRank}</td>
                <td><img src="${anime.image}" style="width:50px; height:70px; border-radius:4px; object-fit:cover; cursor:pointer;" onclick="loadAnimeDetails(${anime.mal_id})"></td>
                <td style="font-weight:600; cursor:pointer;" onclick="loadAnimeDetails(${anime.mal_id})">${anime.title}</td>
                <td style="text-align:center; font-weight:800; font-size:16px;">${window.myReviewScoreMap?.[anime.mal_id] != null ? Number(window.myReviewScoreMap[anime.mal_id]).toFixed(1) : '-'}</td>
                <td style="text-align:center; color:var(--text-muted);">
                    <strong style="color:var(--text-dark);">${anime.watchedEpisodes}</strong> / ${anime.totalEpisodes > 0 ? anime.totalEpisodes : '?'}
                </td>
                <td style="text-align:center;"><span class="list-status-badge ${statusClasses[anime.status]}">${statusLabels[anime.status]}</span></td>
                <td style="text-align:center;">${editHtml}</td>
            </tr>
        `;
    });
};

window.openReviewFromList = async function(malId, title, image) {
    if (!auth.currentUser) return window.openAuthModal();
    window.currentAnimeId = malId;
    window.currentAnime = { title, title_english: title, images: { jpg: { image_url: image } } };
    await window.openReviewModal();
};

// --- Ranked Top Anime System ---
window.currentTopAnimeList = [];

window.openTopAnimeModal = async function() {
    if(!auth.currentUser) return window.openAuthModal();
    window.closeAllModals();
    document.getElementById('top-anime-search-input').value = '';
    document.getElementById('top-anime-search-results').style.display = 'none';
    
    const topDoc = await getDoc(doc(db, "top_anime_lists", auth.currentUser.uid));
    if(topDoc.exists() && topDoc.data().list) { window.currentTopAnimeList = topDoc.data().list; } 
    else { window.currentTopAnimeList = []; }
    
    renderTopAnimeEditList();
    document.getElementById('top-anime-modal').style.display = 'flex';
};

window.searchTopAnime = async function() {
    const q = document.getElementById('top-anime-search-input').value.trim();
    if(!q) return;
    const resContainer = document.getElementById('top-anime-search-results');
    resContainer.style.display = 'block';
    resContainer.innerHTML = '<div class="loading" style="font-size:12px;">Searching Jikan...</div>';
    
    try {
        const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=5`);
        const { data } = await res.json();
        resContainer.innerHTML = '';
        if(data.length === 0) { resContainer.innerHTML = '<p style="font-size:12px;">No results found.</p>'; return; }
        
        data.forEach(anime => {
            const title = anime.title_english || anime.title;
            const img = anime.images.jpg.image_url;
            const safeTitle = title.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            resContainer.innerHTML += `
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #E0E0E0; padding-bottom:8px; margin-bottom:8px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <img src="${img}" style="width:25px; height:35px; border-radius:4px; object-fit:cover;">
                        <span style="font-size:12px; font-weight:600;">${title}</span>
                    </div>
                    <button onclick="addAnimeToTopList(${anime.mal_id}, '${safeTitle}', '${img}')" class="action-btn" style="padding:4px 10px; font-size:11px;">Add</button>
                </div>
            `;
        });
    } catch(e) { resContainer.innerHTML = '<p style="color:red; font-size:12px;">Search failed.</p>'; }
};

window.addAnimeToTopList = function(mal_id, title, image) {
    if(window.currentTopAnimeList.length >= 10) return alert("You can only have a Top 10 list!");
    if(window.currentTopAnimeList.find(a => a.mal_id === mal_id)) return alert("This anime is already in your top list.");
    
    window.currentTopAnimeList.push({ mal_id, title, image });
    document.getElementById('top-anime-search-results').style.display = 'none';
    document.getElementById('top-anime-search-input').value = '';
    renderTopAnimeEditList();
};

window.removeTopAnimeList = function(index) {
    window.currentTopAnimeList.splice(index, 1);
    renderTopAnimeEditList();
};

window.moveTopAnimeList = function(index, direction) {
    const newIndex = index + direction;
    if(newIndex < 0 || newIndex >= window.currentTopAnimeList.length) return;
    
    const temp = window.currentTopAnimeList[index];
    window.currentTopAnimeList[index] = window.currentTopAnimeList[newIndex];
    window.currentTopAnimeList[newIndex] = temp;
    renderTopAnimeEditList();
};

window.renderTopAnimeEditList = function() {
    const listContainer = document.getElementById('top-anime-edit-list');
    listContainer.innerHTML = '';
    
    if(window.currentTopAnimeList.length === 0) {
        listContainer.innerHTML = '<p style="font-size:12px; color:var(--text-muted); text-align:center; padding: 20px; border: 1px dashed #DDD; border-radius: 8px;">Your list is empty. Search above to add anime!</p>';
        return;
    }
    
    window.currentTopAnimeList.forEach((a, i) => {
        listContainer.innerHTML += `
            <div style="display:flex; align-items:center; justify-content:space-between; background:var(--bg-white); border:1px solid #E0E0E0; border-radius:8px; padding:10px;">
                <div style="display:flex; align-items:center; gap:15px; flex: 1; min-width: 0;">
                    <span style="font-size:16px; font-weight:800; color:var(--accent-yellow); width:20px; flex-shrink: 0;">${i + 1}</span>
                    <img src="${a.image}" style="width:30px; height:40px; border-radius:4px; object-fit:cover; flex-shrink: 0;">
                    <span style="font-size:13px; font-weight:600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${a.title}</span>
                </div>
                <div style="display:flex; gap:5px; flex-shrink: 0;">
                    <button onclick="moveTopAnimeList(${i}, -1)" class="action-btn" style="padding:4px; min-width:unset;" ${i===0?'disabled':''}><span class="material-symbols-outlined" style="font-size:16px;">arrow_upward</span></button>
                    <button onclick="moveTopAnimeList(${i}, 1)" class="action-btn" style="padding:4px; min-width:unset;" ${i===window.currentTopAnimeList.length-1?'disabled':''}><span class="material-symbols-outlined" style="font-size:16px;">arrow_downward</span></button>
                    <button onclick="removeTopAnimeList(${i})" class="action-btn" style="padding:4px; min-width:unset; background:#FFE0E0; color:red; border:none;"><span class="material-symbols-outlined" style="font-size:16px;">delete</span></button>
                </div>
            </div>
        `;
    });
};

window.saveTopAnime = async function() {
    if(!auth.currentUser) return;
    try {
        await setDoc(doc(db, "top_anime_lists", auth.currentUser.uid), { list: window.currentTopAnimeList });
        window.closeAllModals();
        fetchUserProfile(window.targetProfileUid); 
    } catch(e) { alert("Failed to save Top Anime list."); console.error(e); }
};

// --- SUGGESTION SYSTEM ---
window.currentSuggestType = 'feed';

window.toggleSuggestType = function(type, btnElement) {
    window.currentSuggestType = type;
    document.querySelectorAll('#suggest-modal .p-tab').forEach(t => t.classList.remove('active'));
    btnElement.classList.add('active');
    
    document.getElementById('suggest-feed-form').style.display = type === 'feed' ? 'block' : 'none';
    document.getElementById('suggest-friend-form').style.display = type === 'friend' ? 'block' : 'none';
};

window.openSuggestModal = async function() {
    if(!auth.currentUser) return window.openAuthModal();
    window.closeAllModals();
    document.getElementById('suggest-modal').style.display = 'flex';
    
    const select = document.getElementById('suggest-friend-select');
    select.innerHTML = '<option value="">Loading friends...</option>';
    try {
        const q = query(collection(db, "follows"), where("followerUid", "==", auth.currentUser.uid), where("type", "==", "user"));
        const snap = await getDocs(q);
        if(snap.empty) {
            select.innerHTML = '<option value="">You are not following anyone yet.</option>';
        } else {
            select.innerHTML = '<option value="">-- Choose a friend --</option>';
            snap.forEach(d => {
                select.innerHTML += `<option value="${d.data().targetId}">${d.data().username || 'User ID: ' + d.data().targetId.substring(0,8)}</option>`;
            });
        }
    } catch(e) { console.error("Error loading friends:", e); }
};

window.submitSuggestion = async function() {
    if(!auth.currentUser) return;
    const animeTitle = window.currentAnime.title_english || window.currentAnime.title;
    const animeImage = window.currentAnime.images.jpg.image_url;
    
    if(window.currentSuggestType === 'feed') {
        const text = document.getElementById('suggest-feed-text').value.trim();
        if(!text) return alert("Please add a reason for your suggestion!");
        
        await addDoc(collection(db, "reviews"), { 
            mal_id: window.currentAnimeId, animeTitle: animeTitle, animeImage: animeImage, 
            type: 'suggestion', score: null, text: text, username: auth.currentUser.displayName, 
            avatar: auth.currentUser.photoURL, uid: auth.currentUser.uid, timestamp: new Date(), 
            likes: [], dislikes: [], commentCount: 0 
        });
        alert("Posted suggestion to the feed!");
    } else {
        const targetId = document.getElementById('suggest-friend-select').value;
        const text = document.getElementById('suggest-friend-text').value.trim();
        if(!targetId) return alert("Please select a friend!");
        
        await addDoc(collection(db, "direct_suggestions"), {
            senderUid: auth.currentUser.uid, senderName: auth.currentUser.displayName, targetUid: targetId,
            mal_id: window.currentAnimeId, animeTitle: animeTitle, animeImage: animeImage,
            text: text, timestamp: new Date()
        });

        await addDoc(collection(db, "notifications"), {
            targetUid: targetId,
            type: 'suggestion',
            senderUid: auth.currentUser.uid,
            senderName: auth.currentUser.displayName,
            senderAvatar: auth.currentUser.photoURL,
            message: `suggested ${animeTitle} to you!`,
            timestamp: new Date(),
            read: false,
            linkRef: window.currentAnimeId
        });

        alert("Suggestion sent directly to your friend!");
    }
    
    document.getElementById('suggest-feed-text').value = '';
    document.getElementById('suggest-friend-text').value = '';
    window.closeAllModals();
    if(window.currentSuggestType === 'feed') loadAnimeDetails(window.currentAnimeId);
};

// --- Reactions & Toggles ---
window.openEditReviewFromCard = async function(reviewId, malId) {
    if (!auth.currentUser) return;
    document.querySelectorAll('[id^="review-menu-"]').forEach(m => m.style.display = 'none');
    try {
        const d = await getDoc(doc(db, 'reviews', reviewId));
        if (!d.exists()) return;
        const data = d.data();
        // Set all globals the submit functions depend on
        window.currentAnimeId = malId;
        window.existingReviewId = reviewId;
        window.existingReviewData = data;
        window.currentAnime = {
            mal_id: malId,
            title: data.animeTitle || data.title || 'Anime',
            title_english: data.animeTitle || data.title || 'Anime',
            images: { jpg: { image_url: data.animeImage || data.image || '' } }
        };
        window.closeAllModals();
        if (data.type === 'in-depth' || data.categories) {
            window.pendingInDepthData = {
                categories: data.categories || {},
                overallScore: data.score,
                fanService: data.fanService || null
            };
            window.openInDepthModal();
        } else {
            window.openQuickScoreModal();
        }
    } catch(e) { console.error(e); alert('Could not load review: ' + e.message); }
};

window.deleteReview = async function(reviewId, btn) {
    if (!auth.currentUser) return;
    if (!confirm('Delete this review? This cannot be undone.')) return;
    try {
        await deleteDoc(doc(db, "reviews", reviewId));
        const card = btn.closest('.review-card');
        if (card) card.remove();
        const seriesSection = document.getElementById('detail-series-section');
        const seriesList = document.getElementById('detail-series-reviews');
        if (seriesSection && seriesList && seriesList.querySelectorAll('.review-card').length === 0) {
            seriesSection.style.display = 'none';
        }
    } catch(e) { alert('Failed to delete review.'); console.error(e); }
};

window.toggleReviewMenu = function(reviewId) {
    const menu = document.getElementById(`review-menu-${reviewId}`);
    if (!menu) return;
    const isOpen = menu.style.display !== 'none';
    document.querySelectorAll('[id^="review-menu-"]').forEach(m => m.style.display = 'none');
    menu.style.display = isOpen ? 'none' : 'block';
};

document.addEventListener('click', () => {
    document.querySelectorAll('[id^="review-menu-"]').forEach(m => m.style.display = 'none');
});

window.toggleReaction = async function(event, reviewId, type, btn) {
    if(event) { event.preventDefault(); event.stopPropagation(); }
    if(!auth.currentUser) return window.openAuthModal();
    const actionsContainer = btn.closest('.review-actions');
    const likeBtn = actionsContainer.children[1].querySelector('button');
    const likeSpan = actionsContainer.children[1].lastElementChild; 
    const dislikeBtn = actionsContainer.children[2].querySelector('button');
    const dislikeSpan = actionsContainer.children[2].lastElementChild; 
    
    let lCount = parseInt(likeSpan.innerText.replace(/[^\d]/g, '')) || 0;
    let dCount = parseInt(dislikeSpan.innerText.replace(/[^\d]/g, '')) || 0;

    if (type === 'like') {
        if (likeBtn.style.color) { likeBtn.style.color = ''; likeSpan.innerText = Math.max(0, lCount - 1) + " Likes"; }
        else { likeBtn.style.color = 'var(--accent-yellow)'; likeSpan.innerText = (lCount + 1) + " Likes";
            if (dislikeBtn.style.color) { dislikeBtn.style.color = ''; dislikeSpan.innerText = Math.max(0, dCount - 1) + " Dislikes"; } }
    } else {
        if (dislikeBtn.style.color) { dislikeBtn.style.color = ''; dislikeSpan.innerText = Math.max(0, dCount - 1) + " Dislikes"; }
        else { dislikeBtn.style.color = 'red'; dislikeSpan.innerText = (dCount + 1) + " Dislikes";
            if (likeBtn.style.color) { likeBtn.style.color = ''; likeSpan.innerText = Math.max(0, lCount - 1) + " Likes"; } }
    }

    const reviewRef = doc(db, "reviews", reviewId);
    const revSnap = await getDoc(reviewRef);
    if(revSnap.exists()) {
        let likes = revSnap.data().likes || []; let dislikes = revSnap.data().dislikes || [];
        let addedReaction = false;
        if(type === 'like') { if(likes.includes(auth.currentUser.uid)) likes = likes.filter(id => id !== auth.currentUser.uid); else { likes.push(auth.currentUser.uid); dislikes = dislikes.filter(id => id !== auth.currentUser.uid); addedReaction = true; } }
        else { if(dislikes.includes(auth.currentUser.uid)) dislikes = dislikes.filter(id => id !== auth.currentUser.uid); else { dislikes.push(auth.currentUser.uid); likes = likes.filter(id => id !== auth.currentUser.uid); addedReaction = true; } }
        await updateDoc(reviewRef, { likes, dislikes });
        if (addedReaction) {
            setDoc(doc(db, "profiles", auth.currentUser.uid), { reactionCount: increment(1) }, { merge: true }).then(() =>
                getDoc(doc(db, "profiles", auth.currentUser.uid)).then(pd => {
                    window.awardAchievements(window.getEarnedIds('react', pd.exists() ? (pd.data().reactionCount || 1) : 1)).catch(() => {});
                })
            ).catch(() => {});
        }
    }
};

window.deleteInlineComment = async function(commentId, reviewId, isReply = false) {
    if (!auth.currentUser) return;
    if (!confirm('Delete this comment?')) return;
    try {
        await deleteDoc(doc(db, "comments", commentId));
        const el = document.getElementById(`comment-doc-${commentId}`);
        if (el) el.remove();
        if (!isReply) {
            updateDoc(doc(db, "reviews", reviewId), { commentCount: increment(-1) }).catch(() => {});
            const countEl = document.getElementById(`comment-count-${reviewId}`);
            if (countEl) {
                const cur = Math.max(0, parseInt(countEl.innerText) - 1);
                countEl.innerText = cur + (cur === 1 ? ' Comment' : ' Comments');
            }
        }
    } catch(e) { alert('Failed to delete comment.'); }
};

window.editInlineComment = function(commentId) {
    const p = document.getElementById(`comment-text-${commentId}`);
    if (!p) return;
    const original = p.innerText;
    p.outerHTML = `
        <div id="comment-edit-${commentId}">
            <textarea id="comment-edit-input-${commentId}" style="width:100%; padding:6px; border-radius:6px; border:1px solid var(--border-color); font-size:12px; resize:vertical; background:var(--bg-gray); color:var(--text-dark); margin-top:4px;" rows="2">${original}</textarea>
            <div style="display:flex; gap:8px; margin-top:4px;">
                <button onclick="saveInlineComment('${commentId}')" class="action-btn" style="padding:3px 10px; font-size:11px;">Save</button>
                <button onclick="cancelEditComment('${commentId}','${original.replace(/'/g,"\\'")}')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:11px;">Cancel</button>
            </div>
        </div>`;
};

window.cancelEditComment = function(commentId, original) {
    const wrap = document.getElementById(`comment-edit-${commentId}`);
    if (wrap) wrap.outerHTML = `<p id="comment-text-${commentId}" style="font-size:12px; margin-top:2px;">${original}</p>`;
};

window.saveInlineComment = async function(commentId) {
    const input = document.getElementById(`comment-edit-input-${commentId}`);
    if (!input) return;
    const newText = input.value.trim();
    if (!newText) return;
    if (window.checkTextContent(newText)) return alert('Your comment contains language that isn\'t allowed on WeeBee.');
    try {
        await updateDoc(doc(db, "comments", commentId), { text: newText, edited: true });
        const wrap = document.getElementById(`comment-edit-${commentId}`);
        if (wrap) wrap.outerHTML = `<p id="comment-text-${commentId}" style="font-size:12px; margin-top:2px; word-break:break-word;">${newText} <span style="font-size:10px; color:var(--text-muted); font-style:italic;">(edited)</span></p>`;
    } catch(e) { alert('Failed to save edit.'); }
};

window.toggleReplyInput = function(commentId) {
    const el = document.getElementById(`reply-input-${commentId}`);
    if (!el) return;
    const isOpen = el.style.display !== 'none';
    el.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) document.getElementById(`reply-text-${commentId}`)?.focus();
};

window.submitReply = async function(parentCommentId, reviewId) {
    if (!auth.currentUser) return window.openAuthModal();
    const input = document.getElementById(`reply-text-${parentCommentId}`);
    const text = input?.value.trim();
    if (!text) return;
    if (window.checkTextContent(text)) return alert('Your reply contains language that isn\'t allowed on WeeBee.');
    try {
        const newRef = await addDoc(collection(db, "comments"), {
            reviewId, parentCommentId, text,
            username: auth.currentUser.displayName,
            avatar: auth.currentUser.photoURL,
            uid: auth.currentUser.uid,
            timestamp: new Date(), likes: [], dislikes: []
        });
        input.value = '';
        document.getElementById(`reply-input-${parentCommentId}`).style.display = 'none';
        const repliesContainer = document.getElementById(`replies-${parentCommentId}`);
        if (repliesContainer) {
            repliesContainer.insertAdjacentHTML('beforeend', window.buildCommentHTML({
                id: newRef.id, text, username: auth.currentUser.displayName,
                avatar: auth.currentUser.photoURL, uid: auth.currentUser.uid,
                likes: [], dislikes: [], reviewId
            }, reviewId, true));
        }
    } catch(e) { alert('Failed to post reply.'); }
};

window.toggleCommentReaction = async function(event, commentId, type, btnElement) {
    if(event) { event.preventDefault(); event.stopPropagation(); }
    if(!auth.currentUser) return window.openAuthModal();
    const container = btnElement.parentElement;
    const likeBtn = container.children[0]; const likeSpan = likeBtn.querySelector('.c-like-count');
    const dislikeBtn = container.children[1]; const dislikeSpan = dislikeBtn.querySelector('.c-dislike-count');
    let lCount = parseInt(likeSpan.innerText) || 0; let dCount = parseInt(dislikeSpan.innerText) || 0;

    if (type === 'like') {
        if (likeBtn.style.color === 'var(--accent-yellow)') { likeBtn.style.color = 'var(--text-muted)'; likeSpan.innerText = Math.max(0, lCount - 1); }
        else { likeBtn.style.color = 'var(--accent-yellow)'; likeSpan.innerText = lCount + 1;
            if (dislikeBtn.style.color === 'red') { dislikeBtn.style.color = 'var(--text-muted)'; dislikeSpan.innerText = Math.max(0, dCount - 1); } }
    } else {
        if (dislikeBtn.style.color === 'red') { dislikeBtn.style.color = 'var(--text-muted)'; dislikeSpan.innerText = Math.max(0, dCount - 1); }
        else { dislikeBtn.style.color = 'red'; dislikeSpan.innerText = dCount + 1;
            if (likeBtn.style.color === 'var(--accent-yellow)') { likeBtn.style.color = 'var(--text-muted)'; likeSpan.innerText = Math.max(0, lCount - 1); } }
    }
    const commentRef = doc(db, "comments", commentId);
    const snap = await getDoc(commentRef);
    if(snap.exists()) {
        let likes = snap.data().likes || []; let dislikes = snap.data().dislikes || [];
        if(type === 'like') { if(likes.includes(auth.currentUser.uid)) likes = likes.filter(id => id !== auth.currentUser.uid); else { likes.push(auth.currentUser.uid); dislikes = dislikes.filter(id => id !== auth.currentUser.uid); } }
        else { if(dislikes.includes(auth.currentUser.uid)) dislikes = dislikes.filter(id => id !== auth.currentUser.uid); else { dislikes.push(auth.currentUser.uid); likes = likes.filter(id => id !== auth.currentUser.uid); } }
        await updateDoc(commentRef, { likes, dislikes });
    }
};

window.toggleReviewExpand = function(el) {
    const full = el.querySelector('.full-review-content');
    const comms = el.querySelector('.inline-comments');
    if (full && full.style.display === 'none') { full.style.display = 'block'; el.classList.add('expanded'); } 
    else if (full) { full.style.display = 'none'; if(comms && comms.style.display === 'none') el.classList.remove('expanded'); }
};

window.toggleComments = function(event, reviewId, btn) {
    event.stopPropagation();
    // Use relative navigation from the button to avoid duplicate-ID issues across views
    const card = btn ? btn.closest('.review-card') : null;
    const container = card ? card.querySelector('.inline-comments') : document.getElementById(`comments-container-${reviewId}`);
    if (!container) return;
    const parentCard = container.closest('.review-card');
    if (container.style.display === 'none') { container.style.display = 'block'; parentCard?.classList.add('expanded'); fetchInlineComments(reviewId, container); }
    else { container.style.display = 'none'; if(!parentCard?.querySelector('.full-review-content') || parentCard?.querySelector('.full-review-content').style.display === 'none') parentCard?.classList.remove('expanded'); }
};

window.buildCommentHTML = function(c, reviewId, isReply = false) {
    const id = c.id;
    const isOwner = auth.currentUser && c.uid === auth.currentUser.uid;
    const likeStyle = auth.currentUser && c.likes?.includes(auth.currentUser.uid) ? 'color:var(--accent-yellow);' : 'color:var(--text-muted);';
    const dislikeStyle = auth.currentUser && c.dislikes?.includes(auth.currentUser.uid) ? 'color:red;' : 'color:var(--text-muted);';
    const size = isReply ? 24 : 30;
    const ownerBtns = isOwner ? `
        <button onclick="editInlineComment('${id}')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:0;display:flex;align-items:center;" title="Edit"><span class="material-symbols-outlined" style="font-size:13px;">edit</span></button>
        <button onclick="deleteInlineComment('${id}','${reviewId}',${isReply})" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:0;display:flex;align-items:center;" title="Delete"><span class="material-symbols-outlined" style="font-size:13px;">delete</span></button>` : '';
    const replyBtn = !isReply && auth.currentUser ? `<button onclick="toggleReplyInput('${id}')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:11px;display:flex;align-items:center;gap:3px;"><span class="material-symbols-outlined" style="font-size:13px;">reply</span> Reply</button>` : '';
    const replySection = !isReply ? `
        <div id="replies-${id}" style="margin-top:6px;"></div>
        <div id="reply-input-${id}" style="display:none; margin-top:6px;">
            <div style="display:flex; gap:6px;">
                <input type="text" id="reply-text-${id}" placeholder="Write a reply..." maxlength="500" style="flex:1; padding:6px 10px; border-radius:8px; border:1px solid var(--border-color); font-size:12px; background:var(--bg-gray); color:var(--text-dark);" onkeydown="if(event.key==='Enter') submitReply('${id}','${reviewId}')">
                <button onclick="submitReply('${id}','${reviewId}')" class="action-btn" style="padding:4px 10px; font-size:11px;">Reply</button>
                <button onclick="toggleReplyInput('${id}')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:11px;">Cancel</button>
            </div>
        </div>` : '';
    return `
        <div id="comment-doc-${id}" style="display:flex; gap:8px; margin-bottom:8px; background:var(--bg-white); padding:10px; border-radius:8px; border:1px solid var(--border-color);">
            <img src="${c.avatar}" style="width:${size}px; height:${size}px; border-radius:50%; object-fit:cover; cursor:pointer; flex-shrink:0;" onclick="viewUserProfile('${c.uid}')">
            <div style="flex:1; min-width:0;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
                    <strong style="font-size:12px; cursor:pointer;" onclick="viewUserProfile('${c.uid}')">${c.username}</strong>
                    <div style="display:flex; gap:4px;">${ownerBtns}</div>
                </div>
                <p id="comment-text-${id}" style="font-size:12px; margin-top:2px; word-break:break-word;">${c.text}${c.edited ? ' <span style="font-size:10px; color:var(--text-muted); font-style:italic;">(edited)</span>' : ''}</p>
                <div style="display:flex; gap:12px; margin-top:5px; font-size:11px; align-items:center;">
                    <div style="display:flex; align-items:center; gap:3px; cursor:pointer; ${likeStyle}" onclick="toggleCommentReaction(event,'${id}','like',this)"><span class="material-symbols-outlined" style="font-size:13px;">thumb_up</span><span class="c-like-count">${c.likes?.length || 0}</span></div>
                    <div style="display:flex; align-items:center; gap:3px; cursor:pointer; ${dislikeStyle}" onclick="toggleCommentReaction(event,'${id}','dislike',this)"><span class="material-symbols-outlined" style="font-size:13px;">thumb_down</span><span class="c-dislike-count">${c.dislikes?.length || 0}</span></div>
                    ${replyBtn}
                </div>
                ${replySection}
            </div>
        </div>`;
};

window.fetchInlineComments = async function(reviewId, container) {
    const list = container ? container.querySelector(`#comments-list-${reviewId}`) : document.getElementById(`comments-list-${reviewId}`);
    list.innerHTML = '<div class="loading" style="font-size:12px;">Loading...</div>';
    const snap = await getDocs(query(collection(db, "comments"), where("reviewId", "==", reviewId)));
    let all = [];
    snap.forEach(d => { all.push({ ...d.data(), id: d.id }); });
    all.sort((a, b) => (a.timestamp?.toMillis?.() || 0) - (b.timestamp?.toMillis?.() || 0));

    const topLevel = all.filter(c => !c.parentCommentId);
    const repliesMap = {};
    all.filter(c => c.parentCommentId).forEach(c => {
        if (!repliesMap[c.parentCommentId]) repliesMap[c.parentCommentId] = [];
        repliesMap[c.parentCommentId].push(c);
    });

    const countEl = document.getElementById(`comment-count-${reviewId}`);
    if (countEl) countEl.innerText = topLevel.length + (topLevel.length === 1 ? ' Comment' : ' Comments');

    if (topLevel.length === 0) { list.innerHTML = '<p style="text-align:center; font-size:12px; color:var(--text-muted);">No comments yet.</p>'; return; }

    list.innerHTML = topLevel.map(c => {
        const html = window.buildCommentHTML(c, reviewId, false);
        const replies = (repliesMap[c.id] || []).map(r => window.buildCommentHTML(r, reviewId, true)).join('');
        return html.replace(`<div id="replies-${c.id}" style="margin-top:6px;"></div>`,
            `<div id="replies-${c.id}" style="margin-top:6px; padding-left:12px; border-left:2px solid var(--border-color);">${replies}</div>`);
    }).join('');
};

window.submitInlineComment = async function(reviewId, btn) {
    if(!auth.currentUser) return window.openAuthModal();
    const card = btn ? btn.closest('.review-card') : null;
    const input = card ? card.querySelector('.review-inline-input') : document.getElementById(`comment-input-${reviewId}`);
    if(!input.value.trim()) return;
    if (window.checkTextContent(input.value)) return alert('Your comment contains language that isn\'t allowed on WeeBee.');
    await addDoc(collection(db, "comments"), { reviewId, text: input.value.trim(), username: auth.currentUser.displayName, avatar: auth.currentUser.photoURL, uid: auth.currentUser.uid, timestamp: new Date(), likes: [], dislikes: [] });
    updateDoc(doc(db, "reviews", reviewId), { commentCount: increment(1) }).catch(() => {});
    const countEl = document.getElementById(`comment-count-${reviewId}`);
    if (countEl) countEl.innerText = (parseInt(countEl.innerText) + 1) + ' Comments';
    const container = card ? card.querySelector('.inline-comments') : null;
    input.value = ''; fetchInlineComments(reviewId, container);
};

window.generateReviewCardHTML = function(rev, isGlobal = false) {
    if(isGlobal) { 
        return `<div class="review-card"><div class="review-header"><img src="${rev.user.images.jpg.image_url}" class="avatar"><div><strong>${rev.user.username}</strong> <span class="source-badge badge-global">Global</span></div></div><div class="rating-badge blue">${rev.score}</div><p class="review-text" style="-webkit-line-clamp: 3; line-clamp: 3; display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden;">${rev.review}</p></div>`; 
    }
    
    let innerContent = '';
    const safeUid = rev.uid;

    if(rev.type === 'suggestion') {
        innerContent = `
            <img src="${rev.animeImage}" class="review-anime-thumb" alt="Cover" onclick="event.stopPropagation(); loadAnimeDetails(${rev.mal_id})">
            <span class="review-anime-hint">View Anime →</span>
            <div class="review-header" style="justify-content: space-between; position: relative; z-index: 3;">
                <div style="display:flex; gap: 15px;">
                    <img src="${rev.avatar}" class="avatar clickable-user" onclick="event.stopPropagation(); viewUserProfile('${safeUid}')">
                    <div>
                        <strong class="clickable-user" onclick="event.stopPropagation(); viewUserProfile('${safeUid}')">${rev.username}</strong> ${window.getFounderBadgeHTML(safeUid)} ${window.getRankBadgeHTML(window.userRankCache[safeUid] || 0, 14)}
                        <span class="source-badge" style="background: #4CAF50; color: white; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; text-transform: uppercase;">Suggestion</span><br>
                        <span style="font-size: 12px; color: var(--text-muted);">Suggested: <strong style="cursor:pointer; color:var(--text-dark);" onclick="event.stopPropagation(); loadAnimeDetails(${rev.mal_id})">${rev.animeTitle}</strong> · ${formatTimeAgo(rev.timestamp)}</span>
                    </div>
                </div>
                ${window.getFollowBtnHTML(safeUid)}
            </div>
            <div style="padding-right: 170px; position: relative; z-index: 2;">
                <p class="review-text" style="margin-top: 20px; font-style: italic; font-size: 15px; color: var(--text-dark); border-left: 3px solid #4CAF50; padding-left: 15px; background: var(--bg-white); border-radius: 0 8px 8px 0; padding-top: 10px; padding-bottom: 10px;">"${rev.text || 'You should definitely check this out!'}"</p>
            </div>
        `;
    } 
    else {
        const overallScore = parseFloat(rev.score).toFixed(1); const overallTier = window.getScoreTier(overallScore);
        let badgesHTML = '';
        let fullHTML = '';

        if(rev.type === 'in-depth' && rev.categories) {
            badgesHTML = `<div class="review-badges-row" style="display:flex; gap: 15px; margin-top: 20px; flex-wrap: nowrap; overflow-x: auto; align-items: flex-end; padding-right: 195px; position: relative; z-index: 2; padding-bottom: 4px;">
                <div style="display:flex; flex-direction:column; align-items:center; width: 75px;">
                    <span style="font-size: 10px; font-weight: 800; color: var(--text-dark); text-transform: uppercase; margin-bottom: 8px; height: 24px; display: flex; align-items: flex-end;">Overall</span>
                    <div class="rating-badge ${overallTier}" style="width: 65px; height: 65px; font-size: 22px; filter: drop-shadow(0 3px 8px rgba(0,0,0,0.2)); outline: 3px solid rgba(255,255,255,0.3);">${overallScore}</div>
                </div>
                <div style="width: 1px; height: 55px; background: var(--border-color); margin: 0 10px; align-self: flex-end; margin-bottom: 5px;"></div>`;
            rev.categories.filter(cat => cat.score).forEach(cat => {
                badgesHTML += `<div style="display:flex; flex-direction:column; align-items:center; width: 75px;"><span style="font-size: 10px; font-weight: 600; margin-bottom: 8px; text-align: center; height: 24px; display: flex; align-items: flex-end;">${cat.label}</span><div class="rating-badge ${window.getScoreTier(cat.score)}" style="width: 55px; height: 55px; font-size: 18px;">${cat.score}</div></div>`;
            });
            badgesHTML += `</div>`;

            fullHTML = `<div class="full-review-content" style="display:none; margin-top: 25px; padding-right: 170px; position: relative; z-index: 2;">`;
            rev.categories.filter(cat => cat.score).forEach(cat => {
                fullHTML += `<div style="background: var(--bg-white); padding: 12px; border-radius: 10px; border: 1px solid #E0E0E0; margin-bottom: 10px;"><div style="display: flex; justify-content: space-between; align-items: center;"><strong>${cat.label}</strong><div class="rating-badge ${window.getScoreTier(cat.score)}" style="width: 32px; height: 32px; font-size: 11px;">${cat.score}</div></div>${cat.text ? `<p style="font-size: 13px; margin-top: 8px; border-top: 1px solid #F0F0F0; padding-top: 8px;">${cat.text}</p>` : ''}</div>`;
            });
            fullHTML += `</div>`;
        } else {
            badgesHTML = `
                <div class="review-badges-row" style="display:flex; padding-right: 170px; margin-top: 15px; position: relative; z-index: 2;">
                    <div style="display:flex; flex-direction:column; align-items:center; width: 75px;">
                        <span style="font-size: 10px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px;">Overall</span>
                        <div class="rating-badge ${overallTier}" style="width: 55px; height: 55px; font-size: 18px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));">${overallScore}</div>
                    </div>
                </div>`;
            fullHTML = `
                <div style="padding-right: 170px; position: relative; z-index: 2;">
                    <p class="review-text" style="margin-top: 20px; font-size: 15px; color: var(--text-dark);">"${rev.text || ''}"</p>
                </div>`;
        }

        innerContent = `
            <img src="${rev.animeImage}" class="review-anime-thumb" alt="Cover" onclick="event.stopPropagation(); loadAnimeDetails(${rev.mal_id})">
            <span class="review-anime-hint">View Anime →</span>
            <div class="review-header" style="justify-content: space-between; position: relative; z-index: 3;">
                <div style="display:flex; gap: 15px;">
                    <img src="${rev.avatar}" class="avatar clickable-user" onclick="event.stopPropagation(); viewUserProfile('${safeUid}')">
                    <div><strong><span class="clickable-user" style="color:var(--text-dark);" onclick="event.stopPropagation(); viewUserProfile('${safeUid}')">${rev.username}</span></strong> ${window.getFounderBadgeHTML(safeUid)} ${window.getRankBadgeHTML(window.userRankCache[safeUid] || 0, 14)} ${window.getPinnedBadgesHTML(safeUid)}<br>
                    <span style="font-size: 12px; color: var(--text-muted); display:flex; align-items:center; gap:6px; margin-top:3px; min-width:0;">${rev.animeImage ? `<img src="${rev.animeImage}" class="review-cover-mobile" onclick="event.stopPropagation(); loadAnimeDetails(${rev.mal_id})">` : ''}${rev.type === 'series'
                        ? `<span style="background:var(--accent-yellow); color:#111; font-size:10px; font-weight:800; padding:2px 7px; border-radius:4px; text-transform:uppercase; letter-spacing:0.5px;">Series Rating</span>`
                        : `Season Review: <strong class="review-anime-title" style="cursor:pointer; color:var(--text-dark);" onclick="event.stopPropagation(); loadAnimeDetails(${rev.mal_id})">${rev.animeTitle}</strong>`
                    } <span style="color:var(--text-muted); flex-shrink:0;">· ${formatTimeAgo(rev.timestamp)}</span></span></div>
                </div>
                ${window.getFollowBtnHTML(safeUid)}
            </div>
            ${badgesHTML}
            ${fullHTML}
        `;
    }

    const isOwner = auth.currentUser && rev.uid === auth.currentUser.uid;
    return `
        <div class="review-card weebee-review interactive review-item" onclick="${rev.type === 'in-depth' ? 'toggleReviewExpand(this)' : ''}">
            ${isOwner ? `
            <div style="position:absolute; top:10px; right:10px; z-index:5;" onclick="event.stopPropagation();">
                <button onclick="window.toggleReviewMenu('${rev.id}')" style="background:rgba(0,0,0,0.35); border:none; border-radius:50%; width:28px; height:28px; cursor:pointer; display:flex; align-items:center; justify-content:center; color:white;">
                    <span class="material-symbols-outlined" style="font-size:16px;">more_vert</span>
                </button>
                <div id="review-menu-${rev.id}" style="display:none; position:absolute; top:32px; right:0; background:var(--bg-white); border:1px solid var(--border-color); border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15); min-width:140px; overflow:hidden; z-index:10;">
                    <button onclick="event.stopPropagation(); window.openEditReviewFromCard('${rev.id}', ${rev.mal_id})" style="width:100%; padding:10px 14px; background:none; border:none; text-align:left; cursor:pointer; color:var(--text-dark); font-size:13px; display:flex; align-items:center; gap:8px;">
                        <span class="material-symbols-outlined" style="font-size:16px;">edit</span> Edit Review
                    </button>
                    <div style="height:1px; background:var(--border-color);"></div>
                    <button onclick="event.stopPropagation(); deleteReview('${rev.id}', this)" style="width:100%; padding:10px 14px; background:none; border:none; text-align:left; cursor:pointer; color:#FF5252; font-size:13px; display:flex; align-items:center; gap:8px;">
                        <span class="material-symbols-outlined" style="font-size:16px;">delete</span> Delete
                    </button>
                </div>
            </div>` : ''}
            ${innerContent}
            <div class="review-actions">
                <div class="action-stat"><button onclick="window.toggleComments(event, '${rev.id}', this)"><span class="material-symbols-outlined">chat_bubble</span></button><span class="action-label" id="comment-count-${rev.id}">${rev.commentCount || 0} Comments</span></div>
                <div class="action-stat"><button onclick="window.toggleReaction(event, '${rev.id}', 'like', this)" style="${auth.currentUser && rev.likes?.includes(auth.currentUser.uid) ? 'color:var(--accent-yellow);' : ''}"><span class="material-symbols-outlined">thumb_up</span></button><span class="action-label">${rev.likes?.length || 0} Likes</span></div>
                <div class="action-stat"><button onclick="window.toggleReaction(event, '${rev.id}', 'dislike', this)" style="${auth.currentUser && rev.dislikes?.includes(auth.currentUser.uid) ? 'color:red;' : ''}"><span class="material-symbols-outlined">thumb_down</span></button><span class="action-label">${rev.dislikes?.length || 0} Dislikes</span></div>
            </div>
            ${rev.type === 'in-depth' ? '<div class="expand-hint-row"><span class="expand-hint"><span class="material-symbols-outlined" style="font-size:11px; vertical-align:middle;">expand_more</span> Click to expand</span></div>' : ''}
            <div id="comments-container-${rev.id}" class="inline-comments" style="display:none; margin-top: 15px; padding-top: 15px; position: relative; z-index: 2;" onclick="event.stopPropagation();">
                <div id="comments-list-${rev.id}"></div>
                <div style="display:flex; gap:10px; margin-top:10px;">
                    <input type="text" class="review-inline-input" placeholder="Add a comment..." style="flex:1; padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); background:var(--bg-gray); color:var(--text-dark);" onkeydown="if(event.key==='Enter'){event.preventDefault();this.nextElementSibling.click();}">
                    <button class="action-btn" onclick="window.submitInlineComment('${rev.id}', this)">Send</button>
                </div>
            </div>
        </div>`;
};

// --- DYNAMIC PROFILE HUB VIEW ---
window.viewUserProfile = function(uid, skipUrlUpdate = false) {
    if(!uid) return;
    window.targetProfileUid = uid;
    switchView('profile-view');
    if (!skipUrlUpdate) history.replaceState({}, '', `?profile=${uid}`);
};

const EDIT_GENRES = ['Action','Adventure','Comedy','Drama','Fantasy','Horror','Mystery','Romance','Sci-Fi','Slice of Life','Sports','Supernatural','Thriller','Mecha'];
const BANNER_PRESETS = [
    { label: 'Dark',     value: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)' },
    { label: 'WeeBee',   value: 'linear-gradient(135deg, #1a1a1a 0%, #b8860b 100%)' },
    { label: 'Midnight', value: 'linear-gradient(135deg, #0f0c29, #302b63)' },
    { label: 'Sunset',   value: 'linear-gradient(135deg, #f12711, #f5af19)' },
    { label: 'Forest',   value: 'linear-gradient(135deg, #134E5E, #71B280)' },
    { label: 'Purple',   value: 'linear-gradient(135deg, #8E2DE2, #4A00E0)' },
    { label: 'Ocean',    value: 'linear-gradient(135deg, #1CB5E0, #000046)' },
    { label: 'Pink',     value: 'linear-gradient(135deg, #f953c6, #b91d73)' },
    { label: 'Sakura',   value: 'linear-gradient(135deg, #ffb7c5, #d4548a)' },
];

window.toggleGenreChip = function(el) {
    const selected = document.querySelectorAll('#edit-genre-chips .genre-chip.active');
    if (el.classList.contains('active')) { el.classList.remove('active'); }
    else if (selected.length < 3) { el.classList.add('active'); }
};

async function compressAvatar(file, size = 400, quality = 0.82) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = size; canvas.height = size;
                const ctx = canvas.getContext('2d');
                const shortest = Math.min(img.width, img.height);
                const sx = (img.width - shortest) / 2;
                const sy = (img.height - shortest) / 2;
                ctx.drawImage(img, sx, sy, shortest, shortest, 0, 0, size, size);
                canvas.toBlob(resolve, 'image/jpeg', quality);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function compressBanner(file, maxWidth = 2400, quality = 0.92) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, maxWidth / img.width);
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(resolve, 'image/jpeg', quality);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

window.previewBannerUpload = function(input) {
    if (!input.files[0]) return;
    if (input.files[0].size > 10 * 1024 * 1024) { alert('Please choose an image under 10MB.'); input.value = ''; return; }
    const reader = new FileReader();
    reader.onload = (e) => {
        const prev = document.getElementById('edit-banner-preview');
        if (prev) { prev.style.backgroundImage = `url(${e.target.result})`; prev.style.backgroundColor = ''; }
        document.getElementById('edit-profile-banner').value = '';
        window.selectedBannerPreset = '';
        document.querySelectorAll('#banner-presets div').forEach(d => d.style.borderColor = 'transparent');
    };
    reader.readAsDataURL(input.files[0]);
};

window.previewBannerFromUrl = function(url) {
    const prev = document.getElementById('edit-banner-preview');
    if (!prev) return;
    if (url) { prev.style.backgroundImage = `url(${url})`; prev.style.backgroundColor = ''; }
    else { prev.style.backgroundImage = ''; prev.style.backgroundColor = 'var(--bg-gray-darker)'; }
};

window.previewAvatarUpload = function(input) {
    if (!input.files[0]) return;
    if (input.files[0].size > 10 * 1024 * 1024) {
        alert('Please choose an image under 10MB.');
        input.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('edit-avatar-preview').src = e.target.result;
        document.getElementById('edit-profile-avatar').value = '';
    };
    reader.readAsDataURL(input.files[0]);
};

window.openEditProfileModal = async function() {
    if (!auth.currentUser) return;
    const profileDoc = await getDoc(doc(db, "profiles", auth.currentUser.uid));
    const pd = profileDoc.exists() ? profileDoc.data() : {};
    const currentName = pd.displayName || auth.currentUser.displayName || '';
    const currentBio = pd.bio || '';
    const currentAvatar = pd.avatar || auth.currentUser.photoURL || '';
    const currentGenres = pd.genres || [];
    const currentBanner = pd.bannerUrl || '';

    document.getElementById('edit-profile-name').value = currentName;
    document.getElementById('edit-profile-bio').value = currentBio;
    document.getElementById('edit-profile-avatar').value = currentAvatar;
    document.getElementById('edit-profile-error').innerText = '';
    document.getElementById('edit-avatar-preview').src = currentAvatar || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(currentName)}&backgroundColor=ffc107&fontColor=333333`;
    document.getElementById('avatar-file-input').value = '';
    document.getElementById('banner-file-input').value = '';
    const bannerPrev = document.getElementById('edit-banner-preview');
    if (bannerPrev) {
        if (currentBanner.startsWith('url(')) { bannerPrev.style.backgroundImage = currentBanner; bannerPrev.style.background = ''; }
        else if (currentBanner) { bannerPrev.style.backgroundImage = ''; bannerPrev.style.background = currentBanner; }
        else { bannerPrev.style.backgroundImage = ''; bannerPrev.style.backgroundColor = 'var(--bg-gray-darker)'; }
    }

    const chipsContainer = document.getElementById('edit-genre-chips');
    chipsContainer.innerHTML = EDIT_GENRES.map(g =>
        `<button type="button" class="genre-chip ${currentGenres.includes(g) ? 'active' : ''}" onclick="toggleGenreChip(this)">${g}</button>`
    ).join('');
    window.selectedBannerPreset = BANNER_PRESETS.some(p => p.value === currentBanner) ? currentBanner : '';
    const bannerUrlInput = document.getElementById('edit-profile-banner');
    if (bannerUrlInput) {
        bannerUrlInput.value = currentBanner.startsWith('url(') ? currentBanner.slice(4, -1) : '';
    }
    const presetsEl = document.getElementById('banner-presets');
    if (presetsEl) {
        presetsEl.innerHTML = BANNER_PRESETS.map(p =>
            `<div onclick="selectBannerPreset(this, '${p.value}')" title="${p.label}" style="width:56px; height:34px; border-radius:6px; cursor:pointer; background:${p.value}; border:3px solid ${currentBanner === p.value ? 'var(--accent-yellow)' : 'transparent'}; flex-shrink:0; transition:border-color 0.15s;"></div>`
        ).join('');
    }

    document.getElementById('edit-profile-modal').style.display = 'flex';

    // Load badge picker
    const pickerEl = document.getElementById('edit-badge-picker');
    if (pickerEl && auth.currentUser) {
        try {
            const achDoc = await getDoc(doc(db, 'achievements', auth.currentUser.uid));
            const earned = achDoc.exists() ? achDoc.data() : {};
            const currentPins = pd.pinnedBadges || [];
            window._editPinnedBadges = [...currentPins];
            const earnedAchs = ACHIEVEMENTS.filter(a => earned[a.id]);
            if (!earnedAchs.length) {
                pickerEl.innerHTML = '<span style="font-size:13px;color:var(--text-muted);">Earn achievements to showcase them here!</span>';
            } else {
                pickerEl.innerHTML = earnedAchs.map(a => {
                    const isPinned = currentPins.includes(a.id);
                    return `<div onclick="window.togglePinnedBadge('${a.id}',this)" id="badge-pick-${a.id}" style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:20px;border:2px solid ${isPinned ? a.color : 'var(--border-color)'};background:${isPinned ? 'rgba('+hexToRgb(a.color)+',0.1)' : 'var(--bg-gray)'};cursor:pointer;transition:all 0.15s;">
                        <span class="material-symbols-outlined" style="font-size:16px;color:${a.color};">${a.icon}</span>
                        <span style="font-size:12px;font-weight:600;color:var(--text-dark);">${a.name}</span>
                    </div>`;
                }).join('');
            }
        } catch(e) { pickerEl.innerHTML = '<span style="font-size:13px;color:var(--text-muted);">Could not load achievements.</span>'; }
    }
};

function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `${r},${g},${b}`;
}

window.togglePinnedBadge = function(id, el) {
    const pins = window._editPinnedBadges || [];
    const ach = ACHIEVEMENTS.find(a => a.id === id);
    if (!ach) return;
    const idx = pins.indexOf(id);
    if (idx !== -1) {
        pins.splice(idx, 1);
        el.style.borderColor = 'var(--border-color)';
        el.style.background = 'var(--bg-gray)';
    } else {
        if (pins.length >= 3) { alert('You can only pin 3 badges. Remove one first.'); return; }
        pins.push(id);
        el.style.borderColor = ach.color;
        el.style.background = `rgba(${hexToRgb(ach.color)},0.1)`;
    }
    window._editPinnedBadges = pins;
};

window.selectBannerPreset = function(el, value) {
    window.selectedBannerPreset = value;
    document.getElementById('edit-profile-banner').value = '';
    document.getElementById('banner-file-input').value = '';
    document.querySelectorAll('#banner-presets div').forEach(d => d.style.borderColor = 'transparent');
    el.style.borderColor = 'var(--accent-yellow)';
    const prev = document.getElementById('edit-banner-preview');
    if (prev) { prev.style.backgroundImage = ''; prev.style.background = value; }
};

window.saveEditProfile = async function() {
    if (!auth.currentUser) return;
    const newName = document.getElementById('edit-profile-name').value.trim();
    const bio = document.getElementById('edit-profile-bio').value.trim();
    const genres = [...document.querySelectorAll('#edit-genre-chips .genre-chip.active')].map(el => el.innerText);
    const fileInput = document.getElementById('avatar-file-input');
    let avatar = document.getElementById('edit-profile-avatar').value.trim();
    const errEl = document.getElementById('edit-profile-error');

    if (!newName) return errEl.innerText = 'Display name cannot be empty.';
    if (window.checkTextContent(newName, bio)) return errEl.innerText = 'Your profile contains language that isn\'t allowed on WeeBee.';
    if (newName.length < 2) return errEl.innerText = 'Display name must be at least 2 characters.';

    const uid = auth.currentUser.uid;
    const oldName = (await getDoc(doc(db, "profiles", uid))).data()?.displayName || auth.currentUser.displayName || '';
    const oldNorm = oldName.trim().toLowerCase().replace(/\s+/g, ' ');
    const newNorm = newName.toLowerCase().replace(/\s+/g, ' ');
    const saveBtn = document.getElementById('edit-profile-save-btn');
    saveBtn.disabled = true; saveBtn.innerText = 'Saving...';

    try {
        // Upload avatar if one was selected
        if (fileInput.files[0]) {
            saveBtn.innerText = 'Uploading avatar...';
            const compressed = await compressAvatar(fileInput.files[0]);
            const sRef = storageRef(storage, `avatars/${uid}/profile.jpg`);
            await uploadBytes(sRef, compressed);
            avatar = await getDownloadURL(sRef);
        }

        // Upload banner if one was selected
        const bannerFileInput = document.getElementById('banner-file-input');
        let uploadedBannerUrl = null;
        if (bannerFileInput?.files[0]) {
            saveBtn.innerText = 'Uploading banner...';
            const compressed = await compressBanner(bannerFileInput.files[0]);
            const sRef = storageRef(storage, `banners/${uid}/banner.jpg`);
            await uploadBytes(sRef, compressed);
            uploadedBannerUrl = `url(${await getDownloadURL(sRef)})`;
        }

        if (newNorm !== oldNorm) {
            const taken = await getDoc(doc(db, "usernames", newNorm));
            if (taken.exists() && taken.data().uid !== uid) {
                errEl.innerText = 'That display name is already taken.';
                saveBtn.disabled = false; saveBtn.innerText = 'Save';
                return;
            }
            await runTransaction(db, async (t) => {
                t.delete(doc(db, "usernames", oldNorm));
                t.set(doc(db, "usernames", newNorm), { uid });
            });
            await updateProfile(auth.currentUser, { displayName: newName, photoURL: avatar || auth.currentUser.photoURL });
        } else if (avatar !== auth.currentUser.photoURL) {
            await updateProfile(auth.currentUser, { photoURL: avatar });
        }

        const bannerInput = document.getElementById('edit-profile-banner')?.value.trim();
        const bannerUrl = uploadedBannerUrl || window.selectedBannerPreset || (bannerInput ? `url(${bannerInput})` : '');
        const pinnedBadges = window._editPinnedBadges || [];
        await setDoc(doc(db, "profiles", uid), { displayName: newName, displayNameLower: newName.toLowerCase(), bio, avatar: avatar || auth.currentUser.photoURL, genres, bannerUrl, pinnedBadges }, { merge: true });
        window.userPinnedBadgesCache[uid] = pinnedBadges;

        window.closeAllModals();
        fetchUserProfile(uid);
    } catch(e) {
        errEl.innerText = 'Failed to save. Please try again.';
        console.error(e);
    } finally {
        saveBtn.disabled = false; saveBtn.innerText = 'Save';
    }
};

window.switchProfileTab = function(event, tabId) {
    document.querySelectorAll('.profile-main-feed .p-tab-content').forEach(c => c.style.display = 'none');
    document.querySelectorAll('.profile-main-feed .p-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(tabId).style.display = 'block';
    event.currentTarget.classList.add('active');
    if (tabId === 'p-achievements') window.loadProfileAchievements(window.currentProfileUid);
    if (tabId === 'p-friends') window.loadFriendsTab(window.currentProfileUid);
    if (tabId === 'p-tierlists') window.loadTierListsTab(window.currentProfileUid);
    if (tabId === 'p-followers') window.loadFollowersTab(window.currentProfileUid);
};

window.fetchUserProfile = async function(targetUid = null) {
    const isMe = !targetUid || (auth.currentUser && targetUid === auth.currentUser.uid);
    const uidToFetch = isMe ? auth.currentUser?.uid : targetUid;
    if(!uidToFetch) return window.openAuthModal();
    window.currentProfileUid = uidToFetch;
    
    document.getElementById('profile-header-container').innerHTML = '<div class="loading">Loading Profile...</div>';
    
    let pName = 'WeeBee User';
    let pAvatar = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent('WeeBee User')}&backgroundColor=ffc107&fontColor=333333`;
    let pJoined = new Date().toLocaleDateString();
    let pBio = ''; let pGenres = [];

    // Fetch profile doc (bio, genres, custom avatar/name) alongside auth data
    const profileDoc = await getDoc(doc(db, "profiles", uidToFetch));
    const profileData = profileDoc.exists() ? profileDoc.data() : {};

    if(isMe && auth.currentUser) {
        pName = profileData.displayName || auth.currentUser.displayName;
        pAvatar = profileData.avatar || auth.currentUser.photoURL || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(pName)}&backgroundColor=ffc107&fontColor=333333`;
        pJoined = new Date(auth.currentUser.metadata.creationTime).toLocaleDateString();
    } else {
        pName = profileData.displayName || pName;
        pAvatar = profileData.avatar || pAvatar;
    }
    pBio = profileData.bio || '';
    pGenres = profileData.genres || [];
    window.userPinnedBadgesCache[uidToFetch] = profileData.pinnedBadges || [];

    window.currentProfileName = pName;
    document.getElementById('top-anime-title').innerText = `${pName}'s Top Anime`;

    const isFollowing = window.myFollowedUserIds?.has(uidToFetch);
    const notifyOn = window.myFollowNotifyMap?.get(uidToFetch) !== false;
    const pendingInReqId = window.myPendingInIds?.get(uidToFetch);
    const friendBtnInner = auth.currentUser
        ? window.myFriendIds.has(uidToFetch)
            ? `<button onclick="removeFriend('${uidToFetch}', this)" class="action-btn" style="background:var(--bg-gray-darker); color:var(--text-dark);"><span class="material-symbols-outlined">people</span> Friends</button>`
            : window.myPendingOutIds.has(uidToFetch)
            ? `<button class="action-btn" style="background:var(--bg-gray-darker); color:var(--text-muted);" disabled><span class="material-symbols-outlined">schedule</span> Pending</button>`
            : pendingInReqId
            ? `<button onclick="acceptFriendRequest('${uidToFetch}','${pendingInReqId}',null,this)" class="action-btn" style="background:#4CAF50; color:white;"><span class="material-symbols-outlined">check</span> Accept</button>
               <button onclick="declineFriendRequest('${uidToFetch}','${pendingInReqId}',null,this)" class="action-btn" style="background:var(--bg-gray-darker); color:var(--text-dark);"><span class="material-symbols-outlined">close</span> Decline</button>`
            : `<button onclick="sendFriendRequest('${uidToFetch}', this)" class="action-btn"><span class="material-symbols-outlined">person_add</span> Add Friend</button>`
        : '';
    const editBtnHtml = isMe
        ? `<button class="action-btn" onclick="openEditProfileModal()" style="background:var(--bg-gray-darker); color:var(--text-dark);"><span class="material-symbols-outlined">edit</span> Edit Profile</button>`
        : `<div style="display:flex;gap:8px;flex-shrink:0; flex-wrap:wrap;">
               <button onclick="openDMConversation('${uidToFetch}','${pName.replace(/'/g,"\\'")}','${pAvatar}')" class="action-btn" style="padding:8px; min-width:unset; background:var(--bg-gray-darker); color:var(--text-dark);" title="Message"><span class="material-symbols-outlined">chat_bubble</span></button>
               <button id="profile-notify-btn" onclick="toggleReviewNotify('${uidToFetch}', this)" class="action-btn" title="${notifyOn ? 'Review notifications on' : 'Review notifications off'}" style="padding:8px; min-width:unset; background:var(--bg-gray-darker); color:var(--text-dark); display:${isFollowing ? 'inline-flex' : 'none'};"><span class="material-symbols-outlined" style="font-size:20px;">${notifyOn && isFollowing ? 'notifications_active' : 'notifications_off'}</span></button>
               <span id="profile-friend-btns">${friendBtnInner}</span>
               <button onclick="toggleFollow('${uidToFetch}', 'user', this)" class="action-btn" style="${isFollowing ? 'background:var(--bg-gray-darker);color:var(--text-dark);' : ''}"><span class="material-symbols-outlined">${isFollowing ? 'check' : 'person_add'}</span> ${isFollowing ? 'Following' : 'Follow User'}</button>
           </div>`;

    const genreChipsHTML = pGenres.length
        ? `<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:10px;">${pGenres.map(g => `<span class="genre-chip active" style="pointer-events:none;">${g}</span>`).join('')}</div>`
        : '';
    const pBanner = profileData.bannerUrl || 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)';
    const bannerStyle = pBanner.startsWith('url(') ? `background-image:${pBanner}` : `background:${pBanner}`;

    const pinnedBannerBadges = (() => {
        const pins = profileData.pinnedBadges || [];
        if (!pins.length) return '';
        return '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">' + pins.map(id => {
            const ach = ACHIEVEMENTS.find(a => a.id === id);
            if (!ach) return '';
            return `<div style="display:flex;align-items:center;gap:4px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.25);border-radius:20px;padding:3px 9px;">
                <span class="material-symbols-outlined" style="font-size:13px;color:${ach.color};">${ach.icon}</span>
                <span style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.9);">${ach.name}</span>
            </div>`;
        }).join('') + '</div>';
    })();

    const topBtns = isMe
        ? `<button class="action-btn" onclick="openEditProfileModal()" style="position:absolute;top:14px;right:14px;z-index:5;background:rgba(0,0,0,0.45);color:white;border:1px solid rgba(255,255,255,0.3);backdrop-filter:blur(6px);"><span class="material-symbols-outlined">edit</span> Edit Profile</button>`
        : `<div style="position:absolute;top:14px;right:14px;z-index:5;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
               <button onclick="openDMConversation('${uidToFetch}','${pName.replace(/'/g,"\\'")}','${pAvatar}')" class="action-btn" style="padding:8px;min-width:unset;background:rgba(0,0,0,0.45);color:white;border:1px solid rgba(255,255,255,0.3);backdrop-filter:blur(6px);" title="Message"><span class="material-symbols-outlined">chat_bubble</span></button>
               <button id="profile-notify-btn" onclick="toggleReviewNotify('${uidToFetch}', this)" class="action-btn" title="${notifyOn ? 'Review notifications on' : 'Review notifications off'}" style="padding:8px;min-width:unset;background:rgba(0,0,0,0.45);color:white;border:1px solid rgba(255,255,255,0.3);backdrop-filter:blur(6px);display:${isFollowing ? 'inline-flex' : 'none'};"><span class="material-symbols-outlined" style="font-size:20px;">${notifyOn && isFollowing ? 'notifications_active' : 'notifications_off'}</span></button>
               <span id="profile-friend-btns">${friendBtnInner}</span>
               <button onclick="toggleFollow('${uidToFetch}', 'user', this)" class="action-btn" style="background:rgba(0,0,0,0.45);color:white;border:1px solid rgba(255,255,255,0.3);backdrop-filter:blur(6px);${isFollowing ? 'opacity:0.75;' : ''}"><span class="material-symbols-outlined">${isFollowing ? 'check' : 'person_add'}</span> ${isFollowing ? 'Following' : 'Follow'}</button>
           </div>`;

    const bioSection = pBio
        ? `<div style="padding:14px 24px;background:var(--bg-gray);border-radius:0 0 var(--border-radius) var(--border-radius);border-top:1px solid var(--border-color);">
               <p style="font-size:14px;color:var(--text-dark);margin:0;line-height:1.5;">${pBio}</p>
           </div>` : '';

    document.getElementById('profile-header-container').innerHTML = `
        <div class="profile-header-wrap">
            <div class="profile-banner" style="${bannerStyle};">
                ${topBtns}
                <div class="profile-banner-overlay">
                    <div style="display:inline-flex;align-items:center;gap:16px;background:rgba(0,0,0,0.55);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:12px 18px;">
                        <img src="${pAvatar}" class="profile-avatar-large" onerror="this.src='https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(pName)}&backgroundColor=ffc107&fontColor=333333'">
                        <div style="min-width:0;">
                            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px;">
                                <h1 style="font-size:20px;margin:0;color:white;font-weight:800;">${pName}</h1>
                                ${window.getFounderBadgeHTML(uidToFetch, 18)}
                                ${window.getRankBadgeHTML(window.userRankCache[uidToFetch] || 0, 18)}
                            </div>
                            <p style="color:rgba(255,255,255,0.65);font-size:12px;margin:0 0 6px;">WeeBee Member since ${pJoined}</p>
                            <div id="profile-follow-counts" style="display:flex;gap:14px;font-size:13px;font-weight:600;color:rgba(255,255,255,0.9);flex-wrap:wrap;"></div>
                            ${pGenres.length ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:7px;">${pGenres.map(g=>`<span style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.9);font-size:11px;font-weight:600;padding:2px 9px;border-radius:20px;">${g}</span>`).join('')}</div>` : ''}
                            ${pinnedBannerBadges}
                        </div>
                    </div>
                </div>
            </div>
            ${bioSection}
        </div>
    `;

    const topAnimeEditBtn = document.getElementById('edit-top-anime-btn');
    if(topAnimeEditBtn) topAnimeEditBtn.style.display = isMe ? 'flex' : 'none';

    // Analytics / Lists
    const revQuery = query(collection(db, "reviews"), where("uid", "==", uidToFetch));
    const revSnap = await getDocs(revQuery);
    let totalScore = 0; let reviewCount = 0; let myReviews = [];
    revSnap.forEach(d => {
        const data = d.data();
        if(data.type !== 'suggestion' && data.type !== 'series') { totalScore += parseFloat(data.score); reviewCount++; }
        myReviews.push({ ...data, id: d.id });
    });
    myReviews.sort((a,b) => b.timestamp - a.timestamp);
    const avg = reviewCount > 0 ? (totalScore / reviewCount).toFixed(1) : "0.0";
    window.userRankCache[uidToFetch] = reviewCount;
    const _ri = window.getRankInfo(reviewCount);
    const _rPct = _ri.next ? Math.min(100, Math.round((reviewCount - _ri.min) / (_ri.next - _ri.min) * 100)) : 100;
    const _rLabel = _ri.next ? `${reviewCount} / ${_ri.next} to ${window.getRankInfo(_ri.next).name}` : `${reviewCount} reviews · Max rank!`;

    const listQuery = query(collection(db, "anime_lists"), where("uid", "==", uidToFetch));
    const listSnap = await getDocs(listQuery);
    let watchAnimes = [];
    let completedCount = 0;
    listSnap.forEach(d => {
        if(d.data().status === 'watching') watchAnimes.push(d.data());
        if(d.data().status === 'completed') completedCount++;
    });
    
    document.getElementById('profile-stats-content').innerHTML = `
        <div style="margin-bottom:14px; padding-bottom:14px; border-bottom:1px solid var(--bg-gray);">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                ${window.getRankBadgeHTML(reviewCount, 22)}
                <span style="font-weight:700; font-size:16px; color:${_ri.color};">${_ri.name}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                <div style="flex:1; height:6px; background:var(--bg-gray); border-radius:3px; overflow:hidden;">
                    <div style="width:${_rPct}%; height:100%; background:${_ri.color}; border-radius:3px; transition:width 0.5s ease;"></div>
                </div>
            </div>
            <p style="font-size:11px; color:var(--text-muted); margin-top:4px;">${_rLabel}</p>
        </div>
        <div class="profile-stat-row"><strong>Reviews Written</strong> <span>${reviewCount}</span></div>
        <div class="profile-stat-row"><strong>Average Rating</strong> <span>${avg}</span></div>
        <div class="profile-stat-row"><strong>Completed</strong> <span>${completedCount}</span></div>
        <div class="profile-stat-row"><strong>Watch List</strong> <span id="watch-list-count">${watchAnimes.length}</span></div>
    `;

    const watchContainer = document.getElementById('currently-watching-list'); watchContainer.innerHTML = '';
    if(watchAnimes.length === 0) { watchContainer.innerHTML = '<p class="empty-msg" style="color:var(--text-muted); font-size:13px;">Not tracking anything yet.</p>'; } 
    else {
        watchAnimes.forEach((a) => {
            watchContainer.innerHTML += `
                <div style="display:flex; align-items:center; gap:12px; margin-bottom: 12px; cursor:pointer; padding: 5px; border-radius: 8px; transition: background 0.2s;" onmouseover="this.style.background='var(--bg-gray)'" onmouseout="this.style.background='transparent'" onclick="loadAnimeDetails(${a.mal_id})">
                    <img src="${a.image}" style="width: 45px; height: 60px; border-radius: 6px; object-fit: cover; box-shadow: 0 2px 4px rgba(0,0,0,0.1); flex-shrink: 0;">
                    <div style="flex: 1; min-width: 0;"><span style="font-size: 13px; font-weight: 600; color: var(--text-dark); display:-webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient:vertical; overflow:hidden;">${a.title}</span></div>
                </div>`;
        });
    }

    // Top Anime List Update
    const topDoc = await getDoc(doc(db, "top_anime_lists", uidToFetch));
    const topContainer = document.getElementById('top-anime-list'); topContainer.innerHTML = '';
    if(!topDoc.exists() || !topDoc.data().list || topDoc.data().list.length === 0) {
        topContainer.innerHTML = '<p class="empty-msg" style="color:var(--text-muted); font-size:13px;">List is empty.</p>';
    } else {
        const topAnimes = topDoc.data().list;
        topAnimes.forEach((a, index) => {
            let rankColor = 'var(--text-muted)'; if(index === 0) rankColor = '#FFD700'; if(index === 1) rankColor = '#C0C0C0'; if(index === 2) rankColor = '#CD7F32'; 
            topContainer.innerHTML += `
                <div style="display:flex; align-items:center; gap:12px; margin-bottom: 12px; cursor:pointer; padding: 5px; border-radius: 8px; transition: background 0.2s;" onmouseover="this.style.background='var(--bg-gray)'" onmouseout="this.style.background='transparent'" onclick="loadAnimeDetails(${a.mal_id})">
                    <div style="font-size: 18px; font-weight: 900; color: ${rankColor}; width: 20px; text-align: center; flex-shrink: 0;">${index + 1}</div>
                    <img src="${a.image}" style="width: 45px; height: 60px; border-radius: 6px; object-fit: cover; box-shadow: 0 2px 4px rgba(0,0,0,0.1); flex-shrink: 0;">
                    <div style="flex: 1; min-width: 0;"><span style="font-size: 13px; font-weight: 600; color: var(--text-dark); display:-webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient:vertical; overflow:hidden;">${a.title}</span></div>
                </div>`;
        });
    }

    // FEED
    const feed = document.getElementById('user-reviews-feed'); feed.innerHTML = '';
    if(myReviews.length === 0) feed.innerHTML = '<p class="empty-msg" style="color:var(--text-muted);">No activity to display.</p>';
    else myReviews.forEach(d => feed.innerHTML += window.generateReviewCardHTML(d));

    // Follower / Following counts
    const [followingSnap, followersSnap, friendsCountSnap] = await Promise.all([
        getDocs(query(collection(db, "follows"), where("followerUid", "==", uidToFetch), where("type", "==", "user"))),
        getDocs(query(collection(db, "follows"), where("targetId", "==", uidToFetch), where("type", "==", "user"))),
        getDocs(query(collection(db, "friends"), where("uids", "array-contains", uidToFetch)))
    ]);
    const followingCount = followingSnap.size;
    const followersCount = followersSnap.size;
    const friendsCount = friendsCountSnap.size;
    const countsEl = document.getElementById('profile-follow-counts');
    if (countsEl) countsEl.innerHTML = `
        <span style="cursor:pointer;" onclick="switchProfileTab({currentTarget: document.querySelector('.p-tab[onclick*=p-friends]')}, 'p-friends')">
            <strong>${friendsCount}</strong> <span style="color:var(--text-muted); font-size:13px;">Friends</span>
        </span>
        <span style="color:var(--border-color);">·</span>
        <span style="cursor:pointer;" onclick="switchProfileTab({currentTarget: document.querySelector('.p-tab[onclick*=p-social]')}, 'p-social')">
            <strong>${followingCount}</strong> <span style="color:var(--text-muted); font-size:13px;">Following</span>
        </span>
        <span style="color:var(--border-color);">·</span>
        <span style="cursor:pointer;" onclick="switchProfileTab({currentTarget: document.querySelector('.p-tab[onclick*=p-followers]')}, 'p-followers')">
            <strong>${followersCount}</strong> <span style="color:var(--text-muted); font-size:13px;">Followers</span>
        </span>`;

    // SOCIAL (FOLLOWING)
    const followsSnap = await getDocs(query(collection(db, "follows"), where("followerUid", "==", uidToFetch)));
    const fAnimeList = document.getElementById('followed-anime-list'); fAnimeList.innerHTML = '';
    const fUserList = document.getElementById('followed-users-list'); fUserList.innerHTML = '';
    
    let hasAnime = false; let hasUser = false;
    const missingAnimeData = [];
    followsSnap.forEach(d => {
        const f = d.data();
        if(f.type === 'anime') {
            hasAnime = true;
            const title = f.title; const img = f.image;
            const needsFetch = !title || !img || title === 'Unknown Anime';
            fAnimeList.innerHTML += `<div class="anime-card" id="follow-card-${f.targetId}" style="min-width:100px; padding:8px;" onclick="loadAnimeDetails(${f.targetId})">
                <img id="follow-img-${f.targetId}" src="${img || ''}" style="width:80px; height:120px; margin-bottom:5px; background:var(--bg-gray-darker);" onerror="this.removeAttribute('src')">
                <p id="follow-title-${f.targetId}" style="font-size:11px; max-width:80px;">${needsFetch ? '...' : title}</p>
            </div>`;
            if(needsFetch) missingAnimeData.push({ docId: d.id, mal_id: f.targetId });
        } else if (f.type === 'user' && f.targetId) {
            hasUser = true;
            fUserList.innerHTML += `<div class="user-chip clickable-user" id="user-chip-${f.targetId}" onclick="viewUserProfile('${f.targetId}')"><img id="user-chip-img-${f.targetId}" src="${f.avatar || ''}" onerror="this.style.display='none'" style="width:24px;height:24px;border-radius:50%;"> <span id="user-chip-name-${f.targetId}">${f.username || '...'}</span></div>`;
        }
    });
    if(!hasAnime) fAnimeList.parentElement.innerHTML = '<h5>Following Anime</h5><p class="empty-msg" style="color:var(--text-muted); font-size:13px;">Not following any anime yet.</p>';
    if(!hasUser) fUserList.innerHTML = '<p class="empty-msg" style="color:var(--text-muted); font-size:13px;">Not following any users yet.</p>';

    // Batch-resolve real display names from profiles for all followed users
    const userFollowDocs = [];
    followsSnap.forEach(d => { if(d.data().type === 'user') userFollowDocs.push({ docId: d.id, ...d.data() }); });
    if (userFollowDocs.length > 0) {
        await Promise.all(userFollowDocs.map(async f => {
            try {
                const profileDoc = await getDoc(doc(db, "profiles", f.targetId));
                let displayName = null, avatar = null;
                if (profileDoc.exists() && profileDoc.data().displayName) {
                    displayName = profileDoc.data().displayName;
                    avatar = profileDoc.data().avatar;
                }
                // Fallback: try auth display name from reviews
                if (!displayName) {
                    const rSnap = await getDocs(query(collection(db, "reviews"), where("uid", "==", f.targetId), limit(1)));
                    if (!rSnap.empty) { displayName = rSnap.docs[0].data().username; avatar = avatar || rSnap.docs[0].data().avatar; }
                }
                displayName = displayName || f.username || 'WeeBee User';
                const dicebear = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(displayName)}&backgroundColor=ffc107&fontColor=333333`;
                avatar = avatar || dicebear;

                const nameEl = document.getElementById(`user-chip-name-${f.targetId}`);
                const imgEl = document.getElementById(`user-chip-img-${f.targetId}`);
                if (nameEl) nameEl.textContent = displayName;
                if (imgEl) { imgEl.src = avatar; imgEl.style.display = ''; }

                // Patch the follow doc if name was wrong or missing
                if (displayName !== f.username || !f.username) {
                    updateDoc(doc(db, "follows", f.docId), { username: displayName, avatar }).catch(() => {});
                }
            } catch(e) {
                const nameEl = document.getElementById(`user-chip-name-${f.targetId}`);
                if (nameEl) nameEl.textContent = f.username || 'WeeBee User';
            }
        }));
    }

    // Re-fetch and repair any follows saved without title/image
    for(let i = 0; i < missingAnimeData.length; i++) {
        const { docId, mal_id } = missingAnimeData[i];
        if(i > 0) await new Promise(r => setTimeout(r, 400));
        try {
            const res = await fetch(`https://api.jikan.moe/v4/anime/${mal_id}`);
            const { data: anime } = await res.json();
            if(!anime) continue;
            const newTitle = anime.title_english || anime.title;
            const newImg = anime.images.jpg.image_url;
            const imgEl = document.getElementById(`follow-img-${mal_id}`);
            const titleEl = document.getElementById(`follow-title-${mal_id}`);
            if(imgEl) imgEl.src = newImg;
            if(titleEl) titleEl.textContent = newTitle;
            updateDoc(doc(db, "follows", docId), { title: newTitle, image: newImg }).catch(() => {});
        } catch(e) {
            const titleEl = document.getElementById(`follow-title-${mal_id}`);
            if(titleEl) titleEl.textContent = 'Unknown Anime';
        }
    }

    fetchProfileComments(uidToFetch);
};

window.submitProfileComment = async function() {
    const user = auth.currentUser;
    if(!user) return window.openAuthModal();
    const input = document.getElementById('profile-comment-input');
    if(!input.value.trim()) return;
    if (window.checkTextContent(input.value)) return alert('Your comment contains language that isn\'t allowed on WeeBee.');
    const targetUid = window.targetProfileUid || user.uid;
    await addDoc(collection(db, "profile_comments"), { profileOwnerId: targetUid, authorName: user.displayName, authorAvatar: user.photoURL, uid: user.uid, text: input.value.trim(), timestamp: new Date() });
    input.value = ''; fetchProfileComments(targetUid);
};

window.viewFullAnimeList = async function() {
    const uid = window.currentProfileUid;
    const isMe = auth.currentUser && uid === auth.currentUser.uid;
    if (isMe) { switchView('my-list-view'); return; }
    // For other users, show their list in a modal
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.cssText = 'display:flex;';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:600px; max-height:80vh; overflow-y:auto;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <h3 style="margin:0;" id="full-list-modal-title">Anime List</h3>
                <button onclick="this.closest('.modal-overlay').remove()" class="cancel-btn" style="padding:4px 10px;">Close</button>
            </div>
            <div id="full-list-modal-content"><div class="loading">Loading...</div></div>
        </div>`;
    document.body.appendChild(modal);
    try {
        const [ownerProfile, snap] = await Promise.all([
            getDoc(doc(db, "profiles", uid)),
            getDocs(query(collection(db, "anime_lists"), where("uid", "==", uid)))
        ]);
        const listPrivate = ownerProfile.exists() ? ownerProfile.data().listPrivate : false;
        const content = document.getElementById('full-list-modal-content');
        if (listPrivate && !window.myFriendIds.has(uid)) {
            content.innerHTML = '<div style="text-align:center; padding:40px;"><span class="material-symbols-outlined" style="font-size:48px; color:var(--text-muted);">lock</span><p style="color:var(--text-muted); margin-top:12px;">This list is private. You need to be friends to see it.</p></div>';
            return;
        }
        const items = [];
        snap.forEach(d => items.push(d.data()));
        items.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        const profileName = ownerProfile.exists() ? ownerProfile.data().displayName : 'User';
        document.getElementById('full-list-modal-title').innerText = `${profileName}'s Anime List`;
        if (items.length === 0) { content.innerHTML = '<p class="empty-msg" style="color:var(--text-muted);">No anime in this list yet.</p>'; return; }
        const statusOrder = ['watching','completed','on-hold','dropped','plan-to-watch'];
        const grouped = {};
        statusOrder.forEach(s => { grouped[s] = items.filter(a => a.status === s); });
        const labels = { 'watching':'Watching','completed':'Completed','on-hold':'On Hold','dropped':'Dropped','plan-to-watch':'Plan to Watch' };
        content.innerHTML = statusOrder.filter(s => grouped[s].length > 0).map(s => `
            <div style="margin-bottom:20px;">
                <h4 style="margin-bottom:10px; color:var(--text-muted); font-size:12px; text-transform:uppercase; letter-spacing:1px;">${labels[s]} (${grouped[s].length})</h4>
                ${grouped[s].map(a => `
                    <div style="display:flex; align-items:center; gap:12px; padding:8px 0; border-bottom:1px solid var(--border-color); cursor:pointer;" onclick="this.closest('.modal-overlay').remove(); loadAnimeDetails(${a.mal_id})">
                        <img src="${a.image}" style="width:36px; height:50px; object-fit:cover; border-radius:4px; flex-shrink:0;">
                        <div style="flex:1; min-width:0;"><div style="font-size:14px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${a.title}</div>${a.score ? `<div style="font-size:12px; color:var(--text-muted);">Score: ${a.score}</div>` : ''}</div>
                    </div>`).join('')}
            </div>`).join('');
    } catch(e) { document.getElementById('full-list-modal-content').innerHTML = '<p style="color:var(--text-muted);">Failed to load list.</p>'; }
};

window.fetchProfileComments = async function(ownerId) {
    const feed = document.getElementById('profile-comments-feed');
    if (!feed) return;
    const isOwner = auth.currentUser && auth.currentUser.uid === ownerId;
    // Show/hide the comment input area
    const inputArea = document.getElementById('profile-comment-input-area');
    if (inputArea) inputArea.style.display = auth.currentUser ? 'block' : 'none';

    const q = query(collection(db, "profile_comments"), where("profileOwnerId", "==", ownerId));
    const snap = await getDocs(q);
    feed.innerHTML = '';
    if(snap.empty) { feed.innerHTML = '<p class="empty-msg" style="color:var(--text-muted); font-size:13px;">No comments yet.</p>'; return; }
    const docs = [];
    snap.forEach(d => docs.push({ ...d.data(), _id: d.id }));
    docs.sort((a, b) => (b.timestamp?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || 0));
    docs.forEach(c => {
        const deleteBtn = isOwner ? `<button onclick="deleteProfileComment('${c._id}', '${ownerId}')" style="background:none; border:none; cursor:pointer; color:var(--text-muted); padding:2px 4px; margin-left:auto; flex-shrink:0;" title="Delete comment"><span class="material-symbols-outlined" style="font-size:16px;">delete</span></button>` : '';
        feed.innerHTML += `
            <div style="display:flex; gap:12px; padding:14px; background:var(--bg-gray-darker); border:1px solid var(--border-color); border-radius:10px; margin-bottom:10px; align-items:flex-start;">
                <img src="${c.authorAvatar || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(c.authorName)}&backgroundColor=ffc107&fontColor=333333`}" class="clickable-user" onclick="viewUserProfile('${c.uid}')" style="width:38px; height:38px; border-radius:50%; object-fit:cover; flex-shrink:0;">
                <div style="flex:1; min-width:0;">
                    <strong class="clickable-user" onclick="viewUserProfile('${c.uid}')" style="font-size:14px;">${c.authorName}</strong>
                    <p style="font-size:14px; margin-top:4px; line-height:1.5; color:var(--text-dark);">${c.text}</p>
                </div>
                ${deleteBtn}
            </div>`;
    });
};

window.deleteProfileComment = async function(commentId, ownerId) {
    if (!auth.currentUser || auth.currentUser.uid !== ownerId) return;
    if (!confirm('Delete this comment?')) return;
    await deleteDoc(doc(db, "profile_comments", commentId));
    fetchProfileComments(ownerId);
};

// --- Home Feed & News from Follows ---
window._lastReviewDoc = null;
window._feedLoading = false;
window._feedExhausted = false;
const HOME_FEED_PAGE_SIZE = 15;

async function loadReviewBatch(append = false) {
    if (window._feedLoading || window._feedExhausted) return;
    window._feedLoading = true;
    const feed = document.getElementById('review-feed');
    try {
        let q = query(collection(db, "reviews"), orderBy("timestamp", "desc"), limit(HOME_FEED_PAGE_SIZE));
        if (append && window._lastReviewDoc) q = query(collection(db, "reviews"), orderBy("timestamp", "desc"), startAfter(window._lastReviewDoc), limit(HOME_FEED_PAGE_SIZE));

        const snap = await getDocs(q);
        if (snap.empty || snap.docs.length < HOME_FEED_PAGE_SIZE) window._feedExhausted = true;
        if (snap.empty) { window._feedLoading = false; return; }
        window._lastReviewDoc = snap.docs[snap.docs.length - 1];

        const revDocs = [];
        snap.forEach(d => revDocs.push({ ...d.data(), id: d.id }));
        const uids = revDocs.map(r => r.uid).filter(Boolean);
        await window.prefetchRankCache(uids);

        if (revDocs.length > 0) {
            const reviewIds = revDocs.map(r => r.id);
            const commSnap = await getDocs(query(collection(db, "comments"), where("reviewId", "in", reviewIds)));
            const countMap = {};
            commSnap.forEach(d => { const rid = d.data().reviewId; countMap[rid] = (countMap[rid] || 0) + 1; });
            revDocs.forEach(r => { r.commentCount = countMap[r.id] || 0; });
        }

        if (!append) feed.innerHTML = '';
        revDocs.forEach(r => feed.innerHTML += window.generateReviewCardHTML(r));

        // Show/hide the sentinel loader
        const sentinel = document.getElementById('feed-scroll-sentinel');
        if (sentinel) sentinel.style.display = window._feedExhausted ? 'none' : 'block';
    } catch(e) { console.error("Error loading home feed:", e); }
    window._feedLoading = false;
}

window.fetchHomepageReviews = async function() {
    // Launch activity feed — don't await, runs in background
    window.fetchHomeActivityFeed();

    // Load news from followed anime
    if (auth.currentUser) {
        try {
            const fQ = query(collection(db, "follows"), where("followerUid", "==", auth.currentUser.uid), where("type", "==", "anime"));
            const fSnap = await getDocs(fQ);
            let followedMalIds = [];
            fSnap.forEach(d => followedMalIds.push(d.data().targetId));
            const newsSection = document.getElementById('home-news-section');
            const newsCarousel = document.getElementById('home-news-carousel');
            if (followedMalIds.length > 0) {
                newsSection.style.display = 'block';
                newsCarousel.innerHTML = '';
                for (let animeId of followedMalIds.slice(0, 2)) {
                    try {
                        const r = await fetch(`https://api.jikan.moe/v4/anime/${animeId}/news`);
                        const d = await r.json();
                        if (d.data) d.data.slice(0, 3).forEach(n => {
                            newsCarousel.innerHTML += `<div class="news-card" style="min-width:300px;flex-shrink:0;">
                                <img src="${n.images?.jpg?.image_url || 'https://via.placeholder.com/300x150'}">
                                <div class="news-content" style="padding:10px;">
                                    <h3 style="font-size:14px;margin-bottom:5px;">${n.title}</h3>
                                    <a href="${n.url}" target="_blank" class="news-link" style="display:inline-block;margin-top:auto;font-size:10px;">Read Article</a>
                                </div>
                            </div>`;
                        });
                    } catch(e) {}
                }
                if (newsCarousel.innerHTML === '') newsCarousel.innerHTML = '<p class="empty-msg" style="color:var(--text-muted);padding:10px;">No recent news for your followed anime.</p>';
            } else { newsSection.style.display = 'none'; }
        } catch(e) {}
    } else { document.getElementById('home-news-section').style.display = 'none'; }
};

// --- UNIFIED ACTIVITY FEED ---
window._activityItems = [];
window._activityIndex = 0;
const ACTIVITY_PAGE_SIZE = 20;

function formatTimeAgo(ts) {
    const ms = ts?.toMillis?.() || (ts?.seconds ? ts.seconds * 1000 : (typeof ts === 'number' ? ts : 0));
    if (!ms) return '';
    const diff = Date.now() - ms;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderTierListFeedCard(id, tl) {
    const itemCount = tl.tiers.reduce((a, t) => a + (t.items?.length || 0), 0);
    const avatar = tl.authorAvatar || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(tl.authorName || 'U')}&backgroundColor=ffc107&fontColor=333333`;
    const timeAgo = formatTimeAgo(tl._ts || tl.timestamp || tl.updatedAt);
    const tierPreview = tl.tiers.slice(0, 5).map(t =>
        `<span style="background:${t.color};color:#333;font-size:10px;font-weight:800;padding:3px 8px;border-radius:4px;white-space:nowrap;">${t.label}</span>`
    ).join('');
    const rankHTML = window.getRankBadgeHTML(window.userRankCache[tl.uid] || 0, 16);
    const likes = tl.likes || [];
    const dislikes = tl.dislikes || [];
    const isLiked = auth.currentUser && likes.includes(auth.currentUser.uid);
    const isDisliked = auth.currentUser && dislikes.includes(auth.currentUser.uid);
    const coverImage = tl.coverImage || tl.tiers.flatMap(t => t.items || []).find(i => i.image)?.image || null;
    const typeLabel = tl.type === 'characters' && tl.sourceAnimeTitle ? tl.sourceAnimeTitle : null;
    const thumbHTML = coverImage ? `<img class="review-anime-thumb" src="${coverImage}" onclick="event.stopPropagation();window.openTierListViewer('${id}')" onerror="this.style.display='none'">` : '';
    const padRight = coverImage ? 'padding-right:195px;' : '';
    return `<div class="review-card tl-post-card feed-post-card">
        ${thumbHTML}
        <div style="position:absolute;top:10px;right:10px;z-index:5;" onclick="event.stopPropagation();">
            <button onclick="window.useAsTemplate('${id}')" style="background:rgba(0,0,0,0.35);border:none;border-radius:20px;padding:5px 10px;cursor:pointer;color:white;font-size:11px;font-weight:700;display:flex;align-items:center;gap:4px;">
                <span class="material-symbols-outlined" style="font-size:13px;">content_copy</span> Make One
            </button>
        </div>
        <div class="review-header" style="margin-bottom:10px;position:relative;z-index:2;${padRight}">
            <img src="${avatar}" class="avatar" onclick="event.stopPropagation();viewUserProfile('${tl.uid}')" style="cursor:pointer;" onerror="this.src='https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(tl.authorName||'U')}&backgroundColor=ffc107&fontColor=333333'">
            <div style="min-width:0;">
                <strong style="color:var(--text-dark);">${tl.authorName || 'WeeBee User'}</strong>
                ${rankHTML}
                ${window.getPinnedBadgesHTML(tl.uid)}
                <span style="display:inline-block;background:#1565C0;color:white;font-size:10px;font-weight:800;padding:2px 8px;border-radius:4px;margin-left:6px;vertical-align:middle;">📊 Tier List</span><br>
                <span style="font-size:12px;color:var(--text-muted);">${timeAgo}</span>
                ${typeLabel ? `<span style="font-size:12px;color:var(--text-muted);"> · ${typeLabel}</span>` : ''}
            </div>
        </div>
        <div style="font-size:15px;font-weight:700;margin-bottom:6px;color:var(--text-dark);cursor:pointer;position:relative;z-index:2;${padRight}" onclick="window.openTierListViewer('${id}')">${tl.title || 'Untitled Tier List'}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;position:relative;z-index:2;${padRight}">${tl.tiers.length} tiers · ${itemCount} item${itemCount !== 1 ? 's' : ''} ranked</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;cursor:pointer;position:relative;z-index:2;${padRight}" onclick="window.openTierListViewer('${id}')">${tierPreview}</div>
        <div class="review-actions" style="position:relative;z-index:2;">
            <div class="action-stat">
                <button onclick="window.toggleBwPostComments(event,this,'${id}')">
                    <span class="material-symbols-outlined">chat_bubble</span>
                </button>
                <span class="action-label bw-comment-count">${tl.commentCount || 0} Comments</span>
            </div>
            <div class="action-stat">
                <button onclick="window.toggleBwPostReaction(event,'${id}','tier_lists','like',this)" style="${isLiked ? 'color:var(--accent-yellow);' : ''}">
                    <span class="material-symbols-outlined">thumb_up</span>
                </button>
                <span class="action-label" id="bw-likes-${id}">${likes.length} Likes</span>
            </div>
            <div class="action-stat">
                <button onclick="window.toggleBwPostReaction(event,'${id}','tier_lists','dislike',this)" style="${isDisliked ? 'color:red;' : ''}">
                    <span class="material-symbols-outlined">thumb_down</span>
                </button>
                <span class="action-label" id="bw-dislikes-${id}">${dislikes.length} Dislikes</span>
            </div>
        </div>
        <div class="bw-post-comments" data-post-collection="tier_lists" style="display:none;margin-top:15px;padding-top:15px;border-top:1px solid var(--border-color);position:relative;z-index:2;${padRight}" onclick="event.stopPropagation();">
            <div class="bw-comments-list"></div>
            <div style="display:flex;gap:10px;margin-top:10px;">
                <input type="text" class="bw-comment-input" placeholder="Add a comment..." style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-gray);color:var(--text-dark);" onkeydown="if(event.key==='Enter'){event.preventDefault();this.nextElementSibling.click();}">
                <button class="action-btn" onclick="window.submitBwPostComment(event,this,'${id}','tier_lists')">Send</button>
            </div>
        </div>
    </div>`;
}

function renderActivityBatch() {
    const feed = document.getElementById('home-activity-feed');
    const sentinel = document.getElementById('home-activity-sentinel');
    if (!feed) return;
    const items = window._activityItems || [];
    const batch = items.slice(window._activityIndex, window._activityIndex + ACTIVITY_PAGE_SIZE);
    if (!batch.length) {
        if (window._activityIndex === 0) feed.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px;font-size:14px;">No activity yet — start by writing a review or creating a tier list!</div>';
        if (sentinel) sentinel.style.display = 'none';
        return;
    }
    batch.forEach(item => {
        let html = '';
        if (item._type === 'review') html = window.generateReviewCardHTML(item);
        else if (item._type === 'tierlist') html = renderTierListFeedCard(item.id, item);
        else if (item._type === 'bw') html = window.generateBwPostCardHTML(item);
        if (html) feed.innerHTML += html;
    });
    window._activityIndex += batch.length;
    if (sentinel) sentinel.style.display = window._activityIndex < items.length ? 'block' : 'none';
}

window.fetchHomeActivityFeed = async function() {
    const feed = document.getElementById('home-activity-feed');
    const sentinel = document.getElementById('home-activity-sentinel');
    if (!feed) return;
    feed.innerHTML = '<div class="loading">Loading your feed...</div>';
    if (sentinel) sentinel.style.display = 'none';
    window._activityItems = [];
    window._activityIndex = 0;
    try {
        const today = bwGetDate();
        const [reviewSnap, tlSnap, bwSnap] = await Promise.all([
            getDocs(query(collection(db, 'reviews'), orderBy('timestamp', 'desc'), limit(60))),
            getDocs(query(collection(db, 'tier_lists'), where('public', '==', true))),
            getDocs(query(collection(db, 'bw_posts'), where('date', '==', today)))
        ]);

        // Build set of social UIDs (follows + friends)
        const socialUids = new Set();
        if (auth.currentUser) {
            try {
                const uid = auth.currentUser.uid;
                const [followSnap, friendSnap] = await Promise.all([
                    getDocs(query(collection(db, 'follows'), where('followerUid', '==', uid), where('type', '==', 'user'))),
                    getDocs(query(collection(db, 'friends'), where('uids', 'array-contains', uid)))
                ]);
                followSnap.forEach(d => socialUids.add(d.data().targetId));
                friendSnap.forEach(d => { const other = d.data().uids?.find(u => u !== uid); if (other) socialUids.add(other); });
            } catch(e) {}
        }

        const items = [];
        reviewSnap.forEach(d => {
            const data = d.data();
            items.push({ ...data, id: d.id, _type: 'review', _ts: data.timestamp?.toMillis?.() || 0, _social: socialUids.has(data.uid) });
        });
        tlSnap.forEach(d => {
            const data = d.data();
            const ts = data.timestamp?.toMillis?.() || data.updatedAt?.toMillis?.() || 0;
            items.push({ ...data, id: d.id, _type: 'tierlist', _ts: ts, _social: socialUids.has(data.uid) });
        });
        bwSnap.forEach(d => {
            const data = d.data();
            items.push({ ...data, id: d.id, _type: 'bw', _ts: data.timestamp?.toMillis?.() || 0, _social: socialUids.has(data.uid), _col: 'bw_posts' });
        });

        await window.prefetchRankCache([...new Set(items.map(i => i.uid).filter(Boolean))]);

        const byTime = (a, b) => b._ts - a._ts;
        window._activityItems = [
            ...items.filter(i => i._social).sort(byTime),
            ...items.filter(i => !i._social).sort(byTime)
        ];
        feed.innerHTML = '';
        renderActivityBatch();
    } catch(e) {
        console.error('fetchHomeActivityFeed', e);
        feed.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px;">Could not load feed.</div>';
    }
};

// --- SEASONAL VOTING SYSTEM ---
window.isAdmin = false;
window.activeSeasonalVote = null;
window.mySeasonalVote = null;

window.getSeasonLabel = function(season, year) {
    return `${season.charAt(0).toUpperCase() + season.slice(1)} ${year}`;
};

window.getPreviousSeason = function() {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    const seasons = ['winter','spring','summer','fall'];
    let idx = month < 3 ? 0 : month < 6 ? 1 : month < 9 ? 2 : 3;
    if (idx === 0) return { season: 'fall', year: year - 1 };
    return { season: seasons[idx - 1], year };
};

window.loadActiveSeasonalVote = async function() {
    try {
        const snap = await getDocs(query(collection(db, "seasonal_votes"), where("closed", "==", false)));
        if (snap.empty) { window.activeSeasonalVote = null; return; }
        const d = snap.docs[0];
        window.activeSeasonalVote = { id: d.id, ...d.data() };
        // Check if expired — auto-close
        const endDate = window.activeSeasonalVote.endDate?.toDate ? window.activeSeasonalVote.endDate.toDate() : new Date(window.activeSeasonalVote.endDate);
        if (new Date() > endDate) { await window.closeSeasonalVote(d.id); return; }
        // Check if current user already voted
        if (auth.currentUser) {
            const recDoc = await getDoc(doc(db, "seasonal_vote_records", `${d.id}_${auth.currentUser.uid}`));
            window.mySeasonalVote = recDoc.exists() ? recDoc.data().mal_id : null;
        }
    } catch(e) { console.error('loadActiveSeasonalVote', e); }
};

window.startSeasonalVote = async function(isTest) {
    if (!window.isAdmin) return;
    const btn = document.getElementById('admin-start-vote-btn');
    if (btn) { btn.disabled = true; btn.innerText = 'Creating...'; }
    try {
        const { season, year } = isTest ? (() => { const m = new Date().getMonth(); const y = new Date().getFullYear(); const s = m < 3 ? 'winter' : m < 6 ? 'spring' : m < 9 ? 'summer' : 'fall'; return { season: s, year: y }; })() : window.getPreviousSeason();
        const url = isTest ? `https://api.jikan.moe/v4/seasons/now?limit=25` : `https://api.jikan.moe/v4/seasons/${year}/${season}?limit=25`;
        const res = await fetch(url);
        const { data } = await res.json();
        const seenIds = new Set();
        const seenTitles = new Set();
        const baseTitle = t => (t || '').toLowerCase().replace(/[\s:·\-]+(season|part|cour|s\d|p\d|\d+).*$/i, '').trim();
        const candidates = (data || [])
            .filter(a => a.type === 'TV' && a.images?.jpg?.image_url)
            .sort((a, b) => (b.members || 0) - (a.members || 0))
            .filter(a => {
                if (seenIds.has(a.mal_id)) return false;
                const bt = baseTitle(a.title_english || a.title);
                if (seenTitles.has(bt)) return false;
                seenIds.add(a.mal_id); seenTitles.add(bt);
                return true;
            })
            .slice(0, 10)
            .map(a => ({ mal_id: a.mal_id, title: a.title_english || a.title, image: a.images.jpg.image_url }));
        const now = new Date();
        const endDate = isTest ? new Date(now.getTime() + 5 * 60 * 1000) : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const docId = isTest ? `test_${Date.now()}` : `${season}_${year}`;
        const label = window.getSeasonLabel(season, year) + (isTest ? ' (Test)' : '');
        await setDoc(doc(db, "seasonal_votes", docId), { season: label, startDate: now, endDate, closed: false, candidates, voteCounts: {} });
        window.activeSeasonalVote = { id: docId, season: label, startDate: now, endDate, closed: false, candidates, voteCounts: {} };
        window.mySeasonalVote = null;
        window.renderSeasonalVoting();
    } catch(e) { console.error(e); alert('Failed to create vote.'); if (btn) { btn.disabled = false; btn.innerText = 'Start Vote'; } }
};

window.submitSeasonalVote = async function(malId) {
    if (!auth.currentUser) return window.openAuthModal();
    const vote = window.activeSeasonalVote;
    if (!vote || vote.closed) return;
    if (String(window.mySeasonalVote) === String(malId)) return;
    try {
        const recordId = `${vote.id}_${auth.currentUser.uid}`;
        await setDoc(doc(db, "seasonal_vote_records", recordId), { uid: auth.currentUser.uid, mal_id: malId, season: vote.id, timestamp: new Date() });
        const updates = { [`voteCounts.${malId}`]: increment(1) };
        if (window.mySeasonalVote) updates[`voteCounts.${window.mySeasonalVote}`] = increment(-1);
        await updateDoc(doc(db, "seasonal_votes", vote.id), updates);
        if (window.mySeasonalVote) {
            vote.voteCounts[window.mySeasonalVote] = Math.max(0, (vote.voteCounts[window.mySeasonalVote] || 0) - 1);
        }
        vote.voteCounts[malId] = (vote.voteCounts[malId] || 0) + 1;
        window.mySeasonalVote = malId;
        window.renderSeasonalVoting();
    } catch(e) { console.error(e); alert('Failed to submit vote.'); }
};

window.closeSeasonalVote = async function(voteId) {
    try {
        const voteDoc = await getDoc(doc(db, "seasonal_votes", voteId));
        if (!voteDoc.exists() || voteDoc.data().closed) return;
        const vote = voteDoc.data();
        const sorted = Object.entries(vote.voteCounts || {}).sort(([,a],[,b]) => b - a).slice(0, 3);
        const placeLabels = ['Anime of the Season', 'Runner-Up', '3rd Place'];
        const winners = sorted.map(([mal_id, votes], i) => {
            const c = vote.candidates.find(x => String(x.mal_id) === String(mal_id));
            return { place: i + 1, mal_id: parseInt(mal_id), title: c?.title || 'Unknown', image: c?.image || '', votes };
        });
        await updateDoc(doc(db, "seasonal_votes", voteId), { closed: true, winners });
        for (const w of winners) {
            const badgeRef = doc(db, "seasonal_badges", String(w.mal_id));
            const existing = await getDoc(badgeRef);
            const badge = { season: vote.season, seasonId: voteId, place: w.place, label: placeLabels[w.place - 1], votes: w.votes, timestamp: new Date() };
            if (existing.exists()) { await updateDoc(badgeRef, { badges: [...(existing.data().badges || []), badge] }); }
            else { await setDoc(badgeRef, { mal_id: w.mal_id, title: w.title, badges: [badge] }); }
        }
        await addDoc(collection(db, "seasonal_winners"), { season: vote.season, seasonId: voteId, winners, timestamp: new Date() });
        window.activeSeasonalVote = { ...vote, closed: true, winners, id: voteId };
        window.renderSeasonalVoting();
    } catch(e) { console.error('closeSeasonalVote', e); }
};

window.renderSeasonalVoting = function() {
    const vote = window.activeSeasonalVote;
    const containers = [
        { sectionId: 'discover-seasonal-section', contentId: 'discover-seasonal-content', titleId: 'discover-seasonal-title', subId: 'discover-seasonal-sub', adminId: 'discover-seasonal-admin' },
        { sectionId: 'news-seasonal-section', contentId: 'news-seasonal-content', titleId: 'news-seasonal-title', subId: 'news-seasonal-sub', adminId: null }
    ];
    containers.forEach(({ sectionId, contentId, titleId, subId, adminId }) => {
        const section = document.getElementById(sectionId);
        const content = document.getElementById(contentId);
        if (!section || !content) return;
        // Admin panel
        if (adminId && window.isAdmin) {
            const adminEl = document.getElementById(adminId);
            if (adminEl) {
                adminEl.style.display = 'flex';
                adminEl.style.gap = '10px';
                adminEl.style.flexWrap = 'wrap';
                if (!vote) {
                    adminEl.innerHTML = `
                        <button id="admin-start-vote-btn" onclick="startSeasonalVote(false)" class="action-btn" style="background:#FF9800; color:white;"><span class="material-symbols-outlined">how_to_vote</span> Start Seasonal Vote</button>
                        <button onclick="startSeasonalVote(true)" class="action-btn" style="background:var(--bg-gray-darker); color:var(--text-dark);"><span class="material-symbols-outlined">science</span> Start Test Vote (5 min)</button>`;
                } else if (!vote.closed) {
                    adminEl.innerHTML = `<button onclick="closeSeasonalVote('${vote.id}')" class="action-btn" style="background:#f44336; color:white;"><span class="material-symbols-outlined">gavel</span> End Vote Now</button>`;
                } else {
                    adminEl.innerHTML = `<span style="font-size:13px; color:var(--text-muted); padding:8px;">Vote closed ✓</span>`;
                }
            }
        }
        if (!vote) {
            if (window.isAdmin && adminId) {
                section.style.display = 'block';
                const adminEl = document.getElementById(adminId);
                if (adminEl) {
                    adminEl.style.cssText = 'display:flex; gap:10px; flex-wrap:wrap;';
                    adminEl.innerHTML = `
                        <button id="admin-start-vote-btn" onclick="startSeasonalVote(false)" class="action-btn" style="background:#FF9800; color:white;"><span class="material-symbols-outlined">how_to_vote</span> Start Seasonal Vote</button>
                        <button onclick="startSeasonalVote(true)" class="action-btn" style="background:var(--bg-gray-darker); color:var(--text-dark);"><span class="material-symbols-outlined">science</span> Start Test Vote (5 min)</button>`;
                }
                if (contentId) { const c = document.getElementById(contentId); if (c) c.innerHTML = '<p style="color:var(--text-muted); font-size:14px;">No active vote. Use the buttons above to start one.</p>'; }
            } else {
                section.style.display = 'none';
            }
            return;
        }
        section.style.display = 'block';
        if (titleId) { const t = document.getElementById(titleId); if (t) t.innerText = `Anime of the Season — ${vote.season}`; }
        const endDate = vote.endDate?.toDate ? vote.endDate.toDate() : new Date(vote.endDate);
        const timeLeft = Math.max(0, endDate - new Date());
        const daysLeft = Math.floor(timeLeft / 86400000);
        const hoursLeft = Math.floor((timeLeft % 86400000) / 3600000);
        const subText = vote.closed ? 'Voting has closed — results below' : timeLeft < 3600000 ? `Voting closes in ${hoursLeft}h` : daysLeft > 0 ? `Voting closes in ${daysLeft}d ${hoursLeft}h` : `Voting closes soon`;
        if (subId) { const s = document.getElementById(subId); if (s) s.innerText = subText; }
        const totalVotes = Object.values(vote.voteCounts || {}).reduce((a, b) => a + b, 0);
        const hasVoted = !!window.mySeasonalVote || vote.closed;
        const placeIcons = ['emoji_events', 'military_tech', 'military_tech'];
        const placeColors = ['#FFD700', '#C0C0C0', '#CD7F32'];
        const winnerIds = vote.winners ? vote.winners.map(w => String(w.mal_id)) : [];
        const sortedCandidates = hasVoted
            ? [...vote.candidates].sort((a, b) => (vote.voteCounts?.[b.mal_id] || 0) - (vote.voteCounts?.[a.mal_id] || 0))
            : vote.candidates;
        content.innerHTML = `<div class="seasonal-vote-grid" style="display:grid; grid-template-columns:repeat(5,1fr); gap:14px;">` +
            sortedCandidates.map(c => {
                const votes = vote.voteCounts?.[c.mal_id] || 0;
                const pct = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
                const isMyVote = String(c.mal_id) === String(window.mySeasonalVote);
                const winnerIdx = winnerIds.indexOf(String(c.mal_id));
                const isWinner = winnerIdx !== -1;
                const placeLabel = vote.closed && isWinner ? vote.winners[winnerIdx].label : '';
                return `<div style="border-radius:12px; overflow:hidden; background:var(--bg-gray); position:relative; border:2px solid ${isMyVote ? 'var(--accent-yellow)' : isWinner ? placeColors[winnerIdx] : 'transparent'}; cursor:pointer;" onclick="loadAnimeDetails(${c.mal_id})">
                    ${isWinner ? `<div style="position:absolute;top:6px;left:6px;z-index:2;"><span class="material-symbols-outlined" style="font-size:20px;color:${placeColors[winnerIdx]};text-shadow:0 1px 3px rgba(0,0,0,0.5);">${placeIcons[winnerIdx]}</span></div>` : ''}
                    ${isMyVote ? `<div style="position:absolute;top:6px;right:6px;z-index:2;background:var(--accent-yellow);border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;"><span class="material-symbols-outlined" style="font-size:14px;color:#333;">check</span></div>` : ''}
                    <img src="${c.image}" style="width:100%;height:220px;object-fit:cover;display:block;">
                    <div style="padding:8px;">
                        <div style="font-size:12px;font-weight:700;line-height:1.3;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${c.title}">${c.title}</div>
                        ${hasVoted ? `<div style="background:var(--bg-gray-darker);border-radius:4px;height:6px;margin-bottom:4px;overflow:hidden;"><div style="background:${isMyVote ? 'var(--accent-yellow)' : isWinner ? placeColors[winnerIdx] : 'var(--text-muted)'};height:100%;width:${pct}%;transition:width 0.4s;"></div></div><div style="font-size:11px;color:var(--text-muted);">${pct}% · ${votes} vote${votes !== 1 ? 's' : ''}</div>` : ''}
                        ${!hasVoted ? `<button onclick="event.stopPropagation(); submitSeasonalVote(${c.mal_id})" class="action-btn" style="width:100%;justify-content:center;padding:6px;font-size:12px;margin-top:4px;">Vote</button>` : ''}
                        ${hasVoted && !vote.closed && !isMyVote && auth.currentUser ? `<button onclick="event.stopPropagation(); submitSeasonalVote(${c.mal_id})" class="action-btn" style="width:100%;justify-content:center;padding:6px;font-size:11px;margin-top:4px;background:transparent;color:var(--text-dark);border:1px solid var(--border-color);">Change Vote</button>` : ''}
                        ${isMyVote && !vote.closed ? `<div style="font-size:11px;font-weight:700;color:var(--accent-yellow);margin-top:6px;text-align:center;">✓ Your Vote</div>` : ''}
                        ${vote.closed && placeLabel ? `<div style="font-size:11px;font-weight:700;color:${placeColors[winnerIdx]};margin-top:4px;">${placeLabel}</div>` : ''}
                    </div>
                </div>`;
            }).join('') + '</div>';
    });
};

// --- TIER LIST SYSTEM ---
window.tierListState = null;
window.tlDragging = null;
const TL_COLORS = ['#FF7F7F','#FFBF7F','#FFFF7F','#7FFF7F','#7FBFFF','#BF7FFF','#FF7FBF'];
const TL_DEFAULT_TIERS = () => [
    { label:'S', color:'#FF7F7F', items:[] }, { label:'A', color:'#FFBF7F', items:[] },
    { label:'B', color:'#FFFF7F', items:[] }, { label:'C', color:'#7FFF7F', items:[] },
    { label:'D', color:'#7FBFFF', items:[] }
];

window.openTierListCreator = function() {
    if (!auth.currentUser) return window.openAuthModal();
    window.tierListState = { editingId:null, type:null, sourceAnimeId:null, sourceAnimeTitle:null, tiers:TL_DEFAULT_TIERS(), unranked:[], isPublic:true };
    window.closeAllModals();
    document.getElementById('tier-list-creator').style.display = 'flex';
    window.showTierStep('type');
};

window.useAsTemplate = async function(id) {
    if (!auth.currentUser) return window.openAuthModal();
    try {
        const d = await getDoc(doc(db, 'tier_lists', id));
        if (!d.exists()) return;
        const tl = d.data();
        const templateTiers = tl.tiers.map(t => ({ ...t, items: [] }));
        window.tierListState = {
            editingId: null,
            type: tl.type || 'anime',
            sourceAnimeId: tl.sourceAnimeId || null,
            sourceAnimeTitle: tl.sourceAnimeTitle || null,
            tiers: templateTiers,
            unranked: [],
            isPublic: true
        };
        window.closeAllModals();
        document.getElementById('tier-list-creator').style.display = 'flex';
        if (tl.type === 'characters' && tl.sourceAnimeId) {
            // Load characters for the same source anime
            await window.selectTierSource(tl.sourceAnimeId, tl.sourceAnimeTitle, tl._sourceAnimeImage || null);
        } else {
            document.getElementById('tl-source-label').innerText = 'Anime tier list';
            window.showTierStep('editor');
            window.renderTierEditor();
        }
    } catch(e) { console.error(e); alert('Could not load template.'); }
};

window.showTierStep = function(step) {
    ['type','source','editor'].forEach(s => { const el = document.getElementById(`tl-step-${s}`); if(el) el.style.display = 'none'; });
    const el = document.getElementById(`tl-step-${step}`); if(el) el.style.display = 'block';
};

window.selectTierListType = function(type) {
    window.tierListState.type = type;
    if (type === 'characters') { window.showTierStep('source'); }
    else { window.showTierStep('editor'); document.getElementById('tl-source-label').innerText = 'Anime tier list'; window.renderTierEditor(); }
};

window.searchTierSource = async function() {
    const q = document.getElementById('tl-source-search').value.trim();
    const results = document.getElementById('tl-source-results');
    if (q.length < 2) { results.innerHTML = ''; return; }
    results.innerHTML = '<div class="loading" style="padding:12px;">Searching...</div>';
    try {
        const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=8&type=tv`);
        const { data } = await res.json();
        results.innerHTML = (data || []).map(a => `
            <div onclick="selectTierSource(${a.mal_id},'${(a.title_english||a.title).replace(/'/g,"\\'")}','${a.images.jpg.image_url}')"
                style="display:flex;align-items:center;gap:12px;padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--bg-gray);background:var(--bg-white);"
                onmouseover="this.style.background='var(--bg-gray)'" onmouseout="this.style.background='var(--bg-white)'">
                <img src="${a.images.jpg.image_url}" style="width:36px;height:50px;object-fit:cover;border-radius:4px;flex-shrink:0;">
                <span style="font-weight:600;font-size:14px;">${a.title_english||a.title}</span>
            </div>`).join('');
    } catch(e) { results.innerHTML = '<div style="padding:12px;color:var(--text-muted);">Failed to search.</div>'; }
};

window.selectTierSource = async function(malId, title, imageUrl) {
    window.tierListState.sourceAnimeId = malId; window.tierListState.sourceAnimeTitle = title; window.tierListState._sourceAnimeImage = imageUrl || null;
    window.showTierStep('editor');
    document.getElementById('tl-source-label').innerText = `Characters from: ${title}`;
    window.tierListState.unranked = [];
    window.renderTierEditor();
    const zone = document.getElementById('tl-unranked-zone');
    if (zone) zone.innerHTML = '<div class="loading" style="padding:10px;">Loading characters...</div>';
    try {
        const res = await fetch(`https://api.jikan.moe/v4/anime/${malId}/characters`);
        const { data } = await res.json();
        const toItem = c => ({ id:`char_${c.character.mal_id}`, title:c.character.name, image:c.character.images?.jpg?.image_url||'' });
        const mains = (data||[]).filter(c=>c.role==='Main').sort((a,b)=>(b.favorites||0)-(a.favorites||0)).map(toItem);
        const supporting = (data||[]).filter(c=>c.role==='Supporting').sort((a,b)=>(b.favorites||0)-(a.favorites||0)).map(toItem);
        window.tierListState.unranked = [...mains, ...supporting];
        window.renderTierEditor();
    } catch(e) { if(zone) zone.innerHTML = '<div style="color:var(--text-muted);padding:10px;">Failed to load characters.</div>'; }
};

window.renderTierEditor = function() {
    const tc = document.getElementById('tl-tiers-container');
    const uz = document.getElementById('tl-unranked-zone');
    if (!tc || !uz) return;
    const st = window.tierListState;
    tc.innerHTML = st.tiers.map((tier, i) => `
        <div class="tl-tier-row" draggable="true"
            ondragstart="window.tlTierDragStart(event,${i})"
            ondragover="window.tlTierDragOver(event,${i})"
            ondrop="window.tlTierDrop(event,${i})"
            ondragleave="this.classList.remove('tl-tier-drag-over')"
            ondragend="window.tlTierDragEnd()"
            style="display:flex;min-height:80px;margin-bottom:3px;border-radius:8px;overflow:hidden;">
            <div style="width:72px;flex-shrink:0;background:${tier.color};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:4px;">
                <div style="color:rgba(255,255,255,0.7);font-size:18px;cursor:grab;user-select:none;line-height:1;" title="Drag to reorder tier">⠿</div>
                <input type="text" value="${tier.label}" maxlength="4" onclick="this.select()"
                    oninput="window.tierListState.tiers[${i}].label=this.value"
                    style="background:transparent;border:none;text-align:center;font-size:22px;font-weight:900;color:white;text-shadow:0 1px 3px rgba(0,0,0,0.5);width:100%;outline:none;cursor:text;">
                <input type="color" value="${tier.color}" oninput="window.tierListState.tiers[${i}].color=this.value; window.renderTierEditor()"
                    style="width:28px;height:18px;border:none;border-radius:3px;cursor:pointer;padding:0;">
                <button onclick="removeTierRow(${i})" style="background:rgba(0,0,0,0.25);color:white;border:none;border-radius:4px;font-size:10px;padding:2px 6px;cursor:pointer;">✕</button>
            </div>
            <div class="tl-drop-zone" ondragover="tlDragOver(event)" ondrop="tlDrop(event,'tier_${i}')" ondragleave="this.classList.remove('drag-over')"
                style="flex:1;background:${tier.color}22;display:flex;flex-wrap:wrap;gap:6px;padding:8px;align-content:flex-start;min-height:80px;border-left:2px solid ${tier.color}88;">
                ${tier.items.map(item => window.renderTlItem(item,`tier_${i}`)).join('')}
            </div>
        </div>`).join('');
    uz.innerHTML = st.unranked.length === 0
        ? '<div style="color:var(--text-muted);font-size:13px;padding:8px;">Use the search below to add items, then drag them into tiers</div>'
        : st.unranked.map(item => window.renderTlItem(item,'unranked')).join('');
};

window.renderTlItem = function(item, zone) {
    const safe = item.title.replace(/'/g,"\\'").replace(/"/g,'&quot;');
    return `<div draggable="true"
        ondragstart="tlDragStart(event,'${item.id}','${zone}')"
        ondragover="tlItemDragOver(event,'${item.id}','${zone}')"
        ondrop="tlDropOnItem(event,'${item.id}','${zone}')"
        ondragleave="this.classList.remove('tl-item-drag-over')"
        style="width:65px;flex-shrink:0;cursor:grab;position:relative;user-select:none;" title="${safe}">
        <img src="${item.image}" style="width:65px;height:88px;object-fit:cover;border-radius:6px;display:block;background:var(--bg-gray-darker);" onerror="this.style.background='var(--bg-gray-darker)'">
        <div style="font-size:9px;color:var(--text-dark);text-align:center;line-height:1.2;margin-top:3px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${item.title}</div>
        <button onclick="event.stopPropagation();removeTlItem('${item.id}')"
            style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.7);color:white;border:none;border-radius:50%;width:16px;height:16px;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;">✕</button>
    </div>`;
};

// Item drag — stopPropagation prevents the parent tier row from also firing tlTierDragStart
window.tlDragStart = function(e, itemId, fromZone) {
    e.stopPropagation();
    window.tlDragging = { itemId, fromZone };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', itemId);
};

// Zone drag-over — skip if a tier row is being dragged
window.tlDragOver = function(e) {
    if (window.tlTierDragging !== null) return;
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
};

// Zone drop — append to end of zone (item-on-item drops are handled by tlDropOnItem)
window.tlDrop = function(e, toZone) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    if (window.tlTierDragging !== null || !window.tlDragging) return;
    const { itemId, fromZone } = window.tlDragging; window.tlDragging = null;
    const st = window.tierListState; let item = null;
    if (fromZone === 'unranked') { const i = st.unranked.findIndex(x=>x.id===itemId); if(i!==-1) item=st.unranked.splice(i,1)[0]; }
    else { const ti=parseInt(fromZone.replace('tier_','')); if(st.tiers[ti]){const i=st.tiers[ti].items.findIndex(x=>x.id===itemId);if(i!==-1)item=st.tiers[ti].items.splice(i,1)[0];} }
    if (!item) return;
    if (toZone==='unranked') { st.unranked.push(item); }
    else { const ti=parseInt(toZone.replace('tier_','')); if(st.tiers[ti]) st.tiers[ti].items.push(item); }
    window.renderTierEditor();
};

// Item-on-item drag-over — highlights target, stops bubbling so zone doesn't also highlight
window.tlItemDragOver = function(e, targetId, zone) {
    if (window.tlTierDragging !== null) return;
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('.tl-item-drag-over').forEach(el => el.classList.remove('tl-item-drag-over'));
    if (window.tlDragging?.itemId !== targetId) e.currentTarget.classList.add('tl-item-drag-over');
};

// Item-on-item drop — inserts before target item, works within same tier or across tiers
window.tlDropOnItem = function(e, targetId, toZone) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('tl-item-drag-over');
    if (!window.tlDragging) return;
    const { itemId, fromZone } = window.tlDragging; window.tlDragging = null;
    if (itemId === targetId) return;
    const st = window.tierListState; let item = null;
    if (fromZone === 'unranked') { const i = st.unranked.findIndex(x=>x.id===itemId); if(i!==-1) item=st.unranked.splice(i,1)[0]; }
    else { const ti=parseInt(fromZone.replace('tier_','')); if(st.tiers[ti]){const i=st.tiers[ti].items.findIndex(x=>x.id===itemId);if(i!==-1)item=st.tiers[ti].items.splice(i,1)[0];} }
    if (!item) return;
    if (toZone==='unranked') { const idx=st.unranked.findIndex(x=>x.id===targetId); st.unranked.splice(idx<0?st.unranked.length:idx,0,item); }
    else { const ti=parseInt(toZone.replace('tier_','')); if(st.tiers[ti]){const idx=st.tiers[ti].items.findIndex(x=>x.id===targetId); st.tiers[ti].items.splice(idx<0?st.tiers[ti].items.length:idx,0,item);} }
    window.renderTierEditor();
};

// Tier row drag — moves entire tier (with all its contents) to a new position
window.tlTierDragging = null;
window.tlTierDragStart = function(e, tierIdx) {
    window.tlTierDragging = tierIdx;
    e.dataTransfer.effectAllowed = 'move';
};
window.tlTierDragOver = function(e, tierIdx) {
    e.preventDefault();
    e.stopPropagation();
    if (window.tlTierDragging === null || window.tlTierDragging === tierIdx) return;
    document.querySelectorAll('.tl-tier-row').forEach(el => el.classList.remove('tl-tier-drag-over'));
    e.currentTarget.classList.add('tl-tier-drag-over');
};
window.tlTierDrop = function(e, tierIdx) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('tl-tier-drag-over');
    if (window.tlTierDragging === null || window.tlTierDragging === tierIdx) { window.tlTierDragging = null; return; }
    const fromIdx = window.tlTierDragging; window.tlTierDragging = null;
    const st = window.tierListState;
    const [tier] = st.tiers.splice(fromIdx, 1);
    st.tiers.splice(tierIdx, 0, tier);
    window.renderTierEditor();
};
window.tlTierDragEnd = function() {
    window.tlTierDragging = null;
    document.querySelectorAll('.tl-tier-drag-over, .tl-item-drag-over').forEach(el => {
        el.classList.remove('tl-tier-drag-over', 'tl-item-drag-over');
    });
};

window.addTierRow = function() {
    const st = window.tierListState;
    const used = st.tiers.map(t=>t.label);
    const label = ['S','A','B','C','D','E','F','G','H','?'].find(l=>!used.includes(l))||'?';
    st.tiers.push({ label, color:TL_COLORS[st.tiers.length%TL_COLORS.length], items:[] });
    window.renderTierEditor();
};

window.removeTierRow = function(index) {
    const removed = window.tierListState.tiers.splice(index,1)[0];
    window.tierListState.unranked.push(...removed.items);
    window.renderTierEditor();
};

window.removeTlItem = function(itemId) {
    const st = window.tierListState;
    st.unranked = st.unranked.filter(x=>x.id!==itemId);
    st.tiers.forEach(t => { t.items=t.items.filter(x=>x.id!==itemId); });
    window.renderTierEditor();
};

window.searchTierPool = async function() {
    const q = document.getElementById('tl-pool-search').value.trim();
    const results = document.getElementById('tl-pool-results');
    if (q.length < 2) { results.innerHTML=''; return; }
    try {
        const isChar = window.tierListState?.type === 'characters';
        const url = isChar ? `https://api.jikan.moe/v4/characters?q=${encodeURIComponent(q)}&limit=8` : `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=8`;
        const res = await fetch(url); const { data } = await res.json();
        results.innerHTML = (data||[]).map(item => {
            const id = isChar ? `char_${item.mal_id}` : String(item.mal_id);
            const title = isChar ? item.name : (item.title_english||item.title);
            const image = isChar ? (item.images?.jpg?.image_url||'') : item.images.jpg.image_url;
            const safe = title.replace(/'/g,"\\'"); const safeImg = image.replace(/'/g,"\\'");
            return `<div onclick="addToTierPool({id:'${id}',title:'${safe}',image:'${safeImg}'})"
                style="display:flex;align-items:center;gap:10px;padding:8px 10px;cursor:pointer;border-radius:6px;margin-bottom:2px;"
                onmouseover="this.style.background='var(--bg-gray-darker)'" onmouseout="this.style.background='transparent'">
                <img src="${image}" style="width:32px;height:45px;object-fit:cover;border-radius:4px;flex-shrink:0;" onerror="this.style.background='var(--bg-gray-darker)'">
                <span style="font-size:13px;flex:1;">${title}</span>
                <span class="material-symbols-outlined" style="color:var(--accent-yellow);font-size:20px;">add_circle</span>
            </div>`;
        }).join('');
    } catch(e) {}
};

window.addToTierPool = function(item) {
    const st = window.tierListState;
    const all = [...st.unranked, ...st.tiers.flatMap(t=>t.items)];
    if (all.some(x=>x.id===item.id)) return;
    st.unranked.push(item);
    document.getElementById('tl-pool-search').value='';
    document.getElementById('tl-pool-results').innerHTML='';
    window.renderTierEditor();
};

window.saveTierList = async function() {
    if (!auth.currentUser) return window.openAuthModal();
    const st = window.tierListState;
    const title = document.getElementById('tl-title-input').value.trim();
    if (!title) return alert('Please give your tier list a title.');
    const isPublic = document.getElementById('tl-public-toggle').checked;
    const pd = await getDoc(doc(db,"profiles",auth.currentUser.uid)).catch(()=>null);
    const displayName = pd?.data()?.displayName || auth.currentUser.displayName;
    const myAvatar = auth.currentUser.photoURL || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(displayName)}&backgroundColor=ffc107&fontColor=333333`;
    const _allItems = [...(st.tiers||[]).flatMap(t => t.items||[]), ...(st.unranked||[])];
    const coverImage = st._sourceAnimeImage || _allItems.find(i => i.image)?.image || null;
    const data = { uid:auth.currentUser.uid, authorName:displayName, authorAvatar:myAvatar, title, type:st.type, sourceAnimeId:st.sourceAnimeId||null, sourceAnimeTitle:st.sourceAnimeTitle||null, coverImage, tiers:st.tiers, unranked:st.unranked, public:isPublic, updatedAt:new Date() };
    try {
        if (st.editingId) { await updateDoc(doc(db,"tier_lists",st.editingId), data); }
        else { await addDoc(collection(db,"tier_lists"), { ...data, likes:[], dislikes:[], commentCount:0, timestamp:new Date() }); }
        window.closeAllModals();
        if (window.currentActiveViewId==='profile-view') window.loadTierListsTab(auth.currentUser.uid);
    } catch(e) { alert('Failed to save.'); console.error(e); }
};

window.loadTierListsTab = async function(uid) {
    const container = document.getElementById('tier-lists-container');
    if (!container) return;
    container.innerHTML = '<div class="loading">Loading tier lists...</div>';
    const isMe = auth.currentUser && uid===auth.currentUser.uid;
    try {
        const snap = await getDocs(isMe
            ? query(collection(db,"tier_lists"),where("uid","==",uid))
            : query(collection(db,"tier_lists"),where("uid","==",uid),where("public","==",true)));
        const sortedDocs = [...snap.docs].sort((a,b) => (b.data().timestamp?.toMillis?.() || 0) - (a.data().timestamp?.toMillis?.() || 0));
        let html = isMe ? `<div style="margin-bottom:16px;"><button onclick="openTierListCreator()" class="action-btn"><span class="material-symbols-outlined">add</span> Create Tier List</button></div>` : '';
        if (snap.empty) { html += `<p style="color:var(--text-muted);text-align:center;padding:30px;">${isMe?'No tier lists yet — create your first!':'No public tier lists yet.'}</p>`; container.innerHTML=html; return; }
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;">';
        sortedDocs.forEach(d => { html += renderTierListCard(d.id, d.data()); });
        html += '</div>'; container.innerHTML=html;
    } catch(e) { container.innerHTML='<p style="color:var(--text-muted);text-align:center;padding:30px;">Failed to load tier lists.</p>'; console.error(e); }
};

window.openTierListViewer = async function(id) {
    const viewerEl=document.getElementById('tier-list-viewer');
    const contentEl=document.getElementById('tier-list-viewer-content');
    if (!viewerEl||!contentEl) return;
    contentEl.innerHTML='<div class="loading">Loading...</div>';
    window.closeAllModals(); viewerEl.style.display='flex';
    try {
        const d=await getDoc(doc(db,"tier_lists",id)); if(!d.exists()){contentEl.innerHTML='<p>Not found.</p>';return;}
        const tl=d.data(); const isOwner=auth.currentUser&&tl.uid===auth.currentUser.uid;
        const liked=auth.currentUser&&(tl.likes||[]).includes(auth.currentUser.uid);
        let html=`<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
            <div>
                <h2 style="margin:0 0 6px;">${tl.title}</h2>
                <div style="display:flex;align-items:center;gap:8px;">
                    <img src="${tl.authorAvatar}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;" onerror="this.style.display='none'">
                    <span style="font-size:13px;color:var(--text-muted);">by <strong style="color:var(--text-dark);">${tl.authorName}</strong>${tl.type==='characters'&&tl.sourceAnimeTitle?` · Characters from <em>${tl.sourceAnimeTitle}</em>`:' · Anime'}</span>
                </div>
            </div>
            <div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;">
                <button onclick="likeTierList('${id}',this)" class="action-btn" style="padding:6px 14px;${liked?'background:var(--accent-yellow);':'background:var(--bg-gray-darker);color:var(--text-dark);'}">
                    <span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;">${liked?'favorite':'favorite_border'}</span> ${(tl.likes||[]).length}
                </button>
                <button onclick="shareTierList('${id}')" class="action-btn" style="background:var(--bg-gray-darker);color:var(--text-dark);padding:6px 12px;" title="Copy share link">
                    <span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;">share</span>
                </button>
                <button onclick="window.useAsTemplate('${id}')" class="action-btn" style="background:var(--bg-gray-darker);color:var(--text-dark);padding:6px 12px;" title="Use this tier structure as a template">
                    <span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;">content_copy</span> Use as Template
                </button>
                <button onclick="window.openTierListCreator()" class="action-btn" style="background:var(--bg-gray-darker);color:var(--text-dark);padding:6px 12px;" title="Start a brand new tier list">
                    <span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;">add</span> Start Fresh
                </button>
                ${isOwner?`<button onclick="editTierList('${id}')" class="action-btn" style="background:var(--bg-gray-darker);color:var(--text-dark);padding:6px 12px;"><span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;">edit</span></button>`:''}
                ${isOwner?`<button onclick="deleteTierList('${id}')" class="action-btn" style="background:#FF5252;color:white;padding:6px 12px;"><span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;">delete</span></button>`:''}
                <button onclick="closeAllModals()" class="cancel-btn">Close</button>
            </div>
        </div>`;
        tl.tiers.forEach(tier => {
            if (tier.items.length===0) return;
            html+=`<div style="display:flex;min-height:80px;margin-bottom:3px;border-radius:8px;overflow:hidden;">
                <div style="width:72px;flex-shrink:0;background:${tier.color};display:flex;align-items:center;justify-content:center;">
                    <span style="font-size:24px;font-weight:900;color:white;text-shadow:0 1px 3px rgba(0,0,0,0.4);">${tier.label}</span>
                </div>
                <div style="flex:1;background:${tier.color}22;display:flex;flex-wrap:wrap;gap:6px;padding:8px;border-left:2px solid ${tier.color}88;align-content:flex-start;">
                    ${tier.items.map(item=>`<div style="width:65px;flex-shrink:0;" title="${item.title}">
                        <img src="${item.image}" style="width:65px;height:88px;object-fit:cover;border-radius:6px;display:block;background:var(--bg-gray-darker);" onerror="this.style.background='var(--bg-gray-darker)'">
                        <div style="font-size:9px;text-align:center;line-height:1.2;margin-top:3px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${item.title}</div>
                    </div>`).join('')}
                </div>
            </div>`;
        });
        contentEl.innerHTML=html;
    } catch(e) { contentEl.innerHTML='<p>Failed to load.</p>'; console.error(e); }
};

window.likeTierList = async function(id, btn) {
    if (!auth.currentUser) return window.openAuthModal();
    try {
        const d=await getDoc(doc(db,"tier_lists",id)); if(!d.exists()) return;
        const likes=d.data().likes||[]; const uid=auth.currentUser.uid;
        const newLikes=likes.includes(uid)?likes.filter(x=>x!==uid):[...likes,uid];
        await updateDoc(doc(db,"tier_lists",id),{likes:newLikes});
        const liked=newLikes.includes(uid);
        btn.style.background=liked?'var(--accent-yellow)':'var(--bg-gray-darker)'; btn.style.color=liked?'':'var(--text-dark)';
        btn.innerHTML=`<span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;">${liked?'favorite':'favorite_border'}</span> ${newLikes.length}`;
    } catch(e) { console.error(e); }
};

window.shareTierList = function(id) {
    const url = `${window.location.origin}/?tl=${id}`;
    navigator.clipboard.writeText(url).then(() => {
        alert('Link copied to clipboard!');
    }).catch(() => {
        prompt('Copy this link:', url);
    });
};

window.fetchHomepageTierLists = function() {
    if (window.currentActiveViewId === 'home-view') window.fetchHomeActivityFeed();
};

window.allCommunityTierLists = [];
window.fetchCommunityTierLists = async function() {
    const feed = document.getElementById('community-tierlists-feed');
    if (!feed) return;
    feed.innerHTML = '<div class="loading">Loading tier lists...</div>';
    try {
        const snap = await getDocs(query(collection(db, "tier_lists"), where("public", "==", true)));
        window.allCommunityTierLists = snap.docs.sort((a,b) => (b.data().timestamp?.toMillis?.() || 0) - (a.data().timestamp?.toMillis?.() || 0));
        window.filterCommunityTierLists();
    } catch(e) { feed.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px;">Failed to load.</p>'; }
};

window.filterCommunityTierLists = function() {
    const feed = document.getElementById('community-tierlists-feed');
    const q = (document.getElementById('community-tl-search')?.value || '').toLowerCase();
    const filtered = window.allCommunityTierLists.filter(d => {
        if (!q) return true;
        const tl = d.data();
        return tl.title?.toLowerCase().includes(q) || tl.authorName?.toLowerCase().includes(q) || tl.sourceAnimeTitle?.toLowerCase().includes(q);
    });
    if (!feed) return;
    if (filtered.length === 0) { feed.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px;">No tier lists found.</p>'; return; }
    feed.innerHTML = filtered.map(d => renderTierListCard(d.id, d.data())).join('');
};

function renderTierListCard(id, tl) {
    const preview = tl.tiers.map(t => `<span style="background:${t.color};color:#333;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;">${t.label}</span>`).join('');
    const count = tl.tiers.reduce((a,t) => a+t.items.length, 0);
    const date = tl.timestamp?.toDate ? new Date(tl.timestamp.toDate()).toLocaleDateString() : '';
    return `<div onclick="openTierListViewer('${id}')" style="background:var(--bg-gray);border-radius:12px;padding:16px;cursor:pointer;border:1px solid var(--border-color);transition:transform 0.15s;" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform=''">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <img src="${tl.authorAvatar||''}" style="width:26px;height:26px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'">
            <span style="font-size:12px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${tl.authorName}</span>
        </div>
        <div style="font-weight:700;font-size:15px;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${tl.title}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">${tl.type==='characters'&&tl.sourceAnimeTitle?`Characters · ${tl.sourceAnimeTitle}`:'Anime'} · ${date}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">${preview}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;">
            <div style="font-size:12px;color:var(--text-muted);">${count} item${count!==1?'s':''} ranked · ❤️ ${(tl.likes||[]).length}</div>
            <button onclick="event.stopPropagation(); window.useAsTemplate('${id}')" class="action-btn" style="font-size:11px;padding:4px 10px;background:var(--bg-gray-darker);color:var(--text-dark);">
                <span class="material-symbols-outlined" style="font-size:13px;vertical-align:middle;">content_copy</span> Make One
            </button>
        </div>
    </div>`;
}

window.deleteTierList = async function(id) {
    if (!auth.currentUser) return;
    if (!confirm('Delete this tier list? This cannot be undone.')) return;
    try {
        await deleteDoc(doc(db, "tier_lists", id));
        window.closeAllModals();
        if (window.currentActiveViewId === 'profile-view') window.loadTierListsTab(auth.currentUser.uid);
        if (window.currentActiveViewId === 'community-view') window.fetchCommunityTierLists();
        window.fetchHomepageTierLists();
    } catch(e) { alert('Failed to delete.'); console.error(e); }
};

window.editTierList = async function(id) {
    const d=await getDoc(doc(db,"tier_lists",id)); if(!d.exists()) return;
    const tl=d.data();
    window.tierListState={ editingId:id, type:tl.type, sourceAnimeId:tl.sourceAnimeId, sourceAnimeTitle:tl.sourceAnimeTitle, tiers:tl.tiers, unranked:tl.unranked, isPublic:tl.public };
    window.closeAllModals();
    document.getElementById('tier-list-creator').style.display='flex';
    window.showTierStep('editor');
    document.getElementById('tl-title-input').value=tl.title;
    document.getElementById('tl-public-toggle').checked=tl.public;
    document.getElementById('tl-source-label').innerText=tl.type==='characters'?`Characters from: ${tl.sourceAnimeTitle}`:'Anime tier list';
    window.renderTierEditor();
};

// --- PATCH NOTES ---
window.currentPatchNotes = [];

window.loadPatchNotes = async function() {
    try {
        const snap = await getDocs(query(collection(db, "patch_notes"), orderBy("timestamp", "desc"), limit(20)));
        window.currentPatchNotes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const feed = document.getElementById('patch-notes-feed');
        const section = document.getElementById('patch-notes-section');
        if (!feed || !section) return;
        if (snap.empty) { section.style.display = 'none'; return; }
        section.style.display = 'block';
        feed.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';

        const VISIBLE = 4;
        const renderCard = (p, i) => `
            <div class="news-card${i >= VISIBLE ? ' pn-hidden' : ''}" onclick="openPatchNoteModal(${i})" style="cursor:pointer; position:relative;${i >= VISIBLE ? 'display:none;' : ''}">
                <div style="background:var(--accent-yellow); height:6px; border-radius:10px 10px 0 0;"></div>
                <div class="news-content">
                    ${i === 0 ? '<div style="display:inline-block;background:var(--accent-yellow);color:#111;font-size:10px;font-weight:800;padding:2px 10px;border-radius:20px;letter-spacing:0.5px;margin-bottom:10px;">✦ LATEST</div>' : ''}
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                        <img src="${p.authorAvatar || ''}" style="width:28px; height:28px; border-radius:50%; object-fit:cover;" onerror="this.style.display='none'">
                        <div>
                            <div style="font-size:11px; font-weight:700; color:var(--accent-yellow);">WeeBee Update</div>
                            <div style="font-size:10px; color:var(--text-muted);">${p.authorName || 'WeeBee'}</div>
                        </div>
                    </div>
                    <h3 style="font-size:14px; font-weight:700; margin-bottom:6px; line-height:1.4;">${p.title}</h3>
                    <p style="font-size:12px; color:var(--text-muted); display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; line-height:1.5;">${p.body.replace(/\n/g, ' ')}</p>
                    <div class="news-footer" style="margin-top:10px;">
                        <span style="font-size:11px; color:var(--text-muted);">${p.timestamp?.toDate ? new Date(p.timestamp.toDate()).toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'}) : ''}</span>
                        <span class="news-link" style="font-size:12px;">Read More</span>
                    </div>
                </div>
            </div>`;

        feed.innerHTML = window.currentPatchNotes.map(renderCard).join('');

        // Show more button spanning full grid width
        if (window.currentPatchNotes.length > VISIBLE) {
            const remaining = window.currentPatchNotes.length - VISIBLE;
            feed.insertAdjacentHTML('beforeend', `
                <div id="pn-show-more" style="grid-column:1/-1; text-align:center; padding-top:4px;">
                    <button onclick="window.expandPatchNotes()" class="action-btn" style="background:var(--bg-gray-darker);color:var(--text-dark);">
                        <span class="material-symbols-outlined" style="font-size:16px;">expand_more</span> Show ${remaining} older update${remaining !== 1 ? 's' : ''}
                    </button>
                </div>`);
        }
        window.checkPatchNoteBadge();
    } catch(e) { console.error('loadPatchNotes', e); }
};

window.expandPatchNotes = function() {
    document.querySelectorAll('.pn-hidden').forEach(el => el.style.display = '');
    const btn = document.getElementById('pn-show-more');
    if (btn) btn.style.display = 'none';
};

window.openPatchNoteModal = function(index) {
    const p = window.currentPatchNotes[index];
    if (!p) return;
    document.getElementById('article-reader-img').style.display = 'none';
    document.getElementById('article-reader-anime').innerText = 'WeeBee Patch Notes';
    document.getElementById('article-reader-anime').onclick = null;
    document.getElementById('article-reader-date').innerText = p.timestamp?.toDate ? new Date(p.timestamp.toDate()).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }) : '';
    document.getElementById('article-reader-title').innerText = p.title;
    const body = document.getElementById('article-reader-body');
    body.style.whiteSpace = 'pre-line';
    body.innerText = p.body;
    document.getElementById('article-reader-link').style.display = 'none';
    window.currentArticleReactionId = p.id;
    const uid = auth.currentUser?.uid;
    const likes = p.likes || [];
    const dislikes = p.dislikes || [];
    const reactionsEl = document.getElementById('article-reader-reactions');
    reactionsEl.style.display = 'flex';
    document.getElementById('article-like-count').innerText = likes.length;
    document.getElementById('article-dislike-count').innerText = dislikes.length;
    document.getElementById('article-like-btn').style.color = uid && likes.includes(uid) ? 'var(--accent-yellow)' : 'var(--text-dark)';
    document.getElementById('article-dislike-btn').style.color = uid && dislikes.includes(uid) ? '#FF5252' : 'var(--text-dark)';
    window.closeAllModals();
    document.getElementById('article-reader-modal').style.display = 'flex';
};

window.submitPatchNote = async function() {
    if (!auth.currentUser || !window.isAdmin) return;
    const title = document.getElementById('patch-notes-title').value.trim();
    const body = document.getElementById('patch-notes-body').value.trim();
    if (!title || !body) return alert('Please fill in both the title and body.');
    try {
        const myAvatar = auth.currentUser.photoURL || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(auth.currentUser.displayName)}&backgroundColor=ffc107&fontColor=333333`;
        await addDoc(collection(db, "patch_notes"), {
            title, body,
            authorName: auth.currentUser.displayName,
            authorAvatar: myAvatar,
            timestamp: new Date()
        });
        document.getElementById('patch-notes-title').value = '';
        document.getElementById('patch-notes-body').value = '';
        await window.loadPatchNotes();
        alert('Patch notes posted!');
    } catch(e) { alert('Failed to post.'); console.error(e); }
};

window.toggleArticleReaction = async function(type) {
    if (!auth.currentUser) return window.openAuthModal();
    const id = window.currentArticleReactionId;
    if (!id) return;
    const uid = auth.currentUser.uid;
    const pRef = doc(db, "patch_notes", id);
    const pSnap = await getDoc(pRef);
    if (!pSnap.exists()) return;
    let likes = [...(pSnap.data().likes || [])];
    let dislikes = [...(pSnap.data().dislikes || [])];
    if (type === 'like') {
        likes = likes.includes(uid) ? likes.filter(u => u !== uid) : [...likes.filter(u => u !== uid), uid];
        dislikes = dislikes.filter(u => u !== uid);
    } else {
        dislikes = dislikes.includes(uid) ? dislikes.filter(u => u !== uid) : [...dislikes.filter(u => u !== uid), uid];
        likes = likes.filter(u => u !== uid);
    }
    await updateDoc(pRef, { likes, dislikes });
    document.getElementById('article-like-count').innerText = likes.length;
    document.getElementById('article-dislike-count').innerText = dislikes.length;
    document.getElementById('article-like-btn').style.color = likes.includes(uid) ? 'var(--accent-yellow)' : 'var(--text-dark)';
    document.getElementById('article-dislike-btn').style.color = dislikes.includes(uid) ? '#FF5252' : 'var(--text-dark)';
    const cached = window.currentPatchNotes.find(p => p.id === id);
    if (cached) { cached.likes = likes; cached.dislikes = dislikes; }
};

window.checkPatchNoteBadge = function() {
    const badge = document.getElementById('news-badge');
    if (!badge || window.currentPatchNotes.length === 0) return;
    const lastRead = parseInt(localStorage.getItem('weebee-last-read-patch') || '0');
    const latest = window.currentPatchNotes[0]?.timestamp?.toDate
        ? window.currentPatchNotes[0].timestamp.toDate().getTime()
        : 0;
    const unread = window.currentPatchNotes.filter(p => {
        const t = p.timestamp?.toDate ? p.timestamp.toDate().getTime() : 0;
        return t > lastRead;
    }).length;
    if (unread > 0) { badge.innerText = unread; badge.style.display = 'flex'; }
    else { badge.style.display = 'none'; }
};

window.clearPatchNoteBadge = function() {
    localStorage.setItem('weebee-last-read-patch', Date.now().toString());
    const badge = document.getElementById('news-badge');
    if (badge) badge.style.display = 'none';
};

window.currentNewsArticles = [];

window.openArticleModal = function(index) {
    const item = window.currentNewsArticles[index];
    if (!item) return;
    window.currentArticleReactionId = null;
    document.getElementById('article-reader-reactions').style.display = 'none';
    document.getElementById('article-reader-link').style.display = 'inline-flex';
    document.getElementById('article-reader-body').style.whiteSpace = 'normal';
    const img = document.getElementById('article-reader-img');
    const imgUrl = item.images?.jpg?.image_url || '';
    if (imgUrl) { img.src = imgUrl; img.style.display = 'block'; } else { img.style.display = 'none'; }
    document.getElementById('article-reader-title').innerText = item.title || '';
    document.getElementById('article-reader-body').innerText = item.excerpt || 'No preview available for this article.';
    document.getElementById('article-reader-date').innerText = item.date ? new Date(item.date).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }) : '';
    const animeEl = document.getElementById('article-reader-anime');
    animeEl.innerText = item.animeTitle || '';
    animeEl.onclick = item.animeId ? () => { window.closeAllModals(); window.loadAnimeDetails(item.animeId); } : null;
    document.getElementById('article-reader-link').href = item.url || '#';
    window.closeAllModals();
    document.getElementById('article-reader-modal').style.display = 'flex';
};

window.fetchGlobalNews = async function() {
    const container = document.getElementById('global-news-feed');
    container.innerHTML = '<div class="loading">Sourcing latest headlines...</div>';
    try {
        const res = await fetch('https://api.jikan.moe/v4/seasons/now?limit=6');
        const { data: seasonal } = await res.json();
        const topAnime = (seasonal || []).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
        let allNews = [];
        const seenTitles = new Set();
        for (const anime of topAnime) {
            await new Promise(r => setTimeout(r, 420));
            try {
                const newsRes = await fetch(`https://api.jikan.moe/v4/anime/${anime.mal_id}/news?limit=5`);
                const { data: news } = await newsRes.json();
                (news || []).slice(0, 5).forEach(item => {
                    if (!seenTitles.has(item.title)) {
                        seenTitles.add(item.title);
                        allNews.push({ ...item, animeTitle: anime.title_english || anime.title, animeId: anime.mal_id });
                    }
                });
            } catch(_) {}
        }
        allNews.sort((a, b) => new Date(b.date) - new Date(a.date));
        window.currentNewsArticles = allNews;
        if (allNews.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:40px;">No news found right now. Check back later!</p>';
            return;
        }
        container.innerHTML = allNews.map((item, i) => `
            <div class="news-card" onclick="openArticleModal(${i})" style="cursor:pointer;">
                <img src="${item.images?.jpg?.image_url || ''}" onerror="this.style.display='none'" style="width:100%; height:160px; object-fit:cover; border-radius:10px 10px 0 0;">
                <div class="news-content">
                    <div style="font-size:11px; color:var(--accent-yellow); font-weight:700; text-transform:uppercase; margin-bottom:6px;">${item.animeTitle}</div>
                    <h3 style="font-size:14px; font-weight:700; margin-bottom:6px; line-height:1.4;">${item.title}</h3>
                    <p style="font-size:13px; color:var(--text-muted); margin-bottom:10px; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;">${item.excerpt || ''}</p>
                    <div class="news-footer">
                        <span style="font-size:12px; color:var(--text-muted);">${new Date(item.date).toLocaleDateString()}</span>
                        <span class="news-link">Read More</span>
                    </div>
                </div>
            </div>`).join('');
    } catch(e) {
        container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:40px;">Failed to load news. Try again later.</p>';
        console.error(e);
    }
    window.renderSeasonalVoting();
};

// --- NEW DISCOVER PAGE LOGIC (PODIUM UPDATE) ---
window.fetchDiscoverPage = async function() {
    const top10Container = document.getElementById('weebee-top10-container');
    const lbContainer = document.getElementById('reviewer-leaderboard-container');
    const spotlightEl = document.getElementById('discover-spotlight');
    top10Container.innerHTML = '<div class="loading">Calculating WeeBee scores...</div>';
    if (lbContainer) lbContainer.innerHTML = '<div class="loading">Loading...</div>';
    if (spotlightEl) spotlightEl.innerHTML = '<div class="loading">Loading spotlight...</div>';
    try {
        const revSnap = await getDocs(collection(db, "reviews"));
        let animeStats = {};
        const reviewerMap = {};
        revSnap.forEach(d => {
            const data = d.data();
            if(data.type !== 'suggestion' && data.type !== 'series' && data.score && data.mal_id) {
                if(!animeStats[data.mal_id]) { animeStats[data.mal_id] = { mal_id: data.mal_id, title: data.animeTitle, image: data.animeImage, totalScore: 0, count: 0 }; }
                // Fill in missing title/image from any review that has them
                if(!animeStats[data.mal_id].title && data.animeTitle) { animeStats[data.mal_id].title = data.animeTitle; animeStats[data.mal_id].image = data.animeImage; }
                animeStats[data.mal_id].totalScore += parseFloat(data.score); animeStats[data.mal_id].count++;
            }
            if(data.uid && data.type !== 'suggestion' && data.score) {
                if(!reviewerMap[data.uid]) reviewerMap[data.uid] = { uid: data.uid, displayName: data.username || 'Unknown', avatar: data.avatar, count: 0 };
                reviewerMap[data.uid].count++;
            }
        });
        Object.values(reviewerMap).forEach(r => { window.userRankCache[r.uid] = r.count; });

        // For entries still missing title, fetch from Jikan and patch the bad review docs
        const missingMeta = Object.values(animeStats).filter(a => !a.title);
        for (const anime of missingMeta) {
            try {
                await new Promise(r => setTimeout(r, 420));
                const res = await fetch(`https://api.jikan.moe/v4/anime/${anime.mal_id}`);
                if (res.ok) {
                    const json = await res.json();
                    anime.title = json.data.title;
                    anime.image = json.data.images?.jpg?.image_url || '';
                    // Patch the underlying review docs so this doesn't happen again
                    revSnap.forEach(d => {
                        const data = d.data();
                        if(data.mal_id === anime.mal_id && !data.animeTitle) {
                            setDoc(d.ref, { animeTitle: anime.title, animeImage: anime.image }, { merge: true }).catch(() => {});
                        }
                    });
                }
            } catch(e) {}
        }

        const MIN_REVIEWS = 5;
        const allRanked = Object.values(animeStats)
            .filter(a => a.title)
            .map(a => ({ ...a, avgScore: (a.totalScore / a.count).toFixed(1) }))
            .sort((a, b) => parseFloat(b.avgScore) - parseFloat(a.avgScore));
        // Podium: top 3 from ALL qualifying anime — don't cap at 10 first
        const podium = allRanked.filter(a => a.count >= MIN_REVIEWS).slice(0, 3);
        const podiumIds = new Set(podium.map(a => a.mal_id));
        // List: next 7 non-podium anime by avgScore (includes unqualified)
        const listItems = allRanked.filter(a => !podiumIds.has(a.mal_id)).slice(0, 7);
        // top10 used by rank snapshot below
        const top10 = [...podium, ...listItems];
        
        if(top10.length === 0) {
            top10Container.innerHTML = '<p class="empty-msg" style="color:var(--text-muted); text-align:center;">No reviews on WeeBee yet! Be the first!</p>';
        } else {
            // Read previous snapshot for rank movement indicators
            let prevRankMap = {};
            let lastSnapshotTime = 0;
            try {
                const snapDoc = await getDoc(doc(db, "meta", "rankSnapshot"));
                if (snapDoc.exists()) {
                    snapDoc.data().rankings.forEach(r => { prevRankMap[r.mal_id] = r.rank; });
                    lastSnapshotTime = snapDoc.data().lastUpdated || 0;
                }
            } catch(e) {}

            // Read rank history + MAL scores from cache in parallel
            const historyMap = {};
            const malScoreMap = {};
            await Promise.all([
                ...top10.map(async a => {
                    try {
                        const d = await getDoc(doc(db, "rankHistory", String(a.mal_id)));
                        historyMap[a.mal_id] = d.exists() ? d.data() : {};
                    } catch(e) { historyMap[a.mal_id] = {}; }
                }),
                ...top10.map(async a => {
                    try {
                        const cd = await getDoc(doc(db, "anime_cache", `full_${a.mal_id}`));
                        if (cd.exists()) {
                            const score = cd.data().payload?.data?.score;
                            if (score) malScoreMap[a.mal_id] = score;
                        }
                    } catch(e) {}
                })
            ]);

            // Award badges only to qualified podium anime (MIN_REVIEWS threshold)
            const histUpdates = [];
            [['hasBeenFirst', 'firstDate', 0], ['hasBeenSecond', 'secondDate', 1], ['hasBeenThird', 'thirdDate', 2]].forEach(([flag, dateField, i]) => {
                if (podium[i] && !historyMap[podium[i].mal_id]?.[flag]) {
                    const now = new Date();
                    if (!historyMap[podium[i].mal_id]) historyMap[podium[i].mal_id] = {};
                    historyMap[podium[i].mal_id][flag] = true;
                    historyMap[podium[i].mal_id][dateField] = now;
                    histUpdates.push(setDoc(doc(db, "rankHistory", String(podium[i].mal_id)), { [flag]: true, [dateField]: now }, { merge: true }));
                }
            });
            if (histUpdates.length) Promise.all(histUpdates).catch(() => {});

            // Revoke badges from any anime that doesn't meet the minimum review threshold
            const revokes = [];
            top10.forEach(a => {
                if (a.count < MIN_REVIEWS) {
                    const h = historyMap[a.mal_id] || {};
                    if (h.hasBeenFirst || h.hasBeenSecond || h.hasBeenThird) {
                        const updates = {};
                        if (h.hasBeenFirst)  { updates.hasBeenFirst  = false; updates.firstDate  = null; }
                        if (h.hasBeenSecond) { updates.hasBeenSecond = false; updates.secondDate = null; }
                        if (h.hasBeenThird)  { updates.hasBeenThird  = false; updates.thirdDate  = null; }
                        historyMap[a.mal_id] = { ...h, ...updates };
                        revokes.push(setDoc(doc(db, "rankHistory", String(a.mal_id)), updates, { merge: true }));
                    }
                }
            });
            if (revokes.length) Promise.all(revokes).catch(() => {});

            // Only update the snapshot every 12 hours (~twice a day) so arrows reflect real movement
            const daysSinceSnapshot = (Date.now() - lastSnapshotTime) / 86400000;
            if (daysSinceSnapshot >= 0.5) {
                setDoc(doc(db, "meta", "rankSnapshot"), {
                    rankings: top10.map((a, i) => ({ mal_id: a.mal_id, rank: i + 1 })),
                    lastUpdated: Date.now()
                }).catch(() => {});
            }

            const getRankChange = (id) => {
                const prev = prevRankMap[id];
                if (prev === undefined) return '';
                const curr = top10.findIndex(a => a.mal_id === id) + 1;
                const diff = prev - curr;
                if (diff > 0) return `<span class="change-up" title="Moved up ${diff} place${diff > 1 ? 's' : ''}">▲</span>`;
                if (diff < 0) return `<span class="change-down" title="Moved down ${Math.abs(diff)} place${Math.abs(diff) > 1 ? 's' : ''}">▼</span>`;
                return `<span class="change-same">—</span>`;
            };

            const fmtDate = (ts) => {
                if (!ts) return null;
                try { const d = ts.toDate ? ts.toDate() : new Date(ts); return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); } catch(e) { return null; }
            };

            const getHistBadges = (id, inline = false) => {
                const h = historyMap[id] || {};
                let b = '';
                if (h.hasBeenFirst) b += `<span class="material-symbols-outlined hist-badge hist-gem" title="${fmtDate(h.firstDate) ? `Reached #1 on ${fmtDate(h.firstDate)}` : 'Has reached #1 on WeeBee'}">diamond</span>`;
                if (h.hasBeenSecond) b += `<span class="material-symbols-outlined hist-badge hist-silver" title="${fmtDate(h.secondDate) ? `Reached #2 on ${fmtDate(h.secondDate)}` : 'Has reached #2 on WeeBee'}">military_tech</span>`;
                if (h.hasBeenThird) b += `<span class="material-symbols-outlined hist-badge hist-bronze" title="${fmtDate(h.thirdDate) ? `Reached #3 on ${fmtDate(h.thirdDate)}` : 'Has reached #3 on WeeBee'}">military_tech</span>`;
                if (!b) return '';
                return inline ? b : `<div class="hist-badges">${b}</div>`;
            };

            let html = '<div class="podium-container">';

            // #2 — Left (qualified only)
            if (podium[1]) {
                html += `
                    <div class="podium-item podium-2" onclick="loadAnimeDetails(${podium[1].mal_id})">
                        ${getHistBadges(podium[1].mal_id)}
                        <div class="podium-rank-change">${getRankChange(podium[1].mal_id)}</div>
                        <img src="${podium[1].image}" alt="${podium[1].title}">
                        <h4>${podium[1].title}</h4>
                        <div style="display:flex;gap:5px;align-items:flex-end;justify-content:center;">
                            <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
                                <div class="rating-badge tier-silver" style="width:38px;height:38px;font-size:13px;">${podium[1].avgScore}</div>
                                <span style="font-size:9px;color:rgba(255,255,255,0.7);font-weight:600;">WeeBee</span>
                            </div>
                            ${malScoreMap[podium[1].mal_id] ? `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;"><div class="rating-badge blue" style="width:30px;height:30px;font-size:10px;">${malScoreMap[podium[1].mal_id]}</div><span style="font-size:9px;color:rgba(255,255,255,0.7);font-weight:600;">MAL</span></div>` : ''}
                        </div>
                        <div class="podium-step step-2">2</div>
                    </div>`;
            }

            // #1 — Center (qualified only)
            if (podium[0]) {
                html += `
                    <div class="podium-item podium-1" onclick="loadAnimeDetails(${podium[0].mal_id})">
                        ${getHistBadges(podium[0].mal_id)}
                        <div class="podium-rank-change">${getRankChange(podium[0].mal_id)}</div>
                        <img src="${podium[0].image}" alt="${podium[0].title}">
                        <h4>${podium[0].title}</h4>
                        <div style="display:flex;gap:5px;align-items:flex-end;justify-content:center;">
                            <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
                                <div class="rating-badge tier-royal" style="width:48px;height:48px;font-size:16px;">${podium[0].avgScore}</div>
                                <span style="font-size:9px;color:rgba(255,255,255,0.7);font-weight:600;">WeeBee</span>
                            </div>
                            ${malScoreMap[podium[0].mal_id] ? `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;"><div class="rating-badge blue" style="width:36px;height:36px;font-size:12px;">${malScoreMap[podium[0].mal_id]}</div><span style="font-size:9px;color:rgba(255,255,255,0.7);font-weight:600;">MAL</span></div>` : ''}
                        </div>
                        <div class="podium-step step-1">1</div>
                    </div>`;
            } else {
                html += `<div style="color:var(--text-muted); font-size:13px; text-align:center; align-self:center; padding:20px;">Need ${MIN_REVIEWS}+ reviews to qualify for the podium</div>`;
            }

            // #3 — Right (qualified only)
            if (podium[2]) {
                html += `
                    <div class="podium-item podium-3" onclick="loadAnimeDetails(${podium[2].mal_id})">
                        ${getHistBadges(podium[2].mal_id)}
                        <div class="podium-rank-change">${getRankChange(podium[2].mal_id)}</div>
                        <img src="${podium[2].image}" alt="${podium[2].title}">
                        <h4>${podium[2].title}</h4>
                        <div style="display:flex;gap:5px;align-items:flex-end;justify-content:center;">
                            <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
                                <div class="rating-badge tier-bronze" style="width:38px;height:38px;font-size:13px;">${podium[2].avgScore}</div>
                                <span style="font-size:9px;color:rgba(255,255,255,0.7);font-weight:600;">WeeBee</span>
                            </div>
                            ${malScoreMap[podium[2].mal_id] ? `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;"><div class="rating-badge blue" style="width:30px;height:30px;font-size:10px;">${malScoreMap[podium[2].mal_id]}</div><span style="font-size:9px;color:rgba(255,255,255,0.7);font-weight:600;">MAL</span></div>` : ''}
                        </div>
                        <div class="podium-step step-3">3</div>
                    </div>`;
            }

            html += '</div>';

            // List: all non-podium anime ranked below
            if (listItems.length > 0) {
                html += '<div class="top10-list-container">';
                listItems.forEach((anime, i) => {
                    const globalRank = podium.length + i + 1;
                    const unqualifiedNote = anime.count < MIN_REVIEWS
                        ? `<span style="font-size:10px; color:var(--text-muted); margin-left:4px;">(${anime.count}/${MIN_REVIEWS} reviews for podium)</span>`
                        : '';
                    html += `
                        <div class="top10-list-item" onclick="loadAnimeDetails(${anime.mal_id})">
                            <div class="list-rank-number">${globalRank}</div>
                            <div class="rank-change-col">${getRankChange(anime.mal_id)}</div>
                            <img src="${anime.image}" alt="${anime.title}">
                            <div style="flex:1; min-width:0;">
                                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                                    <h3 style="margin-bottom:2px; font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${anime.title}</h3>
                                    ${getHistBadges(anime.mal_id, true)}
                                    ${unqualifiedNote}
                                </div>
                                <p style="font-size:12px; color:var(--text-muted);">${anime.count} WeeBee Review${anime.count !== 1 ? 's' : ''}</p>
                            </div>
                            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
                                <div style="display:flex;flex-direction:column;align-items:center;gap:3px;">
                                    <div class="rating-badge ${window.getScoreTier(anime.avgScore)}" style="width:42px;height:42px;font-size:14px;">${anime.avgScore}</div>
                                    <span style="font-size:10px;color:var(--text-muted);font-weight:600;letter-spacing:0.5px;">WeeBee</span>
                                </div>
                                ${malScoreMap[anime.mal_id] ? `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;"><div class="rating-badge blue" style="width:40px;height:40px;font-size:14px;">${malScoreMap[anime.mal_id]}</div><span style="font-size:10px;color:var(--text-muted);font-weight:600;letter-spacing:0.5px;">MAL</span></div>` : ''}
                            </div>
                        </div>
                    `;
                });
                html += '</div>';
            }

            top10Container.innerHTML = html;
        }

        // Render leaderboard
        if (lbContainer) {
            const leaderboard = Object.values(reviewerMap).sort((a, b) => b.count - a.count).slice(0, 10);
            if (auth.currentUser && leaderboard.some(r => r.uid === auth.currentUser.uid)) {
                window.awardAchievements(['top_reviewer']).catch(() => {});
            }
            if (leaderboard.length === 0) {
                lbContainer.innerHTML = '<p class="empty-msg" style="color:var(--text-muted); text-align:center;">No reviews yet — be the first!</p>';
            } else {
                const numColors = ['#FFD700', '#C0C0C0', '#CD7F32'];
                lbContainer.innerHTML = leaderboard.map((reviewer, i) => {
                    const numColor = numColors[i] || 'var(--text-muted)';
                    const avUrl = reviewer.avatar || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(reviewer.displayName)}&backgroundColor=ffc107&fontColor=333333`;
                    return `
                        <div style="display:flex; align-items:center; gap:12px; padding:12px 0; ${i < leaderboard.length - 1 ? 'border-bottom:1px solid var(--bg-gray);' : ''} cursor:pointer;" onclick="viewUserProfile('${reviewer.uid}')">
                            <div style="font-size:18px; font-weight:900; color:${numColor}; width:24px; text-align:center; flex-shrink:0;">${i + 1}</div>
                            <img src="${avUrl}" class="avatar" style="width:38px; height:38px; flex-shrink:0;" onerror="this.src='https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(reviewer.displayName)}&backgroundColor=ffc107&fontColor=333333'">
                            <div style="flex:1; min-width:0;">
                                <div style="font-weight:600; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${reviewer.displayName} ${window.getFounderBadgeHTML(reviewer.uid)}</div>
                                <div style="font-size:12px; color:var(--text-muted);">${reviewer.count} review${reviewer.count !== 1 ? 's' : ''}</div>
                            </div>
                            ${window.getRankBadgeHTML(reviewer.count, 22)}
                        </div>`;
                }).join('');
            }
        }
        // Spotlight — show WeeBee #1, fetch synopsis from Jikan async
        if (spotlightEl) {
            if (podium.length === 0) {
                spotlightEl.innerHTML = '';
            } else {
                const s = podium[0];
                spotlightEl.innerHTML = `
                    <div class="spotlight-card" onclick="loadAnimeDetails(${s.mal_id})">
                        <div class="spotlight-bg" style="background-image:url('${s.image}')"></div>
                        <div class="spotlight-content">
                            <img src="${s.image}" class="spotlight-cover" alt="${s.title}">
                            <div class="spotlight-info">
                                <div class="spotlight-label"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:middle;margin-right:3px;">emoji_events</span>WeeBee's #1 Rated</div>
                                <h2 class="spotlight-title">${s.title}</h2>
                                <p class="spotlight-meta" id="spotlight-meta-text">Loading details...</p>
                                <div class="spotlight-footer">
                                    <div class="rating-badge tier-royal" style="width:50px;height:50px;font-size:17px;">${s.avgScore}</div>
                                    <button class="action-btn spotlight-btn" onclick="event.stopPropagation(); loadAnimeDetails(${s.mal_id})">View Anime</button>
                                </div>
                            </div>
                        </div>
                    </div>`;
                // Fetch synopsis + genres from Jikan (non-blocking)
                ;(async () => {
                    try {
                        await new Promise(r => setTimeout(r, 420));
                        const res = await fetch(`https://api.jikan.moe/v4/anime/${s.mal_id}`);
                        if (!res.ok) return;
                        const json = await res.json();
                        const genres = json.data.genres?.slice(0, 3).map(g => g.name).join(' · ') || '';
                        const synopsis = (json.data.synopsis || '').replace(/\[Written by.*?\]/g, '').trim();
                        const el = document.getElementById('spotlight-meta-text');
                        if (el) el.innerHTML = `${genres ? `<span class="spotlight-genres">${genres}</span>` : ''}${synopsis ? `<span class="spotlight-synopsis">${synopsis.substring(0, 240)}...</span>` : ''}`;
                    } catch(e) {}
                })();
            }
        }

    } catch(e) { top10Container.innerHTML = '<p>Failed to calculate WeeBee Top 10.</p>'; if(lbContainer) lbContainer.innerHTML = ''; if(spotlightEl) spotlightEl.innerHTML = ''; console.error(e); }

    const friendsCarousel = document.getElementById('friends-suggested-carousel');
    friendsCarousel.innerHTML = '<div class="loading">Loading suggestions...</div>';
    if(!auth.currentUser) { friendsCarousel.innerHTML = '<p class="empty-msg" style="color:var(--text-muted);">Sign in and follow friends to see their suggestions!</p>'; } 
    else {
        try {
            const followsSnap = await getDocs(query(collection(db, "follows"), where("followerUid", "==", auth.currentUser.uid), where("type", "==", "user")));
            let friendIds = []; followsSnap.forEach(d => friendIds.push(d.data().targetId));
            if(friendIds.length === 0) { friendsCarousel.innerHTML = '<p class="empty-msg" style="color:var(--text-muted);">You aren\'t following anyone yet. Discover users in the Community!</p>'; } 
            else {
                const recentRevs = await getDocs(query(collection(db, "reviews"), orderBy("timestamp", "desc"), limit(100)));
                let suggestedMalIds = new Set(); let friendsSuggested = [];
                recentRevs.forEach(d => {
                    const data = d.data();
                    const isSuggestion = data.type === 'suggestion';
                    const meetsThreshold = isSuggestion || parseFloat(data.score) >= 8;
                    if(friendIds.includes(data.uid) && !suggestedMalIds.has(data.mal_id) && meetsThreshold) {
                        suggestedMalIds.add(data.mal_id);
                        friendsSuggested.push({ mal_id: data.mal_id, title: data.animeTitle, image: data.animeImage, friendName: data.username, action: isSuggestion ? 'Suggested' : 'Reviewed' });
                    }
                });
                friendsCarousel.innerHTML = '';
                if(friendsSuggested.length === 0) { friendsCarousel.innerHTML = '<p class="empty-msg" style="color:var(--text-muted);">Your friends haven\'t been active recently.</p>'; } 
                else {
                    friendsSuggested.slice(0, 15).forEach(anime => {
                        friendsCarousel.innerHTML += `
                            <div class="anime-card" onclick="loadAnimeDetails(${anime.mal_id})">
                                <img src="${anime.image}"><p>${anime.title}</p>
                                <span style="font-size:11px; color:var(--accent-yellow); display:block; margin-top:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${anime.action} by ${anime.friendName}</span>
                            </div>`;
                    });
                }
            }
        } catch(e) { friendsCarousel.innerHTML = '<p>Failed to load suggestions.</p>'; console.error(e); }
    }
    fetchAPI_CategoriesSequentially();
};

function getCurrentSeasonLabel() {
    const m = new Date().getMonth() + 1, y = new Date().getFullYear();
    if (m <= 3) return `Winter ${y}`;
    if (m <= 6) return `Spring ${y}`;
    if (m <= 9) return `Summer ${y}`;
    return `Fall ${y}`;
}
function getNextSeasonLabel() {
    const m = new Date().getMonth() + 1, y = new Date().getFullYear();
    if (m <= 3) return `Spring ${y}`;
    if (m <= 6) return `Summer ${y}`;
    if (m <= 9) return `Fall ${y}`;
    return `Winter ${y + 1}`;
}

async function fetchAPI_CategoriesSequentially() {
    const cur = getCurrentSeasonLabel(), next = getNextSeasonLabel();
    const tTitle = document.getElementById('discover-trending-title');
    const tSub = document.getElementById('discover-trending-subtitle');
    const uTitle = document.getElementById('discover-upcoming-title');
    const uSub = document.getElementById('discover-upcoming-subtitle');
    if (tTitle) tTitle.innerText = cur;
    if (tSub) tSub.innerText = `Currently airing — ${cur}`;
    if (uTitle) uTitle.innerText = `Upcoming: ${next}`;
    if (uSub) uSub.innerText = `Announced anime airing in ${next}`;

    const delay = () => new Promise(r => setTimeout(r, 800));
    await fetchAndRenderCarousel('https://api.jikan.moe/v4/seasons/now?limit=15', 'discover-trending-carousel'); await delay();
    await fetchAndRenderCarousel('https://api.jikan.moe/v4/seasons/upcoming?limit=15', 'discover-upcoming-carousel'); await delay();
    await fetchAndRenderCarousel('https://api.jikan.moe/v4/anime?genres=1&order_by=score&sort=desc&limit=15', 'discover-action-carousel'); await delay();
    await fetchAndRenderCarousel('https://api.jikan.moe/v4/anime?genres=22&order_by=score&sort=desc&limit=15', 'discover-romance-carousel'); await delay();
    await fetchAndRenderCarousel('https://api.jikan.moe/v4/anime?genres=4&order_by=score&sort=desc&limit=15', 'discover-comedy-carousel'); await delay();
    await fetchAndRenderCarousel('https://api.jikan.moe/v4/anime?genres=14&order_by=score&sort=desc&limit=15', 'discover-horror-carousel'); await delay();
    await fetchAndRenderCarousel('https://api.jikan.moe/v4/anime?genres=24&order_by=score&sort=desc&limit=15', 'discover-scifi-carousel'); await delay();
    await fetchAndRenderCarousel('https://api.jikan.moe/v4/anime?genres=10&order_by=score&sort=desc&limit=15', 'discover-fantasy-carousel'); await delay();
    await fetchAndRenderCarousel('https://api.jikan.moe/v4/anime?genres=36&order_by=score&sort=desc&limit=15', 'discover-sol-carousel'); await delay();
    await fetchAndRenderCarousel('https://api.jikan.moe/v4/anime?genres=30&order_by=score&sort=desc&limit=15', 'discover-sports-carousel'); await delay();
    await fetchAndRenderCarousel('https://api.jikan.moe/v4/anime?genres=18&order_by=score&sort=desc&limit=15', 'discover-mecha-carousel');
}

async function fetchAndRenderCarousel(url, containerId) {
    const container = document.getElementById(containerId); if(!container) return;
    try {
        const { data } = await window.jikanFetch(url, `carousel_${containerId}`, JIKAN_CAROUSEL_TTL_MS);
        container.innerHTML = '';
        if(!data || data.length === 0) { container.innerHTML = '<p class="empty-msg" style="color:var(--text-muted);">No anime found.</p>'; return; }
        const seen = new Set();
        data.forEach(anime => {
            if (seen.has(anime.mal_id)) return;
            seen.add(anime.mal_id);
            container.innerHTML += `<div class="anime-card" onclick="loadAnimeDetails(${anime.mal_id})"><img src="${anime.images.jpg.image_url}"><p>${anime.title_english || anime.title}</p></div>`;
        });
    } catch(e) { container.innerHTML = '<p class="empty-msg" style="color:var(--text-muted); font-size:13px;">Couldn\'t load right now — try refreshing.</p>'; }
}

// --- Search Logic ---
window.searchAnime = async function(queryStr) {
    switchView('discover-view', true); 
    
    // Switch the view to act as a search page
    const top10Container = document.getElementById('weebee-top10-container');
    document.querySelector('#discover-view h2').innerText = `Search Results: "${queryStr}"`;
    document.querySelector('#discover-view p').innerText = "Found in database";
    top10Container.innerHTML = '<div class="loading">Searching Anime Database...</div>';
    
    // Hide default discovery sections
    ['discover-seasonal-section','discover-spotlight-section','discover-reviewers-section','discover-friends-section',
     'discover-trending-section','discover-upcoming-section','discover-action-section',
     'discover-romance-section','discover-comedy-section','discover-horror-section',
     'discover-scifi-section','discover-fantasy-section','discover-sol-section',
     'discover-sports-section','discover-mecha-section'].forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
    
    try {
        // Run anime search and user search in parallel
        const normalized = queryStr.toLowerCase();
        const [animeRes, userSnap] = await Promise.all([
            fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(queryStr)}&limit=10`),
            getDocs(query(collection(db, "profiles"), where("displayNameLower", ">=", normalized), where("displayNameLower", "<=", normalized + ''), limit(8)))
                .catch(() => ({ empty: true, docs: [] }))
        ]);

        let html = '';

        // User results
        if (!userSnap.empty) {
            html += `<div style="margin-bottom:24px;">
                <h4 style="font-size:12px; text-transform:uppercase; letter-spacing:1px; color:var(--text-muted); margin-bottom:12px;">Users</h4>
                <div style="display:flex; flex-direction:column; gap:8px;">`;
            userSnap.docs.forEach(d => {
                const p = d.data();
                const uid = d.id;
                const avatar = p.avatar || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(p.displayName)}&backgroundColor=ffc107&fontColor=333333`;
                html += `
                    <div style="display:flex; align-items:center; gap:12px; padding:10px 14px; background:var(--bg-gray); border-radius:10px; cursor:pointer;" onclick="viewUserProfile('${uid}')">
                        <img src="${avatar}" class="avatar" style="width:38px; height:38px;">
                        <div>
                            <div style="font-weight:600; font-size:14px;">${p.displayName}</div>
                            <div style="font-size:12px; color:var(--text-muted);">${p.reviewCount || 0} review${(p.reviewCount || 0) !== 1 ? 's' : ''} · ${window.getRankInfo(p.reviewCount || 0).name}</div>
                        </div>
                        ${window.getRankBadgeHTML(p.reviewCount || 0, 18)}
                    </div>`;
            });
            html += `</div></div>`;
        }

        // Anime results
        if (!animeRes.ok) throw new Error(`Jikan returned ${animeRes.status}`);
        const json = await animeRes.json();
        const data = json.data;
        if (!Array.isArray(data)) throw new Error('Unexpected response format');

        // Fetch WeeBee scores for all returned anime in one query
        const bwScoreMap = {};
        if (data.length > 0) {
            try {
                const malIds = data.map(a => a.mal_id);
                const bwSnap = await getDocs(query(collection(db, "reviews"), where("mal_id", "in", malIds)));
                bwSnap.forEach(d => {
                    const r = d.data();
                    if (r.type === 'suggestion' || r.type === 'series' || !r.score) return;
                    if (!bwScoreMap[r.mal_id]) bwScoreMap[r.mal_id] = { total: 0, count: 0 };
                    bwScoreMap[r.mal_id].total += parseFloat(r.score);
                    bwScoreMap[r.mal_id].count++;
                });
            } catch(e) { /* silently fail */ }
        }

        if (data.length === 0 && userSnap.empty) {
            html = '<p style="color:var(--text-muted); text-align:center;">No results found.</p>';
        } else if (data.length > 0) {
            html += `<h4 style="font-size:12px; text-transform:uppercase; letter-spacing:1px; color:var(--text-muted); margin-bottom:12px;">Anime</h4>
                <div class="top10-list-container">`;
            data.forEach(anime => {
                const title = anime.title_english || anime.title;
                const img = anime.images.jpg.image_url;
                const eps = anime.episodes || 0;
                const inList = window.myAnimeList?.some(a => a.mal_id === anime.mal_id);
                const safeTitle = title.replace(/'/g, "\\'");
                const bw = bwScoreMap[anime.mal_id];
                const bwScore = bw && bw.count > 0 ? (bw.total / bw.count).toFixed(1) : null;
                const bwTier = bwScore ? window.getScoreTier(bwScore) : '';
                html += `
                    <div class="top10-list-item" onclick="loadAnimeDetails(${anime.mal_id})">
                        <img src="${img}">
                        <div style="flex:1; min-width:0;">
                            <h3 style="margin-bottom:4px; font-size:16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${title}</h3>
                            <p style="font-size:12px; color:var(--text-muted);">${anime.type || ''}, ${anime.year || 'N/A'}</p>
                        </div>
                        <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
                            <div style="display:flex; flex-direction:column; align-items:center; gap:3px;">
                                <div class="rating-badge blue" style="width:40px; height:40px; font-size:14px;">${anime.score || 'N/A'}</div>
                                <span style="font-size:10px; color:var(--text-muted); font-weight:600; letter-spacing:0.5px;">MAL</span>
                            </div>
                            <div style="display:flex; flex-direction:column; align-items:center; gap:3px;">
                                <div class="rating-badge ${bwTier || 'blue'}" style="width:40px; height:40px; font-size:14px; ${bwScore ? '' : 'opacity:0.35;'}">${bwScore || '—'}</div>
                                <span style="font-size:10px; color:var(--text-muted); font-weight:600; letter-spacing:0.5px;">WeeBee</span>
                            </div>
                            <button onclick="event.stopPropagation(); selectAnimeForList(${anime.mal_id}, '${safeTitle}', '${img}', ${eps})"
                                class="action-btn search-quick-add" data-mal="${anime.mal_id}"
                                style="padding:6px 12px; font-size:12px; ${inList ? 'background:var(--bg-gray-darker); color:var(--text-muted);' : ''}">
                                <span class="material-symbols-outlined" style="font-size:15px;">${inList ? 'check' : 'add'}</span>
                                ${inList ? 'In List' : 'Add'}
                            </button>
                        </div>
                    </div>`;
            });
            html += '</div>';
        }

        top10Container.innerHTML = html;

    } catch(e) {
        top10Container.innerHTML = '<p style="color:var(--text-muted); text-align:center;">Search failed — try again in a moment.</p>';
        console.error(e);
    }
};

// --- Navigation ---
window.switchView = function(targetId, isSearch = false, skipHistory = false) {
    window.closeMobileMenu?.();
    window.closeMobileSearch?.();
    if(targetId !== 'anime-detail-view') window.previousViewId = targetId;
    if(targetId !== 'profile-view') window.targetProfileUid = null;
    if (!skipHistory) {
        const _tabHashes = { 'home-view': '', 'discover-view': 'discover', 'my-list-view': 'mylist', 'news-view': 'news', 'community-view': 'community' };
        const _tabHash = _tabHashes[targetId];
        // Clear ?anime= or ?profile= params when navigating to non-detail views
        if (targetId !== 'anime-detail-view' && targetId !== 'profile-view') {
            history.replaceState({}, '', window.location.pathname);
        }
        const _newUrl = _tabHash !== undefined
            ? (_tabHash ? `${window.location.pathname}#${_tabHash}` : window.location.pathname)
            : window.location.pathname;
        history.pushState({ view: targetId, profileUid: window.targetProfileUid, animeId: window.currentAnimeId }, '', _newUrl);
    }
    // Save state for refresh restoration
    sessionStorage.setItem('weebee-last-view', JSON.stringify({ view: targetId, profileUid: window.targetProfileUid, animeId: window.currentAnimeId }));
    
    document.querySelectorAll(".nav-btn").forEach(btn => { btn.classList.remove("active"); if(btn.getAttribute("data-target") === targetId) btn.classList.add("active"); });
    document.querySelectorAll(".view").forEach(view => view.classList.remove("active"));
    document.getElementById(targetId).classList.add("active");
    window.currentActiveViewId = targetId;
    document.querySelector('.main-content').scrollTo(0,0);
    
    if(targetId === 'home-view') { fetchHomepageReviews(); }
    if(targetId === 'community-view') {
        window.fetchCommunityTierLists();
        window.fetchBwCommunityFeed();
        window.loadBwBannerImages();
        // Update game thumbnail status texts
        const today = bwGetDate();
        const opStatusEl = document.getElementById('bwop-status-text');
        if (opStatusEl && window.bwOpState.date === today) {
            const { solved, guesses } = window.bwOpState;
            opStatusEl.innerText = solved ? `✓ Solved in ${guesses.length} ${guesses.length===1?'guess':'guesses'} today!` : guesses.length > 0 ? `${guesses.length} ${guesses.length===1?'guess':'guesses'} so far` : 'New puzzle available! 🗡️';
        } else if (opStatusEl) {
            opStatusEl.innerText = 'New puzzle available! 🗡️';
        }
        const nrtStatusEl = document.getElementById('bwnrt-status-text');
        if (nrtStatusEl && window.bwNrtState.date === today) {
            const { solved, guesses } = window.bwNrtState;
            nrtStatusEl.innerText = solved ? `✓ Solved in ${guesses.length} ${guesses.length===1?'guess':'guesses'} today!` : guesses.length > 0 ? `${guesses.length} ${guesses.length===1?'guess':'guesses'} so far` : 'New puzzle available! 🍃';
        } else if (nrtStatusEl) {
            nrtStatusEl.innerText = 'New puzzle available! 🍃';
        }
    }
    if(targetId === 'news-view') {
        fetchGlobalNews();
        window.loadPatchNotes();
        window.clearPatchNoteBadge();
        if (auth.currentUser) {
            const ADMIN_UIDS = ['XUD3ym2NcdWtrUiPLlFFaO5ufMh1'];
            getDoc(doc(db, "admins", auth.currentUser.uid)).then(d => {
                window.isAdmin = d.exists() || ADMIN_UIDS.includes(auth.currentUser.uid);
            }).catch(() => {
                window.isAdmin = ADMIN_UIDS.includes(auth.currentUser.uid);
            }).finally(() => {
                const adminPanel = document.getElementById('patch-notes-admin');
                if (adminPanel) adminPanel.style.display = window.isAdmin ? 'block' : 'none';
            });
        }
    }
    if(targetId === 'profile-view') fetchUserProfile(window.targetProfileUid);
    if(targetId === 'my-list-view') fetchMyList(); 
    if(targetId === 'discover-view' && !isSearch) {
        document.querySelector('#discover-view h2').innerText = "WeeBee's Top 10 All Time";
        document.querySelector('#discover-view p').innerText = "Ranked purely by WeeBee community scores";
        ['discover-seasonal-section','discover-spotlight-section','discover-reviewers-section','discover-friends-section',
         'discover-trending-section','discover-upcoming-section','discover-action-section',
         'discover-romance-section','discover-comedy-section','discover-horror-section',
         'discover-scifi-section','discover-fantasy-section','discover-sol-section',
         'discover-sports-section','discover-mecha-section'].forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'block'; });
        fetchDiscoverPage();
        window.renderSeasonalVoting();
    }
};

window.goBack = function() { history.back(); };

window.addEventListener('popstate', (e) => {
    if (!e.state) return;
    const { view, profileUid, animeId } = e.state;
    if (view === 'anime-detail-view' && animeId) {
        window.loadAnimeDetails(animeId, true);
    } else if (view === 'profile-view' && profileUid) {
        window.targetProfileUid = profileUid;
        switchView('profile-view', false, true);
    } else if (view) {
        switchView(view, false, true);
    }
});

// --- ANIME DETAIL SYSTEM ---
window.loadAnimeDetails = async function(mal_id, skipHistory = false) {
    window.currentAnimeId = mal_id;
    switchView('anime-detail-view', false, skipHistory);
    if (!skipHistory) history.replaceState({}, '', `?anime=${mal_id}`);
    const { data: anime } = await window.jikanFetch(`https://api.jikan.moe/v4/anime/${mal_id}/full`, `full_${mal_id}`);
    window.currentAnime = anime;

    let fanServiceScores = new Map(); 
    const revQ = query(collection(db, "reviews"), where("mal_id", "==", mal_id));
    const revSnapshot = await getDocs(revQ);
    let weebeeTotal = 0; let weebeeCount = 0;

    revSnapshot.forEach(d => { 
        const rData = d.data();
        if(rData.fanService) fanServiceScores.set(rData.uid, rData.fanService); 
        if(rData.type !== 'suggestion' && rData.type !== 'series' && rData.score) { weebeeTotal += parseFloat(rData.score); weebeeCount++; }
    });

    const listQ = query(collection(db, "anime_lists"), where("mal_id", "==", mal_id));
    const listSnapshot = await getDocs(listQ);
    listSnapshot.forEach(d => { if(d.data().fanService) fanServiceScores.set(d.data().uid, d.data().fanService); });

    let weebeeAvg = weebeeCount > 0 ? (weebeeTotal / weebeeCount).toFixed(1) : 'N/A';
    let fanServiceAvg = 'N/A'; let fanServicePercentage = 0;
    if(fanServiceScores.size > 0) {
        let sum = 0; fanServiceScores.forEach(val => sum += parseFloat(val));
        fanServiceAvg = (sum / fanServiceScores.size).toFixed(1); fanServicePercentage = (fanServiceAvg / 10) * 100;
    }

    const fanServiceHTML = `
        <div style="margin-top: 15px; border-top: 1px dashed #E0E0E0; padding-top: 15px;">
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:5px;">
                <span style="display:flex; align-items:center; gap:5px;">Fan Service <span class="material-symbols-outlined tooltip-icon" data-tooltip="A 0-10 scale indicating the amount of fan service. 0 = None, 10 = Heavy fan service. This is a background community stat and does not affect the anime's overall score." style="font-size:14px; color:var(--text-muted);">info</span></span>
                <span>${fanServiceAvg === 'N/A' ? 'No Data' : fanServiceAvg + ' / 10'}</span>
            </div>
            <div style="width: 100%; height: 8px; background: #E0E0E0; border-radius: 4px; overflow: hidden;"><div style="width: ${fanServicePercentage}%; height: 100%; background: linear-gradient(90deg, #FFB74D, #FF5252);"></div></div>
        </div>
    `;

    const rankHistDoc = await getDoc(doc(db, "rankHistory", String(mal_id))).catch(() => null);
    const rankHist = rankHistDoc?.exists() ? rankHistDoc.data() : {};
    const fmtRankDate = (ts) => {
        if (!ts) return null;
        try { const d = ts.toDate ? ts.toDate() : new Date(ts); return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); } catch(e) { return null; }
    };
    let rankHistoryHTML = '';
    let allBadges = '';
    if (rankHist.hasBeenFirst || rankHist.hasBeenSecond || rankHist.hasBeenThird) {
        const d1 = fmtRankDate(rankHist.firstDate), d2 = fmtRankDate(rankHist.secondDate), d3 = fmtRankDate(rankHist.thirdDate);
        if (rankHist.hasBeenFirst) allBadges += `<div class="detail-rank-badge hist-gem-badge" data-tooltip="${d1 ? `Reached #1 on ${d1}` : 'Has reached #1 on WeeBee'}"><span class="material-symbols-outlined">diamond</span>#1 on WeeBee</div>`;
        if (rankHist.hasBeenSecond) allBadges += `<div class="detail-rank-badge hist-silver-badge" data-tooltip="${d2 ? `Reached #2 on ${d2}` : 'Has reached #2 on WeeBee'}"><span class="material-symbols-outlined">military_tech</span>#2 on WeeBee</div>`;
        if (rankHist.hasBeenThird) allBadges += `<div class="detail-rank-badge hist-bronze-badge" data-tooltip="${d3 ? `Reached #3 on ${d3}` : 'Has reached #3 on WeeBee'}"><span class="material-symbols-outlined">military_tech</span>#3 on WeeBee</div>`;
    }
    try {
        const seasonalBadgeDoc = await getDoc(doc(db, "seasonal_badges", String(mal_id)));
        if (seasonalBadgeDoc.exists()) {
            const placeIcons = ['emoji_events','military_tech','military_tech'];
            const placeColors = ['#FFD700','#C0C0C0','#CD7F32'];
            const badgeClasses = ['hist-gem-badge','hist-silver-badge','hist-bronze-badge'];
            (seasonalBadgeDoc.data().badges || []).forEach(b => {
                const i = (b.place || 1) - 1;
                allBadges += `<div class="detail-rank-badge ${badgeClasses[i]}" data-tooltip="${b.label} · ${b.season}"><span class="material-symbols-outlined">${placeIcons[i]}</span>${b.label}<br><span style="font-size:10px;opacity:0.8;">${b.season}</span></div>`;
            });
        }
    } catch(e) {}
    if (allBadges) rankHistoryHTML = `<div class="detail-rank-badges">${allBadges}</div>`;

    let weebeeRank = '—';
    try {
        const snapDoc = await getDoc(doc(db, 'meta', 'rankSnapshot'));
        if (snapDoc.exists()) {
            const entry = snapDoc.data().rankings?.find(r => r.mal_id === mal_id);
            if (entry) weebeeRank = `#${entry.rank}`;
        }
    } catch(e) {}

    let isFollowingAnime = false;
    if (auth.currentUser) {
        const fSnap = await getDocs(query(collection(db, "follows"),
            where("followerUid", "==", auth.currentUser.uid),
            where("targetId", "==", mal_id),
            where("type", "==", "anime")));
        isFollowingAnime = !fSnap.empty;
    }

    document.getElementById('anime-detail-content').innerHTML = `
        <div class="detail-sidebar">
            <img src="${anime.images.jpg.image_url}">
            <div class="stat-box">
                <div class="stat-row" style="margin-bottom: 15px; gap: 12px; align-items: stretch;">
                    <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
                        <span style="font-size:10px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">Global</span>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <div class="stat-col" style="flex:1;"><h4>Score</h4><span class="value" style="font-size:18px;">${anime.score || 'N/A'}</span></div>
                            <div style="width:1px; background:var(--border-color); align-self:stretch;"></div>
                            <div class="stat-col" style="flex:1;"><h4>Rank</h4><span class="value" style="font-size:18px;">${anime.rank ? '#' + anime.rank : 'N/A'}</span></div>
                        </div>
                    </div>
                    <div style="width:2px; background:var(--accent-yellow); border-radius:2px; align-self:stretch;"></div>
                    <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
                        <span style="font-size:10px; font-weight:800; color:var(--accent-yellow); text-transform:uppercase; letter-spacing:0.5px;">WeeBee</span>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <div class="stat-col" style="flex:1;"><h4>Score</h4><span class="value" style="font-size:18px; color:var(--accent-yellow);">${weebeeAvg}</span></div>
                            <div style="width:1px; background:var(--border-color); align-self:stretch;"></div>
                            <div class="stat-col" style="flex:1;"><h4>Rank</h4><span class="value" style="font-size:18px; color:var(--accent-yellow);">${weebeeRank}</span></div>
                        </div>
                    </div>
                </div>
                <div style="height: 1px; background: #E0E0E0; margin: 15px 0;"></div>
                <div class="info-list">
                    <div class="info-row"><strong>Type</strong><span>${anime.type || 'Unknown'}</span></div>
                    <div class="info-row"><strong>Episodes</strong><span>${anime.episodes || 'Unknown'}</span></div>
                    <div class="info-row"><strong>Status</strong><span>${anime.status || 'Unknown'}</span></div>
                    <div class="info-row"><strong>Aired</strong><span>${anime.aired?.string || 'Unknown'}</span></div>
                    <div class="info-row"><strong>Studios</strong><span>${anime.studios?.map(s => s.name).join(', ') || 'Unknown'}</span></div>
                    <div class="info-row"><strong>Genres</strong><span>${anime.genres?.map(g => g.name).join(', ') || 'Unknown'}</span></div>
                </div>
                ${fanServiceHTML}
            </div>
            <button id="add-to-list-btn" onclick="addCurrentAnimeToList()" class="action-btn" style="width:100%; justify-content:center; margin-bottom: 10px; ${window.myAnimeList?.some(a => a.mal_id === mal_id) ? 'background:var(--bg-gray-darker); color:var(--text-muted);' : ''}"><span class="material-symbols-outlined">${window.myAnimeList?.some(a => a.mal_id === mal_id) ? 'check' : 'add'}</span> ${window.myAnimeList?.some(a => a.mal_id === mal_id) ? 'In My List' : 'Add to List'}</button>
            <button id="follow-anime-btn" onclick="toggleFollow(${mal_id}, 'anime', this)" class="action-btn" style="width:100%; justify-content:center; margin-bottom: 10px; background:${isFollowingAnime ? 'var(--bg-gray-darker)' : 'var(--accent-yellow)'}; color:var(--text-dark);"><span class="material-symbols-outlined">${isFollowingAnime ? 'check' : 'bookmark_add'}</span> ${isFollowingAnime ? 'Following' : 'Follow Anime'}</button>
            <button onclick="openReviewModal()" class="action-btn" style="width:100%; justify-content:center; margin-bottom: 10px; background: transparent; color: var(--text-dark); border: 1px solid #E0E0E0;">
                <span class="material-symbols-outlined">rate_review</span> Review Anime
            </button>
            <button onclick="openSuggestModal()" class="action-btn" style="width:100%; justify-content:center; background: transparent; color: var(--text-dark); border: 1px solid #E0E0E0;">
                <span class="material-symbols-outlined">send</span> Suggest
            </button>
            <button onclick="navigator.clipboard.writeText(window.location.origin + '/?anime=' + window.currentAnimeId).then(() => { this.innerHTML='<span class=\\'material-symbols-outlined\\'>check</span> Copied!'; setTimeout(() => this.innerHTML='<span class=\\'material-symbols-outlined\\'>link</span> Copy Link', 2000); })" class="action-btn" style="width:100%; justify-content:center; background: transparent; color: var(--text-dark); border: 1px solid #E0E0E0;">
                <span class="material-symbols-outlined">link</span> Copy Link
            </button>
        </div>
        <div class="detail-main">
            <h1>${anime.title_english || anime.title}</h1>
            ${rankHistoryHTML}
            <div class="tags" style="color: var(--text-muted); font-size: 14px; margin-bottom: 15px;">${anime.genres?.map(g => g.name).join(', ')}</div>
            <div class="detail-tabs">
                <button class="detail-tab active" onclick="switchDetailTab(event, 'tab-overview')">Overview</button>
                <button class="detail-tab" onclick="switchDetailTab(event, 'tab-episodes')">Episodes</button>
                <button class="detail-tab" onclick="switchDetailTab(event, 'tab-reviews')">Reviews</button>
                <button class="detail-tab" onclick="switchDetailTab(event, 'tab-seasons')">Seasons & Films</button>
            </div>
            <div id="tab-overview" class="detail-tab-content">
                <div class="content-section"><h3>Synopsis</h3><p>${anime.synopsis}</p></div>
                <div id="detail-chars-container" class="content-section"><div class="loading">Loading Characters...</div></div>
                <div id="detail-recs-container" class="content-section"><div class="loading">Loading Similar Anime...</div></div>
                <div id="detail-news-container" class="content-section"><div class="loading">Loading News...</div></div>
            </div>
            <div id="tab-episodes" class="detail-tab-content" style="display:none;">
                <div id="detail-eps-container"><div class="loading">Loading Episodes...</div></div>
            </div>
            <div id="tab-reviews" class="detail-tab-content" style="display:none;">
                <div id="detail-series-section" style="display:none; margin-bottom:24px;">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
                        <span class="material-symbols-outlined" style="color:var(--accent-yellow);">auto_stories</span>
                        <h3 style="margin:0;">Series Ratings</h3>
                        <span style="font-size:12px; color:var(--text-muted); margin-left:4px;">Overall franchise scores</span>
                    </div>
                    <div class="review-list" id="detail-series-reviews"></div>
                    <div style="height:1px; background:var(--border-color); margin:20px 0;"></div>
                </div>
                <div class="review-header-container">
                    <h3>Reviews</h3>
                    <button class="action-btn" onclick="event.stopPropagation(); openReviewModal()">Write a Review</button>
                </div>
                <div class="review-list" id="detail-reviews"></div>
            </div>
            <div id="tab-seasons" class="detail-tab-content" style="display:none;"></div>
        </div>`;

    const revList = document.getElementById('detail-reviews'); revList.innerHTML = '';
    const seriesRevList = document.getElementById('detail-series-reviews');
    let hasSeriesReviews = false;
    revSnapshot.forEach(d => {
        const rev = { ...d.data(), id: d.id };
        if (rev.type === 'series') {
            if (seriesRevList) { seriesRevList.innerHTML += window.generateReviewCardHTML(rev); hasSeriesReviews = true; }
        } else {
            revList.innerHTML += window.generateReviewCardHTML(rev);
        }
    });
    const seriesSection = document.getElementById('detail-series-section');
    if (seriesSection) seriesSection.style.display = hasSeriesReviews ? 'block' : 'none';

    // Async Fetchers
    window.jikanFetch(`https://api.jikan.moe/v4/anime/${mal_id}/characters`, `chars_${mal_id}`).then(d => {
        const cContainer = document.getElementById('detail-chars-container'); if(!cContainer) return;
        if(d.data && d.data.length > 0) {
            cContainer.innerHTML = `<h3>Characters & Voice Actors</h3><div class="character-grid">${d.data.slice(0, 6).map(c => `<div class="character-card"><img src="${c.character.images.jpg.image_url}"><div class="info"><span class="name" title="${c.character.name}">${c.character.name}</span><span class="role">${c.role}</span>${c.voice_actors && c.voice_actors.length > 0 ? `<span style="font-size:11px; margin-top:5px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">VA: ${c.voice_actors[0].person.name}</span>` : ''}</div></div>`).join('')}</div>`;
        } else { cContainer.style.display = 'none'; }
    }).catch(() => document.getElementById('detail-chars-container').style.display = 'none');

    window.currentEpisodeList = [];

    window.jikanFetch(`https://api.jikan.moe/v4/anime/${mal_id}/recommendations`, `recs_${mal_id}`).then(d => {
        const rContainer = document.getElementById('detail-recs-container'); if(!rContainer) return;
        if(d.data && d.data.length > 0) {
            rContainer.innerHTML = `<h3>Similar Anime</h3><div class="carousel-container"><button class="carousel-arrow left" onclick="scrollCarousel('recs-carousel', -1)"><span class="material-symbols-outlined">chevron_left</span></button><div class="carousel" id="recs-carousel" style="margin-bottom:0; padding-bottom:10px;">${d.data.slice(0, 10).map(rec => `<div class="anime-card" onclick="loadAnimeDetails(${rec.entry.mal_id})" style="min-width: 140px;"><img src="${rec.entry.images.jpg.image_url}" style="width:120px; height:170px;"><p style="max-width:120px; font-size:12px;">${rec.entry.title}</p></div>`).join('')}</div><button class="carousel-arrow right" onclick="scrollCarousel('recs-carousel', 1)"><span class="material-symbols-outlined">chevron_right</span></button></div>`;
        } else { rContainer.style.display = 'none'; }
    }).catch(() => document.getElementById('detail-recs-container').style.display = 'none');

    window.jikanFetch(`https://api.jikan.moe/v4/anime/${mal_id}/news`, `news_${mal_id}`, JIKAN_CAROUSEL_TTL_MS).then(d => {
        const nContainer = document.getElementById('detail-news-container'); if(!nContainer) return;
        if(d.data && d.data.length > 0) {
            nContainer.innerHTML = `<h3>Latest News</h3><div class="news-grid">${d.data.slice(0, 3).map(n => `<div class="news-card"><img src="${n.images?.jpg?.image_url || anime.images.jpg.image_url}"><div class="news-content"><h3>${n.title}</h3><p>${n.excerpt}</p><a href="${n.url}" target="_blank" class="news-link">Full Article</a></div></div>`).join('')}</div>`;
        } else { nContainer.style.display = 'none'; }
    }).catch(() => document.getElementById('detail-news-container').style.display = 'none');
};

// --- Mobile Menu ---
window.toggleMobileMenu = function() { document.getElementById('mobile-menu').classList.toggle('open'); };
window.closeMobileMenu = function() { document.getElementById('mobile-menu').classList.remove('open'); };

// --- Mobile Search ---
window.toggleMobileSearch = function() {
    const bar = document.getElementById('mobile-search-bar');
    if (!bar) return;
    bar.classList.toggle('open');
    if (bar.classList.contains('open')) {
        setTimeout(() => document.getElementById('mobile-search-input')?.focus(), 50);
    }
};
window.closeMobileSearch = function() {
    document.getElementById('mobile-search-bar')?.classList.remove('open');
};

// --- Detail Page Tabs ---
window.switchDetailTab = function(event, tabId) {
    const detailMain = event.target.closest('.detail-main');
    detailMain.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
    detailMain.querySelectorAll('.detail-tab-content').forEach(c => c.style.display = 'none');
    event.target.classList.add('active');
    const content = document.getElementById(tabId);
    content.style.display = 'block';
    if (tabId === 'tab-episodes' && !content.dataset.loaded) {
        content.dataset.loaded = 'true';
        fetchDetailEpisodes(window.currentAnimeId);
    }
    if (tabId === 'tab-seasons' && !content.dataset.loaded) {
        content.dataset.loaded = 'true';
        window.loadAnimeRelations(window.currentAnimeId);
    }
};

window.loadAnimeRelations = async function(mal_id) {
    const container = document.getElementById('tab-seasons');
    container.innerHTML = '<div class="loading">Loading related media...</div>';
    try {
        const allEntries = new Map(); // mal_id → entry object
        const visited = new Set([parseInt(mal_id), mal_id]);
        const chainQueue = []; // sequel/prequel ids to follow

        // Fetch relations for a given id and collect entries
        async function fetchAndCollect(id) {
            const { data } = await window.jikanFetch(
                `https://api.jikan.moe/v4/anime/${id}/relations`, `relations_${id}`
            );
            (data || []).forEach(rel => {
                rel.entry.forEach(e => {
                    if (e.type !== 'anime' || visited.has(e.mal_id)) return;
                    visited.add(e.mal_id);
                    allEntries.set(e.mal_id, { ...e, relation: rel.relation });
                    if (['Sequel', 'Prequel'].includes(rel.relation)) {
                        chainQueue.push(e.mal_id);
                    }
                });
            });
        }

        // Step 1: get direct relations
        await fetchAndCollect(mal_id);

        // Step 2: follow sequel/prequel chain until exhausted (max 15 hops)
        let hops = 0;
        while (chainQueue.length > 0 && hops < 15) {
            const nextId = chainQueue.shift();
            hops++;
            await new Promise(r => setTimeout(r, 420));
            try { await fetchAndCollect(nextId); } catch(_) {}
        }

        const entries = [...allEntries.values()];
        if (entries.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:30px; font-size:14px;">No related anime found.</p>';
            return;
        }

        // Sort: sequels/prequels first, then other relations
        const relOrder = { 'Prequel': 0, 'Sequel': 1, 'Parent story': 2, 'Full story': 3, 'Side story': 4, 'Other': 5 };
        entries.sort((a, b) => (relOrder[a.relation] ?? 6) - (relOrder[b.relation] ?? 6));

        container.innerHTML = entries.map(e => `
            <div style="display:flex; align-items:center; gap:14px; padding:12px; border-radius:10px; background:var(--bg-gray); margin-bottom:8px; cursor:pointer;" onclick="loadAnimeDetails(${e.mal_id})">
                <div style="width:50px; height:70px; border-radius:6px; background:var(--bg-gray-darker); flex-shrink:0; overflow:hidden;">
                    <img id="rel-img-${e.mal_id}" src="" style="width:100%; height:100%; object-fit:cover; display:none;">
                </div>
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:600; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${e.name}</div>
                    <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">${e.relation}</div>
                </div>
                <span class="material-symbols-outlined" style="color:var(--text-muted); flex-shrink:0;">chevron_right</span>
            </div>`).join('');

        // Load cover images progressively
        for (const e of entries) {
            await new Promise(r => setTimeout(r, 420));
            try {
                const { data: d } = await window.jikanFetch(`https://api.jikan.moe/v4/anime/${e.mal_id}`, `full_${e.mal_id}`);
                const img = document.getElementById(`rel-img-${e.mal_id}`);
                if (img && d?.images?.jpg?.image_url) { img.src = d.images.jpg.image_url; img.style.display = 'block'; }
            } catch(_) {}
        }
    } catch(e) {
        container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:30px; font-size:14px;">Failed to load related media.</p>';
    }
};

// --- Episode Scoring ---
async function fetchDetailEpisodes(mal_id, page = 1) {
    const container = document.getElementById('detail-eps-container');
    if (!container) return;
    if (page === 1) {
        container.innerHTML = '<div class="loading">Loading Episodes...</div>';
        window.currentEpStats = {};
        try {
            const epSnap = await getDocs(query(collection(db, 'episode_reviews'), where('mal_id', '==', mal_id)));
            const uid = auth.currentUser?.uid;
            epSnap.forEach(d => {
                const data = d.data(); const n = data.episode_number;
                if (!window.currentEpStats[n]) window.currentEpStats[n] = { total: 0, count: 0, userScore: null, userComment: null };
                window.currentEpStats[n].total += parseFloat(data.score);
                window.currentEpStats[n].count++;
                if (uid && data.uid === uid) { window.currentEpStats[n].userScore = data.score; window.currentEpStats[n].userComment = data.comment || ''; }
            });
        } catch(e) { console.error('Episode scores fetch error:', e); }
    }
    try {
        const json = await window.jikanFetch(`https://api.jikan.moe/v4/anime/${mal_id}/episodes?page=${page}`, `eps_${mal_id}_p${page}`, JIKAN_CAROUSEL_TTL_MS);
        const episodes = json.data || [];
        const hasNext = json.pagination?.has_next_page;
        if (page === 1) window.currentEpisodeList = [];
        window.currentEpisodeList.push(...episodes);
        if (episodes.length === 0 && page === 1) {
            container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:30px 0;">No episode data available for this anime yet.</p>';
            return;
        }
        const renderRows = (eps) => eps.map(ep => {
            const stats = window.currentEpStats[ep.mal_id] || {};
            const avg = stats.count > 0 ? (stats.total / stats.count).toFixed(1) : null;
            const userScore = stats.userScore;
            const flair = [ep.filler ? 'Filler' : '', ep.recap ? 'Recap' : ''].filter(Boolean).join(' · ');
            return `<div class="episode-row" id="ep-row-${ep.mal_id}">
                <div class="ep-num">${ep.mal_id}</div>
                <div class="ep-info">
                    <strong class="ep-title" title="${(ep.title || '').replace(/"/g, '&quot;')}">${ep.title || `Episode ${ep.mal_id}`}</strong>
                    <span class="ep-meta">${ep.aired ? new Date(ep.aired).toLocaleDateString() : 'TBA'}${flair ? ` · <em>${flair}</em>` : ''}</span>
                </div>
                <div class="ep-score-area">
                    ${avg ? `<span class="ep-avg">WeeBee ${avg}</span>` : ''}
                    <button class="ep-score-btn${userScore ? ' scored' : ''}" onclick="openEpisodeScoreModal(${mal_id}, ${ep.mal_id})">${userScore ? `${userScore} ✓` : 'Score'}</button>
                </div>
            </div>`;
        }).join('');
        if (page === 1) { container.innerHTML = `<div class="episode-list">${renderRows(episodes)}</div>`; }
        else { const list = container.querySelector('.episode-list'); if (list) list.insertAdjacentHTML('beforeend', renderRows(episodes)); }
        const oldBtn = container.querySelector('.ep-load-more');
        if (oldBtn) oldBtn.remove();
        if (hasNext) {
            const btn = document.createElement('button');
            btn.className = 'action-btn ep-load-more';
            btn.style.cssText = 'width:100%;justify-content:center;margin-top:15px;background:transparent;color:var(--text-dark);border:1px solid var(--border-color);';
            btn.textContent = `Load More Episodes`;
            btn.onclick = () => { btn.disabled = true; btn.textContent = 'Loading...'; fetchDetailEpisodes(mal_id, page + 1); };
            container.appendChild(btn);
        }
    } catch(e) {
        if (page === 1) container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:30px 0;">Failed to load episodes. Try again later.</p>';
        console.error(e);
    }
}

window.openEpisodeScoreModal = function(mal_id, ep_number) {
    if (!auth.currentUser) return window.openAuthModal();
    window.currentEpisodeContext = { mal_id, ep_number };
    const ep = window.currentEpisodeList?.find(e => e.mal_id === ep_number);
    document.getElementById('ep-modal-title').textContent = `Episode ${ep_number}`;
    document.getElementById('ep-modal-subtitle').textContent = ep?.title || '';
    const stats = window.currentEpStats?.[ep_number] || {};
    document.getElementById('ep-score-input').value = stats.userScore || '';
    document.getElementById('ep-score-comment').value = stats.userComment || '';
    document.getElementById('ep-submit-btn').textContent = stats.userScore ? 'Update Score' : 'Save Score';
    document.getElementById('ep-delete-btn').style.display = stats.userScore ? 'inline-flex' : 'none';
    document.getElementById('episode-score-modal').style.display = 'flex';
};

window.submitEpisodeScore = async function() {
    if (!auth.currentUser) return;
    const { mal_id, ep_number } = window.currentEpisodeContext;
    const scoreVal = parseFloat(document.getElementById('ep-score-input').value);
    const comment = document.getElementById('ep-score-comment').value.trim();
    if (isNaN(scoreVal) || scoreVal < 1 || scoreVal > 10) return alert('Please enter a score between 1 and 10.');
    const score = parseFloat(scoreVal.toFixed(1));
    const uid = auth.currentUser.uid;
    const ep = window.currentEpisodeList?.find(e => e.mal_id === ep_number);
    await setDoc(doc(db, 'episode_reviews', `${uid}_${mal_id}_${ep_number}`), {
        mal_id, episode_number: ep_number, episode_title: ep?.title || `Episode ${ep_number}`,
        uid, username: auth.currentUser.displayName,
        avatar: auth.currentUser.photoURL || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(auth.currentUser.displayName)}&backgroundColor=ffc107&fontColor=333333`,
        score, comment, timestamp: new Date()
    });
    if (!window.currentEpStats[ep_number]) window.currentEpStats[ep_number] = { total: 0, count: 0, userScore: null, userComment: null };
    const stats = window.currentEpStats[ep_number];
    if (stats.userScore !== null) { stats.total = stats.total - parseFloat(stats.userScore) + score; }
    else { stats.total += score; stats.count++; }
    stats.userScore = score; stats.userComment = comment;
    updateEpisodeRowDOM(mal_id, ep_number);
    window.closeAllModals();
};

window.deleteEpisodeScore = async function() {
    if (!auth.currentUser) return;
    const { mal_id, ep_number } = window.currentEpisodeContext;
    const uid = auth.currentUser.uid;
    await deleteDoc(doc(db, 'episode_reviews', `${uid}_${mal_id}_${ep_number}`));
    const stats = window.currentEpStats[ep_number];
    if (stats?.userScore !== null) { stats.total -= parseFloat(stats.userScore); stats.count--; stats.userScore = null; stats.userComment = null; }
    updateEpisodeRowDOM(mal_id, ep_number);
    window.closeAllModals();
};

function updateEpisodeRowDOM(mal_id, ep_number) {
    const row = document.getElementById(`ep-row-${ep_number}`);
    if (!row) return;
    const stats = window.currentEpStats[ep_number] || {};
    const avg = stats.count > 0 ? (stats.total / stats.count).toFixed(1) : null;
    const userScore = stats.userScore;
    row.querySelector('.ep-score-area').innerHTML = `
        ${avg ? `<span class="ep-avg">WeeBee ${avg}</span>` : ''}
        <button class="ep-score-btn${userScore ? ' scored' : ''}" onclick="openEpisodeScoreModal(${mal_id}, ${ep_number})">${userScore ? `${userScore} ✓` : 'Score'}</button>`;
}

window.onload = function() {
    const _initHash = window.location.hash.replace('#', '');
    history.replaceState({ view: 'home-view', profileUid: null, animeId: null }, '', window.location.pathname);
    const saved = localStorage.getItem('weebee-theme') || 'dark';
    document.body.setAttribute('data-theme', saved);

    const loadTrending = async () => {
        try {
            const r = await fetch('https://api.jikan.moe/v4/seasons/now?limit=15'); const d = await r.json();
            const c = document.getElementById('trending-carousel'); c.innerHTML = '';
            const seen = new Set();
            if(d.data) d.data.forEach(a => {
                if (seen.has(a.mal_id)) return;
                seen.add(a.mal_id);
                c.innerHTML += `<div class="anime-card" onclick="loadAnimeDetails(${a.mal_id})"><img src="${a.images.jpg.image_url}"><p>${a.title_english || a.title}</p></div>`;
            });
        } catch(e) { console.error("Trending error:", e); }
    };
    loadTrending(); fetchHomepageReviews();

    const _hashToView = { 'discover': 'discover-view', 'mylist': 'my-list-view', 'news': 'news-view', 'community': 'community-view' };
    if (_initHash && _hashToView[_initHash]) {
        switchView(_hashToView[_initHash]);
    }
};

// =====================================================================
// BUZZWORD GAMES
// =====================================================================

const BW_GAMES = {
    op: {
        label: 'BuzzWord: One Piece Characters',
        badge: '⚓ One Piece',
        badgeBg: '#8B0000',
        badgeColor: '#FFD700',
        cover: 'https://cdn.myanimelist.net/images/anime/6/73245.jpg',
        playFn: 'window.openBwOpModal()'
    },
    naruto: {
        label: 'BuzzWord: Naruto Characters',
        badge: '🍃 Naruto',
        badgeBg: '#7a3300',
        badgeColor: '#FF8C00',
        cover: 'https://cdn.myanimelist.net/images/anime/1565/111305.jpg',
        playFn: 'window.openBwNrtModal()'
    },
    bleach: {
        label: 'BuzzWord: Bleach Characters',
        badge: '⚔️ Bleach',
        badgeBg: '#0d1b2a',
        badgeColor: '#00BCD4',
        cover: 'https://cdn.myanimelist.net/images/anime/3/40451.jpg',
        playFn: 'window.openBwBlcModal()'
    },
    dragonball: {
        label: 'BuzzWord: Dragon Ball Characters',
        badge: '🐉 Dragon Ball',
        badgeBg: '#1a0a00',
        badgeColor: '#FF6F00',
        cover: 'https://cdn.myanimelist.net/images/anime/1277/142022.jpg',
        playFn: 'window.openBwDbModal()'
    }
};

// =====================================================================
// BUZZWORD: NARUTO CHARACTERS
// =====================================================================

const NRT_ARC_ORDER = [
    'Introduction','Chunin Exams','Konoha Crush',
    'Search for Tsunade','Sasuke Recovery Mission',
    'Kazekage Rescue','Tenchi Bridge Reconnaissance','Akatsuki Suppression',
    'Itachi Pursuit','Fated Battle Between Brothers',"Pain's Assault",
    'Five Kage Summit','Fourth Shinobi World War','Kaguya Strikes'
];

const BW_NRT_CHARS = [
    // ── Leaf ──
    {id:'naruto',    name:'Naruto Uzumaki',     gender:'Male',   affiliation:['Leaf'],                                  jutsuType:['Ninjutsu','Taijutsu','Senjutsu','Fuinjutsu'],                                nature:['Wind','Fire','Earth','Water','Lightning'],       kekkeiGenkai:false, attribute:['Jinchuriki','Sage'],  debutArc:'Introduction'},
    {id:'sasuke',    name:'Sasuke Uchiha',       gender:'Male',   affiliation:['Leaf','Missing-nin'],                    jutsuType:['Ninjutsu','Taijutsu','Genjutsu','Kenjutsu'],                                 nature:['Lightning','Fire','Wind','Earth','Water'],       kekkeiGenkai:true,  attribute:[],                    debutArc:'Introduction'},
    {id:'sakura',    name:'Sakura Haruno',       gender:'Female', affiliation:['Leaf'],                                  jutsuType:['Ninjutsu','Taijutsu','Medical Ninjutsu','Genjutsu'],                          nature:['Earth','Water','Fire'],                          kekkeiGenkai:false, attribute:[],                    debutArc:'Introduction'},
    {id:'kakashi',   name:'Kakashi Hatake',      gender:'Male',   affiliation:['Leaf'],                                  jutsuType:['Ninjutsu','Taijutsu','Genjutsu','Kenjutsu','Fuinjutsu'],                      nature:['Lightning','Earth','Water','Fire','Wind'],       kekkeiGenkai:false, attribute:['Anbu'],              debutArc:'Introduction'},
    {id:'iruka',     name:'Iruka Umino',         gender:'Male',   affiliation:['Leaf'],                                  jutsuType:['Ninjutsu','Taijutsu'],                                                        nature:['Water','Earth'],                                kekkeiGenkai:false, attribute:[],                    debutArc:'Introduction'},
    {id:'gai',       name:'Might Guy',           gender:'Male',   affiliation:['Leaf'],                                  jutsuType:['Taijutsu','Ninjutsu'],                                                        nature:['Lightning'],                                    kekkeiGenkai:false, attribute:[],                    debutArc:'Introduction'},
    {id:'rock-lee',  name:'Rock Lee',            gender:'Male',   affiliation:['Leaf'],                                  jutsuType:['Taijutsu'],                                                                   nature:[],                                               kekkeiGenkai:false, attribute:[],                    debutArc:'Chunin Exams'},
    {id:'neji',      name:'Neji Hyuga',          gender:'Male',   affiliation:['Leaf'],                                  jutsuType:['Taijutsu','Ninjutsu'],                                                        nature:['Fire'],                                         kekkeiGenkai:true,  attribute:[],                    debutArc:'Chunin Exams'},
    {id:'tenten',    name:'Tenten',              gender:'Female', affiliation:['Leaf'],                                  jutsuType:['Kenjutsu','Ninjutsu','Taijutsu'],                                             nature:[],                                               kekkeiGenkai:false, attribute:[],                    debutArc:'Chunin Exams'},
    {id:'shikamaru', name:'Shikamaru Nara',      gender:'Male',   affiliation:['Leaf'],                                  jutsuType:['Ninjutsu','Taijutsu'],                                                        nature:['Fire','Earth'],                                 kekkeiGenkai:false, attribute:[],                    debutArc:'Chunin Exams'},
    {id:'ino',       name:'Ino Yamanaka',        gender:'Female', affiliation:['Leaf'],                                  jutsuType:['Ninjutsu','Taijutsu','Medical Ninjutsu','Genjutsu'],                          nature:['Fire','Earth','Water'],                          kekkeiGenkai:false, attribute:['Sensor'],            debutArc:'Chunin Exams'},
    {id:'choji',     name:'Choji Akimichi',      gender:'Male',   affiliation:['Leaf'],                                  jutsuType:['Ninjutsu','Taijutsu'],                                                        nature:['Fire','Earth'],                                 kekkeiGenkai:false, attribute:[],                    debutArc:'Chunin Exams'},
    {id:'kiba',      name:'Kiba Inuzuka',        gender:'Male',   affiliation:['Leaf'],                                  jutsuType:['Ninjutsu','Taijutsu'],                                                        nature:['Earth'],                                        kekkeiGenkai:false, attribute:[],                    debutArc:'Chunin Exams'},
    {id:'hinata',    name:'Hinata Hyuga',        gender:'Female', affiliation:['Leaf'],                                  jutsuType:['Taijutsu','Ninjutsu','Medical Ninjutsu'],                                     nature:['Fire','Earth'],                                 kekkeiGenkai:true,  attribute:[],                    debutArc:'Chunin Exams'},
    {id:'shino',     name:'Shino Aburame',       gender:'Male',   affiliation:['Leaf'],                                  jutsuType:['Ninjutsu','Taijutsu'],                                                        nature:['Earth','Fire'],                                 kekkeiGenkai:false, attribute:[],                    debutArc:'Chunin Exams'},
    {id:'kurenai',   name:'Kurenai Yuhi',        gender:'Female', affiliation:['Leaf'],                                  jutsuType:['Ninjutsu','Genjutsu','Taijutsu'],                                             nature:['Fire'],                                         kekkeiGenkai:false, attribute:[],                    debutArc:'Introduction'},
    {id:'asuma',     name:'Asuma Sarutobi',      gender:'Male',   affiliation:['Leaf'],                                  jutsuType:['Ninjutsu','Taijutsu','Kenjutsu','Fuinjutsu'],                                 nature:['Fire','Wind'],                                  kekkeiGenkai:false, attribute:[],                    debutArc:'Introduction'},
    {id:'hiruzen',   name:'Hiruzen Sarutobi',    gender:'Male',   affiliation:['Leaf'],                                  jutsuType:['Ninjutsu','Taijutsu','Genjutsu','Fuinjutsu','Senjutsu'],                      nature:['Fire','Earth','Wind','Water','Lightning'],       kekkeiGenkai:false, attribute:['Kage'],              debutArc:'Introduction'},
    {id:'minato',    name:'Minato Namikaze',     gender:'Male',   affiliation:['Leaf'],                                  jutsuType:['Ninjutsu','Taijutsu','Fuinjutsu','Senjutsu'],                                 nature:['Fire','Wind','Lightning'],                       kekkeiGenkai:false, attribute:['Kage'],              debutArc:'Sasuke Recovery Mission'},
    {id:'tsunade',   name:'Tsunade',             gender:'Female', affiliation:['Leaf'],                                  jutsuType:['Ninjutsu','Taijutsu','Medical Ninjutsu','Fuinjutsu','Genjutsu'],               nature:['Earth','Fire','Water'],                          kekkeiGenkai:false, attribute:['Sannin','Kage'],     debutArc:'Search for Tsunade'},
    {id:'jiraiya',   name:'Jiraiya',             gender:'Male',   affiliation:['Leaf'],                                  jutsuType:['Ninjutsu','Taijutsu','Fuinjutsu','Senjutsu','Genjutsu'],                      nature:['Fire','Earth','Wind','Water'],                   kekkeiGenkai:false, attribute:['Sannin','Sage'],     debutArc:'Search for Tsunade'},
    {id:'sai',       name:'Sai',                gender:'Male',   affiliation:['Leaf'],                                  jutsuType:['Ninjutsu','Taijutsu','Kenjutsu','Fuinjutsu'],                                 nature:['Fire'],                                         kekkeiGenkai:false, attribute:['Anbu'],              debutArc:'Tenchi Bridge Reconnaissance'},
    {id:'yamato',    name:'Yamato',             gender:'Male',   affiliation:['Leaf'],                                  jutsuType:['Ninjutsu','Taijutsu','Fuinjutsu'],                                            nature:['Earth','Fire','Water'],                          kekkeiGenkai:true,  attribute:['Anbu'],              debutArc:'Tenchi Bridge Reconnaissance'},
    {id:'hashirama', name:'Hashirama Senju',    gender:'Male',   affiliation:['Leaf'],                                  jutsuType:['Ninjutsu','Taijutsu','Medical Ninjutsu','Fuinjutsu','Genjutsu','Senjutsu'],    nature:['Earth','Fire','Water','Wind'],                   kekkeiGenkai:true,  attribute:['Kage','Sage'],       debutArc:'Fourth Shinobi World War'},
    {id:'tobirama',  name:'Tobirama Senju',     gender:'Male',   affiliation:['Leaf'],                                  jutsuType:['Ninjutsu','Taijutsu','Kenjutsu','Fuinjutsu','Kinjutsu'],                      nature:['Water','Earth','Fire','Wind'],                   kekkeiGenkai:false, attribute:['Kage'],              debutArc:'Fourth Shinobi World War'},
    // ── Sound ──
    {id:'orochimaru',name:'Orochimaru',          gender:'Male',   affiliation:['Leaf','Missing-nin','Akatsuki','Sound'],  jutsuType:['Ninjutsu','Taijutsu','Genjutsu','Fuinjutsu','Kenjutsu','Medical Ninjutsu'],  nature:['Fire','Earth','Wind','Lightning','Water'],       kekkeiGenkai:false, attribute:['Sannin'],            debutArc:'Chunin Exams'},
    {id:'kabuto',    name:'Kabuto Yakushi',      gender:'Male',   affiliation:['Sound','Missing-nin'],                   jutsuType:['Ninjutsu','Medical Ninjutsu','Taijutsu','Senjutsu','Genjutsu'],                nature:['Earth','Water','Fire','Wind','Lightning'],       kekkeiGenkai:false, attribute:['Sage'],              debutArc:'Chunin Exams'},
    {id:'kimimaro',  name:'Kimimaro',            gender:'Male',   affiliation:['Sound'],                                 jutsuType:['Taijutsu','Ninjutsu','Kenjutsu'],                                             nature:['Earth'],                                        kekkeiGenkai:true,  attribute:[],                    debutArc:'Sasuke Recovery Mission'},
    // ── Sand ──
    {id:'gaara',     name:'Gaara',              gender:'Male',   affiliation:['Sand'],                                  jutsuType:['Ninjutsu','Taijutsu','Fuinjutsu'],                                            nature:['Earth','Lightning','Wind'],                      kekkeiGenkai:false, attribute:['Jinchuriki','Kage'], debutArc:'Chunin Exams'},
    {id:'temari',    name:'Temari',             gender:'Female', affiliation:['Sand'],                                  jutsuType:['Ninjutsu','Taijutsu','Kenjutsu'],                                             nature:['Wind'],                                         kekkeiGenkai:false, attribute:[],                    debutArc:'Chunin Exams'},
    {id:'kankuro',   name:'Kankuro',            gender:'Male',   affiliation:['Sand'],                                  jutsuType:['Ninjutsu','Kinjutsu'],                                                        nature:['Earth'],                                        kekkeiGenkai:false, attribute:[],                    debutArc:'Chunin Exams'},
    {id:'chiyo',     name:'Chiyo',              gender:'Female', affiliation:['Sand'],                                  jutsuType:['Ninjutsu','Taijutsu','Medical Ninjutsu','Fuinjutsu'],                          nature:['Earth','Fire','Wind'],                           kekkeiGenkai:false, attribute:[],                    debutArc:'Kazekage Rescue'},
    // ── Mist ──
    {id:'zabuza',    name:'Zabuza Momochi',     gender:'Male',   affiliation:['Mist','Missing-nin'],                    jutsuType:['Ninjutsu','Taijutsu','Kenjutsu','Genjutsu'],                                  nature:['Water','Wind','Earth'],                          kekkeiGenkai:false, attribute:[],                    debutArc:'Introduction'},
    {id:'haku',      name:'Haku',               gender:'Male',   affiliation:['Mist','Missing-nin'],                    jutsuType:['Ninjutsu','Taijutsu','Medical Ninjutsu'],                                     nature:['Wind','Water'],                                 kekkeiGenkai:true,  attribute:[],                    debutArc:'Introduction'},
    {id:'kisame',    name:'Kisame Hoshigaki',   gender:'Male',   affiliation:['Mist','Missing-nin','Akatsuki'],         jutsuType:['Ninjutsu','Taijutsu','Kenjutsu','Fuinjutsu'],                                 nature:['Water','Earth','Fire'],                          kekkeiGenkai:false, attribute:[],                    debutArc:'Itachi Pursuit'},
    // ── Cloud ──
    {id:'killerbee', name:'Killer Bee',         gender:'Male',   affiliation:['Cloud'],                                 jutsuType:['Ninjutsu','Taijutsu','Kenjutsu','Senjutsu','Fuinjutsu'],                      nature:['Lightning','Fire','Water','Earth','Wind'],       kekkeiGenkai:false, attribute:['Jinchuriki','Sage'], debutArc:'Akatsuki Suppression'},
    {id:'raikage',   name:'A (Fourth Raikage)', gender:'Male',   affiliation:['Cloud'],                                 jutsuType:['Ninjutsu','Taijutsu'],                                                        nature:['Lightning','Fire'],                              kekkeiGenkai:false, attribute:['Kage'],              debutArc:'Five Kage Summit'},
    // ── Akatsuki ──
    {id:'itachi',    name:'Itachi Uchiha',      gender:'Male',   affiliation:['Leaf','Missing-nin','Akatsuki'],         jutsuType:['Ninjutsu','Taijutsu','Genjutsu','Kenjutsu','Fuinjutsu'],                      nature:['Fire','Water','Wind'],                           kekkeiGenkai:true,  attribute:['Anbu'],              debutArc:'Chunin Exams'},
    {id:'nagato',    name:'Nagato (Pain)',       gender:'Male',   affiliation:['Missing-nin','Akatsuki'],                jutsuType:['Ninjutsu','Taijutsu','Fuinjutsu','Genjutsu'],                                 nature:['Wind','Lightning','Earth','Water','Fire'],       kekkeiGenkai:true,  attribute:[],                    debutArc:"Pain's Assault"},
    {id:'konan',     name:'Konan',              gender:'Female', affiliation:['Missing-nin','Akatsuki'],                jutsuType:['Ninjutsu','Taijutsu','Fuinjutsu'],                                            nature:['Water','Fire','Earth'],                          kekkeiGenkai:false, attribute:[],                    debutArc:"Pain's Assault"},
    {id:'deidara',   name:'Deidara',            gender:'Male',   affiliation:['Stone','Missing-nin','Akatsuki'],        jutsuType:['Ninjutsu','Taijutsu','Kinjutsu'],                                             nature:['Earth','Lightning','Wind'],                      kekkeiGenkai:true,  attribute:[],                    debutArc:'Kazekage Rescue'},
    {id:'sasori',    name:'Sasori',             gender:'Male',   affiliation:['Sand','Missing-nin','Akatsuki'],         jutsuType:['Ninjutsu','Taijutsu','Kinjutsu'],                                             nature:['Fire','Earth','Wind'],                           kekkeiGenkai:false, attribute:[],                    debutArc:'Kazekage Rescue'},
    {id:'hidan',     name:'Hidan',              gender:'Male',   affiliation:['Missing-nin','Akatsuki'],                jutsuType:['Ninjutsu','Taijutsu','Kenjutsu','Kinjutsu'],                                  nature:['Fire'],                                         kekkeiGenkai:false, attribute:[],                    debutArc:'Akatsuki Suppression'},
    {id:'kakuzu',    name:'Kakuzu',             gender:'Male',   affiliation:['Missing-nin','Akatsuki'],                jutsuType:['Ninjutsu','Taijutsu','Kinjutsu','Fuinjutsu'],                                 nature:['Fire','Wind','Lightning','Earth','Water'],       kekkeiGenkai:false, attribute:[],                    debutArc:'Akatsuki Suppression'},
    {id:'zetsu',     name:'Zetsu',              gender:'Male',   affiliation:['Akatsuki'],                              jutsuType:['Ninjutsu','Fuinjutsu'],                                                        nature:['Earth','Water'],                                 kekkeiGenkai:true,  attribute:[],                    debutArc:'Kazekage Rescue'},
    {id:'obito',     name:'Obito Uchiha',       gender:'Male',   affiliation:['Leaf','Missing-nin','Akatsuki'],         jutsuType:['Ninjutsu','Taijutsu','Genjutsu','Kenjutsu','Fuinjutsu','Senjutsu'],            nature:['Fire','Earth','Wind','Water','Lightning'],        kekkeiGenkai:true,  attribute:['Jinchuriki'],        debutArc:'Itachi Pursuit'},
    {id:'madara',    name:'Madara Uchiha',      gender:'Male',   affiliation:['Leaf','Missing-nin'],                    jutsuType:['Ninjutsu','Taijutsu','Genjutsu','Kenjutsu','Fuinjutsu','Senjutsu'],            nature:['Fire','Earth','Wind','Water','Lightning'],        kekkeiGenkai:true,  attribute:['Jinchuriki','Sage'], debutArc:'Fourth Shinobi World War'},
    {id:'kaguya',    name:'Kaguya Otsutsuki',   gender:'Female', affiliation:['None'],                                  jutsuType:['Ninjutsu','Taijutsu','Genjutsu','Fuinjutsu','Kinjutsu'],                      nature:['Fire','Wind','Earth','Water','Lightning'],       kekkeiGenkai:true,  attribute:['Jinchuriki'],        debutArc:'Kaguya Strikes'},
];

// --- BuzzWord: Naruto — Image System ---
window.bwNrtImageMap = {};
window.bwNrtImgReady = false;

window.bwNrtLoadImages = async function() {
    const cacheKey = 'wb_nrt_imgs_v2';
    const cached = localStorage.getItem(cacheKey);
    if (cached) { try { window.bwNrtImageMap = JSON.parse(cached); window.bwNrtImgReady = true; return; } catch(e) {} }
    const addToMap = (data, map) => {
        (data || []).forEach(entry => {
            const char = entry.character;
            if (!char?.images?.jpg?.image_url) return;
            const img = char.images.jpg.image_url;
            const raw = char.name;
            map[raw.toLowerCase()] = img;
            if (raw.includes(',')) {
                const [last, ...rest] = raw.split(',');
                const natural = `${rest.join(',').trim()} ${last.trim()}`;
                map[natural.toLowerCase()] = img;
                const firstWord = rest.join(' ').trim().split(' ')[0].toLowerCase();
                if (firstWord && !map[firstWord]) map[firstWord] = img;
            } else {
                const parts = raw.split(' ');
                const lastName = parts[parts.length - 1].toLowerCase();
                if (!map[lastName]) map[lastName] = img;
            }
        });
    };
    try {
        const map = {};
        // Fetch Naruto (20) and Naruto Shippuden (1735) characters
        const res1 = await fetch('https://api.jikan.moe/v4/anime/20/characters');
        if (res1.ok) { const d = await res1.json(); addToMap(d.data, map); }
        await new Promise(r => setTimeout(r, 450)); // respect rate limit
        const res2 = await fetch('https://api.jikan.moe/v4/anime/1735/characters');
        if (res2.ok) { const d = await res2.json(); addToMap(d.data, map); }
        window.bwNrtImageMap = map;
        window.bwNrtImgReady = true;
        try { localStorage.setItem(cacheKey, JSON.stringify(map)); } catch(e) {}
    } catch(e) {}
};

const NRT_NAME_ALIASES = {
    'nagato': 'pain', 'pain': 'nagato',
    'tobi': 'obito', 'obito': 'tobi',
    'a': 'raikage',
    'might guy': 'maito gai', 'maito gai': 'might guy', 'guy': 'maito gai',
    'rock lee': 'lee, rock', 'lee': 'lee, rock',
    'killer bee': 'killer bee', 'kirabi': 'killer bee',
    'minato': 'namikaze minato', 'namikaze': 'namikaze minato',
    'hashirama': 'senju hashirama', 'senju': 'senju hashirama',
    'tobirama': 'senju tobirama',
    'kaguya': 'otsutsuki kaguya', 'otsutsuki': 'otsutsuki kaguya',
    'zabuza': 'momochi zabuza', 'momochi': 'momochi zabuza',
    'haku': 'haku',
    'chiyo': 'chiyo',
    'yamato': 'yamato', 'tenzou': 'yamato',
    'sai': 'sai',
    'kimimaro': 'kimimaro',
    'kisame': 'hoshigaki kisame', 'hoshigaki': 'hoshigaki kisame',
};

window.bwNrtGetCharImage = function(name) {
    const m = window.bwNrtImageMap;
    const n = name.toLowerCase();
    if (m[n]) return m[n];
    const alias = NRT_NAME_ALIASES[n];
    if (alias && m[alias]) return m[alias];
    const parts = name.split(' ');
    const last = parts[parts.length - 1].toLowerCase();
    if (m[last]) return m[last];
    const first = parts[0].toLowerCase();
    if (m[first]) return m[first];
    return null;
};

window.bwNrtApplyImages = function() {
    document.querySelectorAll('[id^="nimg-"]').forEach(img => {
        const charId = img.id.replace('nimg-', '');
        const char = charId === 'answer' ? window.bwNrtState.answer : BW_NRT_CHARS.find(c => c.id === charId);
        if (!char) return;
        const url = window.bwNrtGetCharImage(char.name);
        if (url) {
            img.src = url; img.style.display = 'block';
            const fb = document.getElementById(`ninitials-${charId}`);
            if (fb) fb.style.display = 'none';
        }
    });
};

window.bwNrtEnsureImages = async function() {
    if (!window.bwNrtImgReady) await window.bwNrtLoadImages();
    window.bwNrtApplyImages();
};

// --- BuzzWord: Naruto — Helpers ---
function bwNrtJutsu(j) {
    if (!j || j.length === 0) return 'None';
    const icons = {Ninjutsu:'✦',Taijutsu:'👊',Genjutsu:'👁️',Kenjutsu:'⚔️',Fuinjutsu:'📜',Medical:'💊','Medical Ninjutsu':'💊',Senjutsu:'🐸',Kinjutsu:'☠️'};
    return j.map(x => `${icons[x]||'•'} ${x}`).join('\n');
}
function bwNrtNature(n) {
    if (!n || n.length === 0) return 'None';
    const icons = {Fire:'🔥',Wind:'💨',Lightning:'⚡',Earth:'🪨',Water:'💧'};
    return n.map(x => `${icons[x]||'•'} ${x}`).join('\n');
}
function bwNrtAffil(a) {
    if (!a || a.length === 0) return 'None';
    const icons = {Leaf:'🍃',Sand:'🏜️',Mist:'🌊',Cloud:'⚡',Stone:'🪨',Sound:'🎵',Akatsuki:'🔴','Missing-nin':'💀',None:'—'};
    return a.map(x => `${icons[x]||'•'} ${x}`).join('\n');
}
function bwNrtAttr(a) {
    if (!a || a.length === 0) return 'None';
    return a.join('\n');
}

function bwNrtCalcColors(guess, answer) {
    const gender = guess.gender === answer.gender ? 'green' : 'red';
    const kekkeiGenkai = guess.kekkeiGenkai === answer.kekkeiGenkai ? 'green' : 'red';
    const arrColor = (g, a) => {
        if (g.length === 0 && a.length === 0) return 'green';
        if (g.length === 0 || a.length === 0) return 'red';
        if (g.length === a.length && g.every(x => a.includes(x))) return 'green';
        if (g.some(x => a.includes(x))) return 'yellow';
        return 'red';
    };
    const affiliation = arrColor(guess.affiliation, answer.affiliation);
    const jutsuType = arrColor(guess.jutsuType, answer.jutsuType);
    const nature = arrColor(guess.nature, answer.nature);
    const attribute = arrColor(guess.attribute, answer.attribute);
    const gIdx = NRT_ARC_ORDER.indexOf(guess.debutArc);
    const aIdx = NRT_ARC_ORDER.indexOf(answer.debutArc);
    const debutArc = gIdx === aIdx ? 'green' : (gIdx < aIdx ? 'yellow_up' : 'yellow_down');
    return { gender, affiliation, jutsuType, nature, attribute, kekkeiGenkai, debutArc };
}

function bwNrtCell(val, color) {
    const arrow = color === 'yellow_up' ? '↑ After' : color === 'yellow_down' ? '↓ Before' : '';
    const c = color.startsWith('yellow') ? 'yellow' : color;
    return `<div class="wordle-cell ${c}" style="white-space:pre-line; font-size:12px;">${val}${arrow ? '\n'+arrow : ''}</div>`;
}

function bwNrtBuildRow(char, colors) {
    const initials = char.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    return `<div class="wordle-row">
        <div class="wordle-char-cell">
            <img id="nimg-${char.id}" src="" style="width:50px;height:50px;border-radius:50%;object-fit:cover;display:none;" onerror="this.style.display='none'; var d=document.getElementById('ninitials-${char.id}'); if(d) d.style.display='flex';">
            <div id="ninitials-${char.id}" style="width:50px;height:50px;border-radius:50%;background:var(--accent-yellow);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;color:#111;">${initials}</div>
            <div style="font-size:10px;font-weight:700;margin-top:4px;text-align:center;word-break:break-word;line-height:1.2;">${char.name}</div>
        </div>
        ${bwNrtCell(char.gender, colors.gender)}
        ${bwNrtCell(bwNrtAffil(char.affiliation), colors.affiliation)}
        ${bwNrtCell(bwNrtJutsu(char.jutsuType), colors.jutsuType)}
        ${bwNrtCell(bwNrtNature(char.nature), colors.nature)}
        ${bwNrtCell(bwNrtAttr(char.attribute), colors.attribute)}
        ${bwNrtCell(char.kekkeiGenkai ? 'Yes' : 'No', colors.kekkeiGenkai)}
        ${bwNrtCell(char.debutArc, colors.debutArc)}
    </div>`;
}

function bwNrtShowResult() {
    const { answer, guesses, solved } = window.bwNrtState;
    const resultEl = document.getElementById('bwnrt-result');
    const inputArea = document.getElementById('bwnrt-input-area');
    if (!resultEl) return;
    if (solved) {
        const initials = answer.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
        resultEl.style.display = 'block';
        resultEl.style.background = '#1b5e20';
        resultEl.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
            <img id="nimg-answer" src="" style="width:100px;height:100px;border-radius:50%;object-fit:cover;border:3px solid #FF8C00;display:none;">
            <div id="ninitials-answer" style="width:100px;height:100px;border-radius:50%;background:var(--accent-yellow);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:26px;color:#111;">${initials}</div>
            <div style="font-size:20px;font-weight:800;color:#FF8C00;">${answer.name}</div>
            <div style="font-size:15px;font-weight:700;color:white;">🎉 ${guesses.length === 1 ? 'First try!' : `Solved in ${guesses.length} ${guesses.length===1?'guess':'guesses'}!`}</div>
            <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap;justify-content:center;">
                <button onclick="window.bwNrtShare()" class="action-btn" style="background:rgba(255,255,255,0.15);color:white;font-size:13px;border:1px solid rgba(255,255,255,0.4);"><span class="material-symbols-outlined" style="font-size:15px;">share</span> Share Result</button>
                <button id="bwnrt-post-btn" onclick="window.bwNrtPostToFeed(this)" class="action-btn" style="background:#FF8C00;color:#111;font-size:13px;"><span class="material-symbols-outlined" style="font-size:15px;">post_add</span> Post to Feed</button>
            </div>
        </div>`;
        if (inputArea) inputArea.style.display = 'none';
        window.bwNrtEnsureImages();
        const statusEl = document.getElementById('bwnrt-status-text');
        if (statusEl) statusEl.innerText = `✓ Solved in ${guesses.length} ${guesses.length===1?'guess':'guesses'} today!`;
    } else {
        resultEl.style.display = 'none';
        if (inputArea) inputArea.style.display = 'block';
    }
}

function bwNrtRender() {
    const grid = document.getElementById('bwnrt-grid');
    if (!grid) return;
    const { answer, guesses } = window.bwNrtState;
    grid.innerHTML = guesses.map(g => bwNrtBuildRow(g, bwNrtCalcColors(g, answer))).join('');
    window.bwNrtEnsureImages();
    bwNrtShowResult();
}

function bwNrtAnimateNewRow(char, colors) {
    const grid = document.getElementById('bwnrt-grid');
    if (!grid) return;
    grid.insertAdjacentHTML('beforeend', bwNrtBuildRow(char, colors));
    window.bwNrtEnsureImages();
    const newRow = grid.lastElementChild;
    const cells = newRow.querySelectorAll('.wordle-cell');
    cells.forEach((cell, i) => {
        cell.style.transform = 'rotateX(-90deg)';
        cell.style.opacity = '0';
        setTimeout(() => {
            cell.style.transition = 'transform 0.75s ease, opacity 0.55s ease';
            cell.style.transform = '';
            cell.style.opacity = '';
        }, i * 500);
    });
}

function bwNrtGetToday() {
    const today = bwGetDate();
    const seed = today.split('-').reduce((a,b) => a + parseInt(b), 0);
    return BW_NRT_CHARS[seed % BW_NRT_CHARS.length];
}

// --- BuzzWord: Naruto — State & Init ---
window.bwNrtState = { answer: null, guesses: [], solved: false, selectedChar: null, date: null };

window.openBwNrtModal = function() {
    window.closeAllModals();
    document.getElementById('bwnrt-modal').style.display = 'flex';
    window.initBwNrtGame();
};

window.initBwNrtGame = async function() {
    const today = bwGetDate();
    if (window.bwNrtState.answer && window.bwNrtState.date === today) {
        document.getElementById('bwnrt-loading').style.display = 'none';
        document.getElementById('bwnrt-content').style.display = 'block';
        bwNrtRender(); return;
    }
    window.bwNrtState = { answer: bwNrtGetToday(), guesses: [], solved: false, selectedChar: null, date: today };
    try {
        if (auth.currentUser) {
            try {
                const snap = await getDoc(doc(db, 'bw_nrt_games', `${auth.currentUser.uid}_${today}`));
                if (snap.exists()) {
                    const d = snap.data();
                    window.bwNrtState.guesses = (d.guesses||[]).map(id => BW_NRT_CHARS.find(c => c.id === id)).filter(Boolean);
                    window.bwNrtState.solved = d.solved || false;
                }
            } catch(e) {
                console.warn('NRT Firestore read failed, using localStorage:', e.message);
                const saved = localStorage.getItem(`wb_bwnrt_${today}`);
                if (saved) { const d = JSON.parse(saved); window.bwNrtState.guesses=(d.guesses||[]).map(id=>BW_NRT_CHARS.find(c=>c.id===id)).filter(Boolean); window.bwNrtState.solved=d.solved||false; }
            }
        } else {
            const saved = localStorage.getItem(`wb_bwnrt_${today}`);
            if (saved) { const d = JSON.parse(saved); window.bwNrtState.guesses=(d.guesses||[]).map(id=>BW_NRT_CHARS.find(c=>c.id===id)).filter(Boolean); window.bwNrtState.solved=d.solved||false; }
        }
    } catch(e) {}
    document.getElementById('bwnrt-loading').style.display = 'none';
    document.getElementById('bwnrt-content').style.display = 'block';
    bwNrtRender();
    window.bwNrtLoadImages();
};

window.bwNrtEnterGuess = function() {
    if (window.bwNrtState.selectedChar) { window.submitBwNrtGuess(); return; }
    const first = document.getElementById('bwnrt-suggestions')?.querySelector('.wordle-suggestion-item');
    if (first) first.click();
};

window.searchBwNrtChar = function() {
    window.bwNrtState.selectedChar = null;
    const q = document.getElementById('bwnrt-search')?.value.trim().toLowerCase();
    const sugg = document.getElementById('bwnrt-suggestions');
    if (!sugg) return;
    if (!q) { sugg.style.display = 'none'; return; }
    const guessedIds = new Set(window.bwNrtState.guesses.map(g => g.id));
    const matches = BW_NRT_CHARS.filter(c => !guessedIds.has(c.id) && c.name.toLowerCase().includes(q)).slice(0, 8);
    sugg.style.display = matches.length ? 'block' : 'none';
    sugg.innerHTML = matches.map(c => {
        const imgUrl = window.bwNrtGetCharImage(c.name);
        const pic = imgUrl ? `<img src="${imgUrl}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;">` : `<div style="width:32px;height:32px;border-radius:50%;background:var(--bg-gray-darker);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">${c.name[0]}</div>`;
        return `<div class="wordle-suggestion-item" style="display:flex;align-items:center;gap:10px;" onclick="window.selectBwNrtChar('${c.id}')">${pic}<span>${c.name}</span></div>`;
    }).join('');
};

window.selectBwNrtChar = function(id) {
    const char = BW_NRT_CHARS.find(c => c.id === id);
    if (!char) return;
    window.bwNrtState.selectedChar = char;
    const inp = document.getElementById('bwnrt-search');
    if (inp) inp.value = char.name;
    const sugg = document.getElementById('bwnrt-suggestions');
    if (sugg) sugg.style.display = 'none';
    window.submitBwNrtGuess();
};

window.submitBwNrtGuess = async function() {
    const char = window.bwNrtState.selectedChar;
    if (!char || window.bwNrtState.solved) return;
    if (window.bwNrtState.guesses.some(g => g.id === char.id)) return;
    const colors = bwNrtCalcColors(char, window.bwNrtState.answer);
    window.bwNrtState.guesses.push(char);
    window.bwNrtState.selectedChar = null;
    const inp = document.getElementById('bwnrt-search');
    if (inp) inp.value = '';
    const isCorrect = char.id === window.bwNrtState.answer.id;
    if (isCorrect) window.bwNrtState.solved = true;
    bwNrtAnimateNewRow(char, colors);
    const totalCells = 6;
    const delay = totalCells * 500 + 800;
    setTimeout(() => bwNrtShowResult(), delay);
    const today = bwGetDate();
    const map = {green:'🟩',yellow:'🟨',yellow_up:'🟨',yellow_down:'🟨',red:'🟥'};
    const emojiRow = [colors.gender,colors.affiliation,colors.jutsuType,colors.nature,colors.attribute,colors.kekkeiGenkai,colors.debutArc].map(x=>map[x]||'⬛').join('');
    const saveData = { guesses: window.bwNrtState.guesses.map(g=>g.id), solved: window.bwNrtState.solved, date: today, guessCount: window.bwNrtState.guesses.length, displayName: auth.currentUser?.displayName||'Player' };
    localStorage.setItem(`wb_bwnrt_${today}`, JSON.stringify(saveData));
    if (auth.currentUser) {
        setDoc(doc(db, 'bw_nrt_games', `${auth.currentUser.uid}_${today}`), saveData).catch(e => console.warn('NRT save failed:', e.message));
        if (window.bwNrtState.solved) window.bwNrtUpdateLeaderboard(window.bwNrtState.guesses.length);
    }
};

window.bwNrtUpdateLeaderboard = async function(guessCount) {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const ref = doc(db, 'bw_nrt_leaderboard', uid);
    const snap = await getDoc(ref);
    const today = bwGetDate();
    const yesterday = new Date(Date.now()-86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    let streak, totalWins;
    if (snap.exists()) {
        const d = snap.data();
        streak = d.lastWinDate === yesterday ? (d.currentStreak||0)+1 : 1;
        totalWins = (d.totalWins || 0) + 1;
        await updateDoc(ref, { totalWins: increment(1), totalGuesses: increment(guessCount), currentStreak: streak, bestStreak: Math.max(d.bestStreak||0,streak), lastWinDate: today, displayName: auth.currentUser.displayName });
    } else {
        streak = 1; totalWins = 1;
        await setDoc(ref, { totalWins:1, totalGuesses:guessCount, currentStreak:1, bestStreak:1, lastWinDate:today, displayName: auth.currentUser.displayName });
    }
    window.checkBwNrtAchievements(guessCount, streak, totalWins).catch(() => {});
};

window.checkBwNrtAchievements = async function(guessCount, streak, totalWins) {
    if (!auth.currentUser) return;
    const ids = [];
    if (totalWins === 1) ids.push('bwnrt_first');
    if (guessCount === 1) ids.push('bwnrt_1guess');
    if (streak >= 7) ids.push('bwnrt_streak_7');
    if (totalWins >= 30) ids.push('bwnrt_total_30');
    const today = bwGetDate();
    const uid = auth.currentUser.uid;
    try {
        const opSnap = await getDoc(doc(db, 'bw_op_games', `${uid}_${today}`));
        if (opSnap.exists() && opSnap.data().solved) ids.push('bw_double_agent');
        const opLb = await getDoc(doc(db, 'bw_op_leaderboard', uid));
        if (opLb.exists() && (opLb.data().totalWins || 0) >= 1) ids.push('bw_multiverse');
    } catch(e) {}
    if (ids.length) window.awardAchievements(ids).catch(() => {});
};

window.bwNrtShare = function() {
    const { answer, guesses, solved } = window.bwNrtState;
    const today = new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    const map = {green:'🟩',yellow:'🟨',yellow_up:'🟨',yellow_down:'🟨',red:'🟥'};
    const rows = guesses.map(g => {
        const c = bwNrtCalcColors(g, answer);
        return [c.gender,c.affiliation,c.jutsuType,c.nature,c.attribute,c.kekkeiGenkai,c.debutArc].map(x=>map[x]||'⬛').join('');
    }).join('\n');
    const text = `BuzzWord: Naruto Characters — ${today}\n${solved?`Solved in ${guesses.length} ${guesses.length===1?'guess':'guesses'}!`:'Not solved'}\n\n${rows}\n\nhttps://weebee.buzz/#community`;
    navigator.clipboard.writeText(text).then(()=>alert('Copied to clipboard!')).catch(()=>alert('Could not copy'));
};

window.bwNrtPostToFeed = async function(btn) {
    if (!auth.currentUser) return window.openAuthModal();
    const { answer, guesses, solved } = window.bwNrtState;
    if (!solved) return;
    const today = bwGetDate();
    const existing = await getDocs(query(collection(db,'bw_posts'), where('uid','==',auth.currentUser.uid), where('date','==',today), where('game','==','naruto')));
    if (!existing.empty) { btn.innerText='Already posted!'; btn.disabled=true; return; }
    const map = {green:'🟩',yellow:'🟨',yellow_up:'🟨',yellow_down:'🟨',red:'🟥'};
    const emojiGrid = guesses.map(g => {
        const c = bwNrtCalcColors(g, answer);
        return [c.gender,c.affiliation,c.jutsuType,c.nature,c.attribute,c.kekkeiGenkai,c.debutArc].map(x=>map[x]||'⬛').join('');
    }).join('\n');
    try {
        btn.disabled=true; btn.innerText='Posting...';
        const av = auth.currentUser.photoURL || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(auth.currentUser.displayName)}&backgroundColor=ffc107&fontColor=333333`;
        await addDoc(collection(db,'bw_posts'),{
            uid:auth.currentUser.uid, displayName:auth.currentUser.displayName, avatar:av,
            game:'naruto', guessCount:guesses.length, emojiGrid, date:today, timestamp:new Date(), likes:[], dislikes:[], commentCount:0
        });
        btn.innerText='✓ Posted!';
        window.awardAchievements(['feed_showtime']).catch(() => {});
        window.fetchBwCommunityFeed();
        window.fetchHomeBwFeed();
    } catch(e) { btn.disabled=false; btn.innerText='Post to Feed'; alert('Failed to post.'); }
};

// --- BuzzWord Post Cards ---
window.generateBwPostCardHTML = function(post) {
    const game = BW_GAMES[post.game] || BW_GAMES.op;
    const safeId = post.id;
    const col = post._col || 'bw_posts';
    const likes = post.likes || [];
    const dislikes = post.dislikes || [];
    const isLiked = auth.currentUser && likes.includes(auth.currentUser.uid);
    const isDisliked = auth.currentUser && dislikes.includes(auth.currentUser.uid);
    return `
        <div class="review-card bw-post-card feed-post-card">
            <div class="bw-thumb-wrapper">
                <img src="${game.cover}" class="bw-thumb-img" alt="${game.badge}">
                <div class="bw-play-overlay">
                    <span class="bw-play-btn" onclick="event.stopPropagation(); ${game.playFn}">▶ Play</span>
                </div>
            </div>
            <div class="review-header" style="position:relative; z-index:3; padding-right:195px;">
                <div style="display:flex; gap:12px; align-items:center;">
                    <img src="${post.avatar}" class="avatar" style="cursor:pointer;" onclick="event.stopPropagation(); viewUserProfile('${post.uid}')" onerror="this.src='https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(post.displayName)}&backgroundColor=ffc107&fontColor=333333'">
                    <div>
                        <strong style="color:var(--text-dark); font-size:14px;">${post.displayName}</strong>
                        <span class="bw-game-badge" style="background:${game.badgeBg}; color:${game.badgeColor};">${game.badge}</span>
                        ${window.getPinnedBadgesHTML(post.uid)}<br>
                        <span style="font-size:12px; color:var(--text-muted);">Solved in <strong style="color:var(--text-dark);">${post.guessCount} ${post.guessCount===1?'guess':'guesses'}</strong> · ${formatTimeAgo(post.timestamp)}</span>
                    </div>
                </div>
            </div>
            <div class="bw-emoji-grid" style="font-family:monospace; font-size:17px; letter-spacing:3px; line-height:2.2; margin:14px 0 4px; position:relative; z-index:2; padding-right:195px;">${post.emojiGrid.split('\n').join('<br>')}</div>
            <div class="review-actions">
                <div class="action-stat">
                    <button onclick="window.toggleBwPostComments(event,this,'${safeId}')">
                        <span class="material-symbols-outlined">chat_bubble</span>
                    </button>
                    <span class="action-label bw-comment-count">${post.commentCount || 0} Comments</span>
                </div>
                <div class="action-stat">
                    <button onclick="window.toggleBwPostReaction(event,'${safeId}','${col}','like',this)" style="${isLiked?'color:var(--accent-yellow);':''}">
                        <span class="material-symbols-outlined">thumb_up</span>
                    </button>
                    <span class="action-label" id="bw-likes-${safeId}">${likes.length} Likes</span>
                </div>
                <div class="action-stat">
                    <button onclick="window.toggleBwPostReaction(event,'${safeId}','${col}','dislike',this)" style="${isDisliked?'color:red;':''}">
                        <span class="material-symbols-outlined">thumb_down</span>
                    </button>
                    <span class="action-label" id="bw-dislikes-${safeId}">${dislikes.length} Dislikes</span>
                </div>
            </div>
            <div class="bw-post-comments" data-post-collection="${col}" style="display:none; margin-top:15px; padding-top:15px; border-top:1px solid var(--border-color); position:relative; z-index:2;" onclick="event.stopPropagation();">
                <div class="bw-comments-list"></div>
                <div style="display:flex; gap:10px; margin-top:10px;">
                    <input type="text" class="bw-comment-input" placeholder="Add a comment..." style="flex:1; padding:10px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-gray); color:var(--text-dark);" onkeydown="if(event.key==='Enter'){event.preventDefault();this.nextElementSibling.click();}">
                    <button class="action-btn" onclick="window.submitBwPostComment(event,this,'${safeId}','${col}')">Send</button>
                </div>
            </div>
        </div>`;
};

window.toggleBwPostReaction = async function(event, postId, postCollection, type, btn) {
    event.stopPropagation();
    if (!auth.currentUser) return window.openAuthModal();
    const uid = auth.currentUser.uid;
    const ref = doc(db, postCollection, postId);
    const field = type === 'like' ? 'likes' : 'dislikes';
    const opposite = type === 'like' ? 'dislikes' : 'likes';
    try {
        const snap = await getDoc(ref);
        const current = (snap.exists() ? snap.data()[field] : null) || [];
        const oppCurrent = (snap.exists() ? snap.data()[opposite] : null) || [];
        const hasReacted = current.includes(uid);
        const hadOpposite = oppCurrent.includes(uid);

        // Optimistic UI — match review card behavior (color on icon, not background)
        const actionsDiv = btn.closest('.review-actions');
        const likeBtn = actionsDiv?.children[0]?.querySelector('button');
        const dislikeBtn = actionsDiv?.children[1]?.querySelector('button');
        const likesEl = document.getElementById(`bw-likes-${postId}`);
        const dislikesEl = document.getElementById(`bw-dislikes-${postId}`);
        let newLikeCount = (snap.exists() ? (snap.data().likes||[]).length : 0);
        let newDislikeCount = (snap.exists() ? (snap.data().dislikes||[]).length : 0);

        if (type === 'like') {
            if (likeBtn) likeBtn.style.color = hasReacted ? '' : 'var(--accent-yellow)';
            if (dislikeBtn && hadOpposite) { dislikeBtn.style.color = ''; newDislikeCount -= 1; }
            newLikeCount += hasReacted ? -1 : 1;
        } else {
            if (dislikeBtn) dislikeBtn.style.color = hasReacted ? '' : 'red';
            if (likeBtn && hadOpposite) { likeBtn.style.color = ''; newLikeCount -= 1; }
            newDislikeCount += hasReacted ? -1 : 1;
        }
        if (likesEl) likesEl.textContent = `${Math.max(0, newLikeCount)} Likes`;
        if (dislikesEl) dislikesEl.textContent = `${Math.max(0, newDislikeCount)} Dislikes`;

        // Write to Firestore
        if (snap.exists()) {
            await updateDoc(ref, {
                [field]: hasReacted ? arrayRemove(uid) : arrayUnion(uid),
                [opposite]: arrayRemove(uid)
            });
        } else {
            await setDoc(ref, { [field]: [uid], [opposite]: [], commentCount: 0 }, { merge: true });
        }
    } catch(e) { console.error('Reaction failed', e); }
};

function renderBwComment(commentId, c, postId, postCollection) {
    const isOwner = auth.currentUser && c.uid === auth.currentUser.uid;
    const ownerBtns = isOwner ? `
        <button onclick="window.editBwPostComment('${commentId}')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:0;display:flex;align-items:center;" title="Edit"><span class="material-symbols-outlined" style="font-size:14px;">edit</span></button>
        <button onclick="window.deleteBwPostComment('${commentId}','${postId}','${postCollection}')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:0;display:flex;align-items:center;" title="Delete"><span class="material-symbols-outlined" style="font-size:14px;">delete</span></button>` : '';
    return `<div id="bw-comment-doc-${commentId}" style="display:flex; gap:10px; margin-bottom:10px; align-items:flex-start; background:var(--bg-white); padding:10px; border-radius:8px; border:1px solid var(--border-color);">
        <img src="${c.avatar}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.src='https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(c.displayName)}&backgroundColor=ffc107&fontColor=333333'">
        <div style="flex:1; min-width:0;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
                <strong style="font-size:13px; color:var(--text-dark);">${c.displayName}</strong>
                <div style="display:flex; gap:4px;">${ownerBtns}</div>
            </div>
            <p id="bw-comment-text-${commentId}" style="font-size:13px; margin:2px 0 0; color:var(--text-dark); word-break:break-word;">${c.text}${c.edited ? ' <span style="font-size:10px;color:var(--text-muted);font-style:italic;">(edited)</span>' : ''}</p>
        </div>
    </div>`;
}

window.editBwPostComment = function(commentId) {
    const p = document.getElementById(`bw-comment-text-${commentId}`);
    if (!p) return;
    const original = p.innerText.replace(/ \(edited\)$/, '').trim();
    p.outerHTML = `<div id="bw-comment-edit-${commentId}" data-original="${original.replace(/"/g,'&quot;')}">
        <textarea id="bw-comment-edit-input-${commentId}" style="width:100%;padding:6px;border-radius:6px;border:1px solid var(--border-color);font-size:12px;resize:vertical;background:var(--bg-gray);color:var(--text-dark);margin-top:4px;" rows="2">${original}</textarea>
        <div style="display:flex;gap:8px;margin-top:4px;">
            <button onclick="window.saveBwPostComment('${commentId}')" class="action-btn" style="padding:3px 10px;font-size:11px;">Save</button>
            <button onclick="window.cancelBwPostComment('${commentId}')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:11px;">Cancel</button>
        </div>
    </div>`;
};

window.cancelBwPostComment = function(commentId) {
    const wrap = document.getElementById(`bw-comment-edit-${commentId}`);
    if (!wrap) return;
    const original = wrap.dataset.original;
    wrap.outerHTML = `<p id="bw-comment-text-${commentId}" style="font-size:13px;margin:2px 0 0;color:var(--text-dark);word-break:break-word;">${original}</p>`;
};

window.saveBwPostComment = async function(commentId) {
    const input = document.getElementById(`bw-comment-edit-input-${commentId}`);
    if (!input) return;
    const newText = input.value.trim();
    if (!newText) return;
    try {
        await updateDoc(doc(db, 'bw_post_comments', commentId), { text: newText, edited: true });
        const wrap = document.getElementById(`bw-comment-edit-${commentId}`);
        if (wrap) wrap.outerHTML = `<p id="bw-comment-text-${commentId}" style="font-size:13px;margin:2px 0 0;color:var(--text-dark);word-break:break-word;">${newText} <span style="font-size:10px;color:var(--text-muted);font-style:italic;">(edited)</span></p>`;
    } catch(e) { alert('Failed to save edit.'); }
};

window.deleteBwPostComment = async function(commentId, postId, postCollection) {
    if (!auth.currentUser || !confirm('Delete this comment?')) return;
    try {
        await deleteDoc(doc(db, 'bw_post_comments', commentId));
        const el = document.getElementById(`bw-comment-doc-${commentId}`);
        if (el) {
            const card = el.closest('.feed-post-card');
            const countEl = card?.querySelector('.bw-comment-count');
            if (countEl) countEl.textContent = `${Math.max(0, (parseInt(countEl.textContent) || 1) - 1)} Comments`;
            el.remove();
        }
        updateDoc(doc(db, postCollection, postId), { commentCount: increment(-1) }).catch(() => {});
    } catch(e) { alert('Failed to delete comment.'); }
};

window.toggleBwPostComments = async function(event, btn, postId) {
    event.stopPropagation();
    const card = btn.closest('.feed-post-card');
    if (!card) return;
    const container = card.querySelector('.bw-post-comments');
    if (!container) return;
    const isOpen = container.style.display !== 'none';
    container.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
        const listEl = card.querySelector('.bw-comments-list');
        const postCollection = container.dataset.postCollection || 'bw_posts';
        if (listEl) {
            listEl.innerHTML = '<div class="loading" style="padding:10px;">Loading...</div>';
            try {
                const snap = await getDocs(query(collection(db, 'bw_post_comments'), where('postId', '==', postId)));
                const comments = snap.docs
                    .map(d => ({ ...d.data(), _id: d.id }))
                    .sort((a, b) => (a.timestamp?.toMillis?.() || 0) - (b.timestamp?.toMillis?.() || 0));
                listEl.innerHTML = comments.length
                    ? comments.map(c => renderBwComment(c._id, c, postId, postCollection)).join('')
                    : '<p style="font-size:13px;color:var(--text-muted);padding:4px 0;">No comments yet.</p>';
            } catch(e) { console.error(e); listEl.innerHTML = '<p style="font-size:13px;color:var(--text-muted);">Could not load comments.</p>'; }
        }
    }
};

window.submitBwPostComment = async function(event, btn, postId, postCollection) {
    event.stopPropagation();
    if (!auth.currentUser) return window.openAuthModal();
    const card = btn.closest('.feed-post-card');
    if (!card) return;
    postCollection = postCollection || card.querySelector('.bw-post-comments')?.dataset.postCollection || 'bw_posts';
    const input = card.querySelector('.bw-comment-input');
    const text = input?.value.trim();
    if (!text) return;
    input.value = '';
    const av = auth.currentUser.photoURL || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(auth.currentUser.displayName)}&backgroundColor=ffc107&fontColor=333333`;
    const commentData = { postId, uid: auth.currentUser.uid, displayName: auth.currentUser.displayName, avatar: av, text, timestamp: new Date() };
    try {
        const ref = await addDoc(collection(db, 'bw_post_comments'), commentData);
        const listEl = card.querySelector('.bw-comments-list');
        if (listEl) {
            listEl.querySelector('p')?.remove();
            listEl.innerHTML += renderBwComment(ref.id, commentData, postId, postCollection);
        }
        const countEl = card.querySelector('.bw-comment-count');
        if (countEl) countEl.textContent = `${(parseInt(countEl.textContent) || 0) + 1} Comments`;
        updateDoc(doc(db, postCollection, postId), { commentCount: increment(1) }).catch(() => {});
    } catch(e) { console.error('Comment failed', e); alert('Failed to post comment: ' + (e?.message || e)); }
};

const OP_ARC_ORDER = [
    'Romance Dawn','Orange Town','Syrup Village','Baratie','Arlong Park',
    'Loguetown','Reverse Mountain','Whisky Peak','Little Garden','Drum Island',
    'Alabasta','Jaya','Skypiea','Long Ring Long Land','Water 7',
    'Enies Lobby','Post-Enies Lobby','Thriller Bark','Sabaody Archipelago',
    'Amazon Lily','Impel Down','Marineford','Post-War','Return to Sabaody',
    'Fishman Island','Punk Hazard','Dressrosa','Zou','Whole Cake Island','Wano','Egghead'
];

const BW_OP_CHARS = [
    {id:'luffy',name:'Monkey D. Luffy',gender:'Male',affiliation:'Straw Hat Pirates',df:{has:true,type:'Zoan',name:'Hito Hito no Mi, Nika Model'},haki:['Observation','Armament','Conquerors'],bounty:3000000000,height:174,firstArc:'Romance Dawn'},
    {id:'zoro',name:'Roronoa Zoro',gender:'Male',affiliation:'Straw Hat Pirates',df:{has:false,type:null,name:null},haki:['Observation','Armament','Conquerors'],bounty:1111000000,height:181,firstArc:'Romance Dawn'},
    {id:'nami',name:'Nami',gender:'Female',affiliation:'Straw Hat Pirates',df:{has:false,type:null,name:null},haki:[],bounty:366000000,height:170,firstArc:'Orange Town'},
    {id:'usopp',name:'Usopp',gender:'Male',affiliation:'Straw Hat Pirates',df:{has:false,type:null,name:null},haki:['Observation'],bounty:500000000,height:176,firstArc:'Syrup Village'},
    {id:'sanji',name:'Sanji',gender:'Male',affiliation:'Straw Hat Pirates',df:{has:false,type:null,name:null},haki:['Observation','Armament'],bounty:1032000000,height:180,firstArc:'Baratie'},
    {id:'chopper',name:'Tony Tony Chopper',gender:'Male',affiliation:'Straw Hat Pirates',df:{has:true,type:'Zoan',name:'Hito Hito no Mi'},haki:[],bounty:1000,height:90,firstArc:'Drum Island'},
    {id:'robin',name:'Nico Robin',gender:'Female',affiliation:'Straw Hat Pirates',df:{has:true,type:'Paramecia',name:'Hana Hana no Mi'},haki:['Observation','Armament'],bounty:930000000,height:188,firstArc:'Alabasta'},
    {id:'franky',name:'Franky',gender:'Male',affiliation:'Straw Hat Pirates',df:{has:false,type:null,name:null},haki:[],bounty:394000000,height:225,firstArc:'Water 7'},
    {id:'brook',name:'Brook',gender:'Male',affiliation:'Straw Hat Pirates',df:{has:true,type:'Paramecia',name:'Yomi Yomi no Mi'},haki:[],bounty:383000000,height:277,firstArc:'Thriller Bark'},
    {id:'jinbe',name:'Jinbe',gender:'Male',affiliation:'Straw Hat Pirates',df:{has:false,type:null,name:null},haki:['Observation','Armament'],bounty:1100000000,height:301,firstArc:'Impel Down'},
    {id:'shanks',name:'Shanks',gender:'Male',affiliation:'Red Hair Pirates',df:{has:false,type:null,name:null},haki:['Observation','Armament','Conquerors'],bounty:4048900000,height:199,firstArc:'Romance Dawn'},
    {id:'whitebeard',name:'Edward Newgate',gender:'Male',affiliation:'Whitebeard Pirates',df:{has:true,type:'Paramecia',name:'Gura Gura no Mi'},haki:['Observation','Armament','Conquerors'],bounty:5046000000,height:666,firstArc:'Jaya'},
    {id:'marco',name:'Marco',gender:'Male',affiliation:'Whitebeard Pirates',df:{has:true,type:'Zoan',name:'Tori Tori no Mi, Phoenix Model'},haki:['Observation','Armament'],bounty:1374000000,height:203,firstArc:'Jaya'},
    {id:'kaido',name:'Kaido',gender:'Male',affiliation:'Beasts Pirates',df:{has:true,type:'Zoan',name:'Uo Uo no Mi, Seiryu Model'},haki:['Observation','Armament','Conquerors'],bounty:4611100000,height:710,firstArc:'Dressrosa'},
    {id:'bigmom',name:'Charlotte Linlin',gender:'Female',affiliation:'Big Mom Pirates',df:{has:true,type:'Paramecia',name:'Soru Soru no Mi'},haki:['Observation','Armament','Conquerors'],bounty:4388000000,height:880,firstArc:'Fishman Island'},
    {id:'blackbeard',name:'Marshall D. Teach',gender:'Male',affiliation:'Blackbeard Pirates',df:{has:true,type:'Logia',name:'Yami Yami no Mi'},haki:['Armament'],bounty:3996000000,height:344,firstArc:'Jaya'},
    {id:'akainu',name:'Sakazuki',gender:'Male',affiliation:'Marines',df:{has:true,type:'Logia',name:'Magu Magu no Mi'},haki:['Observation','Armament'],bounty:0,height:306,firstArc:'Marineford'},
    {id:'aokiji',name:'Kuzan',gender:'Male',affiliation:'Marines',df:{has:true,type:'Logia',name:'Hie Hie no Mi'},haki:['Observation','Armament'],bounty:0,height:298,firstArc:'Long Ring Long Land'},
    {id:'kizaru',name:'Borsalino',gender:'Male',affiliation:'Marines',df:{has:true,type:'Logia',name:'Pika Pika no Mi'},haki:['Observation','Armament'],bounty:0,height:302,firstArc:'Sabaody Archipelago'},
    {id:'garp',name:'Monkey D. Garp',gender:'Male',affiliation:'Marines',df:{has:false,type:null,name:null},haki:['Observation','Armament','Conquerors'],bounty:0,height:287,firstArc:'Post-Enies Lobby'},
    {id:'smoker',name:'Smoker',gender:'Male',affiliation:'Marines',df:{has:true,type:'Logia',name:'Moku Moku no Mi'},haki:['Armament'],bounty:0,height:209,firstArc:'Loguetown'},
    {id:'tashigi',name:'Tashigi',gender:'Female',affiliation:'Marines',df:{has:false,type:null,name:null},haki:['Armament'],bounty:0,height:170,firstArc:'Loguetown'},
    {id:'coby',name:'Coby',gender:'Male',affiliation:'Marines',df:{has:false,type:null,name:null},haki:['Observation','Armament'],bounty:0,height:183,firstArc:'Romance Dawn'},
    {id:'mihawk',name:'Dracule Mihawk',gender:'Male',affiliation:'Cross Guild',df:{has:false,type:null,name:null},haki:['Observation','Armament'],bounty:3590000000,height:198,firstArc:'Baratie'},
    {id:'hancock',name:'Boa Hancock',gender:'Female',affiliation:'Kuja Pirates',df:{has:true,type:'Paramecia',name:'Mero Mero no Mi'},haki:['Observation','Armament','Conquerors'],bounty:1659000000,height:191,firstArc:'Amazon Lily'},
    {id:'doflamingo',name:'Donquixote Doflamingo',gender:'Male',affiliation:'Donquixote Pirates',df:{has:true,type:'Paramecia',name:'Ito Ito no Mi'},haki:['Observation','Armament','Conquerors'],bounty:340000000,height:305,firstArc:'Jaya'},
    {id:'crocodile',name:'Crocodile',gender:'Male',affiliation:'Cross Guild',df:{has:true,type:'Logia',name:'Suna Suna no Mi'},haki:['Armament'],bounty:1965000000,height:253,firstArc:'Alabasta'},
    {id:'law',name:'Trafalgar D. Water Law',gender:'Male',affiliation:'Heart Pirates',df:{has:true,type:'Paramecia',name:'Ope Ope no Mi'},haki:['Observation','Armament','Conquerors'],bounty:3000000000,height:191,firstArc:'Sabaody Archipelago'},
    {id:'buggy',name:'Buggy',gender:'Male',affiliation:'Cross Guild',df:{has:true,type:'Paramecia',name:'Bara Bara no Mi'},haki:[],bounty:3189000000,height:182,firstArc:'Orange Town'},
    {id:'sabo',name:'Sabo',gender:'Male',affiliation:'Revolutionary Army',df:{has:true,type:'Logia',name:'Mera Mera no Mi'},haki:['Observation','Armament','Conquerors'],bounty:602000000,height:187,firstArc:'Dressrosa'},
    {id:'ace',name:'Portgas D. Ace',gender:'Male',affiliation:'Whitebeard Pirates',df:{has:true,type:'Logia',name:'Mera Mera no Mi'},haki:['Observation','Armament','Conquerors'],bounty:550000000,height:185,firstArc:'Alabasta'},
    {id:'rayleigh',name:'Silvers Rayleigh',gender:'Male',affiliation:'Roger Pirates',df:{has:false,type:null,name:null},haki:['Observation','Armament','Conquerors'],bounty:0,height:188,firstArc:'Sabaody Archipelago'},
    {id:'roger',name:'Gol D. Roger',gender:'Male',affiliation:'Roger Pirates',df:{has:false,type:null,name:null},haki:['Observation','Armament','Conquerors'],bounty:5564800000,height:274,firstArc:'Romance Dawn'},
    {id:'kid',name:'Eustass Kid',gender:'Male',affiliation:'Kid Pirates',df:{has:true,type:'Paramecia',name:'Jiki Jiki no Mi'},haki:['Armament','Conquerors'],bounty:3000000000,height:205,firstArc:'Sabaody Archipelago'},
    {id:'killer',name:'Killer',gender:'Male',affiliation:'Kid Pirates',df:{has:false,type:null,name:null},haki:['Armament'],bounty:200000000,height:195,firstArc:'Sabaody Archipelago'},
    {id:'hawkins',name:'Basil Hawkins',gender:'Male',affiliation:'Hawkins Pirates',df:{has:true,type:'Paramecia',name:'Wara Wara no Mi'},haki:['Armament'],bounty:320000000,height:210,firstArc:'Sabaody Archipelago'},
    {id:'drake',name:'X Drake',gender:'Male',affiliation:'SWORD',df:{has:true,type:'Zoan',name:'Ryu Ryu no Mi, Allosaurus Model'},haki:['Observation','Armament'],bounty:222000000,height:233,firstArc:'Sabaody Archipelago'},
    {id:'bonney',name:'Jewelry Bonney',gender:'Female',affiliation:'Bonney Pirates',df:{has:true,type:'Paramecia',name:'Toshi Toshi no Mi'},haki:[],bounty:320000000,height:174,firstArc:'Sabaody Archipelago'},
    {id:'bege',name:'Capone Bege',gender:'Male',affiliation:'Firetank Pirates',df:{has:true,type:'Paramecia',name:'Shiro Shiro no Mi'},haki:['Armament'],bounty:350000000,height:166,firstArc:'Sabaody Archipelago'},
    {id:'lucci',name:'Rob Lucci',gender:'Male',affiliation:'CP0',df:{has:true,type:'Zoan',name:'Neko Neko no Mi, Leopard Model'},haki:['Observation','Armament'],bounty:0,height:212,firstArc:'Water 7'},
    {id:'vivi',name:'Nefeltari Vivi',gender:'Female',affiliation:'Alabasta Kingdom',df:{has:false,type:null,name:null},haki:[],bounty:0,height:169,firstArc:'Whisky Peak'},
    {id:'enel',name:'Enel',gender:'Male',affiliation:'Skypiea',df:{has:true,type:'Logia',name:'Goro Goro no Mi'},haki:['Observation'],bounty:0,height:266,firstArc:'Skypiea'},
    {id:'arlong',name:'Arlong',gender:'Male',affiliation:'Arlong Pirates',df:{has:false,type:null,name:null},haki:[],bounty:20000000,height:263,firstArc:'Arlong Park'},
    {id:'moria',name:'Gecko Moria',gender:'Male',affiliation:'Thriller Bark Pirates',df:{has:true,type:'Paramecia',name:'Kage Kage no Mi'},haki:[],bounty:320000000,height:692,firstArc:'Thriller Bark'},
    {id:'perona',name:'Perona',gender:'Female',affiliation:'Thriller Bark Pirates',df:{has:true,type:'Paramecia',name:'Horo Horo no Mi'},haki:[],bounty:0,height:156,firstArc:'Thriller Bark'},
    {id:'caesar',name:'Caesar Clown',gender:'Male',affiliation:'Punk Hazard',df:{has:true,type:'Logia',name:'Gasu Gasu no Mi'},haki:[],bounty:300000000,height:309,firstArc:'Punk Hazard'},
    {id:'bartolomeo',name:'Bartolomeo',gender:'Male',affiliation:'Barto Club',df:{has:true,type:'Paramecia',name:'Bari Bari no Mi'},haki:['Armament'],bounty:200000000,height:220,firstArc:'Dressrosa'},
    {id:'cavendish',name:'Cavendish',gender:'Male',affiliation:'Beautiful Pirates',df:{has:false,type:null,name:null},haki:['Observation','Armament'],bounty:330000000,height:200,firstArc:'Dressrosa'},
    {id:'rebecca',name:'Rebecca',gender:'Female',affiliation:'Dressrosa',df:{has:false,type:null,name:null},haki:[],bounty:0,height:165,firstArc:'Dressrosa'},
    {id:'katakuri',name:'Charlotte Katakuri',gender:'Male',affiliation:'Big Mom Pirates',df:{has:true,type:'Paramecia',name:'Mochi Mochi no Mi'},haki:['Observation','Armament','Conquerors'],bounty:1057000000,height:509,firstArc:'Whole Cake Island'},
    {id:'carrot',name:'Carrot',gender:'Female',affiliation:'Mink Tribe',df:{has:false,type:null,name:null},haki:['Armament'],bounty:0,height:169,firstArc:'Zou'},
    {id:'yamato',name:'Yamato',gender:'Female',affiliation:'Wano',df:{has:true,type:'Zoan',name:'Inu Inu no Mi, Okuchi-no-Makami Model'},haki:['Observation','Armament','Conquerors'],bounty:0,height:263,firstArc:'Wano'},
    {id:'queen',name:'Queen',gender:'Male',affiliation:'Beasts Pirates',df:{has:true,type:'Zoan',name:'Ryu Ryu no Mi, Brachiosaurus Model'},haki:['Armament'],bounty:1320000000,height:612,firstArc:'Wano'},
    {id:'king',name:'King',gender:'Male',affiliation:'Beasts Pirates',df:{has:true,type:'Zoan',name:'Ryu Ryu no Mi, Pteranodon Model'},haki:['Observation','Armament','Conquerors'],bounty:1390000000,height:613,firstArc:'Wano'},
    {id:'jack',name:'Jack',gender:'Male',affiliation:'Beasts Pirates',df:{has:true,type:'Zoan',name:'Zou Zou no Mi, Mammoth Model'},haki:['Armament'],bounty:1000000000,height:450,firstArc:'Zou'},
    {id:'sengoku',name:'Sengoku',gender:'Male',affiliation:'Marines',df:{has:true,type:'Zoan',name:'Hito Hito no Mi, Daibutsu Model'},haki:['Observation','Armament','Conquerors'],bounty:0,height:278,firstArc:'Marineford'},
];

// --- BuzzWord: One Piece — Image System ---
window.bwOpImageMap = {};
window.bwOpImgReady = false;

window.bwOpLoadImages = async function() {
    const cacheKey = 'wb_op_imgs_v5';
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        try { window.bwOpImageMap = JSON.parse(cached); window.bwOpImgReady = true; return; } catch(e) {}
    }
    try {
        const res = await fetch('https://api.jikan.moe/v4/anime/21/characters');
        if (!res.ok) return;
        const { data } = await res.json();
        const map = {};
        (data || []).forEach(entry => {
            const char = entry.character;
            if (!char?.images?.jpg?.image_url) return;
            const img = char.images.jpg.image_url;
            const raw = char.name; // Jikan uses "Last, First" for Japanese names
            map[raw.toLowerCase()] = img;
            if (raw.includes(',')) {
                // "Luffy, Monkey D." → "Monkey D. Luffy"
                const [last, ...rest] = raw.split(',');
                const natural = `${rest.join(',').trim()} ${last.trim()}`;
                map[natural.toLowerCase()] = img;
                // Also index by first word of first name
                const firstWord = rest.join(' ').trim().split(' ')[0].toLowerCase();
                if (firstWord && !map[firstWord]) map[firstWord] = img;
            } else {
                // Index by last word (common surname/nickname)
                const parts = raw.split(' ');
                const last = parts[parts.length - 1].toLowerCase();
                if (!map[last]) map[last] = img;
            }
        });
        window.bwOpImageMap = map;
        window.bwOpImgReady = true;
        try { localStorage.setItem(cacheKey, JSON.stringify(map)); } catch(e) {}
    } catch(e) {}
};

const WP_NAME_ALIASES = {
    'kaido': 'kaidou',
    'kaidou': 'kaido',
    'charlotte linlin': 'big mom',
    'big mom': 'charlotte linlin',
    'marshall d. teach': 'blackbeard',
    'gol d. roger': 'roger',
    'marco': 'marco the phoenix',
    'marco the phoenix': 'marco',
};

window.bwOpGetCharImage = function(name) {
    const m = window.bwOpImageMap;
    const n = name.toLowerCase();
    if (m[n]) return m[n];
    // Try alias
    const alias = WP_NAME_ALIASES[n];
    if (alias && m[alias]) return m[alias];
    const parts = name.split(' ');
    // Try last name
    const last = parts[parts.length - 1].toLowerCase();
    if (m[last]) return m[last];
    // Try first name
    const first = parts[0].toLowerCase();
    if (m[first]) return m[first];
    // Try alias of last name
    const lastAlias = WP_NAME_ALIASES[last];
    if (lastAlias && m[lastAlias]) return m[lastAlias];
    return null;
};

window.bwOpApplyImages = function() {
    document.querySelectorAll('[id^="wimg-"]').forEach(img => {
        const charId = img.id.replace('wimg-', '');
        const char = charId === 'answer'
            ? window.bwOpState.answer
            : BW_OP_CHARS.find(c => c.id === charId);
        if (!char) return;
        const url = window.bwOpGetCharImage(char.name);
        if (url) {
            img.src = url; img.style.display = 'block';
            const fb = document.getElementById(`winitials-${charId}`);
            if (fb) fb.style.display = 'none';
        }
    });
};

window.bwOpEnsureImages = async function() {
    if (!window.bwOpImgReady) await window.bwOpLoadImages();
    window.bwOpApplyImages();
};

window.bwOpEnterGuess = function() {
    const firstItem = document.querySelector('#bwop-suggestions .wordle-suggestion-item');
    if (firstItem) firstItem.click();
};

// --- BuzzWord: One Piece — Helpers ---
function bwOpBounty(n) {
    if (n === 0) return '฿ 0';
    if (n >= 1000000000) return '฿ ' + (n/1000000000).toFixed(2).replace(/\.?0+$/,'') + 'B';
    if (n >= 1000000) return '฿ ' + Math.round(n/1000000) + 'M';
    return '฿ ' + n.toLocaleString();
}
function bwOpHeight(cm) {
    return Math.floor(cm/100) + 'm' + (cm%100).toString().padStart(2,'0');
}
function bwOpHaki(h) {
    if (!h || h.length === 0) return 'None';
    return h.map(x => x === 'Observation' ? '👁️ Observation' : x === 'Armament' ? '🦾 Armament' : '👑 Conquerors').join('\n');
}
function bwOpDF(df) {
    return df.has ? df.type : 'None';
}

function bwOpCalcColors(guess, answer) {
    // Gender
    const gender = guess.gender === answer.gender ? 'green' : 'red';
    // Affiliation
    const affiliation = guess.affiliation === answer.affiliation ? 'green' : 'red';
    // Devil Fruit
    let devilFruit;
    if (!guess.df.has && !answer.df.has) devilFruit = 'green';
    else if (guess.df.has !== answer.df.has) devilFruit = 'red';
    else if (guess.df.type === answer.df.type) devilFruit = 'green';
    else devilFruit = 'yellow';
    // Haki
    const gH = guess.haki, aH = answer.haki;
    let haki;
    if (gH.length === 0 && aH.length === 0) haki = 'green';
    else if (gH.length === aH.length && gH.every(h => aH.includes(h))) haki = 'green';
    else if (gH.some(h => aH.includes(h))) haki = 'yellow';
    else haki = 'red';
    // Bounty — exact or directional
    let bounty = 'green', bountyDir = null;
    if (guess.bounty !== answer.bounty) { bounty = 'red'; bountyDir = answer.bounty > guess.bounty ? 'up' : 'down'; }
    // Height — exact or directional
    let height = 'green', heightDir = null;
    if (guess.height !== answer.height) { height = 'red'; heightDir = answer.height > guess.height ? 'up' : 'down'; }
    // First Arc — exact or directional
    const gIdx = OP_ARC_ORDER.indexOf(guess.firstArc);
    const aIdx = OP_ARC_ORDER.indexOf(answer.firstArc);
    let firstArc = 'green', arcDir = null;
    if (gIdx !== aIdx) { firstArc = 'red'; arcDir = aIdx > gIdx ? 'up' : 'down'; }
    return { gender, affiliation, devilFruit, haki, bounty, bountyDir, height, heightDir, firstArc, arcDir };
}

function bwOpGetToday() {
    const msPerDay = 86400000;
    const epoch = new Date('2025-01-01').getTime();
    const idx = Math.floor((Date.now() - epoch) / msPerDay);
    return BW_OP_CHARS[idx % BW_OP_CHARS.length];
}

function bwOpRenderRow(char, colors) {
    function cell(val, color, dir) {
        const bg = color === 'green' ? '#2e7d32' : color === 'yellow' ? '#e65100' : '#b71c1c';
        const arrow = dir ? `<span class="material-symbols-outlined" style="font-size:24px; margin-top:3px;">${dir === 'up' ? 'arrow_upward' : 'arrow_downward'}</span>` : '';
        const valHtml = val.includes('\n') ? val.split('\n').map(v=>`<span>${v}</span>`).join('<br>') : val;
        return `<div class="wordle-cell ${color}" style="white-space:pre-line;">${valHtml}${arrow ? '<br>'+arrow : ''}</div>`;
    }
    const initials = char.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const avatarHtml = `
        <img id="wimg-${char.id}" src="" style="width:60px;height:60px;border-radius:50%;object-fit:cover;border:2px solid var(--accent-yellow);display:none;">
        <div id="winitials-${char.id}" style="width:60px;height:60px;border-radius:50%;background:var(--accent-yellow);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;color:#111;">${initials}</div>`;
    const displayName = char.name.split(' ').length > 2 ? char.name.split(' ').slice(-2).join(' ') : char.name;
    return `<div class="wordle-row">
        <div class="wordle-char-cell">
            ${avatarHtml}
            <div style="font-size:10px;font-weight:700;text-align:center;margin-top:4px;color:var(--text-dark);line-height:1.2;">${displayName}</div>
        </div>
        ${cell(char.gender, colors.gender)}
        ${cell(char.affiliation, colors.affiliation)}
        ${cell(bwOpDF(char.df), colors.devilFruit)}
        ${cell(bwOpHaki(char.haki), colors.haki)}
        ${cell(bwOpBounty(char.bounty), colors.bounty, colors.bountyDir)}
        ${cell(bwOpHeight(char.height), colors.height, colors.heightDir)}
        ${cell(char.firstArc, colors.firstArc, colors.arcDir)}
    </div>`;
}

function bwOpShowResult() {
    const { answer, guesses, solved } = window.bwOpState;
    const resultEl = document.getElementById('bwop-result');
    const inputArea = document.getElementById('bwop-input-area');
    if (!resultEl) return;
    if (solved) {
        const initials = answer.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
        const answerImg = `
            <img id="wimg-answer" src="" style="width:100px;height:100px;border-radius:50%;object-fit:cover;border:3px solid #FFD700;display:none;">
            <div id="winitials-answer" style="width:100px;height:100px;border-radius:50%;background:var(--accent-yellow);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:26px;color:#111;">${initials}</div>`;
        resultEl.style.display = 'block';
        resultEl.style.background = '#1b5e20';
        resultEl.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
            ${answerImg}
            <div style="font-size:20px;font-weight:800;color:#FFD700;">${answer.name}</div>
            <div style="font-size:15px;font-weight:700;color:white;">🎉 ${guesses.length === 1 ? 'First try!' : `Solved in ${guesses.length} ${guesses.length===1?'guess':'guesses'}!`}</div>
            <div style="display:flex; gap:10px; margin-top:8px; flex-wrap:wrap; justify-content:center;">
                <button onclick="window.bwOpShare()" class="action-btn" style="background:rgba(255,255,255,0.15);color:white;font-size:13px;border:1px solid rgba(255,255,255,0.4);">
                    <span class="material-symbols-outlined" style="font-size:15px;">share</span> Share Result
                </button>
                <button id="bwop-post-btn" onclick="window.bwOpPostToFeed(this)" class="action-btn" style="background:var(--accent-yellow);color:#111;font-size:13px;" ${!auth.currentUser ? 'style="display:none;"' : ''}>
                    <span class="material-symbols-outlined" style="font-size:15px;">post_add</span> Post to Feed
                </button>
            </div>
        </div>`;
        if (inputArea) inputArea.style.display = 'none';
        // Load answer image
        window.bwOpEnsureImages();
        // Update thumbnail status
        const statusEl = document.getElementById('bwop-status-text');
        if (statusEl) statusEl.innerText = `✓ Solved in ${guesses.length} ${guesses.length===1?'guess':'guesses'} today!`;
    } else {
        resultEl.style.display = 'none';
        if (inputArea) inputArea.style.display = 'block';
    }
}

function bwOpRender() {
    const grid = document.getElementById('bwop-grid');
    if (!grid) return;
    const { answer, guesses } = window.bwOpState;
    grid.innerHTML = guesses.map(g => bwOpRenderRow(g, bwOpCalcColors(g, answer))).join('');
    window.bwOpEnsureImages();
    bwOpShowResult();
}

function bwOpAnimateNewRow(char, colors) {
    const grid = document.getElementById('bwop-grid');
    if (!grid) return;
    grid.insertAdjacentHTML('beforeend', bwOpRenderRow(char, colors));
    window.bwOpEnsureImages();
    const newRow = grid.lastElementChild;
    const cells = newRow.querySelectorAll('.wordle-cell');
    cells.forEach((cell, i) => {
        cell.style.transform = 'rotateX(-90deg)';
        cell.style.opacity = '0';
        setTimeout(() => {
            cell.style.transition = 'transform 0.75s ease, opacity 0.55s ease';
            cell.style.transform = '';
            cell.style.opacity = '';
        }, i * 500);
    });
}

// --- BuzzWord: One Piece — State & Init ---
window.bwOpState = { answer: null, guesses: [], solved: false, selectedChar: null, date: null };

window.openBwOpModal = function() {
    window.closeAllModals();
    document.getElementById('bwop-modal').style.display = 'flex';
    window.initBwOpGame();
    window.bwOpLoadImages(); // pre-warm cache in background
};

window.initBwOpGame = async function() {
    const today = bwGetDate();
    if (window.bwOpState.answer && window.bwOpState.date === today) {
        // Already initialized for today — just re-render
        document.getElementById('bwop-loading').style.display = 'none';
        document.getElementById('bwop-content').style.display = 'block';
        bwOpRender();
        return;
    }
    window.bwOpState = { answer: bwOpGetToday(), guesses: [], solved: false, selectedChar: null, date: today };
    try {
        if (auth.currentUser) {
            try {
                const snap = await getDoc(doc(db, 'bw_op_games', `${auth.currentUser.uid}_${today}`));
                if (snap.exists()) {
                    const d = snap.data();
                    window.bwOpState.guesses = (d.guesses||[]).map(id=>BW_OP_CHARS.find(c=>c.id===id)).filter(Boolean);
                    window.bwOpState.solved = d.solved || false;
                }
            } catch(e) {
                console.warn('OP Firestore read failed, using localStorage:', e.message);
                const saved = localStorage.getItem(`wb_bwop_${today}`);
                if (saved) { const d = JSON.parse(saved); window.bwOpState.guesses=(d.guesses||[]).map(id=>BW_OP_CHARS.find(c=>c.id===id)).filter(Boolean); window.bwOpState.solved=d.solved||false; }
            }
        } else {
            const saved = localStorage.getItem(`wb_bwop_${today}`);
            if (saved) { const d = JSON.parse(saved); window.bwOpState.guesses=(d.guesses||[]).map(id=>BW_OP_CHARS.find(c=>c.id===id)).filter(Boolean); window.bwOpState.solved=d.solved||false; }
        }
    } catch(e) {}
    document.getElementById('bwop-loading').style.display = 'none';
    document.getElementById('bwop-content').style.display = 'block';
    bwOpRender();
    // Update thumbnail status text
    const statusEl = document.getElementById('bwop-status-text');
    if (statusEl) {
        const { solved, guesses } = window.bwOpState;
        statusEl.innerText = solved ? `✓ Solved in ${guesses.length} ${guesses.length===1?'guess':'guesses'} today!` : guesses.length > 0 ? `${guesses.length} ${guesses.length===1?'guess':'guesses'} so far — keep going!` : 'New puzzle available! 🗡️';
    }
};

window.wpEnterGuess = function() {
    if (window.bwOpState.selectedChar) { window.submitBwOpGuess(); return; }
    const first = document.getElementById('bwop-suggestions')?.querySelector('.wordle-suggestion-item');
    if (first) first.click();
};

window.searchBwOpChar = function() {
    window.bwOpState.selectedChar = null;
    const q = document.getElementById('bwop-search')?.value.trim().toLowerCase();
    const sugg = document.getElementById('bwop-suggestions');
    if (!sugg) return;
    if (!q) { sugg.style.display = 'none'; return; }
    const guessedIds = new Set(window.bwOpState.guesses.map(g => g.id));
    const matches = BW_OP_CHARS.filter(c => !guessedIds.has(c.id) && c.name.toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length) { sugg.style.display = 'none'; return; }
    sugg.style.display = 'block';
    sugg.innerHTML = matches.map(c => {
        const imgUrl = window.bwOpGetCharImage ? window.bwOpGetCharImage(c.name) : null;
        const pic = imgUrl ? `<img src="${imgUrl}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;">` : `<div style="width:32px;height:32px;border-radius:50%;background:var(--bg-gray-darker);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">${c.name[0]}</div>`;
        return `<div class="wordle-suggestion-item" style="display:flex;align-items:center;gap:10px;" onclick="window.selectBwOpChar('${c.id}')">${pic}<span>${c.name}</span></div>`;
    }).join('');
};

window.selectBwOpChar = function(id) {
    const char = BW_OP_CHARS.find(c => c.id === id);
    if (!char) return;
    window.bwOpState.selectedChar = char;
    const inp = document.getElementById('bwop-search');
    if (inp) inp.value = '';
    const sugg = document.getElementById('bwop-suggestions');
    if (sugg) sugg.style.display = 'none';
    window.submitBwOpGuess();
};

window.submitBwOpGuess = async function() {
    const char = window.bwOpState.selectedChar;
    if (!char || window.bwOpState.solved) return;
    if (window.bwOpState.guesses.some(g => g.id === char.id)) return;
    const colors = bwOpCalcColors(char, window.bwOpState.answer);
    window.bwOpState.guesses.push(char);
    window.bwOpState.selectedChar = null;
    const isCorrect = char.id === window.bwOpState.answer.id;
    if (isCorrect) window.bwOpState.solved = true;
    // Animate the new row
    bwOpAnimateNewRow(char, colors);
    // Show result after animation completes
    const totalCells = 7;
    const delay = totalCells * 500 + 800;
    setTimeout(() => bwOpShowResult(), delay);
    // Save state
    const today = bwGetDate();
    const saveData = { guesses: window.bwOpState.guesses.map(g=>g.id), solved: window.bwOpState.solved, date: today, guessCount: window.bwOpState.guesses.length, displayName: auth.currentUser?.displayName || 'Player' };
    localStorage.setItem(`wb_bwop_${today}`, JSON.stringify(saveData));
    if (auth.currentUser) {
        setDoc(doc(db, 'bw_op_games', `${auth.currentUser.uid}_${today}`), saveData).catch(e => console.warn('OP save failed:', e.message));
        if (window.bwOpState.solved) window.bwOpUpdateLeaderboard(window.bwOpState.guesses.length);
    }
};

window.bwOpUpdateLeaderboard = async function(guessCount) {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const ref = doc(db, 'bw_op_leaderboard', uid);
    const snap = await getDoc(ref);
    const today = bwGetDate();
    const yesterday = new Date(Date.now()-86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    let streak, totalWins;
    if (snap.exists()) {
        const d = snap.data();
        streak = d.lastWinDate === yesterday ? (d.currentStreak||0)+1 : 1;
        totalWins = (d.totalWins || 0) + 1;
        await updateDoc(ref, { totalWins: increment(1), totalGuesses: increment(guessCount), currentStreak: streak, bestStreak: Math.max(d.bestStreak||0, streak), lastWinDate: today, displayName: auth.currentUser.displayName });
    } else {
        streak = 1; totalWins = 1;
        await setDoc(ref, { totalWins:1, totalGuesses:guessCount, currentStreak:1, bestStreak:1, lastWinDate:today, displayName: auth.currentUser.displayName });
    }
    window.checkBwOpAchievements(guessCount, streak, totalWins).catch(() => {});
};

window.checkBwOpAchievements = async function(guessCount, streak, totalWins) {
    if (!auth.currentUser) return;
    const ids = [];
    if (totalWins === 1) ids.push('bwop_first');
    if (guessCount === 1) ids.push('bwop_1guess');
    if (streak >= 7) ids.push('bwop_streak_7');
    if (streak >= 100) ids.push('bwop_streak_100');
    if (totalWins >= 30) ids.push('bwop_total_30');
    const today = bwGetDate();
    const uid = auth.currentUser.uid;
    try {
        const nrtSnap = await getDoc(doc(db, 'bw_nrt_games', `${uid}_${today}`));
        if (nrtSnap.exists() && nrtSnap.data().solved) ids.push('bw_double_agent');
        const nrtLb = await getDoc(doc(db, 'bw_nrt_leaderboard', uid));
        if (nrtLb.exists() && (nrtLb.data().totalWins || 0) >= 1) ids.push('bw_multiverse');
    } catch(e) {}
    if (ids.length) window.awardAchievements(ids).catch(() => {});
};

window.bwOpShare = function() {
    const { answer, guesses, solved } = window.bwOpState;
    const today = new Date().toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'});
    const map = { green:'🟩', yellow:'🟨', red:'🟥' };
    const rows = guesses.map(g => {
        const c = bwOpCalcColors(g, answer);
        return [c.gender,c.affiliation,c.devilFruit,c.haki,c.bounty,c.height,c.firstArc].map(x=>map[x]||'⬛').join('');
    }).join('\n');
    const text = `BuzzWord: One Piece Characters — ${today}\n${solved?`Solved in ${guesses.length} ${guesses.length===1?'guess':'guesses'}!`:'Not solved'}\n\n${rows}\n\nhttps://weebee.buzz/#community`;
    navigator.clipboard.writeText(text).then(()=>alert('Copied to clipboard!')).catch(()=>alert('Could not copy'));
};

window.bwOpPostToFeed = async function(btn) {
    if (!auth.currentUser) return window.openAuthModal();
    const { answer, guesses, solved } = window.bwOpState;
    if (!solved) return;
    const today = bwGetDate();
    // Check if already posted today (check both new and old collections)
    const [existingNew, existingOld] = await Promise.all([
        getDocs(query(collection(db, 'bw_posts'), where('uid', '==', auth.currentUser.uid), where('date', '==', today), where('game', '==', 'op'))),
        getDocs(query(collection(db, 'bw_op_posts'), where('uid', '==', auth.currentUser.uid), where('date', '==', today))),
    ]);
    if (!existingNew.empty || !existingOld.empty) { btn.innerText = 'Already posted!'; btn.disabled = true; return; }
    const map = { green:'🟩', yellow:'🟨', red:'🟥' };
    const emojiGrid = guesses.map(g => {
        const c = bwOpCalcColors(g, answer);
        return [c.gender,c.affiliation,c.devilFruit,c.haki,c.bounty,c.height,c.firstArc].map(x=>map[x]||'⬛').join('');
    }).join('\n');
    try {
        btn.disabled = true; btn.innerText = 'Posting...';
        const av = auth.currentUser.photoURL || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(auth.currentUser.displayName)}&backgroundColor=ffc107&fontColor=333333`;
        await addDoc(collection(db, 'bw_posts'), {
            uid: auth.currentUser.uid,
            displayName: auth.currentUser.displayName,
            avatar: av,
            game: 'op',
            guessCount: guesses.length,
            emojiGrid,
            date: today,
            timestamp: new Date(),
            likes: [],
            dislikes: [],
            commentCount: 0
        });
        btn.innerText = '✓ Posted!';
        window.awardAchievements(['feed_showtime']).catch(() => {});
        window.fetchHomeBwFeed();
        window.fetchBwCommunityFeed();
    } catch(e) { btn.disabled = false; btn.innerText = 'Post to Feed'; alert('Failed to post.'); }
};

// Jikan character IDs: Luffy=40, Naruto Uzumaki=17, Ichigo=5
window.loadBwBannerImages = async function() {
    const banners = [
        { charId: 40,  elId: 'bwop-banner-img'  },
        { charId: 17,  elId: 'bwnrt-banner-img' },
        { charId: 5,   elId: 'bwblc-banner-img' },
        { charId: 246, elId: 'bwdb-banner-img'  },
    ];
    for (const { charId, elId } of banners) {
        const el = document.getElementById(elId);
        if (!el || el.getAttribute('src')) continue;
        try {
            const data = await window.jikanFetch(`https://api.jikan.moe/v4/characters/${charId}`, `bw_banner_char_${charId}`, 30 * 24 * 60 * 60 * 1000);
            const url = data?.data?.images?.jpg?.image_url;
            if (url) { el.src = url; el.style.display = 'block'; }
        } catch(e) {}
        await new Promise(r => setTimeout(r, 400));
    }
};

window.fetchBwCommunityFeed = async function() {
    const feed = document.getElementById('bw-community-feed');
    if (!feed) return;
    const today = bwGetDate();
    feed.innerHTML = '<div class="loading">Loading results...</div>';
    try {
        const [resAll, resOp, resOld] = await Promise.allSettled([
            getDocs(query(collection(db, 'bw_posts'), where('date', '==', today))),
            getDocs(query(collection(db, 'bw_op_posts'), where('date', '==', today))),
            getDocs(query(collection(db, 'wordle_posts'), where('date', '==', today)))
        ]);
        const snapAll = resAll.status === 'fulfilled' ? resAll.value : null;
        const snapOp  = resOp.status  === 'fulfilled' ? resOp.value  : null;
        const snapOld = resOld.status === 'fulfilled' ? resOld.value : null;
        if (!snapAll && !snapOp && !snapOld) throw new Error('All feed queries failed — check Firestore rules for bw_posts, bw_op_posts, wordle_posts');
        const seen = new Set();
        const posts = [
            ...(snapAll?.docs || []).map(d => ({...d.data(), id: d.id, game: d.data().game || 'op', _col: 'bw_posts'})),
            ...(snapOp?.docs  || []).map(d => ({...d.data(), id: d.id, game: 'op', _col: 'bw_op_posts'})),
            ...(snapOld?.docs || []).map(d => ({...d.data(), id: d.id, game: 'op', _col: 'wordle_posts'}))
        ].filter(p => {
            const key = `${p.uid}_${p.game || 'op'}`;
            if (seen.has(key)) return false; seen.add(key); return true;
        }).sort((a, b) => (a.guessCount || 99) - (b.guessCount || 99));
        if (!posts.length) {
            feed.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:24px; background:var(--bg-gray); border-radius:12px; font-size:14px;">No results yet today — be the first to play and post! 🎮</div>`;
            return;
        }
        feed.innerHTML = posts.map(p => window.generateBwPostCardHTML(p)).join('');
    } catch(e) {
        console.error('fetchBwCommunityFeed error:', e);
        feed.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:20px;">Could not load results: ${e?.message || e}</div>`;
    }
};

window.fetchHomeBwFeed = function() {
    if (window.currentActiveViewId === 'home-view') window.fetchHomeActivityFeed();
};

window.openBwOpLeaderboard = function() {
    window.closeAllModals();
    document.getElementById('bwop-leaderboard-modal').style.display = 'flex';
    window.showBwOpLeaderboardTab('today');
};

window.showBwOpLeaderboardTab = async function(tab) {
    const todayBtn = document.getElementById('bwop-tab-today');
    const alltimeBtn = document.getElementById('bwop-tab-alltime');
    const content = document.getElementById('bwop-leaderboard-content');
    if (!content) return;
    todayBtn.style.background = tab==='today' ? 'var(--accent-yellow)' : 'var(--bg-gray-darker)';
    todayBtn.style.color = tab==='today' ? '#111' : 'var(--text-dark)';
    alltimeBtn.style.background = tab==='alltime' ? 'var(--accent-yellow)' : 'var(--bg-gray-darker)';
    alltimeBtn.style.color = tab==='alltime' ? '#111' : 'var(--text-dark)';
    content.innerHTML = '<div class="loading">Loading...</div>';
    const today = bwGetDate();
    try {
        if (tab === 'today') {
            const snap = await getDocs(query(collection(db,'bw_op_games'), where('date','==',today), where('solved','==',true)));
            const sorted = snap.docs.sort((a,b)=>(a.data().guessCount||99)-(b.data().guessCount||99)).slice(0,10);
            if (!sorted.length) { content.innerHTML='<p style="text-align:center;color:var(--text-muted);padding:30px;">No winners yet today — be the first!</p>'; return; }
            content.innerHTML = sorted.map((d,i)=>{
                const data=d.data();
                const medal=['🥇','🥈','🥉'][i]||`${i+1}.`;
                return `<div style="display:flex;align-items:center;gap:12px;padding:10px;border-radius:8px;background:var(--bg-gray);margin-bottom:8px;">
                    <span style="font-size:20px;width:28px;">${medal}</span>
                    <div style="flex:1;"><div style="font-weight:700;font-size:14px;">${data.displayName||'Player'}</div>
                    <div style="font-size:12px;color:var(--text-muted);">${data.guessCount} ${data.guessCount===1?'guess':'guesses'}</div></div></div>`;
            }).join('');
        } else {
            const snap = await getDocs(collection(db,'bw_op_leaderboard'));
            const sorted = snap.docs.sort((a,b)=>(b.data().totalWins||0)-(a.data().totalWins||0)).slice(0,10);
            if (!sorted.length) { content.innerHTML='<p style="text-align:center;color:var(--text-muted);padding:30px;">No scores yet!</p>'; return; }
            content.innerHTML = sorted.map((d,i)=>{
                const data=d.data();
                const avg = data.totalWins>0?(data.totalGuesses/data.totalWins).toFixed(1):'-';
                const medal=['🥇','🥈','🥉'][i]||`${i+1}.`;
                return `<div style="display:flex;align-items:center;gap:12px;padding:10px;border-radius:8px;background:var(--bg-gray);margin-bottom:8px;">
                    <span style="font-size:20px;width:28px;">${medal}</span>
                    <div style="flex:1;"><div style="font-weight:700;font-size:14px;">${data.displayName||'Player'}</div>
                    <div style="font-size:12px;color:var(--text-muted);">${data.totalWins} wins · Avg ${avg} guesses · Best streak: ${data.bestStreak||1}</div></div></div>`;
            }).join('');
        }
    } catch(e) { content.innerHTML='<p style="text-align:center;color:var(--text-muted);padding:20px;">Could not load leaderboard.</p>'; console.error(e); }
};

window.openBwNrtLeaderboard = function() {
    window.closeAllModals();
    document.getElementById('bwnrt-leaderboard-modal').style.display = 'flex';
    window.showBwNrtLeaderboardTab('today');
};

window.showBwNrtLeaderboardTab = async function(tab) {
    const todayBtn = document.getElementById('bwnrt-tab-today');
    const alltimeBtn = document.getElementById('bwnrt-tab-alltime');
    const content = document.getElementById('bwnrt-leaderboard-content');
    if (!content) return;
    todayBtn.style.background = tab==='today' ? 'var(--accent-yellow)' : 'var(--bg-gray-darker)';
    todayBtn.style.color = tab==='today' ? '#111' : 'var(--text-dark)';
    alltimeBtn.style.background = tab==='alltime' ? 'var(--accent-yellow)' : 'var(--bg-gray-darker)';
    alltimeBtn.style.color = tab==='alltime' ? '#111' : 'var(--text-dark)';
    content.innerHTML = '<div class="loading">Loading...</div>';
    const today = bwGetDate();
    try {
        if (tab === 'today') {
            const snap = await getDocs(query(collection(db,'bw_nrt_games'), where('date','==',today), where('solved','==',true)));
            const sorted = snap.docs.sort((a,b)=>(a.data().guessCount||99)-(b.data().guessCount||99)).slice(0,10);
            if (!sorted.length) { content.innerHTML='<p style="text-align:center;color:var(--text-muted);padding:30px;">No winners yet today — be the first!</p>'; return; }
            content.innerHTML = sorted.map((d,i)=>{
                const data=d.data();
                const medal=['🥇','🥈','🥉'][i]||`${i+1}.`;
                return `<div style="display:flex;align-items:center;gap:12px;padding:10px;border-radius:8px;background:var(--bg-gray);margin-bottom:8px;">
                    <span style="font-size:20px;width:28px;">${medal}</span>
                    <div style="flex:1;"><div style="font-weight:700;font-size:14px;">${data.displayName||'Player'}</div>
                    <div style="font-size:12px;color:var(--text-muted);">${data.guessCount} ${data.guessCount===1?'guess':'guesses'}</div></div></div>`;
            }).join('');
        } else {
            const snap = await getDocs(collection(db,'bw_nrt_leaderboard'));
            const sorted = snap.docs.sort((a,b)=>(b.data().totalWins||0)-(a.data().totalWins||0)).slice(0,10);
            if (!sorted.length) { content.innerHTML='<p style="text-align:center;color:var(--text-muted);padding:30px;">No scores yet!</p>'; return; }
            content.innerHTML = sorted.map((d,i)=>{
                const data=d.data();
                const avg = data.totalWins>0?(data.totalGuesses/data.totalWins).toFixed(1):'-';
                const medal=['🥇','🥈','🥉'][i]||`${i+1}.`;
                return `<div style="display:flex;align-items:center;gap:12px;padding:10px;border-radius:8px;background:var(--bg-gray);margin-bottom:8px;">
                    <span style="font-size:20px;width:28px;">${medal}</span>
                    <div style="flex:1;"><div style="font-weight:700;font-size:14px;">${data.displayName||'Player'}</div>
                    <div style="font-size:12px;color:var(--text-muted);">${data.totalWins} wins · Avg ${avg} guesses · Best streak: ${data.bestStreak||1}</div></div></div>`;
            }).join('');
        }
    } catch(e) { content.innerHTML='<p style="text-align:center;color:var(--text-muted);padding:20px;">Could not load leaderboard.</p>'; }
};

// =====================================================================
// BUZZWORD: BLEACH CHARACTERS
// =====================================================================

const BLC_ARC_ORDER = [
    'Agent of the Shinigami',
    'Soul Society',
    'Arrancar',
    'Hueco Mundo',
    'Fake Karakura Town',
    'Lost Agent',
    'Thousand-Year Blood War'
];

const BW_BLC_CHARS = [
    // Main Cast
    {id:'ichigo',    name:'Ichigo Kurosaki',         gender:'Male',   race:'Human',     affiliation:'Neutral',      rank:'None',        zanpakutoType:'Melee',    hasBankai:true,  debutArc:'Agent of the Shinigami'},
    {id:'rukia',     name:'Rukia Kuchiki',            gender:'Female', race:'Shinigami', affiliation:'Soul Society', rank:'Captain',     zanpakutoType:'Elemental',hasBankai:true,  debutArc:'Agent of the Shinigami'},
    {id:'orihime',   name:'Orihime Inoue',            gender:'Female', race:'Human',     affiliation:'Neutral',      rank:'None',        zanpakutoType:'N/A',      hasBankai:false, debutArc:'Agent of the Shinigami'},
    {id:'chad',      name:'Yasutora Sado',            gender:'Male',   race:'Human',     affiliation:'Neutral',      rank:'None',        zanpakutoType:'N/A',      hasBankai:false, debutArc:'Agent of the Shinigami'},
    {id:'ishida',    name:'Uryū Ishida',              gender:'Male',   race:'Quincy',    affiliation:'Neutral',      rank:'Sternritter', zanpakutoType:'N/A',      hasBankai:false, debutArc:'Agent of the Shinigami'},
    // Gotei 13
    {id:'renji',     name:'Renji Abarai',             gender:'Male',   race:'Shinigami', affiliation:'Soul Society', rank:'Lieutenant',  zanpakutoType:'Melee',    hasBankai:true,  debutArc:'Soul Society'},
    {id:'byakuya',   name:'Byakuya Kuchiki',          gender:'Male',   race:'Shinigami', affiliation:'Soul Society', rank:'Captain',     zanpakutoType:'Other',    hasBankai:true,  debutArc:'Agent of the Shinigami'},
    {id:'hitsugaya', name:'Tōshirō Hitsugaya',        gender:'Male',   race:'Shinigami', affiliation:'Soul Society', rank:'Captain',     zanpakutoType:'Elemental',hasBankai:true,  debutArc:'Soul Society'},
    {id:'rangiku',   name:'Rangiku Matsumoto',         gender:'Female', race:'Shinigami', affiliation:'Soul Society', rank:'Lieutenant',  zanpakutoType:'Elemental',hasBankai:false, debutArc:'Soul Society'},
    {id:'kenpachi',  name:'Kenpachi Zaraki',           gender:'Male',   race:'Shinigami', affiliation:'Soul Society', rank:'Captain',     zanpakutoType:'Melee',    hasBankai:true,  debutArc:'Soul Society'},
    {id:'yachiru',   name:'Yachiru Kusajishi',         gender:'Female', race:'Other',     affiliation:'Soul Society', rank:'Lieutenant',  zanpakutoType:'Other',    hasBankai:false, debutArc:'Soul Society'},
    {id:'mayuri',    name:'Mayuri Kurotsuchi',         gender:'Male',   race:'Shinigami', affiliation:'Soul Society', rank:'Captain',     zanpakutoType:'Other',    hasBankai:true,  debutArc:'Soul Society'},
    {id:'nemu',      name:'Nemu Kurotsuchi',           gender:'Female', race:'Shinigami', affiliation:'Soul Society', rank:'Lieutenant',  zanpakutoType:'N/A',      hasBankai:false, debutArc:'Soul Society'},
    {id:'unohana',   name:'Retsu Unohana',             gender:'Female', race:'Shinigami', affiliation:'Soul Society', rank:'Captain',     zanpakutoType:'Healing',  hasBankai:true,  debutArc:'Soul Society'},
    {id:'shunsui',   name:'Shunsui Kyōraku',          gender:'Male',   race:'Shinigami', affiliation:'Soul Society', rank:'Captain',     zanpakutoType:'Illusion', hasBankai:true,  debutArc:'Soul Society'},
    {id:'ukitake',   name:'Jūshirō Ukitake',          gender:'Male',   race:'Shinigami', affiliation:'Soul Society', rank:'Captain',     zanpakutoType:'Other',    hasBankai:false, debutArc:'Soul Society'},
    {id:'komamura',  name:'Sajin Komamura',            gender:'Male',   race:'Other',     affiliation:'Soul Society', rank:'Captain',     zanpakutoType:'Melee',    hasBankai:true,  debutArc:'Soul Society'},
    {id:'hinamori',  name:'Momo Hinamori',             gender:'Female', race:'Shinigami', affiliation:'Soul Society', rank:'Lieutenant',  zanpakutoType:'Elemental',hasBankai:false, debutArc:'Soul Society'},
    {id:'kira',      name:'Izuru Kira',                gender:'Male',   race:'Shinigami', affiliation:'Soul Society', rank:'Lieutenant',  zanpakutoType:'Other',    hasBankai:false, debutArc:'Soul Society'},
    {id:'hisagi',    name:'Shūhei Hisagi',             gender:'Male',   race:'Shinigami', affiliation:'Soul Society', rank:'Lieutenant',  zanpakutoType:'Melee',    hasBankai:true,  debutArc:'Soul Society'},
    {id:'nanao',     name:'Nanao Ise',                 gender:'Female', race:'Shinigami', affiliation:'Soul Society', rank:'Lieutenant',  zanpakutoType:'Other',    hasBankai:false, debutArc:'Soul Society'},
    {id:'isane',     name:'Isane Kotetsu',             gender:'Female', race:'Shinigami', affiliation:'Soul Society', rank:'Captain',     zanpakutoType:'Melee',    hasBankai:false, debutArc:'Soul Society'},
    // Traitors
    {id:'aizen',     name:'Sōsuke Aizen',              gender:'Male',   race:'Shinigami', affiliation:'Hueco Mundo',  rank:'Captain',     zanpakutoType:'Illusion', hasBankai:false, debutArc:'Soul Society'},
    {id:'gin',       name:'Gin Ichimaru',              gender:'Male',   race:'Shinigami', affiliation:'Hueco Mundo',  rank:'Captain',     zanpakutoType:'Melee',    hasBankai:true,  debutArc:'Soul Society'},
    {id:'tosen',     name:'Kaname Tōsen',              gender:'Male',   race:'Shinigami', affiliation:'Hueco Mundo',  rank:'Captain',     zanpakutoType:'Illusion', hasBankai:true,  debutArc:'Soul Society'},
    // Neutral / Exiled
    {id:'urahara',   name:'Kisuke Urahara',            gender:'Male',   race:'Shinigami', affiliation:'Neutral',      rank:'Captain',     zanpakutoType:'Other',    hasBankai:true,  debutArc:'Agent of the Shinigami'},
    {id:'yoruichi',  name:'Yoruichi Shihōin',          gender:'Female', race:'Shinigami', affiliation:'Neutral',      rank:'Captain',     zanpakutoType:'N/A',      hasBankai:false, debutArc:'Agent of the Shinigami'},
    {id:'isshin',    name:'Isshin Kurosaki',           gender:'Male',   race:'Shinigami', affiliation:'Neutral',      rank:'Captain',     zanpakutoType:'Elemental',hasBankai:false, debutArc:'Agent of the Shinigami'},
    // Vizards
    {id:'shinji',    name:'Shinji Hirako',             gender:'Male',   race:'Vizard',    affiliation:'Soul Society', rank:'Captain',     zanpakutoType:'Illusion', hasBankai:true,  debutArc:'Arrancar'},
    {id:'hiyori',    name:'Hiyori Sarugaki',           gender:'Female', race:'Vizard',    affiliation:'Neutral',      rank:'Lieutenant',  zanpakutoType:'Melee',    hasBankai:false, debutArc:'Arrancar'},
    {id:'kensei',    name:'Kensei Muguruma',           gender:'Male',   race:'Vizard',    affiliation:'Soul Society', rank:'Captain',     zanpakutoType:'Elemental',hasBankai:true,  debutArc:'Arrancar'},
    {id:'rose',      name:'Rōjūrō Ōtoribashi',        gender:'Male',   race:'Vizard',    affiliation:'Soul Society', rank:'Captain',     zanpakutoType:'Illusion', hasBankai:true,  debutArc:'Arrancar'},
    // Espada
    {id:'grimmjow',  name:'Grimmjow Jaegerjaquez',     gender:'Male',   race:'Arrancar',  affiliation:'Hueco Mundo',  rank:'Espada',      zanpakutoType:'Melee',    hasBankai:false, debutArc:'Arrancar'},
    {id:'ulquiorra', name:'Ulquiorra Cifer',           gender:'Male',   race:'Arrancar',  affiliation:'Hueco Mundo',  rank:'Espada',      zanpakutoType:'Other',    hasBankai:false, debutArc:'Arrancar'},
    {id:'nnoitra',   name:'Nnoitra Gilga',             gender:'Male',   race:'Arrancar',  affiliation:'Hueco Mundo',  rank:'Espada',      zanpakutoType:'Melee',    hasBankai:false, debutArc:'Hueco Mundo'},
    {id:'starrk',    name:'Coyote Starrk',             gender:'Male',   race:'Arrancar',  affiliation:'Hueco Mundo',  rank:'Espada',      zanpakutoType:'Other',    hasBankai:false, debutArc:'Fake Karakura Town'},
    {id:'baraggan',  name:'Baraggan Louisenbairn',     gender:'Male',   race:'Arrancar',  affiliation:'Hueco Mundo',  rank:'Espada',      zanpakutoType:'Other',    hasBankai:false, debutArc:'Fake Karakura Town'},
    {id:'harribel',  name:'Tier Harribel',             gender:'Female', race:'Arrancar',  affiliation:'Hueco Mundo',  rank:'Espada',      zanpakutoType:'Elemental',hasBankai:false, debutArc:'Fake Karakura Town'},
    {id:'szayel',    name:'Szayelaporro Granz',        gender:'Male',   race:'Arrancar',  affiliation:'Hueco Mundo',  rank:'Espada',      zanpakutoType:'Other',    hasBankai:false, debutArc:'Hueco Mundo'},
    {id:'nelliel',   name:'Nelliel Tu Odelschwanck',  gender:'Female', race:'Arrancar',  affiliation:'Hueco Mundo',  rank:'Espada',      zanpakutoType:'Other',    hasBankai:false, debutArc:'Hueco Mundo'},
    {id:'yammy',     name:'Yammy Llargo',              gender:'Male',   race:'Arrancar',  affiliation:'Hueco Mundo',  rank:'Espada',      zanpakutoType:'Melee',    hasBankai:false, debutArc:'Arrancar'},
    // Wandenreich
    {id:'yhwach',    name:'Yhwach',                    gender:'Male',   race:'Quincy',    affiliation:'Wandenreich',  rank:'Other',       zanpakutoType:'N/A',      hasBankai:false, debutArc:'Thousand-Year Blood War'},
    {id:'haschwalth',name:'Jugram Haschwalth',         gender:'Male',   race:'Quincy',    affiliation:'Wandenreich',  rank:'Sternritter', zanpakutoType:'N/A',      hasBankai:false, debutArc:'Thousand-Year Blood War'},
    {id:'bambietta', name:'Bambietta Basterbine',      gender:'Female', race:'Quincy',    affiliation:'Wandenreich',  rank:'Sternritter', zanpakutoType:'N/A',      hasBankai:false, debutArc:'Thousand-Year Blood War'},
    {id:'asnodt',    name:'As Nodt',                   gender:'Male',   race:'Quincy',    affiliation:'Wandenreich',  rank:'Sternritter', zanpakutoType:'N/A',      hasBankai:false, debutArc:'Thousand-Year Blood War'},
    {id:'giselle',   name:'Giselle Gewelle',           gender:'Female', race:'Quincy',    affiliation:'Wandenreich',  rank:'Sternritter', zanpakutoType:'N/A',      hasBankai:false, debutArc:'Thousand-Year Blood War'},
    {id:'liltotto',  name:'Liltotto Lamperd',          gender:'Female', race:'Quincy',    affiliation:'Wandenreich',  rank:'Sternritter', zanpakutoType:'N/A',      hasBankai:false, debutArc:'Thousand-Year Blood War'},
    {id:'mask',      name:'Mask De Masculine',         gender:'Male',   race:'Quincy',    affiliation:'Wandenreich',  rank:'Sternritter', zanpakutoType:'N/A',      hasBankai:false, debutArc:'Thousand-Year Blood War'},
    {id:'pernida',   name:'Pernida Parnkgjas',         gender:'Other',  race:'Other',     affiliation:'Wandenreich',  rank:'Sternritter', zanpakutoType:'N/A',      hasBankai:false, debutArc:'Thousand-Year Blood War'},
    {id:'gerard',    name:'Gerard Valkyrie',           gender:'Male',   race:'Other',     affiliation:'Wandenreich',  rank:'Sternritter', zanpakutoType:'N/A',      hasBankai:false, debutArc:'Thousand-Year Blood War'},
];

// --- BuzzWord: Bleach — Image System ---
window.bwBlcImageMap = {};
window.bwBlcImgReady = false;

window.bwBlcLoadImages = async function() {
    const cacheKey = 'wb_blc_imgs_v2';
    const cached = localStorage.getItem(cacheKey);
    if (cached) { try { window.bwBlcImageMap = JSON.parse(cached); window.bwBlcImgReady = true; return; } catch(e) {} }
    const addToMap = (data, map) => {
        (data || []).forEach(entry => {
            const char = entry.character;
            if (!char?.images?.jpg?.image_url) return;
            const img = char.images.jpg.image_url;
            const raw = char.name;
            map[raw.toLowerCase()] = img;
            if (raw.includes(',')) {
                const [last, ...rest] = raw.split(',');
                const natural = `${rest.join(',').trim()} ${last.trim()}`;
                map[natural.toLowerCase()] = img;
                const firstWord = rest.join(' ').trim().split(' ')[0].toLowerCase();
                if (firstWord && !map[firstWord]) map[firstWord] = img;
            } else {
                const parts = raw.split(' ');
                const lastName = parts[parts.length - 1].toLowerCase();
                if (!map[lastName]) map[lastName] = img;
            }
        });
    };
    try {
        const map = {};
        // Original + all TYBW seasons
        const animeIds = [269, 41467, 50441, 52893];
        for (const id of animeIds) {
            const res = await fetch(`https://api.jikan.moe/v4/anime/${id}/characters`);
            if (res.ok) { const d = await res.json(); addToMap(d.data, map); }
            await new Promise(r => setTimeout(r, 450));
        }
        window.bwBlcImageMap = map;
        window.bwBlcImgReady = true;
        try { localStorage.setItem(cacheKey, JSON.stringify(map)); } catch(e) {}
    } catch(e) {}
};

const BLC_NAME_ALIASES = {
    'ichigo': 'kurosaki ichigo', 'rukia': 'kuchiki rukia', 'renji': 'abarai renji',
    'byakuya': 'kuchiki byakuya', 'hitsugaya': 'hitsugaya toushirou', 'kenpachi': 'zaraki kenpachi',
    'mayuri': 'kurotsuchi mayuri', 'aizen': 'aizen sousuke', 'gin': 'ichimaru gin',
    'urahara': 'urahara kisuke', 'yoruichi': 'shihouin yoruichi', 'grimmjow': 'jaegerjaquez grimmjow',
    'ulquiorra': 'cifer ulquiorra', 'yhwach': 'juha bach', 'orihime': 'inoue orihime',
    // Special char romanization aliases
    'tōshirō hitsugaya': 'hitsugaya toushirou', 'sōsuke aizen': 'aizen sousuke',
    'kaname tōsen': 'tousen kaname', 'shunsui kyōraku': 'kyouraku shunsui',
    'jūshirō ukitake': 'ukitake juushirou', 'shūhei hisagi': 'hisagi shuuhei',
    'nanao ise': 'ise nanao', 'yoruichi shihōin': 'shihouin yoruichi',
    'rōjūrō ōtoribashi': 'otoribashi roujuurou', 'nelliel tu odelschwanck': 'nelliel tu odelschwanck',
    'bambietta': 'bambietta basterbine', 'liltotto': 'liltotto lamperd',
    'giselle': 'giselle gewelle', 'haschwalth': 'jugram haschwalth',
    'as nodt': 'as nodt', 'starrk': 'coyote starrk', 'baraggan': 'baraggan louisenbairn',
};

window.bwBlcGetCharImage = function(name) {
    const m = window.bwBlcImageMap;
    const n = name.toLowerCase();
    if (m[n]) return m[n];
    const alias = BLC_NAME_ALIASES[n];
    if (alias && m[alias]) return m[alias];
    const parts = name.split(' ');
    const last = parts[parts.length - 1].toLowerCase();
    if (m[last]) return m[last];
    const first = parts[0].toLowerCase();
    if (m[first]) return m[first];
    return null;
};

window.bwBlcApplyImages = function() {
    document.querySelectorAll('[id^="blcimg-"]').forEach(img => {
        const charId = img.id.replace('blcimg-', '');
        const char = charId === 'answer' ? window.bwBlcState.answer : BW_BLC_CHARS.find(c => c.id === charId);
        if (!char) return;
        const url = window.bwBlcGetCharImage(char.name);
        if (url) {
            img.src = url; img.style.display = 'block';
            const fb = document.getElementById(`blcinitials-${charId}`);
            if (fb) fb.style.display = 'none';
        }
    });
};

window.bwBlcEnsureImages = async function() {
    if (!window.bwBlcImgReady) await window.bwBlcLoadImages();
    window.bwBlcApplyImages();
};

// --- BuzzWord: Bleach — Helpers ---
function bwBlcCalcColors(guess, answer) {
    const gender        = guess.gender        === answer.gender        ? 'green' : 'red';
    const race          = guess.race          === answer.race          ? 'green' : 'red';
    const affiliation   = guess.affiliation   === answer.affiliation   ? 'green' : 'red';
    const rank          = guess.rank          === answer.rank          ? 'green' : 'red';
    const zanpakutoType = guess.zanpakutoType === answer.zanpakutoType ? 'green' : 'red';
    const hasBankai     = guess.hasBankai     === answer.hasBankai     ? 'green' : 'red';
    const gIdx = BLC_ARC_ORDER.indexOf(guess.debutArc);
    const aIdx = BLC_ARC_ORDER.indexOf(answer.debutArc);
    const debutArc = gIdx === aIdx ? 'green' : (gIdx < aIdx ? 'yellow_up' : 'yellow_down');
    return { gender, race, affiliation, rank, zanpakutoType, hasBankai, debutArc };
}

function bwBlcCell(val, color) {
    const arrow = color === 'yellow_up' ? '↑ After' : color === 'yellow_down' ? '↓ Before' : '';
    const c = color.startsWith('yellow') ? 'yellow' : color;
    return `<div class="wordle-cell ${c}" style="white-space:pre-line; font-size:12px;">${val}${arrow ? '\n'+arrow : ''}</div>`;
}

function bwBlcBuildRow(char, colors) {
    const initials = char.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    return `<div class="wordle-row">
        <div class="wordle-char-cell">
            <img id="blcimg-${char.id}" src="" style="width:50px;height:50px;border-radius:50%;object-fit:cover;display:none;" onerror="this.style.display='none'; var d=document.getElementById('blcinitials-${char.id}'); if(d) d.style.display='flex';">
            <div id="blcinitials-${char.id}" style="width:50px;height:50px;border-radius:50%;background:var(--accent-yellow);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;color:#111;">${initials}</div>
            <div style="font-size:10px;font-weight:700;margin-top:4px;text-align:center;word-break:break-word;line-height:1.2;">${char.name}</div>
        </div>
        ${bwBlcCell(char.gender, colors.gender)}
        ${bwBlcCell(char.race, colors.race)}
        ${bwBlcCell(char.affiliation, colors.affiliation)}
        ${bwBlcCell(char.rank, colors.rank)}
        ${bwBlcCell(char.zanpakutoType, colors.zanpakutoType)}
        ${bwBlcCell(char.hasBankai ? 'Yes' : 'No', colors.hasBankai)}
        ${bwBlcCell(char.debutArc, colors.debutArc)}
    </div>`;
}

function bwBlcShowResult() {
    const { answer, guesses, solved } = window.bwBlcState;
    const resultEl = document.getElementById('bwblc-result');
    const inputArea = document.getElementById('bwblc-input-area');
    if (!resultEl) return;
    if (solved) {
        const initials = answer.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
        resultEl.style.display = 'block';
        resultEl.style.background = '#1b5e20';
        resultEl.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
            <img id="blcimg-answer" src="" style="width:100px;height:100px;border-radius:50%;object-fit:cover;border:3px solid #00BCD4;display:none;">
            <div id="blcinitials-answer" style="width:100px;height:100px;border-radius:50%;background:var(--accent-yellow);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:26px;color:#111;">${initials}</div>
            <div style="font-size:20px;font-weight:800;color:#00BCD4;">${answer.name}</div>
            <div style="font-size:15px;font-weight:700;color:white;">🎉 ${guesses.length === 1 ? 'First try!' : `Solved in ${guesses.length} ${guesses.length===1?'guess':'guesses'}!`}</div>
            <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap;justify-content:center;">
                <button onclick="window.bwBlcShare()" class="action-btn" style="background:rgba(255,255,255,0.15);color:white;font-size:13px;border:1px solid rgba(255,255,255,0.4);"><span class="material-symbols-outlined" style="font-size:15px;">share</span> Share Result</button>
                <button id="bwblc-post-btn" onclick="window.bwBlcPostToFeed(this)" class="action-btn" style="background:#00BCD4;color:#111;font-size:13px;"><span class="material-symbols-outlined" style="font-size:15px;">post_add</span> Post to Feed</button>
            </div>
        </div>`;
        if (inputArea) inputArea.style.display = 'none';
        window.bwBlcEnsureImages();
        const statusEl = document.getElementById('bwblc-status-text');
        if (statusEl) statusEl.innerText = `✓ Solved in ${guesses.length} ${guesses.length===1?'guess':'guesses'} today!`;
    } else {
        resultEl.style.display = 'none';
        if (inputArea) inputArea.style.display = 'block';
    }
}

function bwBlcRender() {
    const grid = document.getElementById('bwblc-grid');
    if (!grid) return;
    const { answer, guesses } = window.bwBlcState;
    grid.innerHTML = guesses.map(g => bwBlcBuildRow(g, bwBlcCalcColors(g, answer))).join('');
    window.bwBlcEnsureImages();
    bwBlcShowResult();
}

function bwBlcAnimateNewRow(char, colors) {
    const grid = document.getElementById('bwblc-grid');
    if (!grid) return;
    grid.insertAdjacentHTML('beforeend', bwBlcBuildRow(char, colors));
    window.bwBlcEnsureImages();
    const newRow = grid.lastElementChild;
    const cells = newRow.querySelectorAll('.wordle-cell');
    cells.forEach((cell, i) => {
        cell.style.transform = 'rotateX(-90deg)';
        cell.style.opacity = '0';
        setTimeout(() => {
            cell.style.transition = 'transform 0.75s ease, opacity 0.55s ease';
            cell.style.transform = '';
            cell.style.opacity = '';
        }, i * 500);
    });
}

function bwBlcGetToday() {
    const today = bwGetDate();
    const seed = today.split('-').reduce((a,b) => a + parseInt(b), 0) + 7;
    return BW_BLC_CHARS[seed % BW_BLC_CHARS.length];
}

window.bwBlcState = { answer: null, guesses: [], solved: false, selectedChar: null, date: null };

window.openBwBlcModal = function() {
    window.closeAllModals();
    document.getElementById('bwblc-modal').style.display = 'flex';
    window.initBwBlcGame();
};

window.initBwBlcGame = async function() {
    const today = bwGetDate();
    if (window.bwBlcState.answer && window.bwBlcState.date === today) {
        document.getElementById('bwblc-loading').style.display = 'none';
        document.getElementById('bwblc-content').style.display = 'block';
        bwBlcRender(); return;
    }
    window.bwBlcState = { answer: bwBlcGetToday(), guesses: [], solved: false, selectedChar: null, date: today };
    try {
        if (auth.currentUser) {
            try {
                const snap = await getDoc(doc(db, 'bw_blc_games', `${auth.currentUser.uid}_${today}`));
                if (snap.exists()) {
                    const d = snap.data();
                    window.bwBlcState.guesses = (d.guesses||[]).map(id => BW_BLC_CHARS.find(c => c.id === id)).filter(Boolean);
                    window.bwBlcState.solved = d.solved || false;
                }
            } catch(e) {
                console.warn('BLC Firestore read failed, using localStorage:', e.message);
                const saved = localStorage.getItem(`wb_bwblc_${today}`);
                if (saved) { const d = JSON.parse(saved); window.bwBlcState.guesses=(d.guesses||[]).map(id=>BW_BLC_CHARS.find(c=>c.id===id)).filter(Boolean); window.bwBlcState.solved=d.solved||false; }
            }
        } else {
            const saved = localStorage.getItem(`wb_bwblc_${today}`);
            if (saved) { const d = JSON.parse(saved); window.bwBlcState.guesses=(d.guesses||[]).map(id=>BW_BLC_CHARS.find(c=>c.id===id)).filter(Boolean); window.bwBlcState.solved=d.solved||false; }
        }
    } catch(e) {}
    document.getElementById('bwblc-loading').style.display = 'none';
    document.getElementById('bwblc-content').style.display = 'block';
    bwBlcRender();
    window.bwBlcLoadImages();
};

window.bwBlcEnterGuess = function() {
    if (window.bwBlcState.selectedChar) { window.submitBwBlcGuess(); return; }
    const first = document.getElementById('bwblc-suggestions')?.querySelector('.wordle-suggestion-item');
    if (first) first.click();
};

window.searchBwBlcChar = function() {
    window.bwBlcState.selectedChar = null;
    const q = document.getElementById('bwblc-search')?.value.trim().toLowerCase();
    const sugg = document.getElementById('bwblc-suggestions');
    if (!sugg) return;
    if (!q) { sugg.style.display = 'none'; return; }
    const guessedIds = new Set(window.bwBlcState.guesses.map(g => g.id));
    const matches = BW_BLC_CHARS.filter(c => !guessedIds.has(c.id) && c.name.toLowerCase().includes(q)).slice(0, 8);
    sugg.style.display = matches.length ? 'block' : 'none';
    sugg.innerHTML = matches.map(c => {
        const imgUrl = window.bwBlcGetCharImage ? window.bwBlcGetCharImage(c.name) : null;
        const pic = imgUrl ? `<img src="${imgUrl}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;">` : `<div style="width:32px;height:32px;border-radius:50%;background:var(--bg-gray-darker);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">${c.name[0]}</div>`;
        return `<div class="wordle-suggestion-item" style="display:flex;align-items:center;gap:10px;" onclick="window.selectBwBlcChar('${c.id}')">${pic}<span>${c.name}</span></div>`;
    }).join('');
};

window.selectBwBlcChar = function(id) {
    const char = BW_BLC_CHARS.find(c => c.id === id);
    if (!char) return;
    window.bwBlcState.selectedChar = char;
    const inp = document.getElementById('bwblc-search');
    if (inp) inp.value = char.name;
    const sugg = document.getElementById('bwblc-suggestions');
    if (sugg) sugg.style.display = 'none';
    window.submitBwBlcGuess();
};

window.submitBwBlcGuess = async function() {
    const char = window.bwBlcState.selectedChar;
    if (!char || window.bwBlcState.solved) return;
    if (window.bwBlcState.guesses.some(g => g.id === char.id)) return;
    const colors = bwBlcCalcColors(char, window.bwBlcState.answer);
    window.bwBlcState.guesses.push(char);
    window.bwBlcState.selectedChar = null;
    const inp = document.getElementById('bwblc-search');
    if (inp) inp.value = '';
    const isCorrect = char.id === window.bwBlcState.answer.id;
    if (isCorrect) window.bwBlcState.solved = true;
    bwBlcAnimateNewRow(char, colors);
    setTimeout(() => bwBlcShowResult(), 7 * 500 + 800);
    const today = bwGetDate();
    const saveData = { guesses: window.bwBlcState.guesses.map(g=>g.id), solved: window.bwBlcState.solved, date: today, guessCount: window.bwBlcState.guesses.length, displayName: auth.currentUser?.displayName||'Player' };
    localStorage.setItem(`wb_bwblc_${today}`, JSON.stringify(saveData));
    if (auth.currentUser) {
        setDoc(doc(db, 'bw_blc_games', `${auth.currentUser.uid}_${today}`), saveData).catch(e => console.warn('BLC save failed:', e.message));
        if (window.bwBlcState.solved) window.bwBlcUpdateLeaderboard(window.bwBlcState.guesses.length);
    }
};

window.bwBlcUpdateLeaderboard = async function(guessCount) {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const ref = doc(db, 'bw_blc_leaderboard', uid);
    const snap = await getDoc(ref);
    const today = bwGetDate();
    const yesterday = new Date(Date.now()-86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    let streak, totalWins;
    if (snap.exists()) {
        const d = snap.data();
        streak = d.lastWinDate === yesterday ? (d.currentStreak||0)+1 : 1;
        totalWins = (d.totalWins || 0) + 1;
        await updateDoc(ref, { totalWins: increment(1), totalGuesses: increment(guessCount), currentStreak: streak, bestStreak: Math.max(d.bestStreak||0,streak), lastWinDate: today, displayName: auth.currentUser.displayName });
    } else {
        streak = 1; totalWins = 1;
        await setDoc(ref, { totalWins:1, totalGuesses:guessCount, currentStreak:1, bestStreak:1, lastWinDate:today, displayName: auth.currentUser.displayName });
    }
    window.checkBwBlcAchievements(guessCount, streak, totalWins).catch(() => {});
};

window.checkBwBlcAchievements = async function(guessCount, streak, totalWins) {
    if (!auth.currentUser) return;
    const ids = [];
    if (totalWins === 1) ids.push('bwblc_first');
    if (guessCount === 1) ids.push('bwblc_1guess');
    if (streak >= 7) ids.push('bwblc_streak_7');
    if (totalWins >= 30) ids.push('bwblc_total_30');
    if (ids.length) window.awardAchievements(ids).catch(() => {});
};

window.bwBlcShare = function() {
    const { answer, guesses, solved } = window.bwBlcState;
    const today = new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    const map = {green:'🟩',yellow:'🟨',yellow_up:'🟨',yellow_down:'🟨',red:'🟥'};
    const rows = guesses.map(g => {
        const c = bwBlcCalcColors(g, answer);
        return [c.gender,c.race,c.affiliation,c.rank,c.zanpakutoType,c.hasBankai,c.debutArc].map(x=>map[x]||'⬛').join('');
    }).join('\n');
    const text = `BuzzWord: Bleach Characters — ${today}\n${solved?`Solved in ${guesses.length} ${guesses.length===1?'guess':'guesses'}!`:'Not solved'}\n\n${rows}\n\nhttps://weebee.buzz/#community`;
    navigator.clipboard.writeText(text).then(()=>alert('Copied to clipboard!')).catch(()=>alert('Could not copy'));
};

window.bwBlcPostToFeed = async function(btn) {
    if (!auth.currentUser) return window.openAuthModal();
    const { answer, guesses, solved } = window.bwBlcState;
    if (!solved) return;
    const today = bwGetDate();
    const existing = await getDocs(query(collection(db,'bw_posts'), where('uid','==',auth.currentUser.uid), where('date','==',today), where('game','==','bleach')));
    if (!existing.empty) { btn.innerText='Already posted!'; btn.disabled=true; return; }
    const map = {green:'🟩',yellow:'🟨',yellow_up:'🟨',yellow_down:'🟨',red:'🟥'};
    const emojiGrid = guesses.map(g => {
        const c = bwBlcCalcColors(g, answer);
        return [c.gender,c.race,c.affiliation,c.rank,c.zanpakutoType,c.hasBankai,c.debutArc].map(x=>map[x]||'⬛').join('');
    }).join('\n');
    try {
        btn.disabled=true; btn.innerText='Posting...';
        const av = auth.currentUser.photoURL || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(auth.currentUser.displayName)}&backgroundColor=ffc107&fontColor=333333`;
        await addDoc(collection(db,'bw_posts'),{
            uid:auth.currentUser.uid, displayName:auth.currentUser.displayName, avatar:av,
            game:'bleach', guessCount:guesses.length, emojiGrid, date:today, timestamp:new Date(), likes:[], dislikes:[], commentCount:0
        });
        btn.innerText='✓ Posted!';
        window.awardAchievements(['feed_showtime']).catch(() => {});
        window.fetchBwCommunityFeed();
        window.fetchHomeBwFeed();
    } catch(e) { btn.disabled=false; btn.innerText='Post to Feed'; alert('Failed to post.'); }
};

window.openBwBlcLeaderboard = function() {
    window.closeAllModals();
    document.getElementById('bwblc-leaderboard-modal').style.display = 'flex';
    window.showBwBlcLeaderboardTab('today');
};

window.showBwBlcLeaderboardTab = async function(tab) {
    const todayBtn = document.getElementById('bwblc-tab-today');
    const alltimeBtn = document.getElementById('bwblc-tab-alltime');
    const content = document.getElementById('bwblc-leaderboard-content');
    if (!content) return;
    todayBtn.style.background = tab==='today' ? 'var(--accent-yellow)' : 'var(--bg-gray-darker)';
    todayBtn.style.color = tab==='today' ? '#111' : 'var(--text-dark)';
    alltimeBtn.style.background = tab==='alltime' ? 'var(--accent-yellow)' : 'var(--bg-gray-darker)';
    alltimeBtn.style.color = tab==='alltime' ? '#111' : 'var(--text-dark)';
    content.innerHTML = '<div class="loading">Loading...</div>';
    const today = bwGetDate();
    try {
        if (tab === 'today') {
            const snap = await getDocs(query(collection(db,'bw_blc_games'), where('date','==',today), where('solved','==',true)));
            const sorted = snap.docs.sort((a,b)=>(a.data().guessCount||99)-(b.data().guessCount||99)).slice(0,10);
            if (!sorted.length) { content.innerHTML='<p style="text-align:center;color:var(--text-muted);padding:30px;">No winners yet today — be the first!</p>'; return; }
            content.innerHTML = sorted.map((d,i)=>{
                const data=d.data(); const medal=['🥇','🥈','🥉'][i]||`${i+1}.`;
                return `<div style="display:flex;align-items:center;gap:12px;padding:10px;border-radius:8px;background:var(--bg-gray);margin-bottom:8px;">
                    <span style="font-size:20px;width:28px;">${medal}</span>
                    <div style="flex:1;"><div style="font-weight:700;font-size:14px;">${data.displayName||'Player'}</div>
                    <div style="font-size:12px;color:var(--text-muted);">${data.guessCount} ${data.guessCount===1?'guess':'guesses'}</div></div></div>`;
            }).join('');
        } else {
            const snap = await getDocs(collection(db,'bw_blc_leaderboard'));
            const sorted = snap.docs.sort((a,b)=>(b.data().totalWins||0)-(a.data().totalWins||0)).slice(0,10);
            if (!sorted.length) { content.innerHTML='<p style="text-align:center;color:var(--text-muted);padding:30px;">No scores yet!</p>'; return; }
            content.innerHTML = sorted.map((d,i)=>{
                const data=d.data(); const avg=data.totalWins>0?(data.totalGuesses/data.totalWins).toFixed(1):'-';
                const medal=['🥇','🥈','🥉'][i]||`${i+1}.`;
                return `<div style="display:flex;align-items:center;gap:12px;padding:10px;border-radius:8px;background:var(--bg-gray);margin-bottom:8px;">
                    <span style="font-size:20px;width:28px;">${medal}</span>
                    <div style="flex:1;"><div style="font-weight:700;font-size:14px;">${data.displayName||'Player'}</div>
                    <div style="font-size:12px;color:var(--text-muted);">${data.totalWins} wins · Avg ${avg} guesses · Best streak: ${data.bestStreak||1}</div></div></div>`;
            }).join('');
        }
    } catch(e) { content.innerHTML='<p style="text-align:center;color:var(--text-muted);padding:20px;">Could not load leaderboard.</p>'; }
};

// =====================================================================
// BUZZWORD: DRAGON BALL CHARACTERS
// =====================================================================

const DB_ARC_ORDER = [
    'Emperor Pilaf','Red Ribbon Army','King Piccolo',
    'Saiyan','Namek','Android / Cell','Buu',
    'Battle of Gods','Resurrection F','Universe 6',
    'Future Trunks','Universe Survival','Galactic Patrol'
];

const BW_DB_CHARS = [
    // ── Main Cast ──
    {id:'goku',        name:'Goku',           gender:'Male',   race:'Saiyan',      origin:'Planet Vegeta', affiliation:['Z Fighters'],                           transformation:true,  debutSeries:'DB',  debutArc:'Emperor Pilaf'},
    {id:'vegeta',      name:'Vegeta',         gender:'Male',   race:'Saiyan',      origin:'Planet Vegeta', affiliation:['Frieza Force','Villain','Z Fighters'],   transformation:true,  debutSeries:'DBZ', debutArc:'Saiyan'},
    {id:'gohan',       name:'Gohan',          gender:'Male',   race:'Half-Saiyan', origin:'Earth',         affiliation:['Z Fighters'],                           transformation:true,  debutSeries:'DBZ', debutArc:'Saiyan'},
    {id:'piccolo',     name:'Piccolo',        gender:'Male',   race:'Namekian',    origin:'Earth',         affiliation:['Villain','Z Fighters'],                 transformation:true,  debutSeries:'DB',  debutArc:'King Piccolo'},
    {id:'bulma',       name:'Bulma',          gender:'Female', race:'Human',       origin:'Earth',         affiliation:['Z Fighters'],                           transformation:false, debutSeries:'DB',  debutArc:'Emperor Pilaf'},
    {id:'krillin',     name:'Krillin',        gender:'Male',   race:'Human',       origin:'Earth',         affiliation:['Z Fighters'],                           transformation:false, debutSeries:'DB',  debutArc:'Emperor Pilaf'},
    {id:'future-trunks',name:'Future Trunks', gender:'Male',   race:'Half-Saiyan', origin:'Earth',         affiliation:['Z Fighters'],                           transformation:true,  debutSeries:'DBZ', debutArc:'Android / Cell'},
    {id:'goten',       name:'Goten',          gender:'Male',   race:'Half-Saiyan', origin:'Earth',         affiliation:['Z Fighters'],                           transformation:true,  debutSeries:'DBZ', debutArc:'Buu'},
    {id:'android18',   name:'Android 18',     gender:'Female', race:'Android',     origin:'Earth',         affiliation:['Red Ribbon Army','Z Fighters'],         transformation:false, debutSeries:'DBZ', debutArc:'Android / Cell'},
    {id:'android17',   name:'Android 17',     gender:'Male',   race:'Android',     origin:'Earth',         affiliation:['Red Ribbon Army','Z Fighters'],         transformation:false, debutSeries:'DBZ', debutArc:'Android / Cell'},
    {id:'yamcha',      name:'Yamcha',         gender:'Male',   race:'Human',       origin:'Earth',         affiliation:['Z Fighters'],                           transformation:false, debutSeries:'DB',  debutArc:'Emperor Pilaf'},
    {id:'tien',        name:'Tien Shinhan',   gender:'Male',   race:'Human',       origin:'Earth',         affiliation:['Other','Z Fighters'],                   transformation:false, debutSeries:'DB',  debutArc:'King Piccolo'},
    {id:'chiaotzu',    name:'Chiaotzu',       gender:'Male',   race:'Human',       origin:'Earth',         affiliation:['Other','Z Fighters'],                   transformation:false, debutSeries:'DB',  debutArc:'King Piccolo'},
    {id:'roshi',       name:'Master Roshi',   gender:'Male',   race:'Human',       origin:'Earth',         affiliation:['Z Fighters'],                           transformation:true,  debutSeries:'DB',  debutArc:'Emperor Pilaf'},
    {id:'chichi',      name:'Chi-Chi',        gender:'Female', race:'Human',       origin:'Earth',         affiliation:['Z Fighters'],                           transformation:false, debutSeries:'DB',  debutArc:'Emperor Pilaf'},
    {id:'videl',       name:'Videl',          gender:'Female', race:'Human',       origin:'Earth',         affiliation:['Z Fighters'],                           transformation:false, debutSeries:'DBZ', debutArc:'Buu'},
    {id:'gotenks',     name:'Gotenks',        gender:'Male',   race:'Half-Saiyan', origin:'Earth',         affiliation:['Z Fighters'],                           transformation:true,  debutSeries:'DBZ', debutArc:'Buu'},
    {id:'kid-trunks',  name:'Kid Trunks',     gender:'Male',   race:'Half-Saiyan', origin:'Earth',         affiliation:['Z Fighters'],                           transformation:true,  debutSeries:'DBZ', debutArc:'Buu'},
    {id:'mr-satan',    name:'Mr. Satan',      gender:'Male',   race:'Human',       origin:'Earth',         affiliation:['Z Fighters'],                           transformation:false, debutSeries:'DBZ', debutArc:'Android / Cell'},
    // ── Villains ──
    {id:'frieza',      name:'Frieza',         gender:'Male',   race:'Frieza Race', origin:'Unknown',       affiliation:['Frieza Force','Villain'],               transformation:true,  debutSeries:'DBZ', debutArc:'Namek'},
    {id:'cell',        name:'Cell',           gender:'Male',   race:'Android',     origin:'Earth',         affiliation:['Red Ribbon Army','Villain'],            transformation:true,  debutSeries:'DBZ', debutArc:'Android / Cell'},
    {id:'majin-buu',   name:'Majin Buu',      gender:'Male',   race:'Majin',       origin:'Unknown',       affiliation:['Villain','Z Fighters'],                 transformation:true,  debutSeries:'DBZ', debutArc:'Buu'},
    {id:'raditz',      name:'Raditz',         gender:'Male',   race:'Saiyan',      origin:'Planet Vegeta', affiliation:['Frieza Force','Villain'],               transformation:false, debutSeries:'DBZ', debutArc:'Saiyan'},
    {id:'nappa',       name:'Nappa',          gender:'Male',   race:'Saiyan',      origin:'Planet Vegeta', affiliation:['Frieza Force','Villain'],               transformation:false, debutSeries:'DBZ', debutArc:'Saiyan'},
    {id:'zarbon',      name:'Zarbon',         gender:'Male',   race:'Other',       origin:'Unknown',       affiliation:['Frieza Force','Villain'],               transformation:true,  debutSeries:'DBZ', debutArc:'Namek'},
    {id:'dodoria',     name:'Dodoria',        gender:'Male',   race:'Other',       origin:'Unknown',       affiliation:['Frieza Force','Villain'],               transformation:false, debutSeries:'DBZ', debutArc:'Namek'},
    {id:'ginyu',       name:'Captain Ginyu',  gender:'Male',   race:'Other',       origin:'Unknown',       affiliation:['Frieza Force','Ginyu Force','Villain'], transformation:false, debutSeries:'DBZ', debutArc:'Namek'},
    {id:'jeice',       name:'Jeice',          gender:'Male',   race:'Other',       origin:'Unknown',       affiliation:['Frieza Force','Ginyu Force','Villain'], transformation:false, debutSeries:'DBZ', debutArc:'Namek'},
    {id:'burter',      name:'Burter',         gender:'Male',   race:'Other',       origin:'Unknown',       affiliation:['Frieza Force','Ginyu Force','Villain'], transformation:false, debutSeries:'DBZ', debutArc:'Namek'},
    {id:'recoome',     name:'Recoome',        gender:'Male',   race:'Other',       origin:'Unknown',       affiliation:['Frieza Force','Ginyu Force','Villain'], transformation:false, debutSeries:'DBZ', debutArc:'Namek'},
    {id:'guldo',       name:'Guldo',          gender:'Male',   race:'Other',       origin:'Unknown',       affiliation:['Frieza Force','Ginyu Force','Villain'], transformation:false, debutSeries:'DBZ', debutArc:'Namek'},
    {id:'android16',   name:'Android 16',     gender:'Male',   race:'Android',     origin:'Earth',         affiliation:['Red Ribbon Army','Z Fighters'],         transformation:false, debutSeries:'DBZ', debutArc:'Android / Cell'},
    {id:'android19',   name:'Android 19',     gender:'Male',   race:'Android',     origin:'Earth',         affiliation:['Red Ribbon Army','Villain'],            transformation:false, debutSeries:'DBZ', debutArc:'Android / Cell'},
    {id:'dr-gero',     name:'Dr. Gero',       gender:'Male',   race:'Human',       origin:'Earth',         affiliation:['Red Ribbon Army','Villain'],            transformation:false, debutSeries:'DBZ', debutArc:'Android / Cell'},
    {id:'king-piccolo',name:'King Piccolo',   gender:'Male',   race:'Namekian',    origin:'Namek',         affiliation:['Villain'],                              transformation:false, debutSeries:'DB',  debutArc:'King Piccolo'},
    {id:'babidi',      name:'Babidi',         gender:'Male',   race:'Other',       origin:'Unknown',       affiliation:['Villain'],                              transformation:false, debutSeries:'DBZ', debutArc:'Buu'},
    {id:'dabura',      name:'Dabura',         gender:'Male',   race:'Other',       origin:'Unknown',       affiliation:['Villain'],                              transformation:false, debutSeries:'DBZ', debutArc:'Buu'},
    {id:'goku-black',  name:'Goku Black',     gender:'Male',   race:'Kai',         origin:'Sacred World',  affiliation:['Villain'],                              transformation:true,  debutSeries:'DBS', debutArc:'Future Trunks'},
    // ── Divine / DBS ──
    {id:'beerus',      name:'Beerus',         gender:'Male',   race:'Other',       origin:'Unknown',       affiliation:['Gods of Destruction'],                  transformation:false, debutSeries:'DBS', debutArc:'Battle of Gods'},
    {id:'whis',        name:'Whis',           gender:'Male',   race:'Angel',       origin:'Unknown',       affiliation:['Angels','Gods of Destruction'],         transformation:false, debutSeries:'DBS', debutArc:'Battle of Gods'},
    {id:'champa',      name:'Champa',         gender:'Male',   race:'Other',       origin:'Unknown',       affiliation:['Gods of Destruction'],                  transformation:false, debutSeries:'DBS', debutArc:'Universe 6'},
    {id:'vados',       name:'Vados',          gender:'Female', race:'Angel',       origin:'Unknown',       affiliation:['Angels','Gods of Destruction'],         transformation:false, debutSeries:'DBS', debutArc:'Universe 6'},
    {id:'kami',        name:'Kami',           gender:'Male',   race:'Namekian',    origin:'Namek',         affiliation:['Other','Z Fighters'],                   transformation:false, debutSeries:'DB',  debutArc:'King Piccolo'},
    {id:'king-kai',    name:'King Kai',       gender:'Male',   race:'Kai',         origin:'Sacred World',  affiliation:['Other','Z Fighters'],                   transformation:false, debutSeries:'DBZ', debutArc:'Saiyan'},
    {id:'supreme-kai', name:'Supreme Kai',    gender:'Male',   race:'Kai',         origin:'Sacred World',  affiliation:['Other','Z Fighters'],                   transformation:false, debutSeries:'DBZ', debutArc:'Buu'},
    // ── Universe 6 / DBS ──
    {id:'hit',         name:'Hit',            gender:'Male',   race:'Other',       origin:'Unknown',       affiliation:['Other','Villain'],                      transformation:false, debutSeries:'DBS', debutArc:'Universe 6'},
    {id:'cabba',       name:'Cabba',          gender:'Male',   race:'Saiyan',      origin:'Planet Sadala', affiliation:['Other','Z Fighters'],                   transformation:true,  debutSeries:'DBS', debutArc:'Universe 6'},
    {id:'kale',        name:'Kale',           gender:'Female', race:'Saiyan',      origin:'Planet Sadala', affiliation:['Other','Z Fighters'],                   transformation:true,  debutSeries:'DBS', debutArc:'Universe Survival'},
    {id:'caulifla',    name:'Caulifla',       gender:'Female', race:'Saiyan',      origin:'Planet Sadala', affiliation:['Other','Z Fighters'],                   transformation:true,  debutSeries:'DBS', debutArc:'Universe Survival'},
    {id:'jiren',       name:'Jiren',          gender:'Male',   race:'Other',       origin:'Unknown',       affiliation:['Other','Villain'],                      transformation:true,  debutSeries:'DBS', debutArc:'Universe Survival'},
    {id:'toppo',       name:'Toppo',          gender:'Male',   race:'Other',       origin:'Unknown',       affiliation:['Other','Villain'],                      transformation:true,  debutSeries:'DBS', debutArc:'Universe Survival'},
];

// --- BuzzWord: Dragon Ball — Image System ---
window.bwDbImageMap = {};
window.bwDbImgReady = false;

window.bwDbLoadImages = async function() {
    const cacheKey = 'wb_db_imgs_v1';
    const cached = localStorage.getItem(cacheKey);
    if (cached) { try { window.bwDbImageMap = JSON.parse(cached); window.bwDbImgReady = true; return; } catch(e) {} }
    const addToMap = (data, map) => {
        (data || []).forEach(entry => {
            const char = entry.character;
            if (!char?.images?.jpg?.image_url) return;
            const img = char.images.jpg.image_url;
            const raw = char.name;
            map[raw.toLowerCase()] = img;
            if (raw.includes(',')) {
                const [last, ...rest] = raw.split(',');
                const natural = `${rest.join(',').trim()} ${last.trim()}`;
                map[natural.toLowerCase()] = img;
                const firstWord = rest.join(' ').trim().split(' ')[0].toLowerCase();
                if (firstWord && !map[firstWord]) map[firstWord] = img;
            } else {
                const parts = raw.split(' ');
                const lastName = parts[parts.length - 1].toLowerCase();
                if (!map[lastName]) map[lastName] = img;
            }
        });
    };
    try {
        const map = {};
        // Dragon Ball (430), Dragon Ball Z (813), Dragon Ball Super (39165)
        const res1 = await fetch('https://api.jikan.moe/v4/anime/430/characters');
        if (res1.ok) { const d = await res1.json(); addToMap(d.data, map); }
        await new Promise(r => setTimeout(r, 450));
        const res2 = await fetch('https://api.jikan.moe/v4/anime/813/characters');
        if (res2.ok) { const d = await res2.json(); addToMap(d.data, map); }
        await new Promise(r => setTimeout(r, 450));
        const res3 = await fetch('https://api.jikan.moe/v4/anime/30694/characters');
        if (res3.ok) { const d = await res3.json(); addToMap(d.data, map); }
        window.bwDbImageMap = map;
        window.bwDbImgReady = true;
        try { localStorage.setItem(cacheKey, JSON.stringify(map)); } catch(e) {}
    } catch(e) {}
};

const DB_NAME_ALIASES = {
    'goku': 'son goku', 'son goku': 'goku',
    'gohan': 'son gohan', 'son gohan': 'gohan',
    'goten': 'son goten', 'son goten': 'goten',
    'piccolo': 'piccolo jr.',
    'krillin': 'kuririn', 'kuririn': 'krillin',
    'roshi': 'muten roshi', 'muten roshi': 'roshi', 'master roshi': 'muten roshi',
    'tien': 'tenshinhan', 'tenshinhan': 'tien shinhan', 'tien shinhan': 'tenshinhan',
    'chiaotzu': 'chaozu', 'chaozu': 'chiaotzu',
    'yamcha': 'yamcha',
    'future trunks': 'trunks', 'kid trunks': 'trunks',
    'android 18': 'lazuli', 'lazuli': 'android 18',
    'android 17': 'lapis', 'lapis': 'android 17',
    'frieza': 'freeza', 'freeza': 'frieza',
    'cell': 'cell',
    'beerus': 'bills', 'bills': 'beerus',
    'mr. satan': 'hercule', 'hercule': 'mr. satan', 'satan': 'hercule',
    'king piccolo': 'piccolo daimao',
    'supreme kai': 'shin', 'shin': 'supreme kai',
    'king kai': 'kaiou', 'kaiou': 'king kai',
    'kami': 'kami',
    'goku black': 'zamasu', 'zamasu': 'goku black',
};

window.bwDbGetCharImage = function(name) {
    const m = window.bwDbImageMap;
    const n = name.toLowerCase();
    if (m[n]) return m[n];
    const alias = DB_NAME_ALIASES[n];
    if (alias && m[alias]) return m[alias];
    const parts = name.split(' ');
    const last = parts[parts.length - 1].toLowerCase();
    if (m[last]) return m[last];
    const first = parts[0].toLowerCase();
    if (m[first]) return m[first];
    return null;
};

window.bwDbApplyImages = function() {
    document.querySelectorAll('[id^="dbimg-"]').forEach(img => {
        const charId = img.id.replace('dbimg-', '');
        const char = charId === 'answer' ? window.bwDbState.answer : BW_DB_CHARS.find(c => c.id === charId);
        if (!char) return;
        const url = window.bwDbGetCharImage(char.name);
        if (url) {
            img.src = url; img.style.display = 'block';
            const fb = document.getElementById(`dbinitials-${charId}`);
            if (fb) fb.style.display = 'none';
        }
    });
};

window.bwDbEnsureImages = async function() {
    if (!window.bwDbImgReady) await window.bwDbLoadImages();
    window.bwDbApplyImages();
};

// --- BuzzWord: Dragon Ball — Helpers ---
function bwDbAffil(a) {
    if (!a || a.length === 0) return 'None';
    const icons = {'Z Fighters':'💪','Frieza Force':'👽','Ginyu Force':'🤜','Red Ribbon Army':'🤖','Galactic Patrol':'🚔','Gods of Destruction':'💥','Angels':'👼','Villain':'😈','Other':'•'};
    return a.map(x => `${icons[x]||'•'} ${x}`).join('\n');
}

function bwDbCalcColors(guess, answer) {
    const gender      = guess.gender      === answer.gender      ? 'green' : 'red';
    const race        = guess.race        === answer.race        ? 'green' : 'red';
    const origin      = guess.origin      === answer.origin      ? 'green' : 'red';
    const transformation = guess.transformation === answer.transformation ? 'green' : 'red';
    const debutSeries = guess.debutSeries === answer.debutSeries ? 'green' : 'red';
    const arrColor = (g, a) => {
        if (g.length === 0 && a.length === 0) return 'green';
        if (g.length === 0 || a.length === 0) return 'red';
        if (g.length === a.length && g.every(x => a.includes(x))) return 'green';
        if (g.some(x => a.includes(x))) return 'yellow';
        return 'red';
    };
    const affiliation = arrColor(guess.affiliation, answer.affiliation);
    const gIdx = DB_ARC_ORDER.indexOf(guess.debutArc);
    const aIdx = DB_ARC_ORDER.indexOf(answer.debutArc);
    const debutArc = gIdx === aIdx ? 'green' : (gIdx < aIdx ? 'yellow_up' : 'yellow_down');
    return { gender, race, origin, affiliation, transformation, debutSeries, debutArc };
}

function bwDbCell(val, color) {
    const arrow = color === 'yellow_up' ? '↑ After' : color === 'yellow_down' ? '↓ Before' : '';
    const c = color.startsWith('yellow') ? 'yellow' : color;
    return `<div class="wordle-cell ${c}" style="white-space:pre-line; font-size:12px;">${val}${arrow ? '\n'+arrow : ''}</div>`;
}

function bwDbBuildRow(char, colors) {
    const initials = char.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    return `<div class="wordle-row">
        <div class="wordle-char-cell">
            <img id="dbimg-${char.id}" src="" style="width:50px;height:50px;border-radius:50%;object-fit:cover;display:none;" onerror="this.style.display='none'; var d=document.getElementById('dbinitials-${char.id}'); if(d) d.style.display='flex';">
            <div id="dbinitials-${char.id}" style="width:50px;height:50px;border-radius:50%;background:var(--accent-yellow);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;color:#111;">${initials}</div>
            <div style="font-size:10px;font-weight:700;margin-top:4px;text-align:center;word-break:break-word;line-height:1.2;">${char.name}</div>
        </div>
        ${bwDbCell(char.gender, colors.gender)}
        ${bwDbCell(char.race, colors.race)}
        ${bwDbCell(char.origin, colors.origin)}
        ${bwDbCell(bwDbAffil(char.affiliation), colors.affiliation)}
        ${bwDbCell(char.transformation ? 'Yes' : 'No', colors.transformation)}
        ${bwDbCell(char.debutSeries, colors.debutSeries)}
        ${bwDbCell(char.debutArc, colors.debutArc)}
    </div>`;
}

function bwDbShowResult() {
    const { answer, guesses, solved } = window.bwDbState;
    const resultEl = document.getElementById('bwdb-result');
    const inputArea = document.getElementById('bwdb-input-area');
    if (!resultEl) return;
    if (solved) {
        const initials = answer.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
        resultEl.style.display = 'block';
        resultEl.style.background = '#1b5e20';
        resultEl.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
            <img id="dbimg-answer" src="" style="width:100px;height:100px;border-radius:50%;object-fit:cover;border:3px solid #FF6F00;display:none;">
            <div id="dbinitials-answer" style="width:100px;height:100px;border-radius:50%;background:var(--accent-yellow);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:26px;color:#111;">${initials}</div>
            <div style="font-size:20px;font-weight:800;color:#FF6F00;">${answer.name}</div>
            <div style="font-size:15px;font-weight:700;color:white;">🎉 ${guesses.length === 1 ? 'First try!' : `Solved in ${guesses.length} ${guesses.length===1?'guess':'guesses'}!`}</div>
            <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap;justify-content:center;">
                <button onclick="window.bwDbShare()" class="action-btn" style="background:rgba(255,255,255,0.15);color:white;font-size:13px;border:1px solid rgba(255,255,255,0.4);"><span class="material-symbols-outlined" style="font-size:15px;">share</span> Share Result</button>
                <button id="bwdb-post-btn" onclick="window.bwDbPostToFeed(this)" class="action-btn" style="background:#FF6F00;color:#111;font-size:13px;"><span class="material-symbols-outlined" style="font-size:15px;">post_add</span> Post to Feed</button>
            </div>
        </div>`;
        if (inputArea) inputArea.style.display = 'none';
        window.bwDbEnsureImages();
        const statusEl = document.getElementById('bwdb-status-text');
        if (statusEl) statusEl.innerText = `✓ Solved in ${guesses.length} ${guesses.length===1?'guess':'guesses'} today!`;
    } else {
        resultEl.style.display = 'none';
        if (inputArea) inputArea.style.display = 'block';
    }
}

function bwDbRender() {
    const grid = document.getElementById('bwdb-grid');
    if (!grid) return;
    const { answer, guesses } = window.bwDbState;
    grid.innerHTML = guesses.map(g => bwDbBuildRow(g, bwDbCalcColors(g, answer))).join('');
    window.bwDbEnsureImages();
    bwDbShowResult();
}

function bwDbAnimateNewRow(char, colors) {
    const grid = document.getElementById('bwdb-grid');
    if (!grid) return;
    grid.insertAdjacentHTML('beforeend', bwDbBuildRow(char, colors));
    window.bwDbEnsureImages();
    const newRow = grid.lastElementChild;
    const cells = newRow.querySelectorAll('.wordle-cell');
    cells.forEach((cell, i) => {
        cell.style.transform = 'rotateX(-90deg)';
        cell.style.opacity = '0';
        setTimeout(() => {
            cell.style.transition = 'transform 0.75s ease, opacity 0.55s ease';
            cell.style.transform = '';
            cell.style.opacity = '';
        }, i * 500);
    });
}

function bwDbGetToday() {
    const today = new Date().toISOString().split('T')[0];
    const seed = today.split('-').reduce((a,b) => a + parseInt(b), 0) + 13;
    return BW_DB_CHARS[seed % BW_DB_CHARS.length];
}

window.bwDbState = { answer: null, guesses: [], solved: false, selectedChar: null, date: null };

window.openBwDbModal = function() {
    window.closeAllModals();
    document.getElementById('bwdb-modal').style.display = 'flex';
    window.initBwDbGame();
};

window.initBwDbGame = async function() {
    const today = new Date().toISOString().split('T')[0];
    if (window.bwDbState.answer && window.bwDbState.date === today) {
        document.getElementById('bwdb-loading').style.display = 'none';
        document.getElementById('bwdb-content').style.display = 'block';
        bwDbRender(); return;
    }
    window.bwDbState = { answer: bwDbGetToday(), guesses: [], solved: false, selectedChar: null, date: today };
    try {
        if (auth.currentUser) {
            const snap = await getDoc(doc(db, 'bw_db_games', `${auth.currentUser.uid}_${today}`));
            if (snap.exists()) {
                const d = snap.data();
                window.bwDbState.guesses = (d.guesses||[]).map(id => BW_DB_CHARS.find(c => c.id === id)).filter(Boolean);
                window.bwDbState.solved = d.solved || false;
            }
        } else {
            const saved = localStorage.getItem(`wb_bwdb_${today}`);
            if (saved) { const d = JSON.parse(saved); window.bwDbState.guesses=(d.guesses||[]).map(id=>BW_DB_CHARS.find(c=>c.id===id)).filter(Boolean); window.bwDbState.solved=d.solved||false; }
        }
    } catch(e) {}
    document.getElementById('bwdb-loading').style.display = 'none';
    document.getElementById('bwdb-content').style.display = 'block';
    bwDbRender();
    window.bwDbLoadImages();
};

window.bwDbEnterGuess = function() {
    if (window.bwDbState.selectedChar) { window.submitBwDbGuess(); return; }
    const first = document.getElementById('bwdb-suggestions')?.querySelector('.wordle-suggestion-item');
    if (first) first.click();
};

window.searchBwDbChar = function() {
    window.bwDbState.selectedChar = null;
    const q = document.getElementById('bwdb-search')?.value.trim().toLowerCase();
    const sugg = document.getElementById('bwdb-suggestions');
    if (!sugg) return;
    if (!q) { sugg.style.display = 'none'; return; }
    const guessedIds = new Set(window.bwDbState.guesses.map(g => g.id));
    const matches = BW_DB_CHARS.filter(c => !guessedIds.has(c.id) && c.name.toLowerCase().includes(q)).slice(0, 8);
    sugg.style.display = matches.length ? 'block' : 'none';
    sugg.innerHTML = matches.map(c => `<div class="wordle-suggestion-item" onclick="window.selectBwDbChar('${c.id}')">${c.name}</div>`).join('');
};

window.selectBwDbChar = function(id) {
    const char = BW_DB_CHARS.find(c => c.id === id);
    if (!char) return;
    window.bwDbState.selectedChar = char;
    const inp = document.getElementById('bwdb-search');
    if (inp) inp.value = char.name;
    const sugg = document.getElementById('bwdb-suggestions');
    if (sugg) sugg.style.display = 'none';
    window.submitBwDbGuess();
};

window.submitBwDbGuess = async function() {
    const char = window.bwDbState.selectedChar;
    if (!char || window.bwDbState.solved) return;
    if (window.bwDbState.guesses.some(g => g.id === char.id)) return;
    const colors = bwDbCalcColors(char, window.bwDbState.answer);
    window.bwDbState.guesses.push(char);
    window.bwDbState.selectedChar = null;
    const inp = document.getElementById('bwdb-search');
    if (inp) inp.value = '';
    if (char.id === window.bwDbState.answer.id) window.bwDbState.solved = true;
    bwDbAnimateNewRow(char, colors);
    setTimeout(() => bwDbShowResult(), 8 * 500 + 800);
    const today = new Date().toISOString().split('T')[0];
    const saveData = { guesses: window.bwDbState.guesses.map(g=>g.id), solved: window.bwDbState.solved, date: today, guessCount: window.bwDbState.guesses.length, displayName: auth.currentUser?.displayName||'Player' };
    if (auth.currentUser) {
        setDoc(doc(db, 'bw_db_games', `${auth.currentUser.uid}_${today}`), saveData).catch(()=>{});
        if (window.bwDbState.solved) window.bwDbUpdateLeaderboard(window.bwDbState.guesses.length);
    } else {
        localStorage.setItem(`wb_bwdb_${today}`, JSON.stringify(saveData));
    }
};

window.bwDbUpdateLeaderboard = async function(guessCount) {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const ref = doc(db, 'bw_db_leaderboard', uid);
    const snap = await getDoc(ref);
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now()-86400000).toISOString().split('T')[0];
    let streak, totalWins;
    if (snap.exists()) {
        const d = snap.data();
        streak = d.lastWinDate === yesterday ? (d.currentStreak||0)+1 : 1;
        totalWins = (d.totalWins || 0) + 1;
        await updateDoc(ref, { totalWins: increment(1), totalGuesses: increment(guessCount), currentStreak: streak, bestStreak: Math.max(d.bestStreak||0,streak), lastWinDate: today, displayName: auth.currentUser.displayName });
    } else {
        streak = 1; totalWins = 1;
        await setDoc(ref, { totalWins:1, totalGuesses:guessCount, currentStreak:1, bestStreak:1, lastWinDate:today, displayName: auth.currentUser.displayName });
    }
    window.checkBwDbAchievements(guessCount, streak, totalWins).catch(() => {});
};

window.checkBwDbAchievements = async function(guessCount, streak, totalWins) {
    if (!auth.currentUser) return;
    const ids = [];
    if (totalWins === 1) ids.push('bwdb_first');
    if (guessCount === 1) ids.push('bwdb_1guess');
    if (streak >= 7) ids.push('bwdb_streak_7');
    if (totalWins >= 30) ids.push('bwdb_total_30');
    if (ids.length) window.awardAchievements(ids).catch(() => {});
};

window.bwDbShare = function() {
    const { answer, guesses, solved } = window.bwDbState;
    const today = new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    const map = {green:'🟩',yellow:'🟨',yellow_up:'🟨',yellow_down:'🟨',red:'🟥'};
    const rows = guesses.map(g => {
        const c = bwDbCalcColors(g, answer);
        return [c.gender,c.race,c.origin,c.affiliation,c.transformation,c.debutSeries,c.debutArc].map(x=>map[x]||'⬛').join('');
    }).join('\n');
    const text = `BuzzWord: Dragon Ball Characters — ${today}\n${solved?`Solved in ${guesses.length} ${guesses.length===1?'guess':'guesses'}!`:'Not solved'}\n\n${rows}\n\nhttps://weebee.buzz/#community`;
    navigator.clipboard.writeText(text).then(()=>alert('Copied to clipboard!')).catch(()=>alert('Could not copy'));
};

window.bwDbPostToFeed = async function(btn) {
    if (!auth.currentUser) return window.openAuthModal();
    const { answer, guesses, solved } = window.bwDbState;
    if (!solved) return;
    const today = new Date().toISOString().split('T')[0];
    const existing = await getDocs(query(collection(db,'bw_posts'), where('uid','==',auth.currentUser.uid), where('date','==',today), where('game','==','dragonball')));
    if (!existing.empty) { btn.innerText='Already posted!'; btn.disabled=true; return; }
    const map = {green:'🟩',yellow:'🟨',yellow_up:'🟨',yellow_down:'🟨',red:'🟥'};
    const emojiGrid = guesses.map(g => {
        const c = bwDbCalcColors(g, answer);
        return [c.gender,c.race,c.origin,c.affiliation,c.transformation,c.debutSeries,c.debutArc].map(x=>map[x]||'⬛').join('');
    }).join('\n');
    try {
        btn.disabled=true; btn.innerText='Posting...';
        const av = auth.currentUser.photoURL || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(auth.currentUser.displayName)}&backgroundColor=ffc107&fontColor=333333`;
        await addDoc(collection(db,'bw_posts'),{
            uid:auth.currentUser.uid, displayName:auth.currentUser.displayName, avatar:av,
            game:'dragonball', guessCount:guesses.length, emojiGrid, date:today, timestamp:new Date(), likes:[], dislikes:[], commentCount:0
        });
        btn.innerText='✓ Posted!';
        window.awardAchievements(['feed_showtime']).catch(() => {});
        window.fetchBwCommunityFeed();
        window.fetchHomeBwFeed();
    } catch(e) { btn.disabled=false; btn.innerText='Post to Feed'; alert('Failed to post.'); }
};

window.openBwDbLeaderboard = function() {
    window.closeAllModals();
    document.getElementById('bwdb-leaderboard-modal').style.display = 'flex';
    window.showBwDbLeaderboardTab('today');
};

window.showBwDbLeaderboardTab = async function(tab) {
    const todayBtn = document.getElementById('bwdb-tab-today');
    const alltimeBtn = document.getElementById('bwdb-tab-alltime');
    const content = document.getElementById('bwdb-leaderboard-content');
    if (!content) return;
    todayBtn.style.background = tab==='today' ? 'var(--accent-yellow)' : 'var(--bg-gray-darker)';
    todayBtn.style.color = tab==='today' ? '#111' : 'var(--text-dark)';
    alltimeBtn.style.background = tab==='alltime' ? 'var(--accent-yellow)' : 'var(--bg-gray-darker)';
    alltimeBtn.style.color = tab==='alltime' ? '#111' : 'var(--text-dark)';
    content.innerHTML = '<div class="loading">Loading...</div>';
    const today = new Date().toISOString().split('T')[0];
    try {
        if (tab === 'today') {
            const snap = await getDocs(query(collection(db,'bw_db_games'), where('date','==',today), where('solved','==',true)));
            const sorted = snap.docs.sort((a,b)=>(a.data().guessCount||99)-(b.data().guessCount||99)).slice(0,10);
            if (!sorted.length) { content.innerHTML='<p style="text-align:center;color:var(--text-muted);padding:30px;">No winners yet today — be the first!</p>'; return; }
            content.innerHTML = sorted.map((d,i)=>{
                const data=d.data(); const medal=['🥇','🥈','🥉'][i]||`${i+1}.`;
                return `<div style="display:flex;align-items:center;gap:12px;padding:10px;border-radius:8px;background:var(--bg-gray);margin-bottom:8px;">
                    <span style="font-size:20px;width:28px;">${medal}</span>
                    <div style="flex:1;"><div style="font-weight:700;font-size:14px;">${data.displayName||'Player'}</div>
                    <div style="font-size:12px;color:var(--text-muted);">${data.guessCount} ${data.guessCount===1?'guess':'guesses'}</div></div></div>`;
            }).join('');
        } else {
            const snap = await getDocs(collection(db,'bw_db_leaderboard'));
            const sorted = snap.docs.sort((a,b)=>(b.data().totalWins||0)-(a.data().totalWins||0)).slice(0,10);
            if (!sorted.length) { content.innerHTML='<p style="text-align:center;color:var(--text-muted);padding:30px;">No scores yet!</p>'; return; }
            content.innerHTML = sorted.map((d,i)=>{
                const data=d.data(); const avg=data.totalWins>0?(data.totalGuesses/data.totalWins).toFixed(1):'-';
                const medal=['🥇','🥈','🥉'][i]||`${i+1}.`;
                return `<div style="display:flex;align-items:center;gap:12px;padding:10px;border-radius:8px;background:var(--bg-gray);margin-bottom:8px;">
                    <span style="font-size:20px;width:28px;">${medal}</span>
                    <div style="flex:1;"><div style="font-weight:700;font-size:14px;">${data.displayName||'Player'}</div>
                    <div style="font-size:12px;color:var(--text-muted);">${data.totalWins} wins · Avg ${avg} guesses · Best streak: ${data.bestStreak||1}</div></div></div>`;
            }).join('');
        }
    } catch(e) { content.innerHTML='<p style="text-align:center;color:var(--text-muted);padding:20px;">Could not load leaderboard.</p>'; }
};

document.addEventListener('click', e => {
    if (!e.target.closest('.bwop-search-wrap')) {
        const s = document.getElementById('bwop-suggestions');
        if (s) s.style.display = 'none';
        const sn = document.getElementById('bwnrt-suggestions');
        if (sn) sn.style.display = 'none';
        const sb = document.getElementById('bwblc-suggestions');
        if (sb) sb.style.display = 'none';
        const sd = document.getElementById('bwdb-suggestions');
        if (sd) sd.style.display = 'none';
    }
});

// --- Infinite Scroll for Home Feed ---
const _feedObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && window.currentActiveViewId === 'home-view') {
        renderActivityBatch();
    }
}, { rootMargin: '200px' });

const _sentinel = document.getElementById('home-activity-sentinel');
if (_sentinel) _feedObserver.observe(_sentinel);

// Returns today's date in America/New_York (resets at midnight EST/EDT)
function bwGetDate() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// --- ADVANCED ANIME SEARCH ---
let _advPage = 1;
let _advHasMore = false;
let _advLastParams = null;

window.openAdvancedSearch = function() {
    document.getElementById('advanced-search-modal').style.display = 'flex';
    document.getElementById('adv-search-main-view').style.display = 'flex';
    document.getElementById('adv-archive-view').style.display = 'none';
    document.getElementById('adv-search-input').focus();
};

window.closeAdvancedSearch = function() {
    document.getElementById('advanced-search-modal').style.display = 'none';
};

// Genre chip toggle
document.getElementById('adv-genre-chips')?.addEventListener('click', e => {
    const chip = e.target.closest('.adv-genre-chip');
    if (!chip) return;
    chip.classList.toggle('selected');
});

window.runAdvancedSearch = async function(loadMore = false) {
    const q = document.getElementById('adv-search-input').value.trim();
    const type = document.getElementById('adv-type-filter').value;
    const status = document.getElementById('adv-status-filter').value;
    const minScore = document.getElementById('adv-score-filter').value;
    const orderBy = document.getElementById('adv-sort-filter').value;
    const selectedGenres = [...document.querySelectorAll('.adv-genre-chip.selected')].map(c => c.dataset.genreId);

    if (!q && !selectedGenres.length && !type && !status && !minScore) {
        document.getElementById('adv-search-results').innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:40px;grid-column:1/-1;">Enter a search term or select at least one filter.</div>`;
        return;
    }

    const resultsEl = document.getElementById('adv-search-results');
    const countEl = document.getElementById('adv-results-count');
    const loadMoreBtn = document.getElementById('adv-load-more-btn');

    if (!loadMore) {
        _advPage = 1;
        resultsEl.innerHTML = `<div style="text-align:center;padding:40px;grid-column:1/-1;" class="loading">Searching...</div>`;
        countEl.textContent = '';
        loadMoreBtn.style.display = 'none';
        _advLastParams = { q, type, status, minScore, orderBy, selectedGenres };
    } else {
        _advPage++;
    }

    const params = loadMore ? _advLastParams : { q, type, status, minScore, orderBy, selectedGenres };

    const urlParams = new URLSearchParams();
    if (params.q) urlParams.set('q', params.q);
    if (params.type) urlParams.set('type', params.type);
    if (params.status) urlParams.set('status', params.status);
    if (params.minScore) urlParams.set('min_score', params.minScore);
    urlParams.set('order_by', params.orderBy || 'score');
    urlParams.set('sort', 'desc');
    if (params.selectedGenres.length) urlParams.set('genres', params.selectedGenres.join(','));
    urlParams.set('limit', '24');
    urlParams.set('page', _advPage);

    const endpoint = `https://api.jikan.moe/v4/anime?${urlParams.toString()}&sfw=true`;

    try {
        const rawRes = await fetch(endpoint);
        if (!rawRes.ok) throw new Error(`Jikan ${rawRes.status}`);
        const res = await rawRes.json();
        const items = res.data || [];
        _advHasMore = res.pagination?.has_next_page || false;

        if (!loadMore) {
            if (!items.length) {
                resultsEl.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:40px;grid-column:1/-1;">No anime found. Try different filters.</div>`;
                countEl.textContent = '';
                return;
            }
            resultsEl.innerHTML = '';
        }

        const myList = await _advGetMyList();
        items.forEach(anime => {
            const inList = myList.has(String(anime.mal_id));
            const card = document.createElement('div');
            card.className = 'adv-anime-card';
            const score = anime.score ? `⭐ ${anime.score}` : '';
            const epInfo = anime.type === 'Movie' ? 'Movie' : (anime.episodes ? `${anime.episodes} eps` : anime.type || '');
            card.innerHTML = `
                <div class="adv-anime-card-img">
                    <img src="${anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || ''}" alt="${anime.title}" loading="lazy" onerror="this.parentElement.style.background='var(--bg-gray-darker)';">
                </div>
                <div class="adv-anime-card-body">
                    <div class="adv-anime-card-title">${anime.title}</div>
                    <div class="adv-anime-card-meta">${epInfo}</div>
                    ${score ? `<div class="adv-anime-card-score">${score}</div>` : ''}
                    <button class="adv-quick-add-btn search-quick-add ${inList ? 'in-list' : ''}"
                        data-mal="${anime.mal_id}"
                        onclick="event.stopPropagation(); advQuickAdd(this, ${anime.mal_id}, '${anime.title.replace(/'/g,"\\'")}')">
                        ${inList ? 'In List' : '+ Add'}
                    </button>
                </div>`;
            card.querySelector('.adv-anime-card-img').addEventListener('click', () => loadAnimeDetails(anime.mal_id));
            card.querySelector('.adv-anime-card-title').addEventListener('click', () => loadAnimeDetails(anime.mal_id));
            resultsEl.appendChild(card);
        });

        const total = res.pagination?.items?.total;
        if (!loadMore && total) countEl.textContent = `${total.toLocaleString()} results`;
        loadMoreBtn.style.display = _advHasMore ? 'inline-flex' : 'none';

    } catch(e) {
        if (!loadMore) resultsEl.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:40px;grid-column:1/-1;">Search failed. Please try again.</div>`;
        console.error('Advanced search error:', e);
    }
};

// Cache my list IDs for quick-add checks
let _advMyListCache = null;
async function _advGetMyList() {
    if (_advMyListCache) return _advMyListCache;
    if (!auth.currentUser) return new Set();
    try {
        const snap = await getDocs(query(collection(db, 'anime_lists'), where('uid', '==', auth.currentUser.uid)));
        _advMyListCache = new Set(snap.docs.map(d => String(d.data().mal_id)));
        return _advMyListCache;
    } catch(e) { return new Set(); }
}

auth.onAuthStateChanged(() => { _advMyListCache = null; });

window.advQuickAdd = async function(btn, mal_id, title) {
    if (!auth.currentUser) { alert('Sign in to add anime to your list.'); return; }
    if (btn.classList.contains('in-list')) return;
    btn.disabled = true;
    btn.textContent = '...';
    try {
        await addDoc(collection(db, 'anime_lists'), {
            uid: auth.currentUser.uid,
            mal_id: mal_id,
            title: title,
            status: 'plan_to_watch',
            score: null,
            addedAt: new Date()
        });
        btn.textContent = 'In List';
        btn.classList.add('in-list');
        _advMyListCache?.add(String(mal_id));
        // Update any other quick-add buttons for same anime across the page
        document.querySelectorAll(`.search-quick-add[data-mal="${mal_id}"]`).forEach(b => {
            b.textContent = 'In List';
            b.classList.add('in-list');
        });
    } catch(e) {
        btn.textContent = '+ Add';
        btn.disabled = false;
        console.error(e);
    }
};

// --- SEASONAL ARCHIVE ---
let _archiveData = null;

window.openSeasonalArchive = async function() {
    document.getElementById('adv-search-main-view').style.display = 'none';
    document.getElementById('adv-archive-view').style.display = 'flex';
    document.getElementById('adv-archive-grid').style.display = 'block';
    document.getElementById('adv-season-results').style.display = 'none';

    const gridEl = document.getElementById('adv-archive-grid');
    if (_archiveData) return; // already loaded

    gridEl.innerHTML = '<div class="loading" style="padding:40px;">Loading archive...</div>';

    try {
        const res = await window.jikanFetch('https://api.jikan.moe/v4/seasons', 'archive_list', 24 * 60 * 60 * 1000);
        const raw = res.data || [];

        // Build year -> seasons map, sorted descending
        const byYear = {};
        raw.forEach(({ year, seasons }) => {
            if (!year) return;
            byYear[year] = seasons || [];
        });
        _archiveData = byYear;

        const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);
        const seasonOrder = ['winter', 'spring', 'summer', 'fall'];
        const seasonLabels = { winter: 'Winter', spring: 'Spring', summer: 'Summer', fall: 'Fall' };

        let html = `<table class="adv-archive-table">
            <thead><tr>
                <th>Year</th>
                <th>Winter</th><th>Spring</th><th>Summer</th><th>Fall</th>
            </tr></thead><tbody>`;

        years.forEach(year => {
            const available = byYear[year];
            html += `<tr><td>${year}</td>`;
            seasonOrder.forEach(s => {
                if (available.includes(s)) {
                    html += `<td><button class="adv-season-btn" onclick="loadSeasonAnime(${year},'${s}')">${seasonLabels[s]}</button></td>`;
                } else {
                    html += `<td style="color:var(--text-muted);text-align:center;font-size:12px;">—</td>`;
                }
            });
            html += '</tr>';
        });
        html += '</tbody></table>';
        gridEl.innerHTML = html;

    } catch(e) {
        gridEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px;">Could not load archive. Try again later.</div>';
        console.error(e);
    }
};

window.closeSeasonalArchive = function() {
    document.getElementById('adv-archive-view').style.display = 'none';
    document.getElementById('adv-search-main-view').style.display = 'flex';
};

window.backToArchiveGrid = function() {
    document.getElementById('adv-season-results').style.display = 'none';
    document.getElementById('adv-archive-grid').style.display = 'block';
};

window.loadSeasonAnime = async function(year, season) {
    document.getElementById('adv-archive-grid').style.display = 'none';
    const seasonResultsEl = document.getElementById('adv-season-results');
    const gridEl = document.getElementById('adv-season-results-grid');
    const titleEl = document.getElementById('adv-season-title');
    seasonResultsEl.style.display = 'block';

    const label = season.charAt(0).toUpperCase() + season.slice(1);
    titleEl.textContent = `${label} ${year}`;
    gridEl.innerHTML = '<div class="loading" style="padding:40px;grid-column:1/-1;">Loading season...</div>';

    try {
        const cacheKey = `season_${year}_${season}`;
        const res = await window.jikanFetch(`https://api.jikan.moe/v4/seasons/${year}/${season}?limit=25`, cacheKey, 12 * 60 * 60 * 1000);
        const items = (res.data || []).filter(a => !a.explicit);

        if (!items.length) {
            gridEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px;grid-column:1/-1;">No anime found for this season.</div>';
            return;
        }

        const myList = await _advGetMyList();
        gridEl.innerHTML = '';
        items.forEach(anime => {
            const inList = myList.has(String(anime.mal_id));
            const card = document.createElement('div');
            card.className = 'adv-anime-card';
            const score = anime.score ? `⭐ ${anime.score}` : '';
            const epInfo = anime.type === 'Movie' ? 'Movie' : (anime.episodes ? `${anime.episodes} eps` : anime.type || '');
            card.innerHTML = `
                <div class="adv-anime-card-img">
                    <img src="${anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || ''}" alt="${anime.title}" loading="lazy" onerror="this.parentElement.style.background='var(--bg-gray-darker)';">
                </div>
                <div class="adv-anime-card-body">
                    <div class="adv-anime-card-title">${anime.title}</div>
                    <div class="adv-anime-card-meta">${epInfo}</div>
                    ${score ? `<div class="adv-anime-card-score">${score}</div>` : ''}
                    <button class="adv-quick-add-btn search-quick-add ${inList ? 'in-list' : ''}"
                        data-mal="${anime.mal_id}"
                        onclick="event.stopPropagation(); advQuickAdd(this, ${anime.mal_id}, '${anime.title.replace(/'/g,"\\'")}')">
                        ${inList ? 'In List' : '+ Add'}
                    </button>
                </div>`;
            card.querySelector('.adv-anime-card-img').addEventListener('click', () => { closeAdvancedSearch(); loadAnimeDetails(anime.mal_id); });
            card.querySelector('.adv-anime-card-title').addEventListener('click', () => { closeAdvancedSearch(); loadAnimeDetails(anime.mal_id); });
            gridEl.appendChild(card);
        });

    } catch(e) {
        gridEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px;grid-column:1/-1;">Could not load season. Try again later.</div>';
        console.error(e);
    }
};