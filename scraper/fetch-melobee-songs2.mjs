// Part 2 — remaining + retries for no-preview ones
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function itunesSearch(term) {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=musicTrack&limit=3`;
    const res = await fetch(url);
    const json = await res.json();
    return json.results || [];
}

const SONGS = [
    // Retries
    { anime: 'Haikyu!!', song: 'Hikariare Burnout Syndromes' },
    { anime: 'Black Clover', song: 'Haruka Mirai Black Clover opening' },
    { anime: 'Gintama', song: 'Sakuramitsutsuki SPYAIR' },
    { anime: 'Frieren: Beyond Journey\'s End', song: 'Yubikiri YOASOBI' },
    // Remaining from original list
    { anime: 'Dandadan', song: 'Otonoke Creepy Nuts' },
    { anime: 'Dandadan Season 2', song: 'Me Me She She Aina THE END Dandadan' },
    { anime: 'Pokemon', song: 'Pokemon Theme Jason Paige' },
    { anime: 'Spy x Family', song: 'Mixed Nuts Official HIGE DANdism' },
    { anime: 'Mobile Suit Gundam: The Witch from Mercury', song: 'The Blessing YOASOBI Gundam' },
    { anime: 'Domestic Girlfriend', song: 'Kawaki wo Ameku Minami' },
    { anime: 'Noragami Aragoto', song: 'Kyouran Hey Kids THE ORAL CIGARETTES' },
    { anime: 'Tokyo Revengers', song: 'Cry Baby Official HIGE DANdism' },
    { anime: 'Serial Experiments Lain', song: 'Duvet Boa' },
    { anime: 'Mashle', song: 'Bling Bang Bang Born Creepy Nuts' },
    { anime: 'Chainsaw Man', song: 'Kick Back Kenshi Yonezu' },
    { anime: 'Beastars', song: 'Kaibutsu YOASOBI Beastars' },
    { anime: 'Oshi no Ko', song: 'Idol YOASOBI Oshi no Ko' },
    { anime: 'The Promised Neverland', song: 'Touch Off UVERworld Promised Neverland' },
    { anime: 'Tokyo Ghoul:re', song: 'Munou Oshiro Project' },
    { anime: 'Sword Art Online', song: 'Crossing Field LiSA Sword Art Online' },
];

console.log('Fetching', SONGS.length, 'songs...\n');

const results = [];
for (const s of SONGS) {
    const tracks = await itunesSearch(s.song);
    const preview = tracks.find(t => t.previewUrl)?.previewUrl || null;
    const trackName = tracks[0]?.trackName || '—';
    console.log(`${preview ? '✓' : '✗'} [${s.anime}] → ${trackName}`);
    if (preview) results.push({ anime: s.anime, audio: preview });
    await sleep(400);
}

console.log('\n\n// ── New entries for OB_POOL ──');
results.forEach(r => console.log(`    { anime: '${r.anime}', audio: '${r.audio}' },`));
console.log(`\n// ${results.length}/${SONGS.length} found`);
