import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, where, deleteDoc, doc, orderBy, limit, updateDoc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
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

window.currentActiveViewId = 'home-view';
window.previousViewId = 'home-view';
window.currentAnime = null; 
window.currentAnimeId = null;
window.pendingInDepthData = null; 
window.isSignUpMode = false; 

// --- LIST STATE ---
window.myAnimeList = [];
window.currentListTab = 'all';
window.currentListSort = { key: 'score', desc: true };
window.currentListEntryTotalEps = 0; 
window.currentAnimeEpisodes = []; 

// --- Authentication & Dropdown ---
onAuthStateChanged(auth, (user) => {
    const authSection = document.getElementById('user-auth-section');
    if (user) {
        const avatarUrl = user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.displayName}`;
        authSection.innerHTML = `
            <span class="material-symbols-outlined">notifications</span>
            <div style="display:flex; align-items:center; gap: 10px; cursor:pointer;" onclick="toggleDropdown(event)">
                <span style="font-weight:600; font-size:14px;">${user.displayName}</span>
                <img src="${avatarUrl}" alt="User" class="avatar">
                <span class="material-symbols-outlined" style="font-size:18px;">expand_more</span>
            </div>
            <div id="profile-dropdown" class="dropdown-menu" style="display: none;">
                <div class="dropdown-item" onclick="switchView('profile-view')"><span class="material-symbols-outlined">person</span> My Profile</div>
                <div class="dropdown-item"><span class="material-symbols-outlined">settings</span> Settings</div>
                <div class="dropdown-divider"></div>
                <div class="dropdown-item logout" onclick="logoutUser()"><span class="material-symbols-outlined">logout</span> Sign Out</div>
            </div>
        `;
        fetchMyList(); 
    } else {
        authSection.innerHTML = `<button class="action-btn" onclick="openAuthModal()"><span class="material-symbols-outlined">login</span> Sign In</button>`;
        if(window.currentActiveViewId === 'profile-view' || window.currentActiveViewId === 'my-list-view') switchView('home-view');
        window.myAnimeList = [];
    }
});

window.toggleDropdown = function(e) {
    e.stopPropagation(); 
    const dd = document.getElementById('profile-dropdown');
    dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
};

window.onclick = function() {
    const dd = document.getElementById('profile-dropdown');
    if (dd && dd.style.display === 'block') dd.style.display = 'none';
};

window.openAuthModal = function() { window.closeAllModals(); document.getElementById('auth-modal').style.display = 'flex'; };
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
            await updateProfile(userCred.user, { displayName: username, photoURL: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}` });
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
    if(snap.empty) {
        await addDoc(collection(db, "follows"), { followerUid: auth.currentUser.uid, targetId: targetId, type: type });
        btnElement.innerHTML = `<span class="material-symbols-outlined">check</span> Following`; btnElement.style.backgroundColor = "var(--bg-gray-darker)";
    } else {
        await deleteDoc(doc(db, "follows", snap.docs[0].id));
        btnElement.innerHTML = type === 'anime' ? `<span class="material-symbols-outlined">bookmark_add</span> Follow Anime` : `<span class="material-symbols-outlined">person_add</span> Follow`;
        btnElement.style.backgroundColor = "var(--accent-yellow)";
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
        if(window.currentActiveViewId === 'profile-view') fetchUserProfile(); 
    } catch(e) { alert("Failed to save entry"); console.error(e); }
};

window.deleteListEntry = async function(docId) {
    if(!confirm("Remove this anime from your list?")) return;
    try {
        await deleteDoc(doc(db, "anime_lists", docId));
        window.closeAllModals();
        fetchMyList();
        if(window.currentActiveViewId === 'profile-view') fetchUserProfile();
    } catch(e) { alert("Failed to remove entry"); }
};

