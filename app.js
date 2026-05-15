import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, where, deleteDoc, doc, orderBy, limit, updateDoc, getDoc, setDoc, increment } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";

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

window.currentActiveViewId = 'home-view';
window.previousViewId = 'home-view';
window.currentAnime = null; 
window.currentAnimeId = null;
window.pendingInDepthData = null; 
window.isSignUpMode = false; 

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
            <div style="position:relative; display:flex; align-items:center; margin-right: 15px;">
                <span class="material-symbols-outlined" style="font-size:26px; cursor:pointer; color:var(--text-dark);" onclick="toggleNotifications(event)">notifications</span>
                <span class="notification-badge" id="notif-badge" style="display:none; position:absolute; top:-5px; right:-5px; background:#FF4444; color:white; border-radius:50%; width:18px; height:18px; font-size:10px; font-weight:bold; align-items:center; justify-content:center; pointer-events:none;">0</span>
                
                <div id="notification-dropdown" class="dropdown-menu notification-menu" style="display: none; right:-10px; top:40px; width:320px; padding:0; max-height:400px; overflow-y:auto; cursor:default;" onclick="event.stopPropagation()">
                    <div class="notif-header" style="padding:15px; font-weight:bold; border-bottom:1px solid #E0E0E0; position:sticky; top:0; background:var(--bg-white); z-index:10;">Notifications</div>
                    <div id="notif-list"><div class="loading" style="font-size:12px; padding: 15px;">Loading...</div></div>
                </div>
            </div>
            <div style="display:flex; align-items:center; gap: 10px; cursor:pointer;" onclick="toggleDropdown(event)">
                <span style="font-weight:600; font-size:14px;">${user.displayName}</span><span id="topbar-rank-badge" style="display:inline-flex; align-items:center; margin-left:2px;"></span>
                <img src="${avatarUrl}" alt="User" class="avatar">
                <span class="material-symbols-outlined" style="font-size:18px;">expand_more</span>
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
        window.updateTopbarRank();
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

window.onclick = function() {
    const dd = document.getElementById('profile-dropdown');
    if (dd && dd.style.display === 'block') dd.style.display = 'none';
    const nd = document.getElementById('notification-dropdown');
    if (nd && nd.style.display === 'block') nd.style.display = 'none';
};

window.fetchNotifications = async function() {
    if(!auth.currentUser) return;
    try {
        const q = query(collection(db, "notifications"), where("targetUid", "==", auth.currentUser.uid));
        const snap = await getDocs(q);
        const list = document.getElementById('notif-list');
        const badge = document.getElementById('notif-badge');
        if(!list || !badge) return;
        
        let notifs = [];
        snap.forEach(d => notifs.push({ ...d.data(), id: d.id }));
        notifs.sort((a,b) => b.timestamp - a.timestamp); 
        notifs = notifs.slice(0, 20); 
        
        list.innerHTML = '';
        let unreadCount = 0;
        window.unreadNotifDocs = [];
        
        if(notifs.length === 0) {
            list.innerHTML = '<div style="padding:15px; text-align:center; color:var(--text-muted); font-size:13px;">No new notifications.</div>';
            badge.style.display = 'none';
            return;
        }

        notifs.forEach(n => {
            if(!n.read) { unreadCount++; window.unreadNotifDocs.push(n.id); }
            let onClickAction = n.type === 'suggestion' && n.linkRef ? `onclick="loadAnimeDetails(${n.linkRef})"` : `onclick="viewUserProfile('${n.senderUid}')"`;
            const dateStr = n.timestamp?.toDate ? new Date(n.timestamp.toDate()).toLocaleDateString() : new Date().toLocaleDateString();

            list.innerHTML += `
                <div class="notif-item ${n.read ? '' : 'unread'}" style="cursor:pointer;" ${onClickAction}>
                    <img src="${n.senderAvatar || 'https://via.placeholder.com/40'}">
                    <div class="notif-content">
                        <p class="notif-text"><strong>${n.senderName}</strong> ${n.message}</p>
                        <span class="notif-time">${dateStr}</span>
                    </div>
                </div>
            `;
        });

        if(unreadCount > 0) { badge.innerText = unreadCount; badge.style.display = 'flex'; } 
        else { badge.style.display = 'none'; }
    } catch(e) { console.error("Notif error", e); }
};

