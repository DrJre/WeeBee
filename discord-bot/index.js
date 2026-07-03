require('dotenv').config();

const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, EmbedBuilder, ComponentType, AttachmentBuilder,
} = require('discord.js');

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

// Register system fonts — track which family name to use in canvas
let FONT_FAMILY = 'sans-serif';
for (const [fontPath, family] of [
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',        'DejaVu Sans'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',             'DejaVu Sans'],
  ['/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', 'Liberation Sans'],
  ['/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf','Liberation Sans'],
]) {
  try { GlobalFonts.registerFromPath(fontPath, family); FONT_FAMILY = family; } catch {}
}
console.log('[font] Using font family:', FONT_FAMILY);

// ── Firebase ──────────────────────────────────────────────────────────────────
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString())
  : require('./service-account.json');

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ── Discord ───────────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ── Constants ─────────────────────────────────────────────────────────────────
const CHANNEL_ID        = process.env.DISCORD_CHANNEL_ID;
const DROP_INTERVAL_MS  = 5 * 60 * 1000;
const CLAIM_WINDOW_MS   = 15 * 1000;
const SR_COOLDOWN_MS    = 60 * 60 * 1000;
const SSR_COOLDOWN_MS   = 3 * 60 * 60 * 1000;
const SSR_BLACKOUT_MS   = 44 * 60 * 60 * 1000;
const SSR_ACTIVE_CHANCE = 0.01;

const RARITY_CONFIG = {
  common: { label: 'Common', emoji: '⬜', color: 0x9e9e9e, hex: '#9e9e9e', glow: 0  },
  rare:   { label: 'Rare',   emoji: '🔵', color: 0x2196f3, hex: '#2196f3', glow: 8  },
  sr:     { label: 'SR',     emoji: '⭐', color: 0xffc107, hex: '#ffc107', glow: 16 },
  ssr:    { label: 'SSR',    emoji: '💜', color: 0x9c27b0, hex: '#9c27b0', glow: 22 },
};

// ── Card renderer ─────────────────────────────────────────────────────────────
function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth) {
  let t = text;
  while (ctx.measureText(t).width > maxWidth && t.length > 4) {
    t = t.slice(0, -4) + '...';
  }
  return t;
}