window.fetchMyList = async function() {
    if(!auth.currentUser) return;
    const q = query(collection(db, "anime_lists"), where("uid", "==", auth.currentUser.uid));
    const snap = await getDocs(q);
    window.myAnimeList = [];
    snap.forEach(d => window.myAnimeList.push({ ...d.data(), id: d.id }));
    renderAnimeList();
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

    rankedList.forEach(anime => {
        const safeTitle = anime.title.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        
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
                <td style="text-align:center;">
                    <button class="action-btn" style="padding:6px; min-width:unset; margin:0 auto;" onclick="selectAnimeForList(${anime.mal_id}, '${safeTitle}', '${anime.image}', ${anime.totalEpisodes})">
                        <span class="material-symbols-outlined" style="font-size:18px;">edit</span>
                    </button>
                </td>
            </tr>
        `;
    });
};

// --- Ranked Top Anime Editing System ---
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
        fetchUserProfile(); 
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
                select.innerHTML += `<option value="${d.data().targetId}">User ID: ${d.data().targetId.substring(0,8)}...</option>`;
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
        html += `<div style="display:flex; gap:10px; margin-bottom: 10px; background: var(--bg-white); padding: 10px; border-radius: 8px; border: 1px solid #E0E0E0;"><img src="${c.avatar}" style="width:30px; height:30px; border-radius:50%; object-fit:cover;"><div style="flex: 1;"><strong style="font-size:12px;">${c.username}</strong><p style="font-size:12px; margin-top:2px;">${c.text}</p><div style="display: flex; gap: 15px; margin-top: 6px; font-size: 11px;"><div style="display:flex; align-items:center; gap: 4px; cursor:pointer; ${likeStyle}" onclick="toggleCommentReaction(event, '${id}', 'like', this)"><span class="material-symbols-outlined" style="font-size: 14px;">thumb_up</span> <span class="c-like-count">${c.likes?.length || 0}</span></div><div style="display:flex; align-items:center; gap: 4px; cursor:pointer; ${dislikeStyle}" onclick="toggleCommentReaction(event, '${id}', 'dislike', this)"><span class="material-symbols-outlined" style="font-size: 14px;">thumb_down</span> <span class="c-dislike-count">${c.dislikes?.length || 0}</span></div></div></div></div>`;
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

    if(rev.type === 'suggestion') {
        innerContent = `
            <img src="${rev.animeImage}" class="review-anime-thumb" alt="Cover" style="cursor:pointer;" onclick="event.stopPropagation(); loadAnimeDetails(${rev.mal_id})">
            <div class="review-header" style="justify-content: space-between; position: relative; z-index: 3;">
                <div style="display:flex; gap: 15px;">
                    <img src="${rev.avatar}" class="avatar">
                    <div>
                        <strong>${rev.username}</strong> 
                        <span class="source-badge" style="background: #4CAF50; color: white; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; text-transform: uppercase;">Suggestion</span><br>
                        <span style="font-size: 12px; color: var(--text-muted);">Suggested: <strong style="cursor:pointer; color:var(--text-dark);" onclick="event.stopPropagation(); loadAnimeDetails(${rev.mal_id})">${rev.animeTitle}</strong></span>
                    </div>
                </div>
                <button onclick="event.stopPropagation(); toggleFollow('${rev.uid}', 'user', this)" class="action-btn" style="padding: 4px 10px; font-size: 11px;"><span class="material-symbols-outlined" style="font-size:14px;">person_add</span> Follow</button>
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
            badgesHTML = '<div style="display:flex; gap: 15px; margin-top: 20px; flex-wrap: wrap; justify-content: flex-start; align-items: flex-end; padding-right: 170px; position: relative; z-index: 2;">';
            rev.categories.forEach(cat => { 
                badgesHTML += `<div style="display:flex; flex-direction:column; align-items:center; width: 75px;"><span style="font-size: 10px; font-weight: 600; margin-bottom: 8px; text-align: center; height: 24px; display: flex; align-items: flex-end;">${cat.label}</span><div class="rating-badge ${window.getScoreTier(cat.score)}" style="width: 55px; height: 55px; font-size: 18px;">${cat.score}</div></div>`; 
            }); 
            badgesHTML += `
                <div style="width: 1px; height: 45px; background: #E0E0E0; margin: 0 10px; align-self: flex-end; margin-bottom: 5px;"></div>
                <div style="display:flex; flex-direction:column; align-items:center; width: 75px;">
                    <span style="font-size: 10px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px; height: 24px; display: flex; align-items: flex-end;">Overall</span>
                    <div class="rating-badge ${overallTier}" style="width: 55px; height: 55px; font-size: 18px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));">${overallScore}</div>
                </div></div>`;

            fullHTML = `<div class="full-review-content" style="display:none; margin-top: 25px; padding-right: 170px; position: relative; z-index: 2;">`;
            rev.categories.forEach(cat => { 
                fullHTML += `<div style="background: var(--bg-white); padding: 12px; border-radius: 10px; border: 1px solid #E0E0E0; margin-bottom: 10px;"><div style="display: flex; justify-content: space-between; align-items: center;"><strong>${cat.label}</strong><div class="rating-badge ${window.getScoreTier(cat.score)}" style="width: 32px; height: 32px; font-size: 11px;">${cat.score}</div></div><p style="font-size: 13px; margin-top: 8px; border-top: 1px solid #F0F0F0; padding-top: 8px;">${cat.text || 'No comments.'}</p></div>`; 
            }); 
            fullHTML += `</div>`;
        } else {
            badgesHTML = `
                <div style="display:flex; padding-right: 170px; margin-top: 15px; position: relative; z-index: 2;">
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
                    <img src="${rev.avatar}" class="avatar">
                    <div><strong>${rev.username}</strong> <span class="source-badge badge-weebee">WeeBee</span><br>
                    <span style="font-size: 12px; color: var(--text-muted);">Reviewed: <strong style="cursor:pointer;" onclick="event.stopPropagation(); loadAnimeDetails(${rev.mal_id})">${rev.animeTitle}</strong></span></div>
                </div>
                <button onclick="event.stopPropagation(); toggleFollow('${rev.uid}', 'user', this)" class="action-btn" style="padding: 4px 10px; font-size: 11px;"><span class="material-symbols-outlined" style="font-size:14px;">person_add</span> Follow</button>
            </div>
            ${badgesHTML}
            ${fullHTML}
        `;
    }

    return `
        <div class="review-card weebee-review interactive review-item" onclick="${rev.type === 'in-depth' ? 'toggleReviewExpand(this)' : ''}">
            ${innerContent}
            <div class="review-actions">
                <div class="action-stat"><button onclick="window.toggleComments(event, '${rev.id}')"><span class="material-symbols-outlined">chat_bubble</span></button><span id="comment-count-${rev.id}">${rev.commentCount || 0} Comments</span></div>
                <div class="action-stat"><button onclick="window.toggleReaction(event, '${rev.id}', 'like', this)"><span class="material-symbols-outlined">thumb_up</span></button><span>${rev.likes?.length || 0} Likes</span></div>
                <div class="action-stat"><button onclick="window.toggleReaction(event, '${rev.id}', 'dislike', this)"><span class="material-symbols-outlined">thumb_down</span></button><span>${rev.dislikes?.length || 0} Dislikes</span></div>
            </div>
            <div id="comments-container-${rev.id}" class="inline-comments" style="display:none; margin-top: 15px; padding-top: 15px; position: relative; z-index: 2;" onclick="event.stopPropagation();">
                <div id="comments-list-${rev.id}"></div>
                <div style="display:flex; gap:10px; margin-top:10px;">
                    <input type="text" id="comment-input-${rev.id}" placeholder="Add a comment..." style="flex:1; padding: 10px; border-radius: 8px; border: 1px solid #E0E0E0;">
                    <button class="action-btn" onclick="submitInlineComment('${rev.id}')">Send</button>
                </div>
            </div>
        </div>`;
};

// --- Profile Hub Logic ---
window.switchProfileTab = function(event, tabId) {
    document.querySelectorAll('.profile-main-feed .p-tab-content').forEach(c => c.style.display = 'none');
    document.querySelectorAll('.profile-main-feed .p-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(tabId).style.display = 'block';
    event.currentTarget.classList.add('active');
};

window.fetchUserProfile = async function() {
    const user = auth.currentUser;
    if(!user) return;
    
    document.getElementById('top-anime-title').innerText = `${user.displayName}'s Top Anime`;

    const header = document.getElementById('profile-header-container');
    const avatarUrl = user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.displayName}`;
    header.innerHTML = `
        <div class="profile-header">
            <img src="${avatarUrl}" class="profile-avatar-large">
            <div style="flex:1;">
                <h1 style="font-size: 32px; margin-bottom: 5px;">${user.displayName}</h1>
                <p style="color: var(--text-muted); font-size: 14px;">WeeBee Member since ${new Date(user.metadata.creationTime).toLocaleDateString()}</p>
            </div>
            <button class="action-btn" style="background:#EEE; color:#555;">Edit Profile</button>
        </div>
    `;

    const revQuery = query(collection(db, "reviews"), where("uid", "==", user.uid));
    const revSnap = await getDocs(revQuery);
    let totalScore = 0;
    let reviewCount = 0;
    
    let myReviews = [];
    revSnap.forEach(d => {
        const data = d.data();
        if(data.type !== 'suggestion') {
            totalScore += parseFloat(data.score);
            reviewCount++;
        }
        myReviews.push({ ...data, id: d.id });
    });
    myReviews.sort((a,b) => b.timestamp - a.timestamp);

    const avg = reviewCount > 0 ? (totalScore / reviewCount).toFixed(1) : "0.0";

    const listQuery = query(collection(db, "anime_lists"), where("uid", "==", user.uid));
    const listSnap = await getDocs(listQuery);
    let watchAnimes = [];
    listSnap.forEach(d => {
        if(d.data().status === 'watching') watchAnimes.push(d.data());
    });
    
    document.getElementById('profile-stats-content').innerHTML = `
        <div class="profile-stat-row"><strong>Reviews Written</strong> <span>${reviewCount}</span></div>
        <div class="profile-stat-row"><strong>Average Rating</strong> <span>${avg}</span></div>
        <div class="profile-stat-row"><strong>Watch List</strong> <span id="watch-list-count">${watchAnimes.length}</span></div>
    `;

    const watchContainer = document.getElementById('currently-watching-list');
    watchContainer.innerHTML = '';
    
    if(watchAnimes.length === 0) {
        watchContainer.innerHTML = '<p class="empty-msg" style="color:var(--text-muted); font-size:13px;">Not tracking anything yet.</p>';
    } else {
        watchAnimes.forEach((a) => {
            watchContainer.innerHTML += `
                <div style="display:flex; align-items:center; gap:12px; margin-bottom: 12px; cursor:pointer; padding: 5px; border-radius: 8px; transition: background 0.2s;" onmouseover="this.style.background='var(--bg-gray)'" onmouseout="this.style.background='transparent'" onclick="loadAnimeDetails(${a.mal_id})">
                    <img src="${a.image}" style="width: 45px; height: 60px; border-radius: 6px; object-fit: cover; box-shadow: 0 2px 4px rgba(0,0,0,0.1); flex-shrink: 0;">
                    <div style="flex: 1; min-width: 0;">
                        <span style="font-size: 13px; font-weight: 600; color: var(--text-dark); display:-webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient:vertical; overflow:hidden;">${a.title}</span>
                    </div>
                </div>
            `;
        });
    }

    const topDoc = await getDoc(doc(db, "top_anime_lists", user.uid));
    const topContainer = document.getElementById('top-anime-list');
    topContainer.innerHTML = '';
    
    if(!topDoc.exists() || !topDoc.data().list || topDoc.data().list.length === 0) {
        topContainer.innerHTML = '<p class="empty-msg" style="color:var(--text-muted); font-size:13px;">List is empty.</p>';
    } else {
        const topAnimes = topDoc.data().list;
        topAnimes.forEach((a, index) => {
            let rankColor = 'var(--text-muted)';
            if(index === 0) rankColor = '#FFD700'; 
            if(index === 1) rankColor = '#C0C0C0'; 
            if(index === 2) rankColor = '#CD7F32'; 
            
            topContainer.innerHTML += `
                <div style="display:flex; align-items:center; gap:12px; margin-bottom: 12px; cursor:pointer; padding: 5px; border-radius: 8px; transition: background 0.2s;" onmouseover="this.style.background='var(--bg-gray)'" onmouseout="this.style.background='transparent'" onclick="loadAnimeDetails(${a.mal_id})">
                    <div style="font-size: 18px; font-weight: 900; color: ${rankColor}; width: 20px; text-align: center; flex-shrink: 0;">${index + 1}</div>
                    <img src="${a.image}" style="width: 45px; height: 60px; border-radius: 6px; object-fit: cover; box-shadow: 0 2px 4px rgba(0,0,0,0.1); flex-shrink: 0;">
                    <div style="flex: 1; min-width: 0;">
                        <span style="font-size: 13px; font-weight: 600; color: var(--text-dark); display:-webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient:vertical; overflow:hidden;">${a.title}</span>
                    </div>
                </div>
            `;
        });
    }

    const feed = document.getElementById('user-reviews-feed');
    feed.innerHTML = '';
    myReviews.forEach(d => feed.innerHTML += window.generateReviewCardHTML(d));

    fetchProfileComments(user.uid);
};

window.submitProfileComment = async function() {
    const user = auth.currentUser;
    if(!user) return window.openAuthModal();
    const input = document.getElementById('profile-comment-input');
    if(!input.value.trim()) return;
    await addDoc(collection(db, "profile_comments"), { profileOwnerId: user.uid, authorName: user.displayName, authorAvatar: user.photoURL, text: input.value.trim(), timestamp: new Date() });
    input.value = ''; fetchProfileComments(user.uid);
};

window.fetchProfileComments = async function(ownerId) {
    const feed = document.getElementById('profile-comments-feed');
    const q = query(collection(db, "profile_comments"), where("profileOwnerId", "==", ownerId), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    feed.innerHTML = '';
    snap.forEach(doc => {
        const c = doc.data();
        feed.innerHTML += `<div style="display:flex; gap:12px; padding:15px; background:var(--bg-white); border:1px solid #F0F0F0; border-radius:10px; margin-bottom:10px;"><img src="${c.authorAvatar}" style="width:40px; height:40px; border-radius:50%; object-fit:cover;"><div><strong style="font-size:14px;">${c.authorName}</strong><p style="font-size:14px; margin-top:4px;">${c.text}</p></div></div>`;
    });
};

// --- NEW DISCOVER PAGE LOGIC ---
window.fetchDiscoverPage = async function() {
    // 1. WeeBee's Custom Top 10
    const top10Grid = document.getElementById('weebee-top10-grid');
    top10Grid.innerHTML = '<div class="loading">Calculating WeeBee scores...</div>';
    try {
        const revSnap = await getDocs(collection(db, "reviews"));
        let animeStats = {};
        revSnap.forEach(d => {
            const data = d.data();
            if(data.type !== 'suggestion' && data.score && data.mal_id) {
                if(!animeStats[data.mal_id]) {
                    animeStats[data.mal_id] = { mal_id: data.mal_id, title: data.animeTitle, image: data.animeImage, totalScore: 0, count: 0 };
                }
                animeStats[data.mal_id].totalScore += parseFloat(data.score);
                animeStats[data.mal_id].count++;
            }
        });
        
        let top10 = Object.values(animeStats).map(a => ({
            ...a,
            avgScore: (a.totalScore / a.count).toFixed(1)
        })).sort((a, b) => b.avgScore - a.avgScore).slice(0, 10);

        top10Grid.innerHTML = '';
        if(top10.length === 0) {
            top10Grid.innerHTML = '<p class="empty-msg" style="color:var(--text-muted); grid-column: 1 / -1;">No reviews on WeeBee yet! Be the first!</p>';
        } else {
            top10.forEach((anime, index) => {
                top10Grid.innerHTML += `
                    <div class="anime-card horizontal" onclick="loadAnimeDetails(${anime.mal_id})" style="cursor:pointer; position:relative; overflow: visible;">
                        <div style="position:absolute; top:-10px; left:-10px; background:var(--accent-yellow); color:var(--text-dark); width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:14px; box-shadow:0 2px 4px rgba(0,0,0,0.2); z-index:5;">#${index+1}</div>
                        <img src="${anime.image}">
                        <div class="details">
                            <h3 title="${anime.title}">${anime.title}</h3>
                            <p style="font-size:12px; color:var(--text-muted); margin-bottom: 8px;">${anime.count} WeeBee Reviews</p>
                            <div class="rating-badge large gold" style="width: 45px; height: 45px; font-size: 16px;">${anime.avgScore}</div>
                        </div>
                    </div>
                `;
            });
        }
    } catch(e) { top10Grid.innerHTML = '<p>Failed to calculate WeeBee Top 10.</p>'; console.error(e); }

    // 2. Friends Suggestions
    const friendsCarousel = document.getElementById('friends-suggested-carousel');
    friendsCarousel.innerHTML = '<div class="loading">Loading suggestions...</div>';
    if(!auth.currentUser) {
        friendsCarousel.innerHTML = '<p class="empty-msg" style="color:var(--text-muted);">Sign in and follow friends to see their suggestions!</p>';
    } else {
        try {
            const followsSnap = await getDocs(query(collection(db, "follows"), where("followerUid", "==", auth.currentUser.uid), where("type", "==", "user")));
            let friendIds = [];
            followsSnap.forEach(d => friendIds.push(d.data().targetId));

            if(friendIds.length === 0) {
                friendsCarousel.innerHTML = '<p class="empty-msg" style="color:var(--text-muted);">You aren\'t following anyone yet. Discover users in the Community!</p>';
            } else {
                const recentRevs = await getDocs(query(collection(db, "reviews"), orderBy("timestamp", "desc"), limit(100)));
                let suggestedMalIds = new Set();
                let friendsSuggested = [];
                
                recentRevs.forEach(d => {
                    const data = d.data();
                    if(friendIds.includes(data.uid) && !suggestedMalIds.has(data.mal_id)) {
                        suggestedMalIds.add(data.mal_id);
                        friendsSuggested.push({ mal_id: data.mal_id, title: data.animeTitle, image: data.animeImage, friendName: data.username, action: data.type === 'suggestion' ? 'Suggested' : 'Reviewed' });
                    }
                });

                friendsCarousel.innerHTML = '';
                if(friendsSuggested.length === 0) {
                    friendsCarousel.innerHTML = '<p class="empty-msg" style="color:var(--text-muted);">Your friends haven\'t been active recently.</p>';
                } else {
                    friendsSuggested.slice(0, 15).forEach(anime => {
                        friendsCarousel.innerHTML += `
                            <div class="anime-card" onclick="loadAnimeDetails(${anime.mal_id})">
                                <img src="${anime.image}">
                                <p>${anime.title}</p>
                                <span style="font-size:11px; color:var(--accent-yellow); display:block; margin-top:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${anime.action} by ${anime.friendName}</span>
                            </div>
                        `;
                    });
                }
            }
        } catch(e) { friendsCarousel.innerHTML = '<p>Failed to load suggestions.</p>'; console.error(e); }
    }

    // 3. Jikan API Categories (Fetched sequentially to avoid rate limiting)
    fetchAPI_CategoriesSequentially();
};

async function fetchAPI_CategoriesSequentially() {
    await fetchAndRenderCarousel('https://api.jikan.moe/v4/seasons/now?limit=15', 'discover-trending-carousel');
    await new Promise(r => setTimeout(r, 500)); 
    await fetchAndRenderCarousel('https://api.jikan.moe/v4/anime?genres=1&order_by=score&sort=desc&limit=15', 'discover-action-carousel');
    await new Promise(r => setTimeout(r, 500));
    await fetchAndRenderCarousel('https://api.jikan.moe/v4/anime?genres=22&order_by=score&sort=desc&limit=15', 'discover-romance-carousel');
    await new Promise(r => setTimeout(r, 500));
    await fetchAndRenderCarousel('https://api.jikan.moe/v4/anime?genres=4&order_by=score&sort=desc&limit=15', 'discover-comedy-carousel');
}

async function fetchAndRenderCarousel(url, containerId) {
    const container = document.getElementById(containerId);
    if(!container) return;
    try {
        const res = await fetch(url);
        const { data } = await res.json();
        container.innerHTML = '';
        if(!data || data.length === 0) {
            container.innerHTML = '<p class="empty-msg" style="color:var(--text-muted);">No anime found.</p>';
            return;
        }
        data.forEach(anime => {
            container.innerHTML += `<div class="anime-card" onclick="loadAnimeDetails(${anime.mal_id})"><img src="${anime.images.jpg.image_url}"><p>${anime.title_english || anime.title}</p></div>`;
        });
    } catch(e) {
        container.innerHTML = '<p style="color:red; font-size:12px;">Failed to load category.</p>';
    }
}

// --- Search Logic ---
window.searchAnime = async function(queryStr) {
    switchView('discover-view', true); 
    
    // We repurpose the WeeBee Top 10 grid as the search results container temporarily
    document.querySelector('#discover-view h2').innerText = `Search Results: "${queryStr}"`;
    const grid = document.getElementById('weebee-top10-grid');
    grid.innerHTML = '<div class="loading">Searching Anime Database...</div>';
    
    // Hide the other categories while searching
    document.getElementById('friends-suggested-carousel').parentElement.style.display = 'none';
    document.getElementById('discover-trending-carousel').parentElement.style.display = 'none';
    document.getElementById('discover-action-carousel').parentElement.style.display = 'none';
    document.getElementById('discover-romance-carousel').parentElement.style.display = 'none';
    document.getElementById('discover-comedy-carousel').parentElement.style.display = 'none';
    
    try {
        const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(queryStr)}&limit=10`);
        const { data } = await res.json();
        grid.innerHTML = '';
        if(data.length === 0) { grid.innerHTML = '<p style="color:var(--text-muted); grid-column: 1/-1;">No anime found matching your search.</p>'; return; }
        
        data.forEach(anime => {
            grid.innerHTML += `<div class="anime-card horizontal" onclick="loadAnimeDetails(${anime.mal_id})" style="cursor:pointer;"><img src="${anime.images.jpg.image_url}"><div class="details"><h3 title="${anime.title_english || anime.title}">${anime.title_english || anime.title}</h3><p>${anime.type}, ${anime.year || 'N/A'}</p><div class="rating-badge blue">${anime.score || 'N/A'}</div></div></div>`;
        });
    } catch(e) { grid.innerHTML = '<p>Search failed to load.</p>'; console.error(e); }
};