window.closeAllModals = function() { document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none'); };

window.fetchMyFollows = async function() {
    if (!auth.currentUser) { window.myFollowedUserIds.clear(); return; }
    try {
        const snap = await getDocs(query(collection(db, "follows"), where("followerUid", "==", auth.currentUser.uid), where("type", "==", "user")));
        window.myFollowedUserIds.clear();
        snap.forEach(d => window.myFollowedUserIds.add(d.data().targetId));
    } catch(e) {}
};

window.getFollowBtnHTML = function(uid) {
    if (!uid || !auth.currentUser || uid === auth.currentUser.uid) return '';
    if (window.myFollowedUserIds.has(uid)) {
        return `<button onclick="event.stopPropagation(); toggleFollow('${uid}', 'user', this)" class="action-btn" style="padding:4px 10px; font-size:11px; background:var(--bg-gray-darker); color:var(--text-dark);"><span class="material-symbols-outlined" style="font-size:14px;">check</span> Following</button>`;
    }
    return `<button onclick="event.stopPropagation(); toggleFollow('${uid}', 'user', this)" class="action-btn" style="padding:4px 10px; font-size:11px;"><span class="material-symbols-outlined" style="font-size:14px;">person_add</span> Follow</button>`;
};
window.openAuthModal = function() { window.closeAllModals(); document.getElementById('auth-modal').style.display = 'flex'; };

window.openSettingsModal = function() {
    document.getElementById('profile-dropdown').style.display = 'none';
    window.closeAllModals();
    document.getElementById('settings-modal').style.display = 'flex';
    document.getElementById('dark-mode-toggle').checked = document.body.getAttribute('data-theme') === 'dark';
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

window.openReviewModal = function() {
    if (!auth.currentUser) return window.openAuthModal();
    window.closeAllModals();
    document.getElementById('choice-modal').style.display = 'flex';
};

window.openQuickScoreModal = function() {
    window.closeAllModals();
    document.getElementById('quick-score-value').value = '';
    document.getElementById('quick-fanservice-value').value = '';
    document.getElementById('quick-score-text').value = '';
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
    const overallScore = (scored.reduce((sum, c) => sum + c.score, 0) / scored.length).toFixed(1);
    const fanService = parseFloat(document.getElementById('in-depth-fanservice-value').value) || null;
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
        setDoc(doc(db, "profiles", auth.currentUser.uid), { reviewCount: increment(1), displayName: auth.currentUser.displayName, avatar: _avId }, { merge: true }).catch(() => {});
        const _tb = document.getElementById('topbar-rank-badge');
        if (_tb) _tb.innerHTML = window.getRankBadgeHTML(window.myReviewCount, 16);
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
    try {
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
            const userCred = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(userCred.user, { displayName: username, photoURL: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(username)}&backgroundColor=ffc107&fontColor=333333` });
            
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
window.logoutUser = function() { if(confirm("Are you sure you want to log out?")) signOut(auth); };

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
        const uName = document.querySelector('.profile-header h1')?.innerText || 'User';
        const uImg = document.querySelector('.profile-avatar-large')?.src || `https://api.dicebear.com/9.x/initials/svg?seed=${targetId}`;
        extraData.username = uName;
        extraData.avatar = uImg;
    }

    if(snap.empty) {
        await addDoc(collection(db, "follows"), { followerUid: auth.currentUser.uid, targetId: targetId, type: type, ...extraData });
        btnElement.innerHTML = `<span class="material-symbols-outlined">check</span> Following`; btnElement.style.backgroundColor = "var(--bg-gray-darker)";
        if(type === 'user') window.myFollowedUserIds.add(targetId);
        
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
        if(type === 'user') window.myFollowedUserIds.delete(targetId);
    }
};

// --- MASTER LIST SYSTEM ---
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
    let watched = parseInt(document.getElementById('list-entry-watched').value) || 0;

    if (totalEps > 0 && watched > totalEps) watched = totalEps;
    if (status === 'completed' && totalEps > 0) watched = totalEps;

    const entryData = {
        uid: auth.currentUser.uid, mal_id, title, image: img, 
        status, score, fanService, watchedEpisodes: watched, totalEpisodes: totalEps, 
        timestamp: new Date()
    };

    try {
        if(docId) {
            await updateDoc(doc(db, "anime_lists", docId), entryData);
        } else {
            await addDoc(collection(db, "anime_lists"), entryData);
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
        
        let editHtml = isMyProfile ? `<button class="action-btn" style="padding:6px; min-width:unset; margin:0 auto;" onclick="selectAnimeForList(${anime.mal_id}, '${safeTitle}', '${anime.image}', ${anime.totalEpisodes})"><span class="material-symbols-outlined" style="font-size:18px;">edit</span></button>` : '';

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
        if(type === 'like') { if(likes.includes(auth.currentUser.uid)) likes = likes.filter(id => id !== auth.currentUser.uid); else { likes.push(auth.currentUser.uid); dislikes = dislikes.filter(id => id !== auth.currentUser.uid); } }
        else { if(dislikes.includes(auth.currentUser.uid)) dislikes = dislikes.filter(id => id !== auth.currentUser.uid); else { dislikes.push(auth.currentUser.uid); likes = likes.filter(id => id !== auth.currentUser.uid); } }
        await updateDoc(reviewRef, { likes, dislikes });
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
                        <strong class="clickable-user" onclick="event.stopPropagation(); viewUserProfile('${safeUid}')">${rev.username}</strong> ${window.getRankBadgeHTML(window.userRankCache[safeUid] || 0, 14)}
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
            rev.categories.forEach(cat => {
                badgesHTML += `<div style="display:flex; flex-direction:column; align-items:center; width: 75px;"><span style="font-size: 10px; font-weight: 600; margin-bottom: 8px; text-align: center; height: 24px; display: flex; align-items: flex-end;">${cat.label}</span><div class="rating-badge ${window.getScoreTier(cat.score)}" style="width: 55px; height: 55px; font-size: 18px;">${cat.score}</div></div>`;
            });
            badgesHTML += `</div>`;

            fullHTML = `<div class="full-review-content" style="display:none; margin-top: 25px; padding-right: 170px; position: relative; z-index: 2;">`;
            rev.categories.forEach(cat => { 
                fullHTML += `<div style="background: var(--bg-white); padding: 12px; border-radius: 10px; border: 1px solid #E0E0E0; margin-bottom: 10px;"><div style="display: flex; justify-content: space-between; align-items: center;"><strong>${cat.label}</strong><div class="rating-badge ${window.getScoreTier(cat.score)}" style="width: 32px; height: 32px; font-size: 11px;">${cat.score}</div></div><p style="font-size: 13px; margin-top: 8px; border-top: 1px solid #F0F0F0; padding-top: 8px;">${cat.text || 'No comments.'}</p></div>`; 
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
                    <div><strong><span class="clickable-user" style="color:var(--text-dark);" onclick="event.stopPropagation(); viewUserProfile('${safeUid}')">${rev.username}</span></strong> ${window.getRankBadgeHTML(window.userRankCache[safeUid] || 0, 14)} <span class="source-badge badge-weebee">WeeBee</span><br>
                    <span style="font-size: 12px; color: var(--text-muted); display:flex; align-items:center; gap:6px; margin-top:3px;">${rev.animeImage ? `<img src="${rev.animeImage}" class="review-cover-mobile" onclick="event.stopPropagation(); loadAnimeDetails(${rev.mal_id})">` : ''}Reviewed: <strong style="cursor:pointer; color:var(--text-dark);" onclick="event.stopPropagation(); loadAnimeDetails(${rev.mal_id})">${rev.animeTitle}</strong></span></div>
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
            ${rev.type === 'in-depth' ? '<div class="expand-hint-row"><span class="expand-hint">Tap to expand ›</span></div>' : ''}
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

window.switchProfileTab = function(event, tabId) {
    document.querySelectorAll('.profile-main-feed .p-tab-content').forEach(c => c.style.display = 'none');
    document.querySelectorAll('.profile-main-feed .p-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(tabId).style.display = 'block';
    event.currentTarget.classList.add('active');
};

window.fetchUserProfile = async function(targetUid = null) {
    const isMe = !targetUid || (auth.currentUser && targetUid === auth.currentUser.uid);
    const uidToFetch = isMe ? auth.currentUser?.uid : targetUid;
    if(!uidToFetch) return window.openAuthModal();
    
    document.getElementById('profile-header-container').innerHTML = '<div class="loading">Loading Profile...</div>';
    
    let pName = 'WeeBee User';
    let pAvatar = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent('WeeBee User')}&backgroundColor=ffc107&fontColor=333333`;
    let pJoined = new Date().toLocaleDateString();

    if(isMe && auth.currentUser) {
        pName = auth.currentUser.displayName;
        pAvatar = auth.currentUser.photoURL || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(auth.currentUser.displayName)}&backgroundColor=ffc107&fontColor=333333`;
        pJoined = new Date(auth.currentUser.metadata.creationTime).toLocaleDateString();
    } else {
        const checkQ = query(collection(db, "reviews"), where("uid", "==", uidToFetch), limit(1));
        const checkSnap = await getDocs(checkQ);
        if(!checkSnap.empty) {
            pName = checkSnap.docs[0].data().username || pName;
            pAvatar = checkSnap.docs[0].data().avatar || pAvatar;
        }
    }

    document.getElementById('top-anime-title').innerText = `${pName}'s Top Anime`;

    const editBtnHtml = isMe ? `<button class="action-btn" style="background:#EEE; color:#555;">Edit Profile</button>` : `<button onclick="toggleFollow('${uidToFetch}', 'user', this)" class="action-btn"><span class="material-symbols-outlined">person_add</span> Follow User</button>`;

    document.getElementById('profile-header-container').innerHTML = `
        <div class="profile-header">
            <img src="${pAvatar}" class="profile-avatar-large" onerror="this.src='https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(pName)}&backgroundColor=ffc107&fontColor=333333'">
            <div style="flex:1;">
                <h1 style="font-size: 32px; margin-bottom: 5px;">${pName}</h1>
                <p style="color: var(--text-muted); font-size: 14px;">WeeBee Member since ${pJoined}</p>
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
            const uName = f.username || 'User ' + f.targetId.substring(0,6);
            const uImg = f.avatar || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(uName)}&backgroundColor=ffc107&fontColor=333333`;
            fUserList.innerHTML += `<div class="user-chip clickable-user" onclick="viewUserProfile('${f.targetId}')"><img src="${uImg}" onerror="this.style.display='none'"> <span>${uName}</span></div>`;
        }
    });
    if(!hasAnime) fAnimeList.parentElement.innerHTML = '<h5>Following Anime</h5><p class="empty-msg" style="color:var(--text-muted); font-size:13px;">Not following any anime yet.</p>';
    if(!hasUser) fUserList.innerHTML = '<p class="empty-msg" style="color:var(--text-muted); font-size:13px;">Not following any users yet.</p>';

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

window.fetchProfileComments = async function(ownerId) {
    const feed = document.getElementById('profile-comments-feed');
    const q = query(collection(db, "profile_comments"), where("profileOwnerId", "==", ownerId), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    feed.innerHTML = '';
    if(snap.empty) { feed.innerHTML = '<p class="empty-msg" style="color:var(--text-muted);">No messages on this profile yet.</p>'; return; }
    snap.forEach(doc => {
        const c = doc.data();
        feed.innerHTML += `<div style="display:flex; gap:12px; padding:15px; background:var(--bg-white); border:1px solid #F0F0F0; border-radius:10px; margin-bottom:10px;"><img src="${c.authorAvatar}" class="clickable-user" onclick="viewUserProfile('${c.uid}')" style="width:40px; height:40px; border-radius:50%; object-fit:cover;"><div><strong class="clickable-user" onclick="viewUserProfile('${c.uid}')" style="font-size:14px;">${c.authorName}</strong><p style="font-size:14px; margin-top:4px; line-height:1.4;">${c.text}</p></div></div>`;
    });
};

// --- Home Feed & News from Follows ---
window.fetchHomepageReviews = async function() {
    try {
        const q = query(collection(db, "reviews"), orderBy("timestamp", "desc"), limit(20));
        const snap = await getDocs(q);
        const uids = []; snap.forEach(d => { if(d.data().uid) uids.push(d.data().uid); });
        await window.prefetchRankCache(uids);
        const feed = document.getElementById('review-feed'); feed.innerHTML = '';
        snap.forEach(d => feed.innerHTML += window.generateReviewCardHTML({ ...d.data(), id: d.id }));
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

window.fetchGlobalNews = async function() {
    const container = document.getElementById('global-news-feed'); container.innerHTML = '<div class="loading">Sourcing latest headlines...</div>';
    try {
        const trendingRes = await fetch('https://api.jikan.moe/v4/seasons/now?limit=3'); const { data: trending } = await trendingRes.json();
        let allNews = [];
        for (const anime of trending) { const newsRes = await fetch(`https://api.jikan.moe/v4/anime/${anime.mal_id}/news`); const { data: news } = await newsRes.json(); if(news) allNews = [...allNews, ...news.slice(0, 4)]; }
        container.innerHTML = '';
        allNews.forEach(item => { container.innerHTML += `<div class="news-card"><img src="${item.images?.jpg?.image_url || 'https://via.placeholder.com/400x200?text=Anime+News'}"><div class="news-content"><h3>${item.title}</h3><p>${item.excerpt}</p><div class="news-footer"><span>${new Date(item.date).toLocaleDateString()}</span><a href="${item.url}" target="_blank" class="news-link">Read Full</a></div></div></div>`; });
    } catch(e) { container.innerHTML = '<p>Failed to load news.</p>'; }
};

// --- NEW DISCOVER PAGE LOGIC (PODIUM UPDATE) ---
window.fetchDiscoverPage = async function() {
    const top10Container = document.getElementById('weebee-top10-container');
    const lbContainer = document.getElementById('reviewer-leaderboard-container');
    top10Container.innerHTML = '<div class="loading">Calculating WeeBee scores...</div>';
    if (lbContainer) lbContainer.innerHTML = '<div class="loading">Loading...</div>';
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

        let top10 = Object.values(animeStats).filter(a => a.title).map(a => ({ ...a, avgScore: (a.totalScore / a.count).toFixed(1) })).sort((a, b) => b.avgScore - a.avgScore).slice(0, 10);
        
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

            // Record new top-3 achievements (only writes when a new milestone is hit)
            const histUpdates = [];
            [['hasBeenFirst', 'firstDate', 0], ['hasBeenSecond', 'secondDate', 1], ['hasBeenThird', 'thirdDate', 2]].forEach(([flag, dateField, i]) => {
                if (top10[i] && !historyMap[top10[i].mal_id][flag]) {
                    const now = new Date();
                    historyMap[top10[i].mal_id][flag] = true;
                    historyMap[top10[i].mal_id][dateField] = now;
                    histUpdates.push(setDoc(doc(db, "rankHistory", String(top10[i].mal_id)), { [flag]: true, [dateField]: now }, { merge: true }));
                }
            });
            if (histUpdates.length) Promise.all(histUpdates).catch(() => {});

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

            // #2 — Left
            if (top10[1]) {
                html += `
                    <div class="podium-item podium-2" onclick="loadAnimeDetails(${top10[1].mal_id})">
                        ${getHistBadges(top10[1].mal_id)}
                        <div class="podium-rank-change">${getRankChange(top10[1].mal_id)}</div>
                        <img src="${top10[1].image}" alt="${top10[1].title}">
                        <h4>${top10[1].title}</h4>
                        <div class="rating-badge tier-silver" style="width:38px;height:38px;font-size:13px;">${top10[1].avgScore}</div>
                        <div class="podium-step step-2">2</div>
                    </div>`;
            }

            // #1 — Center (elevated)
            if (top10[0]) {
                html += `
                    <div class="podium-item podium-1" onclick="loadAnimeDetails(${top10[0].mal_id})">
                        ${getHistBadges(top10[0].mal_id)}
                        <div class="podium-rank-change">${getRankChange(top10[0].mal_id)}</div>
                        <img src="${top10[0].image}" alt="${top10[0].title}">
                        <h4>${top10[0].title}</h4>
                        <div class="rating-badge tier-royal" style="width:48px;height:48px;font-size:16px;">${top10[0].avgScore}</div>
                        <div class="podium-step step-1">1</div>
                    </div>`;
            }

            // #3 — Right
            if (top10[2]) {
                html += `
                    <div class="podium-item podium-3" onclick="loadAnimeDetails(${top10[2].mal_id})">
                        ${getHistBadges(top10[2].mal_id)}
                        <div class="podium-rank-change">${getRankChange(top10[2].mal_id)}</div>
                        <img src="${top10[2].image}" alt="${top10[2].title}">
                        <h4>${top10[2].title}</h4>
                        <div class="rating-badge tier-bronze" style="width:38px;height:38px;font-size:13px;">${top10[2].avgScore}</div>
                        <div class="podium-step step-3">3</div>
                    </div>`;
            }

            html += '</div>';

            // List 4-10
            if (top10.length > 3) {
                html += '<div class="top10-list-container">';
                for (let i = 3; i < top10.length; i++) {
                    const anime = top10[i];
                    html += `
                        <div class="top10-list-item" onclick="loadAnimeDetails(${anime.mal_id})">
                            <div class="list-rank-number">${i + 1}</div>
                            <div class="rank-change-col">${getRankChange(anime.mal_id)}</div>
                            <img src="${anime.image}" alt="${anime.title}">
                            <div style="flex:1; min-width:0;">
                                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                                    <h3 style="margin-bottom:2px; font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${anime.title}</h3>
                                    ${getHistBadges(anime.mal_id, true)}
                                </div>
                                <p style="font-size:12px; color:var(--text-muted);">${anime.count} WeeBee Review${anime.count !== 1 ? 's' : ''}</p>
                            </div>
                            <div class="rating-badge blue" style="width:42px;height:42px;font-size:14px;flex-shrink:0;">${anime.avgScore}</div>
                        </div>
                    `;
                }
                html += '</div>';
            }

            top10Container.innerHTML = html;
        }

        // Render leaderboard
        if (lbContainer) {
            const leaderboard = Object.values(reviewerMap).sort((a, b) => b.count - a.count).slice(0, 10);
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
                                <div style="font-weight:600; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${reviewer.displayName}</div>
                                <div style="font-size:12px; color:var(--text-muted);">${reviewer.count} review${reviewer.count !== 1 ? 's' : ''}</div>
                            </div>
                            ${window.getRankBadgeHTML(reviewer.count, 22)}
                        </div>`;
                }).join('');
            }
        }
    } catch(e) { top10Container.innerHTML = '<p>Failed to calculate WeeBee Top 10.</p>'; if(lbContainer) lbContainer.innerHTML = ''; console.error(e); }

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

    await fetchAndRenderCarousel('https://api.jikan.moe/v4/seasons/now?limit=15', 'discover-trending-carousel'); await new Promise(r => setTimeout(r, 500));
    await fetchAndRenderCarousel('https://api.jikan.moe/v4/seasons/upcoming?limit=15', 'discover-upcoming-carousel'); await new Promise(r => setTimeout(r, 500));
    await fetchAndRenderCarousel('https://api.jikan.moe/v4/anime?genres=1&order_by=score&sort=desc&limit=15', 'discover-action-carousel'); await new Promise(r => setTimeout(r, 500));
    await fetchAndRenderCarousel('https://api.jikan.moe/v4/anime?genres=22&order_by=score&sort=desc&limit=15', 'discover-romance-carousel'); await new Promise(r => setTimeout(r, 500));
    await fetchAndRenderCarousel('https://api.jikan.moe/v4/anime?genres=4&order_by=score&sort=desc&limit=15', 'discover-comedy-carousel');
}

async function fetchAndRenderCarousel(url, containerId) {
    const container = document.getElementById(containerId); if(!container) return;
    try {
        const res = await fetch(url); const { data } = await res.json(); container.innerHTML = '';
        if(!data || data.length === 0) { container.innerHTML = '<p class="empty-msg" style="color:var(--text-muted);">No anime found.</p>'; return; }
        data.forEach(anime => { container.innerHTML += `<div class="anime-card" onclick="loadAnimeDetails(${anime.mal_id})"><img src="${anime.images.jpg.image_url}"><p>${anime.title_english || anime.title}</p></div>`; });
    } catch(e) { container.innerHTML = '<p style="color:red; font-size:12px;">Failed to load category.</p>'; }
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
    ['discover-reviewers-section','discover-friends-section','discover-trending-section',
     'discover-upcoming-section','discover-action-section','discover-romance-section',
     'discover-comedy-section'].forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
    
    try {
        const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(queryStr)}&limit=10`);
        if (!res.ok) throw new Error(`Jikan returned ${res.status}`);
        const json = await res.json();
        const data = json.data;
        if (!Array.isArray(data)) throw new Error('Unexpected response format');

        let html = '<div class="top10-list-container">';
        if (data.length === 0) { html = '<p style="color:var(--text-muted); text-align:center;">No anime found matching your search.</p>'; }
        else {
            data.forEach(anime => {
                html += `
                    <div class="top10-list-item" onclick="loadAnimeDetails(${anime.mal_id})">
                        <img src="${anime.images.jpg.image_url}">
                        <div style="flex:1; min-width:0;">
                            <h3 style="margin-bottom:4px; font-size:16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${anime.title_english || anime.title}">${anime.title_english || anime.title}</h3>
                            <p style="font-size:12px; color:var(--text-muted);">${anime.type}, ${anime.year || 'N/A'}</p>
                        </div>
                        <div class="rating-badge blue" style="width:40px; height:40px; font-size:14px; flex-shrink:0;">${anime.score || 'N/A'}</div>
                    </div>`;
            });
        }
        html += '</div>';
        top10Container.innerHTML = html;

    } catch(e) {
        top10Container.innerHTML = '<p style="color:var(--text-muted); text-align:center;">Search failed — Jikan may be busy. Try again in a moment.</p>';
        console.error(e);
    }
};

// --- Navigation ---
window.switchView = function(targetId, isSearch = false) {
    window.closeMobileMenu?.();
    window.closeMobileSearch?.();
    if(targetId !== 'anime-detail-view') window.previousViewId = targetId;
    if(targetId !== 'profile-view') window.targetProfileUid = null;
    
    document.querySelectorAll(".nav-btn").forEach(btn => { btn.classList.remove("active"); if(btn.getAttribute("data-target") === targetId) btn.classList.add("active"); });
    document.querySelectorAll(".view").forEach(view => view.classList.remove("active"));
    document.getElementById(targetId).classList.add("active");
    document.querySelector('.main-content').scrollTo(0,0);
    
    if(targetId === 'home-view') fetchHomepageReviews();
    if(targetId === 'news-view') fetchGlobalNews();
    if(targetId === 'profile-view') fetchUserProfile(window.targetProfileUid);
    if(targetId === 'my-list-view') fetchMyList(); 
    if(targetId === 'discover-view' && !isSearch) {
        document.querySelector('#discover-view h2').innerText = "WeeBee's Top 10 All Time";
        document.querySelector('#discover-view p').innerText = "Ranked purely by WeeBee community scores";
        ['discover-reviewers-section','discover-friends-section','discover-trending-section',
         'discover-upcoming-section','discover-action-section','discover-romance-section',
         'discover-comedy-section'].forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'block'; });
        fetchDiscoverPage();
    }
};

window.goBack = function() { switchView(window.previousViewId); };

// --- ANIME DETAIL SYSTEM ---
window.loadAnimeDetails = async function(mal_id) {
    window.currentAnimeId = mal_id; switchView('anime-detail-view');
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
    if (rankHist.hasBeenFirst || rankHist.hasBeenSecond || rankHist.hasBeenThird) {
        let badges = '';
        const d1 = fmtRankDate(rankHist.firstDate), d2 = fmtRankDate(rankHist.secondDate), d3 = fmtRankDate(rankHist.thirdDate);
        if (rankHist.hasBeenFirst) badges += `<div class="detail-rank-badge hist-gem-badge" data-tooltip="${d1 ? `Reached #1 on ${d1}` : 'Has reached #1 on WeeBee'}"><span class="material-symbols-outlined">diamond</span>#1 on WeeBee</div>`;
        if (rankHist.hasBeenSecond) badges += `<div class="detail-rank-badge hist-silver-badge" data-tooltip="${d2 ? `Reached #2 on ${d2}` : 'Has reached #2 on WeeBee'}"><span class="material-symbols-outlined">military_tech</span>#2 on WeeBee</div>`;
        if (rankHist.hasBeenThird) badges += `<div class="detail-rank-badge hist-bronze-badge" data-tooltip="${d3 ? `Reached #3 on ${d3}` : 'Has reached #3 on WeeBee'}"><span class="material-symbols-outlined">military_tech</span>#3 on WeeBee</div>`;
        rankHistoryHTML = `<div class="detail-rank-badges">${badges}</div>`;
    }

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
            <button onclick="toggleFollow(${mal_id}, 'anime', this)" class="action-btn" style="width:100%; justify-content:center; margin-bottom: 10px;">Follow Anime</button>
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
    const saved = localStorage.getItem('weebee-theme') || 'light';
    document.body.setAttribute('data-theme', saved);

    const loadTrending = async () => {
        try {
            const r = await fetch('https://api.jikan.moe/v4/seasons/now?limit=15'); const d = await r.json();
            const c = document.getElementById('trending-carousel'); c.innerHTML = '';
            if(d.data) d.data.forEach(a => c.innerHTML += `<div class="anime-card" onclick="loadAnimeDetails(${a.mal_id})"><img src="${a.images.jpg.image_url}"><p>${a.title_english || a.title}</p></div>`);
        } catch(e) { console.error("Trending error:", e); }
    };
    loadTrending(); fetchHomepageReviews();
};