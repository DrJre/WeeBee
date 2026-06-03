// Search Spotify for MeloBee missing songs
// Usage: SPOTIFY_ID=xxx SPOTIFY_SECRET=yyy node scraper/spotify-melobee.mjs

const sleep = ms => new Promise(r => setTimeout(r, ms));

const CLIENT_ID     = process.env.SPOTIFY_ID;
const CLIENT_SECRET = process.env.SPOTIFY_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('Set SPOTIFY_ID and SPOTIFY_SECRET env vars first.');
    console.error('Example: SPOTIFY_ID=abc SPOTIFY_SECRET=xyz node scraper/spotify-melobee.mjs');
    process.exit(1);
}

async function getToken() {
    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
    });
    const json = await res.json();
    return json.access_token;
}

async function search(token, q, artist, limit = 8) {
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=${limit}&market=US`;
    const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    const json = await res.json();
    const tracks = json.tracks?.items || [];
    // Prefer tracks where artist name matches and preview is available
    const match = tracks.find(t =>
        t.preview_url &&
        t.artists.some(a => a.name.toLowerCase().includes(artist.toLowerCase().split(' ')[0]))
    );
    return match || tracks.find(t => t.preview_url) || null;
}

const SONGS = [
    // The 6 iTunes covers we couldn't recover
    { anime: 'One Piece',               song: 'Share the World',           artist: 'Tohoshinki',           q: 'Share the World Tohoshinki One Piece' },
    { anime: 'Demon Slayer',            song: 'Zankyousanka',              artist: 'Aimer',                q: 'Zankyou Sanka Aimer Demon Slayer' },
    { anime: 'Ranking of Kings',        song: 'Hadaka no Yuusha',          artist: 'King Gnu',             q: 'Hadaka no Yuusha King Gnu Ousama Ranking' },
    { anime: 'The Apothecary Diaries',  song: 'Hana ni Natte',             artist: 'Ryokuoushoku Shakai',  q: 'Hana ni Natte Ryokuoushoku Shakai Apothecary' },
    { anime: 'The Seven Deadly Sins',   song: 'Netsujou no Spectrum',      artist: 'Ikimonogakari',        q: 'Netsujou no Spectrum Ikimonogakari Seven Deadly Sins' },
    { anime: 'Beastars',                song: 'Kaibutsu',                  artist: 'YOASOBI',              q: 'Kaibutsu YOASOBI Beastars' },
    // The 7 missing anime
    { anime: 'Mashle',                  song: 'Bling-Bang-Bang-Born',      artist: 'Creepy Nuts',          q: 'Bling Bang Bang Born Creepy Nuts Mashle' },
    { anime: 'Gintama',                 song: 'Sakuramitsutsuki',          artist: 'SPYAIR',               q: 'Sakuramitsutsuki SPYAIR Gintama' },
    { anime: 'Tokyo Ghoul:re',          song: 'Katharsis',                 artist: 'TK',                   q: 'Katharsis TK from Ling tosite sigure Tokyo Ghoul re' },
    { anime: 'Tokyo Ghoul:re',          song: 'Munou',                     artist: 'Nanawo Akari',         q: 'Munou Nanawo Akari Tokyo Ghoul re' },
    { anime: 'Mobile Suit Gundam: The Witch from Mercury', song: 'Shukufuku', artist: 'YOASOBI',           q: 'Shukufuku YOASOBI Gundam Witch from Mercury' },
    { anime: 'Oshi no Ko',              song: 'Idol',                      artist: 'YOASOBI',              q: 'Idol YOASOBI Oshi no Ko' },
    { anime: 'Tokyo Revengers',         song: 'Cry Baby',                  artist: 'Official HIGE DANdism',q: 'Cry Baby Official HIGE DANdism Tokyo Revengers' },
    // Bonus
    { anime: 'Orb: On the Movements of the Earth', song: 'OP', artist: '',  q: 'Orb On the Movements of the Earth anime opening' },
];

console.log('Getting Spotify token...');
const token = await getToken();
console.log('Token obtained. Searching', SONGS.length, 'songs...\n');

const found = [];
const failed = [];

for (const s of SONGS) {
    const track = await search(token, s.q, s.artist);
    if (track?.preview_url) {
        const artistName = track.artists.map(a => a.name).join(', ');
        console.log(`✓  [${s.anime}] ${artistName} — ${track.name}`);
        console.log(`   ${track.preview_url}`);
        found.push({ anime: s.anime, audio: track.preview_url });
    } else {
        console.log(`✗  [${s.anime}] ${s.song} — no preview available on Spotify`);
        failed.push(s);
    }
    await sleep(500);
}

console.log(`\n\n// ── New Spotify entries for OB_POOL ──`);
found.forEach(r => console.log(`    { anime: '${r.anime.replace(/'/g, "\\'")}', audio: '${r.audio}' },`));
console.log(`\n// ✓ ${found.length}/${SONGS.length}  ✗ ${failed.length} no preview`);
if (failed.length) {
    console.log('\n// Still unavailable:');
    failed.forEach(s => console.log(`//   [${s.anime}] ${s.song}`));
}