// --- Navigation ---
window.switchView = function(targetId, isSearch = false) {
    if(targetId !== 'anime-detail-view') window.previousViewId = targetId;
    document.querySelectorAll(".nav-btn").forEach(btn => { btn.classList.remove("active"); if(btn.getAttribute("data-target") === targetId) btn.classList.add("active"); });
    document.querySelectorAll(".view").forEach(view => view.classList.remove("active"));
    document.getElementById(targetId).classList.add("active");
    document.querySelector('.main-content').scrollTo(0,0);
    
    if(targetId === 'home-view') fetchHomepageReviews();
    if(targetId === 'news-view') fetchGlobalNews();
    if(targetId === 'profile-view') fetchUserProfile();
    if(targetId === 'my-list-view') fetchMyList(); 
    if(targetId === 'discover-view' && !isSearch) {
        // Reset Search View back to normal Discover View
        document.querySelector('#discover-view h2').innerText = "WeeBee's Top 10 All Time";
        document.getElementById('friends-suggested-carousel').parentElement.style.display = 'block';
        document.getElementById('discover-trending-carousel').parentElement.style.display = 'block';
        document.getElementById('discover-action-carousel').parentElement.style.display = 'block';
        document.getElementById('discover-romance-carousel').parentElement.style.display = 'block';
        document.getElementById('discover-comedy-carousel').parentElement.style.display = 'block';
        fetchDiscoverPage();
    }
};

