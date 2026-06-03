// Verify MeloBee pool — only keeps entries where iTunes returns the ORIGINAL artist
// Run: node scraper/verify-melobee.mjs

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function itunesSearch(term, limit = 5) {
    try {
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=musicTrack&limit=${limit}`;
        const res = await fetch(url);
        if (!res.ok) { await sleep(5000); return []; }
        const text = await res.text();
        return JSON.parse(text).results || [];
    } catch { await sleep(3000); return []; }
}

// artist: what must appear in the iTunes artistName (case insensitive substring match)
const SONGS = [
    // Attack on Titan
    { anime: 'Attack on Titan',                   song: 'Guren no Yumiya Linked Horizon',               artist: 'Linked Horizon' },
    { anime: 'Attack on Titan',                   song: 'Shinzou wo Sasageyo Linked Horizon',           artist: 'Linked Horizon' },
    // Naruto
    { anime: 'Naruto',                            song: 'GO!!! FLOW naruto opening',                    artist: 'FLOW' },
    { anime: 'Naruto',                            song: 'Haruka Kanata Asian Kung-Fu Generation',        artist: 'Asian Kung-Fu' },
    { anime: 'Naruto',                            song: 'Blue Bird Ikimono gakari naruto',               artist: 'Ikimonogakari' },
    { anime: 'Naruto',                            song: 'Heroes Come Back nobodyknows naruto',           artist: 'nobodyknows' },
    { anime: 'Naruto',                            song: 'Silhouette KANA-BOON naruto',                  artist: 'KANA-BOON' },
    { anime: 'Naruto Shippuden',                  song: 'Sign FLOW Naruto Shippuden',                   artist: 'FLOW' },
    // One Piece
    { anime: 'One Piece',                         song: 'Wake Up AAA one piece',                        artist: 'AAA' },
    { anime: 'One Piece',                         song: 'We Are Kitadani Hiroshi one piece',             artist: 'Kitadani' },
    { anime: 'One Piece',                         song: 'Share the World Tohoshinki one piece',         artist: 'Tohoshinki' },
    // Haikyu
    { anime: 'Haikyu!!',                          song: 'Hikariare BURNOUT SYNDROMES haikyu',           artist: 'BURNOUT SYNDROMES' },
    { anime: 'Haikyu!!',                          song: 'Fly High BURNOUT SYNDROMES haikyu',            artist: 'BURNOUT SYNDROMES' },
    { anime: 'Haikyu!!',                          song: 'Imagination SPYAIR haikyu',                    artist: 'SPYAIR' },
    { anime: 'Haikyu!!',                          song: 'Im a Believer SPYAIR haikyu',                  artist: 'SPYAIR' },
    // My Hero Academia
    { anime: 'My Hero Academia',                  song: 'The Day Porno Graffitti My Hero Academia',     artist: 'Porno Graffitti' },
    { anime: 'My Hero Academia',                  song: 'Peace Sign Kenshi Yonezu My Hero Academia',    artist: 'Kenshi Yonezu' },
    { anime: 'My Hero Academia',                  song: 'Odd Future UVERworld My Hero Academia',        artist: 'UVERworld' },
    { anime: 'My Hero Academia',                  song: 'Polaris Blue Encount My Hero Academia',        artist: 'BLUE ENCOUNT' },
    // Tokyo Ghoul
    { anime: 'Tokyo Ghoul',                       song: 'Unravel TK from Ling tosite sigure',          artist: 'TK' },
    { anime: 'Tokyo Ghoul:re',                    song: 'Katharsis TK from Ling tosite sigure',        artist: 'TK' },
    { anime: 'Tokyo Ghoul:re',                    song: 'Munou Oshiro Project Tokyo Ghoul re',          artist: 'Oshiro' },
    // Demon Slayer
    { anime: 'Demon Slayer',                      song: 'Gurenge LiSA Demon Slayer',                   artist: 'LiSA' },
    { anime: 'Demon Slayer',                      song: 'Akeboshi LiSA Demon Slayer',                  artist: 'LiSA' },
    { anime: 'Demon Slayer',                      song: 'Zankyousanka Aimer Demon Slayer',             artist: 'Aimer' },
    { anime: 'Demon Slayer',                      song: 'Kizuna no Kiseki MAN WITH A MISSION Demon Slayer', artist: 'MAN WITH A MISSION' },
    // Black Clover
    { anime: 'Black Clover',                      song: 'Black Catcher Vickeblanka Black Clover',      artist: 'Vickeblanka' },
    { anime: 'Black Clover',                      song: 'PAiNT it BLACK BiSH Black Clover',            artist: 'BiSH' },
    // JJK
    { anime: 'Jujutsu Kaisen',                    song: 'Kaikai Kitan Eve Jujutsu Kaisen',             artist: 'Eve' },
    { anime: 'Jujutsu Kaisen',                    song: 'Ao no Sumika Tatsuya Kitani Jujutsu Kaisen',  artist: 'Tatsuya Kitani' },
    { anime: 'Jujutsu Kaisen',                    song: 'Specialz King Gnu Jujutsu Kaisen',            artist: 'King Gnu' },
    // Fire Force
    { anime: 'Fire Force',                        song: 'Inferno Mrs GREEN APPLE Fire Force',          artist: 'Mrs. GREEN APPLE' },
    { anime: 'Fire Force',                        song: 'Spark Again Aimer Fire Force',                artist: 'Aimer' },
    // Others
    { anime: 'Gintama',                           song: 'Sakuramitsutsuki SPYAIR Gintama',             artist: 'SPYAIR' },
    { anime: 'The Rising of the Shield Hero',     song: 'Rise MADKID Shield Hero',                     artist: 'MADKID' },
    { anime: 'Fate/Zero',                         song: 'Oath Sign LiSA Fate Zero',                    artist: 'LiSA' },
    { anime: 'Cowboy Bebop',                      song: 'Tank Seatbelts Cowboy Bebop',                 artist: 'SEAT BELTS' },
    { anime: 'The Irregular at Magic High School',song: 'Rising Hope LiSA',                            artist: 'LiSA' },
    { anime: 'Sword Art Online',                  song: 'Crossing Field LiSA Sword Art Online',        artist: 'LiSA' },
    { anime: 'Sword Art Online',                  song: 'Anima ReoNA Sword Art Online',                artist: 'ReoNA' },
    { anime: 'Vinland Saga',                      song: 'Mukanjyo Survive Said The Prophet',           artist: 'Survive Said The Prophet' },
    { anime: 'Rent-A-Girlfriend',                 song: 'Centimeter The Peggies Rent-A-Girlfriend',   artist: 'The Peggies' },
    { anime: 'Parasyte',                          song: 'Let Me Hear Fear Loathing in Las Vegas Parasyte', artist: 'Fear' },
    { anime: 'Ranking of Kings',                  song: 'BOY King Gnu Ranking of Kings',               artist: 'King Gnu' },
    { anime: 'Ranking of Kings',                  song: 'Hadaka no Yuusha King Gnu Ousama Ranking',    artist: 'King Gnu' },
    { anime: 'Call of the Night',                 song: 'Daten Creepy Nuts Call of the Night',         artist: 'Creepy Nuts' },
    { anime: 'The Apothecary Diaries',            song: 'Hana ni Natte Ryokuoushoku Shakai',           artist: 'Ryokuoushoku' },
    { anime: 'Your Lie in April',                 song: 'Hikaru Nara Goose House Your Lie in April',   artist: 'Goose House' },
    { anime: 'The Seven Deadly Sins',             song: 'Netsujou no Spectrum Ikimonogakari Seven Deadly Sins', artist: 'Ikimonogakari' },
    { anime: 'Dandadan',                          song: 'Otonoke Creepy Nuts Dandadan',                artist: 'Creepy Nuts' },
    { anime: 'Dandadan',                          song: 'Ore Wa Uchuu Ni Naru Aina THE END Dandadan', artist: 'Aina' },
    { anime: 'Pokemon',                           song: 'Pokemon Theme Jason Paige',                   artist: 'Jason Paige' },
    { anime: 'Spy x Family',                      song: 'Mixed Nuts Official HIGE DANdism Spy x Family', artist: 'HIGE' },
    { anime: 'Mobile Suit Gundam: The Witch from Mercury', song: 'The Blessing YOASOBI Gundam',        artist: 'YOASOBI' },
    { anime: 'Domestic Girlfriend',               song: 'Kawaki wo Ameku Minami Domestic Girlfriend',  artist: 'Minami' },
    { anime: 'Noragami Aragoto',                  song: 'Kyouran Hey Kids THE ORAL CIGARETTES Noragami', artist: 'ORAL CIGARETTES' },
    { anime: 'Mashle',                            song: 'Bling Bang Bang Born Creepy Nuts Mashle',     artist: 'Creepy Nuts' },
    { anime: 'Chainsaw Man',                      song: 'Kick Back Kenshi Yonezu Chainsaw Man',        artist: 'Kenshi Yonezu' },
    { anime: 'Beastars',                          song: 'Kaibutsu YOASOBI Beastars',                  artist: 'YOASOBI' },
    { anime: 'The Promised Neverland',            song: 'Touch Off UVERworld Promised Neverland',      artist: 'UVERworld' },
    { anime: 'Hunter x Hunter',                   song: 'departure Masatoshi Ono Hunter x Hunter',     artist: 'Masatoshi' },
    { anime: 'Code Geass',                        song: 'Colors FLOW Code Geass',                      artist: 'FLOW' },
    { anime: 'Mob Psycho 100',                    song: '99 MOB CHOIR Mob Psycho',                     artist: 'MOB CHOIR' },
    { anime: 'Death Note',                        song: 'the WORLD NIGHTMARE Death Note',              artist: 'NIGHTMARE' },
    { anime: 'Bleach',                            song: 'Asterisk Orange Range Bleach',                artist: 'Orange Range' },
    { anime: 'Fullmetal Alchemist: Brotherhood',  song: 'Again YUI Fullmetal Alchemist Brotherhood',   artist: 'YUI' },
    { anime: 'Steins;Gate',                       song: 'Hacking to the Gate Kanako Ito Steins Gate',  artist: 'Kanako' },
    { anime: 'No Game No Life',                   song: 'This Game Konomi Suzuki No Game No Life',     artist: 'Konomi Suzuki' },
];

console.log(`Verifying ${SONGS.length} songs (checking original artist)...\n`);

const verified = [];
const failed = [];

for (const s of SONGS) {
    const tracks = await itunesSearch(s.song, 5);
    const match = tracks.find(t =>
        t.previewUrl &&
        t.artistName.toLowerCase().includes(s.artist.toLowerCase())
    );
    if (match) {
        console.log(`✓  [${s.anime}] ${match.artistName} — ${match.trackName}`);
        verified.push({ anime: s.anime, audio: match.previewUrl });
    } else {
        const any = tracks[0];
        if (any) {
            console.log(`✗  [${s.anime}] COVER/MISMATCH: "${any.artistName}" — expected artist containing "${s.artist}"`);
        } else {
            console.log(`✗  [${s.anime}] No results for: ${s.song}`);
        }
        failed.push(s);
    }
    await sleep(700);
}

console.log(`\n\n// ── Clean OB_POOL (${verified.length} verified originals) ──`);
console.log(`const OB_POOL = [`);
verified.forEach(r => console.log(`    { anime: '${r.anime.replace(/'/g, "\\'")}', audio: '${r.audio}' },`));
console.log(`];`);
console.log(`\n// ✓ ${verified.length}  ✗ ${failed.length} (not on iTunes or only covers available)`);
if (failed.length) {
    console.log('\n// Not found as originals:');
    failed.forEach(s => console.log(`//   [${s.anime}] ${s.song} (looking for: ${s.artist})`));
}