async function renderCardImage(card, rarity) {
  const cfg    = RARITY_CONFIG[rarity] || RARITY_CONFIG.common;
  const W      = 360;
  const H      = 500;
  const RADIUS = 14;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // Clip entire card to rounded rect
  ctx.save();
  roundedRect(ctx, 0, 0, W, H, RADIUS);
  ctx.clip();

  // Dark fallback background
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, W, H);

  // Card art — clipped inside frame border (10px inset)
  const INSET = 10;
  const INNER_R = RADIUS - INSET / 2;
  ctx.save();
  roundedRect(ctx, INSET, INSET, W - INSET * 2, H - INSET * 2, INNER_R);
  ctx.clip();
  try {
    const img  = await loadImage(card.image);
    const artW = W - INSET * 2;
    const artH = H - INSET * 2;
    const imgR = img.width / img.height;
    const areR = artW / artH;
    let dw, dh, dx, dy;
    if (imgR > areR) {
      dh = artH; dw = dh * imgR; dx = INSET + (artW - dw) / 2; dy = INSET;
    } else {
      dw = artW; dh = dw / imgR; dx = INSET; dy = INSET + (artH - dh) / 2;
    }
    ctx.drawImage(img, dx, dy, dw, dh);
  } catch { /* fallback dark bg */ }
  ctx.restore();

  // Subtle bottom gradient so text is readable over art
  const grad = ctx.createLinearGradient(0, H * 0.55, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.78)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, H * 0.55, W, H * 0.45);

  // Character name
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 22px "${FONT_FAMILY}"`;
  ctx.textAlign = 'left';
  ctx.fillText(fitText(ctx, card.name, W - 28), 18, H - 52);

  // Anime / series
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `13px "${FONT_FAMILY}"`;
  ctx.fillText(fitText(ctx, card.series || card.anime || '', W - 28), 18, H - 32);

  // Frame overlay — user-supplied transparent PNG per rarity
  // Place PNGs in discord-bot/frames/frame-common.png etc.
  try {
    const frame = await loadImage(`${__dirname}/frames/frame-${rarity}.png`);
    ctx.drawImage(frame, 0, 0, W, H);
  } catch {
    // No frame file yet — simple rarity border fallback
    if (cfg.glow > 0) { ctx.shadowColor = cfg.hex; ctx.shadowBlur = cfg.glow; }
    ctx.strokeStyle = cfg.hex;
    ctx.lineWidth = 4;
    roundedRect(ctx, 2, 2, W - 4, H - 4, RADIUS - 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  ctx.restore();

  return canvas.toBuffer('image/png');
}

// ── Rarity roll ───────────────────────────────────────────────────────────────
async function rollRarity() {
  const stateDoc = await db.doc('discord_bot_state/drops').get();
  const lastSSRTime = stateDoc.exists ? (stateDoc.data().lastSSRDropTime?.toMillis() || 0) : 0;

  if (Date.now() - lastSSRTime > SSR_BLACKOUT_MS && Math.random() < SSR_ACTIVE_CHANCE) {
    return 'ssr';
  }

  const r = Math.random();
  if (r < 0.05)  return 'sr';
  if (r < 0.368) return 'rare';
  return 'common';
}

// ── Card selection ────────────────────────────────────────────────────────────
async function pickCard(rarity) {
  const snap = await db.collection('characters').where('rarityTier', '==', rarity).get();
  if (snap.empty) return null;
  const doc = snap.docs[Math.floor(Math.random() * snap.docs.length)];
  return { id: doc.id, ...doc.data() };
}

function randomSerial() {
  return Math.floor(Math.random() * 5000) + 1;
}

// ── Eligibility check ─────────────────────────────────────────────────────────
async function checkEligibility(discordId, rarity) {
  const linkDoc = await db.doc(`discord_links/${discordId}`).get();
  if (!linkDoc.exists) return { eligible: false, reason: 'not_linked' };

  const data = linkDoc.data();
  const now  = Date.now();

  if (rarity === 'sr') {
    const lastWin = data.lastSRWin?.toMillis() || 0;
    if (now - lastWin < SR_COOLDOWN_MS) return { eligible: false, reason: 'cooldown' };
  } else if (rarity === 'ssr') {
    const lastWin = data.lastSSRWin?.toMillis() || 0;
    if (now - lastWin < SSR_COOLDOWN_MS) return { eligible: false, reason: 'cooldown' };
  }

  return { eligible: true, uid: data.uid, displayName: data.displayName };
}

// ── Card drop ─────────────────────────────────────────────────────────────────
async function dropCard() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel) return console.error('[drop] Channel not found:', CHANNEL_ID);

    const rarity = await rollRarity();
    const card   = await pickCard(rarity);
    if (!card) return console.warn('[drop] No cards found for rarity:', rarity);

    const cfg = RARITY_CONFIG[rarity];
    const animeName = card.series || card.anime || 'Unknown';

    // Render card image
    const cardBuffer = await renderCardImage(card, rarity);
    const attachment = new AttachmentBuilder(cardBuffer, { name: 'card.png' });

    const embed = new EmbedBuilder()
      .setTitle(`${cfg.emoji}  Card Drop — ${cfg.label}`)
      .setDescription(`**${card.name}**\n*${animeName}*\n\nClick **Claim** to enter the draw!\nWinner picked in 15 seconds.`)
      .setImage('attachment://card.png')
      .setColor(cfg.color)
      .setFooter({ text: 'WeeBee TCG  •  Link your account at weebee-fbbd8.web.app' });

    const claimBtn = new ButtonBuilder()
      .setCustomId('claim_card')
      .setLabel('✋  Claim')
      .setStyle(ButtonStyle.Primary);

    const message = await channel.send({
      embeds: [embed],
      files: [attachment],
      components: [new ActionRowBuilder().addComponents(claimBtn)],
    });

    const claimants = new Map();

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: CLAIM_WINDOW_MS,
    });

    collector.on('collect', async interaction => {
      if (claimants.has(interaction.user.id)) {
        return interaction.reply({ content: 'You already entered!', ephemeral: true });
      }
      claimants.set(interaction.user.id, interaction.user.username);
      await interaction.reply({
        content: `✅ You're in the draw! (${claimants.size} entered)`,
        ephemeral: true,
      });
    });

    collector.on('end', async () => {
      try {
        await message.edit({
          components: [new ActionRowBuilder().addComponents(
            ButtonBuilder.from(claimBtn).setDisabled(true)
          )],
        }).catch(() => {});

        if (claimants.size === 0) {
          return channel.send('No one claimed the card — it vanished! 💨');
        }

        const eligible = [];
        for (const [discordId] of claimants) {
          const check = await checkEligibility(discordId, rarity);
          if (check.eligible) eligible.push({ discordId, uid: check.uid, displayName: check.displayName });
        }

        if (eligible.length === 0) {
          return channel.send(
            'Everyone who entered is on cooldown or hasn\'t linked their WeeBee account — card vanished! 💨\n' +
            '*Link at weebee-fbbd8.web.app → Edit Profile → Discord*'
          );
        }

        const winner  = eligible[Math.floor(Math.random() * eligible.length)];
        const animeName = card.series || card.anime || 'Unknown';
        const serial  = randomSerial();

        await db.collection('card_collections').doc(winner.uid).collection('cards').add({
          name:    card.name,
          anime:   animeName,
          rarity,
          image:   card.image,
          serial,
          edition: null,
          source:  'discord_drop',
          pulledAt: Timestamp.now(),
        });

        const cooldownUpdate = {};
        if (rarity === 'sr')  cooldownUpdate.lastSRWin  = Timestamp.now();
        if (rarity === 'ssr') cooldownUpdate.lastSSRWin = Timestamp.now();
        if (Object.keys(cooldownUpdate).length > 0) {
          await db.doc(`discord_links/${winner.discordId}`).update(cooldownUpdate);
        }

        if (rarity === 'ssr') {
          await db.doc('discord_bot_state/drops').set(
            { lastSSRDropTime: Timestamp.now() },
            { merge: true }
          );
        }

        const msg =
          rarity === 'ssr' ? `🎊 **SSR DROP!** <@${winner.discordId}> claimed **${card.name}** (SSR · #${String(serial).padStart(3,'0')})! Added to their WeeBee collection.` :
          rarity === 'sr'  ? `⭐ <@${winner.discordId}> claimed **${card.name}** (SR · #${String(serial).padStart(3,'0')})! Added to their WeeBee collection.` :
                             `🎉 <@${winner.discordId}> claimed **${card.name}** (#${String(serial).padStart(3,'0')})! Added to their WeeBee collection.`;

        await channel.send(msg);
      } catch (err) {
        console.error('[drop] End handler error:', err);
        channel.send('Something went wrong picking a winner. The card vanished! 💨').catch(() => {});
      }
    });
  } catch (err) {
    console.error('[drop] Error:', err);
  }
}