window.goBack = function() { switchView(window.previousViewId); };

window.closeAllModals = function() { document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none'); };

window.openReviewModal = function() { 
    if(!auth.currentUser) return window.openAuthModal(); 
    window.closeAllModals(); 
    document.getElementById('choice-modal').style.display = 'flex'; 
};

window.openQuickScoreModal = function() { 
    window.closeAllModals(); 
    document.getElementById('quick-fanservice-value').value = ''; 
    document.getElementById('quick-score-modal').style.display = 'flex'; 
};

window.openInDepthModal = function() {
    window.closeAllModals(); const container = document.getElementById('in-depth-categories');
    document.getElementById('in-depth-fanservice-value').value = '';
    if (!container.innerHTML) {
        const cats = ['Character Development', 'Plot', 'World Building', 'Art Style', 'Soundtrack', 'Voice Acting', 'Pacing'];
        cats.forEach(c => { container.innerHTML += `<div class="category-block"><strong>${c}</strong><input type="number" id="id-${c}-score" min="1" max="10" step="0.1" placeholder="/ 10"><textarea id="id-${c}-text" rows="2" placeholder="Thoughts..."></textarea></div>`; });
    }
    document.getElementById('in-depth-modal').style.display = 'flex';
};

window.previewInDepthReview = function() {
    let total = 0, count = 0, data = { type: 'in-depth', categories: [] };
    const cats = ['Character Development', 'Plot', 'World Building', 'Art Style', 'Soundtrack', 'Voice Acting', 'Pacing'];
    cats.forEach(c => {
        const s = document.getElementById(`id-${c}-score`).value;
        if(s) { total += parseFloat(s); count++; data.categories.push({ label: c, score: s, text: document.getElementById(`id-${c}-text`).value }); }
    });
    if(count === 0) return alert("Please score at least one category.");
    data.score = (total/count).toFixed(1); 
    
    const fsVal = document.getElementById('in-depth-fanservice-value').value;
    data.fanService = fsVal ? parseFloat(fsVal) : null;
    
    window.pendingInDepthData = data;
    document.getElementById('preview-content').innerHTML = `<div style="text-align:center;"><div class="rating-badge large gold" style="margin: 0 auto 10px;">${data.score}</div><h4>Average Score</h4></div>`;
    window.closeAllModals(); document.getElementById('preview-modal').style.display = 'flex';
};

window.submitQuickReview = async function() {
    const score = document.getElementById('quick-score-value').value;
    const fsVal = document.getElementById('quick-fanservice-value').value;
    const fanService = fsVal ? parseFloat(fsVal) : null;

    await addDoc(collection(db, "reviews"), { mal_id: window.currentAnimeId, animeTitle: window.currentAnime.title_english || window.currentAnime.title, animeImage: window.currentAnime.images.jpg.image_url, score, fanService, text: document.getElementById('quick-score-text').value, username: auth.currentUser.displayName, avatar: auth.currentUser.photoURL, uid: auth.currentUser.uid, timestamp: new Date(), likes: [], dislikes: [], commentCount: 0 });
    window.closeAllModals(); loadAnimeDetails(window.currentAnimeId);
};

window.submitInDepthReview = async function() {
    await addDoc(collection(db, "reviews"), { ...window.pendingInDepthData, mal_id: window.currentAnimeId, animeTitle: window.currentAnime.title_english || window.currentAnime.title, animeImage: window.currentAnime.images.jpg.image_url, username: auth.currentUser.displayName, avatar: auth.currentUser.photoURL, uid: auth.currentUser.uid, timestamp: new Date(), likes: [], dislikes: [], commentCount: 0 });
    window.closeAllModals(); loadAnimeDetails(window.currentAnimeId);
};

window.fetchHomepageReviews = async function() {
    try {
        const q = query(collection(db, "reviews"), orderBy("timestamp", "desc"), limit(20));
        const snap = await getDocs(q);
        const feed = document.getElementById('review-feed'); feed.innerHTML = '';
        snap.forEach(d => feed.innerHTML += window.generateReviewCardHTML({ ...d.data(), id: d.id }));
    } catch(e) { console.error("Error loading home feed:", e); }
};

window.openAllEpisodesModal = function() {
    window.closeAllModals();
    const list = document.getElementById('all-episodes-list');
    list.innerHTML = '';
    
    window.currentAnimeEpisodes.forEach(ep => {
        list.innerHTML += `
            <details style="background: var(--bg-white); border: 1px solid #E0E0E0; border-radius: 8px; overflow: hidden;">
                <summary style="padding: 15px; font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: space-between; outline: none;">
                    <span style="flex:1;">Ep ${ep.mal_id}: ${ep.title}</span>
                    <span class="material-symbols-outlined" style="color:var(--text-muted);">expand_more</span>
                </summary>
                <div style="padding: 0 15px 15px 15px; font-size: 13px; line-height: 1.5; color: var(--text-muted); border-top: 1px dashed #E0E0E0; margin-top: 5px; padding-top: 10px;">
                    ${ep.synopsis ? ep.synopsis : (ep.title_japanese ? `Japanese Title: ${ep.title_japanese}<br><br>No synopsis available.` : 'No synopsis available.')}
                    <br><br><strong style="color:var(--text-dark);">Aired:</strong> ${ep.aired ? new Date(ep.aired).toLocaleDateString() : 'N/A'}
                </div>
            </details>
        `;
    });
    
    document.getElementById('all-episodes-modal').style.display = 'flex';
};

window.loadAnimeDetails = async function(mal_id) {
    window.currentAnimeId = mal_id; 
    switchView('anime-detail-view');
    
    const res = await fetch(`https://api.jikan.moe/v4/anime/${mal_id}/full`);
    const { data: anime } = await res.json(); 
    window.currentAnime = anime;

    let fanServiceScores = new Map(); 
    const revQ = query(collection(db, "reviews"), where("mal_id", "==", mal_id));
    const revSnapshot = await getDocs(revQ);
    
    let weebeeTotal = 0;
    let weebeeCount = 0;

    revSnapshot.forEach(d => { 
        const rData = d.data();
        if(rData.fanService) fanServiceScores.set(rData.uid, rData.fanService); 
        
        if(rData.type !== 'suggestion' && rData.score) {
            weebeeTotal += parseFloat(rData.score);
            weebeeCount++;
        }
    });

    const listQ = query(collection(db, "anime_lists"), where("mal_id", "==", mal_id));
    const listSnapshot = await getDocs(listQ);
    listSnapshot.forEach(d => { if(d.data().fanService) fanServiceScores.set(d.data().uid, d.data().fanService); });

    let weebeeAvg = weebeeCount > 0 ? (weebeeTotal / weebeeCount).toFixed(1) : 'N/A';

    let fanServiceAvg = 'N/A';
    let fanServicePercentage = 0;
    if(fanServiceScores.size > 0) {
        let sum = 0;
        fanServiceScores.forEach(val => sum += parseFloat(val));
        fanServiceAvg = (sum / fanServiceScores.size).toFixed(1);
        fanServicePercentage = (fanServiceAvg / 10) * 100;
    }

    const fanServiceHTML = `
        <div style="margin-top: 15px; border-top: 1px dashed #E0E0E0; padding-top: 15px;">
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:5px;">
                <span style="display:flex; align-items:center; gap:5px;">Fan Service <span class="material-symbols-outlined tooltip-icon" data-tooltip="A 1-10 scale indicating the amount of fan service. 1 = None, 10 = Heavy fan service. This is a background community stat and does not affect the anime's overall score." style="font-size:14px; color:var(--text-muted);">info</span></span>
                <span>${fanServiceAvg === 'N/A' ? 'No Data' : fanServiceAvg + ' / 10'}</span>
            </div>
            <div style="width: 100%; height: 8px; background: #E0E0E0; border-radius: 4px; overflow: hidden;">
                <div style="width: ${fanServicePercentage}%; height: 100%; background: linear-gradient(90deg, #FFB74D, #FF5252);"></div>
            </div>
        </div>
    `;

    document.getElementById('anime-detail-content').innerHTML = `
        <div class="detail-sidebar">
            <img src="${anime.images.jpg.image_url}">
            
            <div class="stat-box">
                <div class="stat-row" style="margin-bottom: 15px; gap: 10px;">
                    <div class="stat-col" style="flex:1;"><h4>Global</h4><span class="value" style="font-size:18px;">${anime.score || 'N/A'}</span></div>
                    <div style="width: 1px; height: 30px; background: #E0E0E0;"></div>
                    <div class="stat-col" style="flex:1;"><h4>WeeBee</h4><span class="value" style="font-size:18px; color:var(--accent-yellow);">${weebeeAvg}</span></div>
                    <div style="width: 1px; height: 30px; background: #E0E0E0;"></div>
                    <div class="stat-col" style="flex:1;"><h4>Rank</h4><span class="value" style="font-size:18px;">#${anime.rank || 'N/A'}</span></div>
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
            <div class="tags" style="color: var(--text-muted); font-size: 14px; margin-bottom: 15px;">${anime.genres?.map(g => g.name).join(', ')}</div>
            
            <div class="content-section">
                <h3>Synopsis</h3>
                <p>${anime.synopsis}</p>
            </div>

            <div id="detail-chars-container" class="content-section"><div class="loading">Loading Characters...</div></div>
            <div id="detail-eps-container" class="content-section"><div class="loading">Loading Episodes...</div></div>
            <div id="detail-recs-container" class="content-section"><div class="loading">Loading Similar Anime...</div></div>
            <div id="detail-news-container" class="content-section"><div class="loading">Loading News...</div></div>
            
            <div class="content-section no-bg">
                <div class="review-header-container">
                    <h3>Reviews</h3>
                    <button class="action-btn" onclick="event.stopPropagation(); openReviewModal()">Write a Review</button>
                </div>
                <div class="review-list" id="detail-reviews"></div>
            </div>
        </div>`;

    const revList = document.getElementById('detail-reviews');
    revList.innerHTML = '';
    revSnapshot.forEach(d => revList.innerHTML += window.generateReviewCardHTML({ ...d.data(), id: d.id }));

    // Async Loaders
    fetch(`https://api.jikan.moe/v4/anime/${mal_id}/characters`).then(r=>r.json()).then(d => {
        const cContainer = document.getElementById('detail-chars-container');
        if(!cContainer) return;
        if(d.data && d.data.length > 0) {
            cContainer.innerHTML = `
                <h3>Characters & Voice Actors</h3>
                <div class="character-grid">
                    ${d.data.slice(0, 6).map(c => `
                        <div class="character-card">
                            <img src="${c.character.images.jpg.image_url}">
                            <div class="info">
                                <span class="name" title="${c.character.name}">${c.character.name}</span>
                                <span class="role">${c.role}</span>
                                ${c.voice_actors && c.voice_actors.length > 0 ? `<span style="font-size:11px; margin-top:5px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">VA: ${c.voice_actors[0].person.name}</span>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>`;
        } else { cContainer.style.display = 'none'; }
    }).catch(() => document.getElementById('detail-chars-container').style.display = 'none');

    fetch(`https://api.jikan.moe/v4/anime/${mal_id}/episodes`).then(r=>r.json()).then(d => {
        const eContainer = document.getElementById('detail-eps-container');
        if(!eContainer) return;
        if(d.data && d.data.length > 0) {
            window.currentAnimeEpisodes = d.data;
            const displayEps = d.data.slice(0, 5);
            let html = `<h3>Episodes</h3><div style="display:flex; flex-direction:column; gap:10px;">`;
            displayEps.forEach(ep => {
                html += `
                    <details style="background: var(--bg-white); border: 1px solid #E0E0E0; border-radius: 8px; overflow: hidden;">
                        <summary style="padding: 15px; font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: space-between; outline: none;">
                            <span style="flex:1;">Ep ${ep.mal_id}: ${ep.title}</span>
                            <span class="material-symbols-outlined" style="color:var(--text-muted);">expand_more</span>
                        </summary>
                        <div style="padding: 0 15px 15px 15px; font-size: 13px; line-height: 1.5; color: var(--text-muted); border-top: 1px dashed #E0E0E0; margin-top: 5px; padding-top: 10px;">
                            ${ep.synopsis ? ep.synopsis : (ep.title_japanese ? `Japanese Title: ${ep.title_japanese}<br><br>No synopsis available.` : 'No synopsis available.')}
                            <br><br><strong style="color:var(--text-dark);">Aired:</strong> ${ep.aired ? new Date(ep.aired).toLocaleDateString() : 'N/A'}
                        </div>
                    </details>
                `;
            });
            html += `</div>`;
            if(d.data.length > 5) {
                html += `<button class="action-btn" style="width:100%; justify-content:center; margin-top:15px; background:transparent; color:var(--text-dark); border:1px solid #E0E0E0;" onclick="openAllEpisodesModal()">View All ${d.data.length} Episodes</button>`;
            }
            eContainer.innerHTML = html;
        } else { eContainer.style.display = 'none'; }
    }).catch(() => document.getElementById('detail-eps-container').style.display = 'none');

    fetch(`https://api.jikan.moe/v4/anime/${mal_id}/recommendations`).then(r=>r.json()).then(d => {
        const rContainer = document.getElementById('detail-recs-container');
        if(!rContainer) return;
        if(d.data && d.data.length > 0) {
            rContainer.innerHTML = `
                <h3>Similar Anime</h3>
                <div class="carousel" style="margin-bottom:0; padding-bottom:10px;">
                    ${d.data.slice(0, 10).map(rec => `
                        <div class="anime-card" onclick="loadAnimeDetails(${rec.entry.mal_id})" style="min-width: 140px;">
                            <img src="${rec.entry.images.jpg.image_url}" style="width:120px; height:170px;">
                            <p style="max-width:120px; font-size:12px;">${rec.entry.title}</p>
                        </div>
                    `).join('')}
                </div>`;
        } else { rContainer.style.display = 'none'; }
    }).catch(() => document.getElementById('detail-recs-container').style.display = 'none');

    fetch(`https://api.jikan.moe/v4/anime/${mal_id}/news`).then(r=>r.json()).then(d => {
        const nContainer = document.getElementById('detail-news-container');
        if(!nContainer) return;
        if(d.data && d.data.length > 0) {
            nContainer.innerHTML = `
                <h3>Latest News</h3>
                <div class="news-grid">
                    ${d.data.slice(0, 3).map(n => `
                        <div class="news-card">
                            <img src="${n.images?.jpg?.image_url || anime.images.jpg.image_url}">
                            <div class="news-content">
                                <h3>${n.title}</h3>
                                <p>${n.excerpt}</p>
                                <a href="${n.url}" target="_blank" class="news-link">Full Article</a>
                            </div>
                        </div>
                    `).join('')}
                </div>`;
        } else { nContainer.style.display = 'none'; }
    }).catch(() => document.getElementById('detail-news-container').style.display = 'none');
};

// --- App Initialization ---
window.onload = function() {
    const loadTrending = async () => {
        try {
            const r = await fetch('https://api.jikan.moe/v4/seasons/now?limit=8');
            const d = await r.json();
            const c = document.getElementById('trending-carousel'); c.innerHTML = '';
            if(d.data) d.data.forEach(a => c.innerHTML += `<div class="anime-card" onclick="loadAnimeDetails(${a.mal_id})"><img src="${a.images.jpg.image_url}"><p>${a.title_english || a.title}</p></div>`);
        } catch(e) { console.error("Trending error:", e); }
    };
    
    loadTrending();
    fetchHomepageReviews();
};