import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, where, deleteDoc, doc, orderBy, limit, updateDoc, getDoc, setDoc, increment, runTransaction, onSnapshot } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
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
        } catch(e) { window.userRankCache[uid] = 0; }
    }));
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
};

window.loadProfileAchievements = async function(uid) {
    const container = document.getElementById('achievements-grid-container');
    if (!container || !uid) return;
    container.innerHTML = '<div class="loading">Loading achievements...</div>';
    try {
        const achDoc = await getDoc(doc(db, "achievements", uid));
        const earned = achDoc.exists() ? achDoc.data() : {};
        const cats = ['Critic', 'Social', 'Collector', 'Special'];
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
                    <div class="notif-header" style="padding:15px; font-weight:bold; border-bottom:1px solid #E0E0E0; position:sticky; top:0; background:var(--bg-white); z-index:10;">Notifications</div>
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
        Promise.all([
            getDoc(doc(db, "admins", auth.currentUser.uid)).then(d => { window.isAdmin = d.exists(); }).catch(() => {}),
            window.loadActiveSeasonalVote(),
            window.loadPatchNotes()
        ]).then(() => window.renderSeasonalVoting());
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
    if (window.myFollowedUserIds.has(uid)) {
        return `<button onclick="event.stopPropagation(); toggleFollow('${uid}', 'user', this)" class="action-btn card-follow-btn" style="padding:4px 10px; font-size:11px; background:var(--bg-gray-darker); color:var(--text-dark); flex-shrink:0;"><span class="material-symbols-outlined" style="font-size:14px;">check</span> <span class="follow-btn-label">Following</span></button>`;
    }
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
    const fanService = parseFloat(document.getElementById('in-depth-fanservice-value').value) || null;
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
    try {
        if (window.existingReviewId) {
            await updateDoc(doc(db, "reviews", window.existingReviewId), {
                score: parseFloat(overallScore), categories, fanService: fanService || null,
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
                fanService: fanService || null, text: '',
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
        window.loadAnimeDetails(window.currentAnimeId);
    } catch(e) { alert('Failed to submit review.'); console.error(e); }
};

window.submitQuickReview = async function() {
    if (!auth.currentUser) return window.openAuthModal();
    const score = parseFloat(document.getElementById('quick-score-value').value);
    const text = document.getElementById('quick-score-text').value.trim();
    const fanService = parseFloat(document.getElementById('quick-fanservice-value').value) || null;
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
        window.loadAnimeDetails(window.currentAnimeId);
    } catch(e) { alert('Failed to submit review.'); console.error(e); }
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
    const q = query(collection(db, "anime_lists"), where("uid", "==", uidToFetch));
    const snap = await getDocs(q);
    window.myAnimeList = [];
    snap.forEach(d => window.myAnimeList.push({ ...d.data(), id: d.id }));
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
};

window.renderAnimeList = function() {
    let filteredList = window.myAnimeList;
    if(window.currentListTab !== 'all') {
        filteredList = window.myAnimeList.filter(a => a.status === window.currentListTab);
    }

    let rankedList = [...filteredList].sort((a, b) => (b.score || 0) - (a.score || 0));
    rankedList.forEach((item, index) => item._absoluteRank = index + 1);

    const { key, desc } = window.currentListSort;
    
    rankedList.sort((a, b) => {
        if(key === 'title') {
            return desc ? b.title.localeCompare(a.title) : a.title.localeCompare(b.title);
        } else if (key === 'score') {
            return desc ? (b.score || 0) - (a.score || 0) : (a.score || 0) - (b.score || 0);
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
                <td style="text-align:center; font-weight:800; font-size:16px;">${anime.score ? anime.score.toFixed(1) : '-'}</td>
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

window.toggleComments = function(event, reviewId) {
    event.stopPropagation();
    const container = document.getElementById(`comments-container-${reviewId}`);
    const card = container.closest('.review-card');
    if (container.style.display === 'none') { container.style.display = 'block'; card.classList.add('expanded'); fetchInlineComments(reviewId); } 
    else { container.style.display = 'none'; if(!card.querySelector('.full-review-content') || card.querySelector('.full-review-content').style.display === 'none') card.classList.remove('expanded'); }
};

window.fetchInlineComments = async function(reviewId) {
    const list = document.getElementById(`comments-list-${reviewId}`);
    list.innerHTML = '<div class="loading" style="font-size:12px;">Loading...</div>';
    const q = query(collection(db, "comments"), where("reviewId", "==", reviewId));
    const snap = await getDocs(q);
    let html = '';
    
    let commentsArray = [];
    snap.forEach(doc => { let d = doc.data(); d.id = doc.id; commentsArray.push(d); });
    commentsArray.sort((a, b) => a.timestamp - b.timestamp);

    // Update the comment count display with the real count
    const countEl = document.getElementById(`comment-count-${reviewId}`);
    if (countEl) countEl.innerText = commentsArray.length + (commentsArray.length === 1 ? ' Comment' : ' Comments');

    commentsArray.forEach(c => {
        const id = c.id;
        const likeStyle = auth.currentUser && c.likes?.includes(auth.currentUser.uid) ? 'color: var(--accent-yellow);' : 'color: var(--text-muted);';
        const dislikeStyle = auth.currentUser && c.dislikes?.includes(auth.currentUser.uid) ? 'color: red;' : 'color: var(--text-muted);';
        html += `<div style="display:flex; gap:10px; margin-bottom: 10px; background: var(--bg-white); padding: 10px; border-radius: 8px; border: 1px solid #E0E0E0;"><img src="${c.avatar}" style="width:30px; height:30px; border-radius:50%; object-fit:cover; cursor:pointer;" onclick="viewUserProfile('${c.uid}')"><div style="flex: 1;"><strong style="font-size:12px; cursor:pointer;" class="clickable-user" onclick="viewUserProfile('${c.uid}')">${c.username}</strong><p style="font-size:12px; margin-top:2px;">${c.text}</p><div style="display: flex; gap: 15px; margin-top: 6px; font-size: 11px;"><div style="display:flex; align-items:center; gap: 4px; cursor:pointer; ${likeStyle}" onclick="toggleCommentReaction(event, '${id}', 'like', this)"><span class="material-symbols-outlined" style="font-size: 14px;">thumb_up</span> <span class="c-like-count">${c.likes?.length || 0}</span></div><div style="display:flex; align-items:center; gap: 4px; cursor:pointer; ${dislikeStyle}" onclick="toggleCommentReaction(event, '${id}', 'dislike', this)"><span class="material-symbols-outlined" style="font-size: 14px;">thumb_down</span> <span class="c-dislike-count">${c.dislikes?.length || 0}</span></div></div></div></div>`;
    });
    list.innerHTML = html || '<p style="text-align:center; font-size:12px;">No comments yet.</p>';
};

window.submitInlineComment = async function(reviewId) {
    if(!auth.currentUser) return window.openAuthModal();
    const input = document.getElementById(`comment-input-${reviewId}`);
    if(!input.value.trim()) return;
    await addDoc(collection(db, "comments"), { reviewId, text: input.value.trim(), username: auth.currentUser.displayName, avatar: auth.currentUser.photoURL, uid: auth.currentUser.uid, timestamp: new Date(), likes: [], dislikes: [] });
    updateDoc(doc(db, "reviews", reviewId), { commentCount: increment(1) }).catch(() => {});
    const countEl = document.getElementById(`comment-count-${reviewId}`);
    if (countEl) countEl.innerText = (parseInt(countEl.innerText) + 1) + ' Comments';
    input.value = ''; fetchInlineComments(reviewId);
};

window.generateReviewCardHTML = function(rev, isGlobal = false) {
    if(isGlobal) { 
        return `<div class="review-card"><div class="review-header"><img src="${rev.user.images.jpg.image_url}" class="avatar"><div><strong>${rev.user.username}</strong> <span class="source-badge badge-global">Global</span></div></div><div class="rating-badge blue">${rev.score}</div><p class="review-text" style="-webkit-line-clamp: 3; line-clamp: 3; display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden;">${rev.review}</p></div>`; 
    }
    
    let innerContent = '';
    const safeUid = rev.uid;

    if(rev.type === 'suggestion') {
        innerContent = `
            <img src="${rev.animeImage}" class="review-anime-thumb" alt="Cover" style="cursor:pointer;" onclick="event.stopPropagation(); loadAnimeDetails(${rev.mal_id})">
            <div class="review-header" style="justify-content: space-between; position: relative; z-index: 3;">
                <div style="display:flex; gap: 15px;">
                    <img src="${rev.avatar}" class="avatar clickable-user" onclick="event.stopPropagation(); viewUserProfile('${safeUid}')">
                    <div>
                        <strong class="clickable-user" onclick="event.stopPropagation(); viewUserProfile('${safeUid}')">${rev.username}</strong> ${window.getFounderBadgeHTML(safeUid)} ${window.getRankBadgeHTML(window.userRankCache[safeUid] || 0, 14)}
                        <span class="source-badge" style="background: #4CAF50; color: white; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; text-transform: uppercase;">Suggestion</span><br>
                        <span style="font-size: 12px; color: var(--text-muted);">Suggested: <strong style="cursor:pointer; color:var(--text-dark);" onclick="event.stopPropagation(); loadAnimeDetails(${rev.mal_id})">${rev.animeTitle}</strong></span>
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
            badgesHTML = `<div class="review-badges-row" style="display:flex; gap: 15px; margin-top: 20px; flex-wrap: wrap; justify-content: flex-start; align-items: flex-end; padding-right: 170px; position: relative; z-index: 2;">
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
            <img src="${rev.animeImage}" class="review-anime-thumb" alt="Cover" style="cursor:pointer;" onclick="event.stopPropagation(); loadAnimeDetails(${rev.mal_id})">
            <div class="review-header" style="justify-content: space-between; position: relative; z-index: 3;">
                <div style="display:flex; gap: 15px;">
                    <img src="${rev.avatar}" class="avatar clickable-user" onclick="event.stopPropagation(); viewUserProfile('${safeUid}')">
                    <div><strong><span class="clickable-user" style="color:var(--text-dark);" onclick="event.stopPropagation(); viewUserProfile('${safeUid}')">${rev.username}</span></strong> ${window.getFounderBadgeHTML(safeUid)} ${window.getRankBadgeHTML(window.userRankCache[safeUid] || 0, 14)} <span class="source-badge badge-weebee">WeeBee</span><br>
                    <span style="font-size: 12px; color: var(--text-muted); display:flex; align-items:center; gap:6px; margin-top:3px; min-width:0;">${rev.animeImage ? `<img src="${rev.animeImage}" class="review-cover-mobile" onclick="event.stopPropagation(); loadAnimeDetails(${rev.mal_id})">` : ''}Reviewed: <strong class="review-anime-title" style="cursor:pointer; color:var(--text-dark);" onclick="event.stopPropagation(); loadAnimeDetails(${rev.mal_id})">${rev.animeTitle}</strong></span></div>
                </div>
                ${window.getFollowBtnHTML(safeUid)}
            </div>
            ${badgesHTML}
            ${fullHTML}
        `;
    }

    return `
        <div class="review-card weebee-review interactive review-item" onclick="${rev.type === 'in-depth' ? 'toggleReviewExpand(this)' : ''}">
            ${innerContent}
            <div class="review-actions">
                <div class="action-stat"><button onclick="window.toggleComments(event, '${rev.id}')"><span class="material-symbols-outlined">chat_bubble</span></button><span class="action-label" id="comment-count-${rev.id}">${rev.commentCount || 0} Comments</span></div>
                <div class="action-stat"><button onclick="window.toggleReaction(event, '${rev.id}', 'like', this)"><span class="material-symbols-outlined">thumb_up</span></button><span class="action-label">${rev.likes?.length || 0} Likes</span></div>
                <div class="action-stat"><button onclick="window.toggleReaction(event, '${rev.id}', 'dislike', this)"><span class="material-symbols-outlined">thumb_down</span></button><span class="action-label">${rev.dislikes?.length || 0} Dislikes</span></div>
            </div>
            ${rev.type === 'in-depth' ? '<div class="expand-hint-row"><span class="expand-hint"><span class="material-symbols-outlined" style="font-size:11px; vertical-align:middle;">expand_more</span> Click to expand</span></div>' : ''}
            <div id="comments-container-${rev.id}" class="inline-comments" style="display:none; margin-top: 15px; padding-top: 15px; position: relative; z-index: 2;" onclick="event.stopPropagation();">
                <div id="comments-list-${rev.id}"></div>
                <div style="display:flex; gap:10px; margin-top:10px;">
                    <input type="text" id="comment-input-${rev.id}" placeholder="Add a comment..." style="flex:1; padding: 10px; border-radius: 8px; border: 1px solid #E0E0E0;">
                    <button class="action-btn" onclick="submitInlineComment('${rev.id}')">Send</button>
                </div>
            </div>
        </div>`;
};

// --- DYNAMIC PROFILE HUB VIEW ---
window.viewUserProfile = function(uid) {
    if(!uid) return;
    window.targetProfileUid = uid;
    switchView('profile-view');
};

const EDIT_GENRES = ['Action','Adventure','Comedy','Drama','Fantasy','Horror','Mystery','Romance','Sci-Fi','Slice of Life','Sports','Supernatural','Thriller','Mecha'];

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

    document.getElementById('edit-profile-name').value = currentName;
    document.getElementById('edit-profile-bio').value = currentBio;
    document.getElementById('edit-profile-avatar').value = currentAvatar;
    document.getElementById('edit-profile-error').innerText = '';
    document.getElementById('edit-avatar-preview').src = currentAvatar || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(currentName)}&backgroundColor=ffc107&fontColor=333333`;
    document.getElementById('avatar-file-input').value = '';

    const chipsContainer = document.getElementById('edit-genre-chips');
    chipsContainer.innerHTML = EDIT_GENRES.map(g =>
        `<button type="button" class="genre-chip ${currentGenres.includes(g) ? 'active' : ''}" onclick="toggleGenreChip(this)">${g}</button>`
    ).join('');

    document.getElementById('edit-profile-modal').style.display = 'flex';
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
    if (newName.length < 2) return errEl.innerText = 'Display name must be at least 2 characters.';

    const uid = auth.currentUser.uid;
    const oldName = (await getDoc(doc(db, "profiles", uid))).data()?.displayName || auth.currentUser.displayName || '';
    const oldNorm = oldName.trim().toLowerCase().replace(/\s+/g, ' ');
    const newNorm = newName.toLowerCase().replace(/\s+/g, ' ');
    const saveBtn = document.getElementById('edit-profile-save-btn');
    saveBtn.disabled = true; saveBtn.innerText = 'Saving...';

    try {
        // Upload file if one was selected
        if (fileInput.files[0]) {
            saveBtn.innerText = 'Uploading...';
            const compressed = await compressAvatar(fileInput.files[0]);
            const sRef = storageRef(storage, `avatars/${uid}/profile.jpg`);
            await uploadBytes(sRef, compressed);
            avatar = await getDownloadURL(sRef);
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

        await setDoc(doc(db, "profiles", uid), { displayName: newName, bio, avatar: avatar || auth.currentUser.photoURL, genres }, { merge: true });

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
    const bioHTML = pBio ? `<p style="font-size:14px; color:var(--text-dark); line-height:1.6; margin-top:6px;">${pBio}</p>` : '';

    document.getElementById('profile-header-container').innerHTML = `
        <div class="profile-header">
            <img src="${pAvatar}" class="profile-avatar-large" style="flex-shrink:0;" onerror="this.src='https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(pName)}&backgroundColor=ffc107&fontColor=333333'">
            <div style="flex:1; min-width:0;">
                <h1 style="font-size: 28px; margin-bottom: 4px;">${pName} ${window.getFounderBadgeHTML(uidToFetch, 22)}</h1>
                <p style="color: var(--text-muted); font-size: 13px;">WeeBee Member since ${pJoined}</p>
                <div id="profile-follow-counts" style="display:flex; gap:12px; margin-top:4px; font-size:14px; font-weight:600;"></div>
                ${bioHTML}
                ${genreChipsHTML}
            </div>
            ${editBtnHtml}
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
        if(data.type !== 'suggestion') { totalScore += parseFloat(data.score); reviewCount++; }
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
    listSnap.forEach(d => { if(d.data().status === 'watching') watchAnimes.push(d.data()); });
    
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
        <span><strong>${followersCount}</strong> <span style="color:var(--text-muted); font-size:13px;">Followers</span></span>`;

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
        } else {
            hasUser = true;
            // Render placeholder, resolve real name below
            fUserList.innerHTML += `<div class="user-chip clickable-user" id="user-chip-${f.targetId}" onclick="viewUserProfile('${f.targetId}')"><img id="user-chip-img-${f.targetId}" src="${f.avatar || ''}" onerror="this.style.display='none'" style="width:24px;height:24px;border-radius:50%;"> <span id="user-chip-name-${f.targetId}">...</span></div>`;
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
                displayName = displayName || 'WeeBee User';
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
window.fetchHomepageReviews = async function() {
    try {
        const q = query(collection(db, "reviews"), orderBy("timestamp", "desc"), limit(20));
        const snap = await getDocs(q);
        const revDocs = [];
        snap.forEach(d => revDocs.push({ ...d.data(), id: d.id }));

        const uids = revDocs.map(r => r.uid).filter(Boolean);
        await window.prefetchRankCache(uids);

        // Batch-fetch real comment counts in one query
        if (revDocs.length > 0) {
            const reviewIds = revDocs.map(r => r.id);
            const commSnap = await getDocs(query(collection(db, "comments"), where("reviewId", "in", reviewIds)));
            const countMap = {};
            commSnap.forEach(d => { const rid = d.data().reviewId; countMap[rid] = (countMap[rid] || 0) + 1; });
            revDocs.forEach(r => { r.commentCount = countMap[r.id] || 0; });
        }

        const feed = document.getElementById('review-feed'); feed.innerHTML = '';
        revDocs.forEach(r => feed.innerHTML += window.generateReviewCardHTML(r));
    } catch(e) { console.error("Error loading home feed:", e); }

    if(auth.currentUser) {
        try {
            const fQ = query(collection(db, "follows"), where("followerUid", "==", auth.currentUser.uid), where("type", "==", "anime"));
            const fSnap = await getDocs(fQ);
            let followedMalIds = [];
            fSnap.forEach(d => followedMalIds.push(d.data().targetId));

            const newsSection = document.getElementById('home-news-section');
            const newsCarousel = document.getElementById('home-news-carousel');

            if(followedMalIds.length > 0) {
                newsSection.style.display = 'block';
                newsCarousel.innerHTML = '';
                
                const limitAnimes = followedMalIds.slice(0, 2);
                for(let animeId of limitAnimes) {
                    try {
                        const r = await fetch(`https://api.jikan.moe/v4/anime/${animeId}/news`);
                        const d = await r.json();
                        if(d.data) {
                            d.data.slice(0, 3).forEach(n => {
                                newsCarousel.innerHTML += `
                                    <div class="news-card" style="min-width: 300px; flex-shrink:0;">
                                        <img src="${n.images?.jpg?.image_url || 'https://via.placeholder.com/300x150'}">
                                        <div class="news-content" style="padding:10px;">
                                            <h3 style="font-size:14px; margin-bottom:5px;">${n.title}</h3>
                                            <a href="${n.url}" target="_blank" class="news-link" style="display:inline-block; margin-top:auto; font-size:10px;">Read Article</a>
                                        </div>
                                    </div>`;
                            });
                        }
                    } catch(e){}
                }
                if(newsCarousel.innerHTML === '') newsCarousel.innerHTML = '<p class="empty-msg" style="color:var(--text-muted); padding:10px;">No recent news for your followed anime.</p>';
            } else { newsSection.style.display = 'none'; }
        } catch(e){}
    } else { document.getElementById('home-news-section').style.display = 'none'; }
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
    if (!window.activeSeasonalVote) return;
    if (window.mySeasonalVote) return;
    try {
        const recordId = `${window.activeSeasonalVote.id}_${auth.currentUser.uid}`;
        await setDoc(doc(db, "seasonal_vote_records", recordId), { uid: auth.currentUser.uid, mal_id: malId, season: window.activeSeasonalVote.id, timestamp: new Date() });
        await updateDoc(doc(db, "seasonal_votes", window.activeSeasonalVote.id), { [`voteCounts.${malId}`]: increment(1) });
        window.mySeasonalVote = malId;
        window.activeSeasonalVote.voteCounts = { ...window.activeSeasonalVote.voteCounts, [malId]: (window.activeSeasonalVote.voteCounts[malId] || 0) + 1 };
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
        content.innerHTML = `<div style="display:grid; grid-template-columns:repeat(5,1fr); gap:14px;">` +
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
                        ${vote.closed && placeLabel ? `<div style="font-size:11px;font-weight:700;color:${placeColors[winnerIdx]};margin-top:4px;">${placeLabel}</div>` : ''}
                    </div>
                </div>`;
            }).join('') + '</div>';
    });
};

// --- PATCH NOTES ---
window.currentPatchNotes = [];

window.loadPatchNotes = async function() {
    try {
        const snap = await getDocs(query(collection(db, "patch_notes"), orderBy("timestamp", "desc"), limit(10)));
        window.currentPatchNotes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const feed = document.getElementById('patch-notes-feed');
        const section = document.getElementById('patch-notes-section');
        if (!feed || !section) return;
        if (snap.empty) { section.style.display = 'none'; return; }
        section.style.display = 'block';
        feed.innerHTML = window.currentPatchNotes.map((p, i) => `
            <div class="news-card" onclick="openPatchNoteModal(${i})" style="cursor:pointer;">
                <div style="background:var(--accent-yellow); height:8px; border-radius:10px 10px 0 0;"></div>
                <div class="news-content">
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                        <img src="${p.authorAvatar || ''}" style="width:32px; height:32px; border-radius:50%; object-fit:cover;" onerror="this.style.display='none'">
                        <div>
                            <div style="font-size:12px; font-weight:700; color:var(--accent-yellow);">WeeBee Update</div>
                            <div style="font-size:11px; color:var(--text-muted);">${p.authorName || 'WeeBee'}</div>
                        </div>
                    </div>
                    <h3 style="font-size:14px; font-weight:700; margin-bottom:8px; line-height:1.4;">${p.title}</h3>
                    <p style="font-size:13px; color:var(--text-muted); display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;">${p.body.replace(/\n/g, ' ')}</p>
                    <div class="news-footer" style="margin-top:10px;">
                        <span style="font-size:12px; color:var(--text-muted);">${p.timestamp?.toDate ? new Date(p.timestamp.toDate()).toLocaleDateString() : ''}</span>
                        <span class="news-link">Read More</span>
                    </div>
                </div>
            </div>`).join('');
        window.checkPatchNoteBadge();
    } catch(e) { console.error('loadPatchNotes', e); }
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
    const link = document.getElementById('article-reader-link');
    link.style.display = 'none';
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
            if(data.type !== 'suggestion' && data.score && data.mal_id) {
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
        let top10 = Object.values(animeStats).filter(a => a.title).map(a => ({ ...a, avgScore: (a.totalScore / a.count).toFixed(1) })).sort((a, b) => b.avgScore - a.avgScore).slice(0, 10);
        // Podium: only anime with enough reviews to qualify; list gets everything else
        const podium = top10.filter(a => a.count >= MIN_REVIEWS).slice(0, 3);
        const podiumIds = new Set(podium.map(a => a.mal_id));
        const listItems = top10.filter(a => !podiumIds.has(a.mal_id)).slice(0, 7);
        
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

            // Read rank history for permanent achievement badges
            const historyMap = {};
            await Promise.all(top10.map(async a => {
                try {
                    const d = await getDoc(doc(db, "rankHistory", String(a.mal_id)));
                    historyMap[a.mal_id] = d.exists() ? d.data() : {};
                } catch(e) { historyMap[a.mal_id] = {}; }
            }));

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
                        <div class="rating-badge tier-silver" style="width:38px;height:38px;font-size:13px;">${podium[1].avgScore}</div>
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
                        <div class="rating-badge tier-royal" style="width:48px;height:48px;font-size:16px;">${podium[0].avgScore}</div>
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
                        <div class="rating-badge tier-bronze" style="width:38px;height:38px;font-size:13px;">${podium[2].avgScore}</div>
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
                            <div class="rating-badge blue" style="width:42px;height:42px;font-size:14px;flex-shrink:0;">${anime.avgScore}</div>
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
                    if(friendIds.includes(data.uid) && !suggestedMalIds.has(data.mal_id)) {
                        suggestedMalIds.add(data.mal_id);
                        friendsSuggested.push({ mal_id: data.mal_id, title: data.animeTitle, image: data.animeImage, friendName: data.username, action: data.type === 'suggestion' ? 'Suggested' : 'Reviewed' });
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
        const res = await fetch(url);
        if(!res.ok) { container.innerHTML = '<p class="empty-msg" style="color:var(--text-muted); font-size:13px;">Couldn\'t load right now — try refreshing.</p>'; return; }
        const { data } = await res.json(); container.innerHTML = '';
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
            getDocs(query(collection(db, "profiles"), where("displayName", ">=", queryStr), where("displayName", "<=", queryStr + ''), limit(5)))
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

        if (data.length === 0 && userSnap.empty) {
            html = '<p style="color:var(--text-muted); text-align:center;">No results found.</p>';
        } else if (data.length > 0) {
            html += `<h4 style="font-size:12px; text-transform:uppercase; letter-spacing:1px; color:var(--text-muted); margin-bottom:12px;">Anime</h4>
                <div class="top10-list-container">`;
            data.forEach(anime => {
                html += `
                    <div class="top10-list-item" onclick="loadAnimeDetails(${anime.mal_id})">
                        <img src="${anime.images.jpg.image_url}">
                        <div style="flex:1; min-width:0;">
                            <h3 style="margin-bottom:4px; font-size:16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${anime.title_english || anime.title}</h3>
                            <p style="font-size:12px; color:var(--text-muted);">${anime.type || ''}, ${anime.year || 'N/A'}</p>
                        </div>
                        <div class="rating-badge blue" style="width:40px; height:40px; font-size:14px; flex-shrink:0;">${anime.score || 'N/A'}</div>
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
        history.pushState({ view: targetId, profileUid: window.targetProfileUid, animeId: window.currentAnimeId }, '', window.location.pathname);
    }
    // Save state for refresh restoration
    sessionStorage.setItem('weebee-last-view', JSON.stringify({ view: targetId, profileUid: window.targetProfileUid, animeId: window.currentAnimeId }));
    
    document.querySelectorAll(".nav-btn").forEach(btn => { btn.classList.remove("active"); if(btn.getAttribute("data-target") === targetId) btn.classList.add("active"); });
    document.querySelectorAll(".view").forEach(view => view.classList.remove("active"));
    document.getElementById(targetId).classList.add("active");
    window.currentActiveViewId = targetId;
    document.querySelector('.main-content').scrollTo(0,0);
    
    if(targetId === 'home-view') fetchHomepageReviews();
    if(targetId === 'news-view') {
        fetchGlobalNews();
        window.loadPatchNotes();
        window.clearPatchNoteBadge();
        const adminPanel = document.getElementById('patch-notes-admin');
        if (adminPanel) adminPanel.style.display = window.isAdmin ? 'block' : 'none';
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
    window.currentAnimeId = mal_id; switchView('anime-detail-view', false, skipHistory);
    const res = await fetch(`https://api.jikan.moe/v4/anime/${mal_id}/full`);
    const { data: anime } = await res.json(); window.currentAnime = anime;

    let fanServiceScores = new Map(); 
    const revQ = query(collection(db, "reviews"), where("mal_id", "==", mal_id));
    const revSnapshot = await getDocs(revQ);
    let weebeeTotal = 0; let weebeeCount = 0;

    revSnapshot.forEach(d => { 
        const rData = d.data();
        if(rData.fanService) fanServiceScores.set(rData.uid, rData.fanService); 
        if(rData.type !== 'suggestion' && rData.score) { weebeeTotal += parseFloat(rData.score); weebeeCount++; }
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
                </div>
                ${fanServiceHTML}
            </div>
            <button onclick="addCurrentAnimeToList()" class="action-btn" style="width:100%; justify-content:center; margin-bottom: 10px;"><span class="material-symbols-outlined">add</span> Add to List</button>
            <button onclick="toggleFollow(${mal_id}, 'anime', this)" class="action-btn" style="width:100%; justify-content:center; margin-bottom: 10px; background:var(--bg-gray-darker); color:var(--text-dark);">Follow Anime</button>
            <button onclick="openSuggestModal()" class="action-btn" style="width:100%; justify-content:center; background: transparent; color: var(--text-dark); border: 1px solid #E0E0E0;">
                <span class="material-symbols-outlined">send</span> Suggest
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
                <div class="review-header-container">
                    <h3>Reviews</h3>
                    <button class="action-btn" onclick="event.stopPropagation(); openReviewModal()">Write a Review</button>
                </div>
                <div class="review-list" id="detail-reviews"></div>
            </div>
            <div id="tab-seasons" class="detail-tab-content" style="display:none;"></div>
        </div>`;

    const revList = document.getElementById('detail-reviews'); revList.innerHTML = '';
    revSnapshot.forEach(d => revList.innerHTML += window.generateReviewCardHTML({ ...d.data(), id: d.id }));

    // Async Fetchers
    fetch(`https://api.jikan.moe/v4/anime/${mal_id}/characters`).then(r=>r.json()).then(d => {
        const cContainer = document.getElementById('detail-chars-container'); if(!cContainer) return;
        if(d.data && d.data.length > 0) {
            cContainer.innerHTML = `<h3>Characters & Voice Actors</h3><div class="character-grid">${d.data.slice(0, 6).map(c => `<div class="character-card"><img src="${c.character.images.jpg.image_url}"><div class="info"><span class="name" title="${c.character.name}">${c.character.name}</span><span class="role">${c.role}</span>${c.voice_actors && c.voice_actors.length > 0 ? `<span style="font-size:11px; margin-top:5px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">VA: ${c.voice_actors[0].person.name}</span>` : ''}</div></div>`).join('')}</div>`;
        } else { cContainer.style.display = 'none'; }
    }).catch(() => document.getElementById('detail-chars-container').style.display = 'none');

    window.currentEpisodeList = [];

    fetch(`https://api.jikan.moe/v4/anime/${mal_id}/recommendations`).then(r=>r.json()).then(d => {
        const rContainer = document.getElementById('detail-recs-container'); if(!rContainer) return;
        if(d.data && d.data.length > 0) {
            rContainer.innerHTML = `<h3>Similar Anime</h3><div class="carousel-container"><button class="carousel-arrow left" onclick="scrollCarousel('recs-carousel', -1)"><span class="material-symbols-outlined">chevron_left</span></button><div class="carousel" id="recs-carousel" style="margin-bottom:0; padding-bottom:10px;">${d.data.slice(0, 10).map(rec => `<div class="anime-card" onclick="loadAnimeDetails(${rec.entry.mal_id})" style="min-width: 140px;"><img src="${rec.entry.images.jpg.image_url}" style="width:120px; height:170px;"><p style="max-width:120px; font-size:12px;">${rec.entry.title}</p></div>`).join('')}</div><button class="carousel-arrow right" onclick="scrollCarousel('recs-carousel', 1)"><span class="material-symbols-outlined">chevron_right</span></button></div>`;
        } else { rContainer.style.display = 'none'; }
    }).catch(() => document.getElementById('detail-recs-container').style.display = 'none');

    fetch(`https://api.jikan.moe/v4/anime/${mal_id}/news`).then(r=>r.json()).then(d => {
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
        const res = await fetch(`https://api.jikan.moe/v4/anime/${mal_id}/relations`);
        const { data } = await res.json();
        const entries = [];
        (data || []).forEach(rel => rel.entry.forEach(e => { if (e.type === 'anime') entries.push({ ...e, relation: rel.relation }); }));
        if (entries.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:30px; font-size:14px;">No related anime found.</p>';
            return;
        }
        container.innerHTML = entries.map(e => `
            <div style="display:flex; align-items:center; gap:14px; padding:12px; border-radius:10px; background:var(--bg-gray); margin-bottom:8px; cursor:pointer;" onclick="loadAnimeDetails(${e.mal_id})">
                <div id="rel-img-wrap-${e.mal_id}" style="width:50px; height:70px; border-radius:6px; background:var(--bg-gray-darker); flex-shrink:0; overflow:hidden;">
                    <img id="rel-img-${e.mal_id}" src="" style="width:100%; height:100%; object-fit:cover; display:none;">
                </div>
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:600; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${e.name}</div>
                    <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">${e.relation}</div>
                </div>
                <span class="material-symbols-outlined" style="color:var(--text-muted); flex-shrink:0;">chevron_right</span>
            </div>`).join('');
        for (const e of entries) {
            await new Promise(r => setTimeout(r, 420));
            try {
                const r = await fetch(`https://api.jikan.moe/v4/anime/${e.mal_id}`);
                const { data: d } = await r.json();
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
        const res = await fetch(`https://api.jikan.moe/v4/anime/${mal_id}/episodes?page=${page}`);
        if (!res.ok) throw new Error(`Jikan ${res.status}`);
        const json = await res.json();
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
};