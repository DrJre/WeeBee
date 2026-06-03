// Fetches iTunes 30s preview URLs for MeloBee song additions
// Run: node scraper/fetch-melobee-songs.mjs

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function itunesSearch(term) {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=musicTrack&limit=3`;
    const res = await fetch(url);
    const json = await res.json();
    return json.results || [];
}

const SONGS = [
    // AOT
    { anime: 'Attack on Titan', song: 'Guren no Yumiya Linked Horizon' },
    { anime: 'Attack on Titan', song: 'Shinzou wo Sasageyo Linked Horizon' },
    // Naruto
    { anime: 'Naruto', song: 'GO!!! FLOW naruto' },
    { anime: 'Naruto', song: 'Haruka Kanata Asian Kung-Fu Generation naruto' },
    { anime: 'Naruto', song: 'Blue Bird Ikimono-gakari naruto' },
    { anime: 'Naruto', song: 'Hero\'s Come Back nobodyknows naruto' },
    { anime: 'Naruto', song: 'Silhouette KANA-BOON naruto' },
    { anime: 'Naruto Shippuden', song: 'Sign Flow Naruto Shippuden opening' },
    // One Piece
    { anime: 'One Piece', song: 'Wake Up AAA one piece' },
    { anime: 'One Piece', song: 'We Are Straw Hat one piece opening' },
    { anime: 'One Piece', song: 'Share the World Tohoshinki one piece' },
    // Haikyu
    { anime: 'Haikyu!!', song: 'Hikariare BURNOUT SYNDROMES haikyu' },
    { anime: 'Haikyu!!', song: 'Fly High BURNOUT SYNDROMES haikyu' },
    { anime: 'Haikyu!!', song: 'Imagination SPYAIR haikyu' },
    { anime: 'Haikyu!!', song: 'I\'m a Believer SPYAIR haikyu' },
    // My Hero Academia
    { anime: 'My Hero Academia', song: 'The Day Porno Graffitti My Hero Academia' },
    { anime: 'My Hero Academia', song: 'Peace Sign Kenshi Yonezu My Hero Academia' },
    { anime: 'My Hero Academia', song: 'Odd Future UVERworld My Hero Academia' },
    { anime: 'My Hero Academia', song: 'Polaris Blue Encount My Hero Academia' },
    // Tokyo Ghoul
    { anime: 'Tokyo Ghoul', song: 'Unravel TK Tokyo Ghoul' },
    { anime: 'Tokyo Ghoul:re', song: 'Katharsis TK Tokyo Ghoul re' },
    { anime: 'Tokyo Ghoul:re', song: 'Munou Oshiro Project Tokyo Ghoul' },
    // Demon Slayer
    { anime: 'Demon Slayer', song: 'Akeboshi LiSA Demon Slayer' },
    { anime: 'Demon Slayer', song: 'Zankyousanka Aimer Demon Slayer' },
    { anime: 'Demon Slayer', song: 'Kizuna no Kiseki MAN WITH A MISSION Demon Slayer' },
    // Black Clover
    { anime: 'Black Clover', song: 'Black Clover Vickeblanka' },
    { anime: 'Black Clover', song: 'Haruka Mirai Kankaku Pierrot Black Clover' },
    { anime: 'Black Clover', song: 'PAiNT it BLACK BiSH Black Clover' },
    // JJK
    { anime: 'Jujutsu Kaisen', song: 'Ao no Sumika Tatsuya Kitani Jujutsu Kaisen' },
    { anime: 'Jujutsu Kaisen', song: 'Specialz King Gnu Jujutsu Kaisen' },
    // Fire Force
    { anime: 'Fire Force', song: 'Inferno Mrs Green Apple Fire Force' },
    { anime: 'Fire Force', song: 'SPARK AGAIN Aimer Fire Force' },
    // New additions
    { anime: 'Gintama', song: 'Sakuramitsutsuki SPYAIR Gintama' },
    { anime: 'The Rising of the Shield Hero', song: 'Rise MADKID Shield Hero' },
    { anime: 'Fate/Zero', song: 'Oath Sign LiSA Fate Zero' },
    { anime: 'Cowboy Bebop', song: 'Tank Seatbelts Cowboy Bebop' },
    { anime: 'The Irregular at Magic High School', song: 'Rising Hope LiSA irregular magic' },
    { anime: 'Sword Art Online', song: 'Anima ReoNA Sword Art Online' },
    { anime: 'Vinland Saga', song: 'Mukanjyo Survive Said The Prophet Vinland Saga' },
    { anime: 'Rent-A-Girlfriend', song: 'Centimeter The Peggies Rent-A-Girlfriend' },
    { anime: 'Dororo', song: 'Kaen Queen Bee Dororo' },
    { anime: 'Parasyte', song: 'Let Me Hear Fear Loathing in Las Vegas Parasyte' },
    { anime: 'Ranking of Kings', song: 'BOY King Gnu Ranking of Kings' },
    { anime: 'Ranking of Kings', song: 'Hadaka no Yuusha King Gnu' },
    { anime: 'Call of the Night', song: 'Daten Creepy Nuts Call of the Night' },
    { anime: 'The Apothecary Diaries', song: 'Hana ni Natte Ryokuoushoku Shakai Apothecary Diaries' },
    { anime: 'Frieren: Beyond Journey\'s End', song: 'Yubikiri YOASOBI Frieren' },
    { anime: 'Your Lie in April', song: 'Hikaru Nara Goose House Your Lie in April' },
    { anime: 'The Seven Deadly Sins', song: 'Netsujou no Spectrum Ikimonogakari Seven Deadly Sins' },
    { anime: 'Dandadan', song: 'Otonoke Creepy Nuts Dandadan' },
    { anime: 'Dandadan Season 2', song: 'Ore Wa Uchuu Ni Naru Aina THE END Dandadan' },
    { anime: 'Pokemon', song: 'Pokemon Theme Jason Paige' },
    { anime: 'Spy x Family', song: 'Mixed Nuts Official HIGE DANdism Spy x Family' },
    { anime: 'Mobile Suit Gundam: The Witch from Mercury', song: 'The Blessing YOASOBI Gundam Witch from Mercury' },
    { anime: 'Domestic Girlfriend', song: 'Kawaki wo Ameku Minami Domestic Girlfriend' },
    { anime: 'Noragami Aragoto', song: 'Kyouran Hey Kids THE ORAL CIGARETTES Noragami' },
    { anime: 'Tokyo Revengers', song: 'Cry Baby Official HIGE DANdism Tokyo Revengers' },
    { anime: 'Serial Experiments Lain', song: 'Duvet Boa Serial Experiments Lain' },
    { anime: 'Mashle', song: 'Bling-Bang-Bang-Born Creepy Nuts Mashle' },
    { anime: 'Chainsaw Man', song: 'Kick Back Kenshi Yonezu Chainsaw Man' },
    { anime: 'Beastars', song: 'Kaibutsu YOASOBI Beastars' },
    { anime: 'Oshi no Ko', song: 'Idol YOASOBI Oshi no Ko' },
    { anime: 'The Promised Neverland', song: 'Touch Off UVERworld Promised Neverland' },
];

console.log('Searching iTunes for', SONGS.length, 'songs...\n');

const results = [];
for (const s of SONGS) {
    const tracks = await itunesSearch(s.song);
    const preview = tracks.find(t => t.previewUrl)?.previewUrl || null;
    const trackName = tracks[0]?.trackName || '—';
    const status = preview ? '✓' : '✗ NO PREVIEW';
    console.log(`${status} [${s.anime}] ${s.song.split(' ').slice(0,3).join(' ')}... → ${trackName}`);
    if (preview) results.push({ anime: s.anime, audio: preview });
    await sleep(300);
}

console.log('\n\n// ── Paste into OB_POOL ──');
results.forEach(r => {
    console.log(`    { anime: '${r.anime}', audio: '${r.audio}' },`);
});
console.log(`\n// ${results.length}/${SONGS.length} found`);
