// Part 1 re-run — get actual URLs
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function itunesSearch(term) {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=musicTrack&limit=3`;
    const res = await fetch(url); const json = await res.json();
    return json.results || [];
}
const SONGS = [
    { anime: 'Attack on Titan',                  song: 'Guren no Yumiya Linked Horizon' },
    { anime: 'Attack on Titan',                  song: 'Shinzou wo Sasageyo Linked Horizon' },
    { anime: 'Naruto',                           song: 'GO!!! FLOW naruto opening' },
    { anime: 'Naruto',                           song: 'Haruka Kanata Asian Kung-Fu Generation' },
    { anime: 'Naruto',                           song: 'Blue Bird Ikimono-gakari naruto' },
    { anime: 'Naruto',                           song: 'Heros Come Back nobodyknows naruto' },
    { anime: 'Naruto',                           song: 'Silhouette KANA-BOON naruto' },
    { anime: 'Naruto Shippuden',                 song: 'Sign Flow Naruto Shippuden' },
    { anime: 'One Piece',                        song: 'Wake Up AAA one piece opening' },
    { anime: 'One Piece',                        song: 'We Are Straw Hat one piece Kitadani' },
    { anime: 'One Piece',                        song: 'Share the World Tohoshinki one piece' },
    { anime: 'Haikyu!!',                         song: 'Fly High BURNOUT SYNDROMES haikyu' },
    { anime: 'Haikyu!!',                         song: 'Imagination SPYAIR haikyu' },
    { anime: 'Haikyu!!',                         song: 'I\'m a Believer SPYAIR haikyu' },
    { anime: 'My Hero Academia',                 song: 'The Day Porno Graffitti My Hero Academia' },
    { anime: 'My Hero Academia',                 song: 'Peace Sign Kenshi Yonezu My Hero Academia' },
    { anime: 'My Hero Academia',                 song: 'Odd Future UVERworld My Hero Academia' },
    { anime: 'My Hero Academia',                 song: 'Polaris Blue Encount My Hero Academia' },
    { anime: 'Tokyo Ghoul',                      song: 'Unravel TK Tokyo Ghoul opening' },
    { anime: 'Tokyo Ghoul:re',                   song: 'Katharsis TK Tokyo Ghoul re opening' },
    { anime: 'Demon Slayer',                     song: 'Akeboshi LiSA Demon Slayer' },
    { anime: 'Demon Slayer',                     song: 'Zankyousanka Aimer Demon Slayer' },
    { anime: 'Demon Slayer',                     song: 'Kizuna no Kiseki MAN WITH A MISSION Demon Slayer' },
    { anime: 'Black Clover',                     song: 'Black Catcher Vickeblanka Black Clover' },
    { anime: 'Black Clover',                     song: 'PAiNT it BLACK BiSH Black Clover' },
    { anime: 'Jujutsu Kaisen',                   song: 'Ao no Sumika Tatsuya Kitani Jujutsu Kaisen' },
    { anime: 'Jujutsu Kaisen',                   song: 'Specialz King Gnu Jujutsu Kaisen' },
    { anime: 'Fire Force',                       song: 'Inferno Mrs Green Apple Fire Force' },
    { anime: 'Fire Force',                       song: 'Spark Again Aimer Fire Force' },
    { anime: 'The Rising of the Shield Hero',    song: 'Rise MADKID Shield Hero' },
    { anime: 'Fate/Zero',                        song: 'Oath Sign LiSA Fate Zero' },
    { anime: 'Cowboy Bebop',                     song: 'Tank Seatbelts Cowboy Bebop' },
    { anime: 'The Irregular at Magic High School', song: 'Rising Hope LiSA' },
    { anime: 'Sword Art Online',                 song: 'Anima ReoNA Sword Art Online' },
    { anime: 'Vinland Saga',                     song: 'Mukanjyo Survive Said The Prophet' },
    { anime: 'Rent-A-Girlfriend',                song: 'Centimeter The Peggies Rent-A-Girlfriend' },
    { anime: 'Dororo',                           song: 'Kaen Queen Bee Dororo anime' },
    { anime: 'Parasyte',                         song: 'Let Me Hear Fear Loathing in Las Vegas Parasyte' },
    { anime: 'Ranking of Kings',                 song: 'BOY King Gnu Ranking of Kings' },
    { anime: 'Ranking of Kings',                 song: 'Hadaka no Yuusha King Gnu Ousama Ranking' },
    { anime: 'Call of the Night',                song: 'Daten Creepy Nuts Call of the Night' },
    { anime: 'The Apothecary Diaries',           song: 'Hana ni Natte Ryokuoushoku Shakai' },
    { anime: 'Your Lie in April',                song: 'Hikaru Nara Goose House Your Lie in April' },
    { anime: 'The Seven Deadly Sins',            song: 'Netsujou no Spectrum Ikimonogakari Seven Deadly Sins' },
];

const results = [];
for (const s of SONGS) {
    const tracks = await itunesSearch(s.song);
    const preview = tracks.find(t => t.previewUrl)?.previewUrl || null;
    if (preview) results.push({ anime: s.anime, audio: preview });
    await sleep(500);
}

console.log('// ── Part 1 URLs ──');
results.forEach(r => console.log(`    { anime: '${r.anime}', audio: '${r.audio}' },`));
console.log(`// ${results.length}/${SONGS.length}`);