// ── /drop command (admin only) ────────────────────────────────────────────────
async function handleDrop(interaction) {
  if (!interaction.memberPermissions.has('Administrator')) {
    return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
  }
  await interaction.reply({ content: '🃏 Triggering a card drop...', ephemeral: true });
  await dropCard();
}

// ── /link command ─────────────────────────────────────────────────────────────
async function handleLink(interaction) {
  const code = interaction.options.getString('code').toUpperCase().trim();
  const ref  = db.doc(`discord_pending_links/${code}`);
  const doc  = await ref.get();

  if (!doc.exists) {
    return interaction.reply({ content: '❌ Invalid or expired code. Generate a new one on WeeBee.', ephemeral: true });
  }

  const { uid, displayName, createdAt } = doc.data();

  if (Date.now() - createdAt.toMillis() > 10 * 60 * 1000) {
    await ref.delete();
    return interaction.reply({ content: '❌ Code expired (10 min). Generate a new one on WeeBee.', ephemeral: true });
  }

  const existing = await db.doc(`discord_links/${interaction.user.id}`).get();
  if (existing.exists && existing.data().uid !== uid) {
    return interaction.reply({
      content: '⚠️ This Discord account is already linked to a different WeeBee account.',
      ephemeral: true,
    });
  }

  await db.doc(`discord_links/${interaction.user.id}`).set({
    uid,
    displayName,
    linkedAt: Timestamp.now(),
  }, { merge: true });

  await db.doc(`profiles/${uid}`).update({
    discordLinked:   true,
    discordId:       interaction.user.id,
    discordUsername: interaction.user.username,
  });

  await ref.delete();

  return interaction.reply({
    content: `✅ Linked to WeeBee account **${displayName}**! You can now claim card drops.`,
    ephemeral: true,
  });
}

// ── Startup ───────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`[bot] Online as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), {
    body: [
      new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Discord account to WeeBee so you can claim card drops')
        .addStringOption(opt =>
          opt.setName('code')
            .setDescription('The 6-character code from your WeeBee profile')
            .setRequired(true)
        )
        .toJSON(),
      new SlashCommandBuilder()
        .setName('drop')
        .setDescription('Force an immediate card drop (admin only)')
        .toJSON(),
    ],
  });
  console.log('[bot] Slash commands registered');

  setTimeout(dropCard, 60 * 1000);
  setInterval(dropCard, DROP_INTERVAL_MS);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'link') await handleLink(interaction);
  if (interaction.commandName === 'drop') await handleDrop(interaction);
});

client.login(process.env.DISCORD_BOT_TOKEN);
