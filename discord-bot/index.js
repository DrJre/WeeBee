require('dotenv').config();

const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, EmbedBuilder, ComponentType, AttachmentBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const express = require('express');
const Stripe = require('stripe');

let FONT_FAMILY = 'sans-serif';

async function loadFont() {
  const https = require('https');
  const urls = [
    'https://cdn.jsdelivr.net/npm/@fontsource/roboto@5.0.8/files/roboto-latin-700-normal.woff2',
    'https://cdn.jsdelivr.net/npm/@fontsource/roboto@5.0.8/files/roboto-latin-400-normal.woff2',
  ];
  for (const url of urls) {
    try {
      const buf = await new Promise((resolve, reject) => {
        https.get(url, res => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        }).on('error', reject);
      });
      GlobalFonts.register(buf, 'Roboto');
      FONT_FAMILY = 'Roboto';
      console.log('[font] Loaded Roboto from CDN');
      return;
    } catch(e) { console.warn('[font] CDN attempt failed:', e.message); }
  }
  console.warn('[font] All font sources failed, text may not render');
}

// ── Firebase ──────────────────────────────────────────────────────────────────
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString())
  : require('./service-account.json');

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ── Stripe ────────────────────────────────────────────────────────────────────
const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;

const AMBER_BUNDLES = [
  { id: 'amber_1000',  label: '750 Amber',    bonus: 250,   amount: 1000,  price: 99  },
  { id: 'amber_5750',  label: '5,000 Amber',  bonus: 750,   amount: 5750,  price: 499 },
  { id: 'amber_12000', label: '10,000 Amber', bonus: 2000,  amount: 12000, price: 999 },
];

// ── Webhook server (Stripe) ───────────────────────────────────────────────────
const webhookApp = express();

webhookApp.post('/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    await handleAmberPurchase(event.data.object).catch(e =>
      console.error('[stripe] handleAmberPurchase error:', e)
    );
  }

  res.json({ received: true });
});

webhookApp.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
webhookApp.listen(PORT, () => console.log(`[webhook] Listening on port ${PORT}`));

async function handleAmberPurchase(session) {
  const sessionId  = session.id;
  const discordId  = session.client_reference_id;
  const bundleId   = session.metadata?.bundleId;
  const bundle     = AMBER_BUNDLES.find(b => b.id === bundleId);

  if (!discordId || !bundle) {
    console.error('[stripe] Missing discordId or unknown bundle on session:', sessionId);
    return;
  }

  const sessionRef = db.doc(`stripe_sessions/${sessionId}`);
  const linkRef    = db.doc(`discord_links/${discordId}`);

  let uid;
  try {
    await db.runTransaction(async tx => {
      const [sessionSnap, linkSnap] = await Promise.all([tx.get(sessionRef), tx.get(linkRef)]);

      if (sessionSnap.exists) return; // Already processed (Stripe retry)

      if (!linkSnap.exists) throw Object.assign(new Error('no_link'), { discordId });

      uid = linkSnap.data().uid;
      tx.set(sessionRef, { uid, bundleId, amberGranted: bundle.amount, processedAt: Timestamp.now() });
      tx.update(db.doc(`profiles/${uid}`), { amber: FieldValue.increment(bundle.amount) });
    });
  } catch (err) {
    if (err.message === 'no_link') {
      try {
        const user = await client.users.fetch(discordId);
        await user.send(
          `⚠️ Your Amber purchase went through but your Discord isn't linked to WeeBee yet.\n` +
          `Link it at https://weebee.buzz → Edit Profile → Discord, then DM the server owner with your Stripe receipt.`
        );
      } catch {}
      return;
    }
    throw err;
  }

  // Notify user
  const amountStr = bundle.amount.toLocaleString();
  try {
    const user = await client.users.fetch(discordId);
    await user.send(`🟡 **+${amountStr} Amber** has been added to your WeeBee account!\nHead to https://weebee.buzz to spend it in the pack store.`);
  } catch {
    // DMs disabled — fall back to the drops channel
    try {
      const channel = await client.channels.fetch(CHANNEL_ID);
      await channel.send(`<@${discordId}> 🟡 **+${amountStr} Amber** added to your WeeBee account!`);
    } catch {}
  }
}

// ── Discord ───────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

// ── Constants ─────────────────────────────────────────────────────────────────
const CHANNEL_ID              = process.env.DISCORD_CHANNEL_ID;
const DROP_ROLE_CHANNEL_ID    = '1521636275403362527';

// ── Drop-role config (loaded from Firestore on startup) ───────────────────────
let dropRoleConfig = null; // { roleId, messageId, channelId }

async function loadDropRoleConfig() {
  try {
    const snap = await db.doc('discord_bot_state/drop_role').get();
    if (snap.exists) dropRoleConfig = snap.data();
  } catch(e) {
    console.error('[drop-role] Failed to load config:', e.message);
  }
}
const DROP_INTERVAL_MS  = 5 * 60 * 1000;
const CLAIM_WINDOW_MS     = 15 * 1000;
const SSR_CLAIM_WINDOW_MS = 60 * 1000;
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

  // Subtle top gradient (matches bottom)
  const topGrad = ctx.createLinearGradient(0, 0, 0, H * 0.35);
  topGrad.addColorStop(0, 'rgba(0,0,0,0.55)');
  topGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, W, H * 0.35);

  // Subtle bottom gradient so text is readable over art
  const grad = ctx.createLinearGradient(0, H * 0.55, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.78)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, H * 0.55, W, H * 0.45);

  // Frame overlay — drawn before text so text sits on top
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

  // Character name — drawn last so it's always on top
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 22px "${FONT_FAMILY}"`;
  ctx.textAlign = 'left';
  ctx.fillText(fitText(ctx, card.name, W - 50), 32, H - 79);

  // Anime / series
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `16px "${FONT_FAMILY}"`;
  ctx.fillText(fitText(ctx, card.series || card.anime || '', W - 50), 32, H - 56);

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

const RARITY_MAX_VERSIONS = { common: 5000, rare: 2500, sr: 500, ssr: 250, ur: 50 };

function cardKey(rarity, name, anime) {
  const slug = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return `${rarity}_${slug(name)}_${slug(anime)}`;
}

function shufflePool(max) {
  const arr = Array.from({ length: max }, (_, i) => i + 1);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function assignSerial(rarity, name, anime) {
  const max = RARITY_MAX_VERSIONS[rarity] || 5000;
  const key = cardKey(rarity, name, anime);
  const ref = db.doc(`card_serials/${key}`);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || !snap.data().versionsRemaining?.length) {
      const edition = snap.exists ? (snap.data().edition || 1) + 1 : 1;
      const pool = shufflePool(max);
      const version = pool.pop();
      tx.set(ref, { versionsRemaining: pool, edition, maxVersions: max });
      return { serial: version, edition };
    }
    const { edition = 1 } = snap.data();
    const pool = [...snap.data().versionsRemaining];
    const idx = Math.floor(Math.random() * pool.length);
    const version = pool.splice(idx, 1)[0];
    tx.update(ref, { versionsRemaining: pool });
    return { serial: version, edition };
  });
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
    const claimWindow = rarity === 'ssr' ? SSR_CLAIM_WINDOW_MS : CLAIM_WINDOW_MS;
    const claimSeconds = claimWindow / 1000;

    // Render card image
    const cardBuffer = await renderCardImage(card, rarity);
    const attachment = new AttachmentBuilder(cardBuffer, { name: 'card.png' });

    const embed = new EmbedBuilder()
      .setTitle(`${cfg.emoji}  Card Drop — ${cfg.label}`)
      .setDescription(`**${card.name}**\n*${animeName}*\n\nClick **Claim** to enter the draw!\nWinner picked in ${claimSeconds} seconds.`)
      .setImage('attachment://card.png')
      .setColor(cfg.color)
      .setFooter({ text: 'WeeBee TCG  •  Link your account at weebee-fbbd8.web.app' });

    const claimBtn = new ButtonBuilder()
      .setCustomId('claim_card')
      .setLabel('✋  Claim')
      .setStyle(ButtonStyle.Primary);

    const dropPayload = {
      embeds: [embed],
      files: [attachment],
      components: [new ActionRowBuilder().addComponents(claimBtn)],
    };
    if (rarity === 'ssr' && dropRoleConfig?.roleId) {
      dropPayload.content = `<@&${dropRoleConfig.roleId}>`;
    }
    const message = await channel.send(dropPayload);

    const claimants = new Map();

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: claimWindow,
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
        const { serial, edition } = await assignSerial(rarity, card.name, animeName);
        const maxVersions = RARITY_MAX_VERSIONS[rarity] || 5000;

        await db.collection('card_collections').doc(winner.uid).collection('cards').add({
          name:    card.name,
          anime:   animeName,
          rarity,
          image:   card.image,
          serial,
          edition,
          maxVersions,
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

// ── /buy-amber command ────────────────────────────────────────────────────────
async function handleBuyAmber(interaction) {
  if (!stripe) {
    return interaction.reply({ content: '❌ Amber purchases are not available yet.', ephemeral: true });
  }

  const linkDoc = await db.doc(`discord_links/${interaction.user.id}`).get();
  if (!linkDoc.exists) {
    return interaction.reply({
      content: '❌ Link your WeeBee account first — run `/link` with your code from WeeBee.',
      ephemeral: true,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('🟡  Buy Amber')
    .setDescription('Amber is WeeBee\'s TCG currency. Use it to open packs in the store.')
    .addFields(AMBER_BUNDLES.map(b => ({
      name: `$${(b.price / 100).toFixed(2)} — ${b.label} + **${b.bonus.toLocaleString()} Bonus** 🎁`,
      value: `**${b.amount.toLocaleString()} Amber total**`,
      inline: false,
    })))
    .setColor(0xffc107)
    .setFooter({ text: 'Payments processed securely by Stripe · Link expires in 30 min' });

  const buttons = AMBER_BUNDLES.map(b =>
    new ButtonBuilder()
      .setCustomId(`buy_amber_${b.id}`)
      .setLabel(`${b.label} + ${b.bonus.toLocaleString()} Bonus · $${(b.price / 100).toFixed(2)}`)
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.reply({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(...buttons)],
    ephemeral: true,
  });
}

async function handleBuyAmberButton(interaction, bundleId) {
  const bundle = AMBER_BUNDLES.find(b => b.id === bundleId);
  if (!bundle) return interaction.reply({ content: '❌ Unknown bundle.', ephemeral: true });

  await interaction.deferReply({ ephemeral: true });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${bundle.label} — WeeBee TCG`,
            description: 'Amber currency for WeeBee TCG. Added to your linked WeeBee account automatically.',
          },
          unit_amount: bundle.price,
        },
        quantity: 1,
      }],
      mode: 'payment',
      client_reference_id: interaction.user.id,
      metadata: { bundleId: bundle.id },
      success_url: `${process.env.PUBLIC_URL || 'https://weebee.buzz'}?amber_purchased=1`,
      cancel_url:  process.env.PUBLIC_URL || 'https://weebee.buzz',
      expires_at:  Math.floor(Date.now() / 1000) + 30 * 60,
    });

    await interaction.editReply({
      content:
        `✅ **Your payment link is ready:**\n${session.url}\n\n` +
        `*Amber is added to your WeeBee account automatically after payment. Link expires in 30 minutes.*`,
    });
  } catch (err) {
    console.error('[stripe] Failed to create checkout session:', err);
    await interaction.editReply({ content: '❌ Failed to create payment link. Please try again.' });
  }
}

// ── /suggest command ─────────────────────────────────────────────────────────

const SUGGEST_STATUS_COLORS = {
  pending:      0x5865f2,
  under_review: 0xf59e0b,
  approved:     0x22c55e,
  declined:     0xef4444,
};
const SUGGEST_STATUS_LABELS = {
  pending:      '⏳ Pending',
  under_review: '⏳ Under Review',
  approved:     '✅ Approved',
  declined:     '❌ Declined',
};

function buildSuggestEmbed(data) {
  const catEmoji = data.category === 'discord' ? '🎮' : '🌐';
  const catLabel = data.category === 'discord' ? 'Discord Server' : 'Website';
  const status   = data.status || 'pending';
  return new EmbedBuilder()
    .setColor(SUGGEST_STATUS_COLORS[status] || 0x5865f2)
    .setTitle(`${catEmoji} ${data.title}`)
    .setDescription(data.description)
    .addFields(
      { name: 'Category',     value: catLabel,                       inline: true },
      { name: 'Status',       value: SUGGEST_STATUS_LABELS[status],  inline: true },
      { name: 'Submitted by', value: data.discordUsername,           inline: true },
    )
    .setFooter({ text: 'Use /suggest to submit your own idea' })
    .setTimestamp(data.timestamp?.toDate?.() ?? new Date());
}

function buildSuggestButtons(docId, status) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`suggest_review_${docId}`)
      .setLabel('Under Review')
      .setEmoji('⏳')
      .setStyle(status === 'under_review' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(status === 'under_review'),
    new ButtonBuilder()
      .setCustomId(`suggest_approve_${docId}`)
      .setLabel('Approve')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(status === 'approved'),
    new ButtonBuilder()
      .setCustomId(`suggest_decline_${docId}`)
      .setLabel('Decline')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(status === 'declined'),
  );
}

async function handleSuggest(interaction) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('suggest_cat_website')
      .setLabel('🌐 Website Suggestion')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('suggest_cat_discord')
      .setLabel('🎮 Discord Suggestion')
      .setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({
    content: '**What kind of suggestion do you have?**',
    components: [row],
    ephemeral: true,
  });
}

async function handleSuggestCategory(interaction, category) {
  const modal = new ModalBuilder()
    .setCustomId(`suggest_modal_${category}`)
    .setTitle(category === 'discord' ? '🎮 Discord Suggestion' : '🌐 Website Suggestion');

  const titleInput = new TextInputBuilder()
    .setCustomId('suggest_title')
    .setLabel('Title (short summary)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(true)
    .setPlaceholder('e.g. Add a leaderboard for pack openings');

  const descInput = new TextInputBuilder()
    .setCustomId('suggest_description')
    .setLabel('Description (details)')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setRequired(true)
    .setPlaceholder('Describe your idea clearly. The more detail, the better!');

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(descInput),
  );

  await interaction.showModal(modal);
}

async function handleSuggestModal(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const category = interaction.customId.replace('suggest_modal_', '');
  const title    = interaction.fields.getTextInputValue('suggest_title').trim();
  const desc     = interaction.fields.getTextInputValue('suggest_description').trim();

  const data = {
    title,
    description: desc,
    category,
    source:          'discord',
    status:          'pending',
    discordUserId:   interaction.user.id,
    discordUsername: interaction.user.tag || interaction.user.username,
    discordMessageId:  null,
    discordChannelId:  null,
    timestamp: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };

  let docId;
  try {
    const ref = await db.collection('feature_suggestions').add(data);
    docId = ref.id;
  } catch(e) {
    console.error('[suggest] Firestore write failed:', e);
    return interaction.editReply({ content: '❌ Failed to save your suggestion. Please try again.' });
  }

  const channelId = process.env.SUGGESTIONS_CHANNEL_ID;
  if (channelId) {
    try {
      const channel = await interaction.client.channels.fetch(channelId);
      const msg = await channel.send({
        embeds:     [buildSuggestEmbed(data)],
        components: [buildSuggestButtons(docId, 'pending')],
      });
      await msg.react('👍');
      await msg.react('👎');
      await db.collection('feature_suggestions').doc(docId).update({
        discordMessageId: msg.id,
        discordChannelId: channelId,
      });
    } catch(e) {
      console.error('[suggest] Failed to post to suggestions channel:', e.message);
    }
  }

  await interaction.editReply({ content: '🎉 Your suggestion has been submitted! Thanks for helping improve WeeBee.' });
}

async function handleSuggestStatus(interaction, newStatus, docId) {
  if (!interaction.memberPermissions.has('Administrator')) {
    return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const ref  = db.collection('feature_suggestions').doc(docId);
  const snap = await ref.get();
  if (!snap.exists) {
    return interaction.editReply({ content: '❌ Suggestion not found.' });
  }

  const data = { ...snap.data(), status: newStatus, updatedAt: Timestamp.now() };
  await ref.update({ status: newStatus, updatedAt: Timestamp.now() });

  try {
    await interaction.message.edit({
      embeds:     [buildSuggestEmbed(data)],
      components: [buildSuggestButtons(docId, newStatus)],
    });
  } catch(e) {
    console.error('[suggest] Failed to edit embed:', e.message);
  }

  await interaction.editReply({ content: `✅ Status updated to **${SUGGEST_STATUS_LABELS[newStatus]}**.` });
}

// ── /announce command (Owner / Admin only) ────────────────────────────────────
async function handleAnnounce(interaction) {
  const memberRoles = interaction.member.roles.cache;
  const hasPermission =
    interaction.memberPermissions.has('Administrator') ||
    memberRoles.some(r => r.name === 'Owner' || r.name === 'Admin');

  if (!hasPermission) {
    return interaction.reply({
      content: '❌ Only members with the **Owner** or **Admin** role can use this command.',
      ephemeral: true,
    });
  }

  const title         = interaction.options.getString('title');
  const body          = interaction.options.getString('body');
  const image         = interaction.options.getAttachment('image');
  const targetChannel = interaction.options.getChannel('channel');

  await interaction.deferReply({ ephemeral: true });

  const destination = interaction.options.getString('destination') || 'announcements';
  const DESTINATION_CHANNELS = {
    announcements: process.env.ANNOUNCEMENTS_CHANNEL_ID,
    events:        process.env.EVENTS_CHANNEL_ID,
    giveaways:     process.env.GIVEAWAYS_CHANNEL_ID,
  };
  const channelId = targetChannel?.id || DESTINATION_CHANNELS[destination] || process.env.ANNOUNCEMENTS_CHANNEL_ID || CHANNEL_ID;

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch {
    return interaction.editReply({
      content: '❌ Could not find the target channel. Set `ANNOUNCEMENTS_CHANNEL_ID` in the bot config or pass a `channel` option.',
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(body)
    .setColor(0xffc107)
    .setTimestamp()
    .setFooter({ text: 'WeeBee' });

  if (image) embed.setImage(image.url);

  try {
    await channel.send({ embeds: [embed] });
    await interaction.editReply({ content: `✅ Announcement posted in <#${channelId}>!` });
  } catch(e) {
    console.error('[announce] Failed to send:', e.message);
    await interaction.editReply({ content: '❌ Failed to post — check that the bot has permission to send messages in that channel.' });
  }
}

// ── /setup-drop-role command ──────────────────────────────────────────────────
async function handleSetupDropRole(interaction) {
  if (!interaction.memberPermissions.has('Administrator')) {
    return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;

  // Create or reuse the BIG DROP role
  let role = guild.roles.cache.find(r => r.name === 'BIG DROP');
  if (!role) {
    role = await guild.roles.create({
      name: 'BIG DROP',
      color: 0x9c27b0,
      mentionable: true,
      reason: 'WeeBee SSR+ drop notifications',
    });
    console.log('[drop-role] Created BIG DROP role:', role.id);
  }

  const channel = await client.channels.fetch(DROP_ROLE_CHANNEL_ID);

  // Delete previous notification message if one was set
  if (dropRoleConfig?.messageId) {
    try {
      const old = await channel.messages.fetch(dropRoleConfig.messageId);
      await old.delete();
    } catch {}
  }

  const embed = new EmbedBuilder()
    .setTitle('🔔  Big Drop Notifications')
    .setDescription(
      'React with 🔔 below to get the **BIG DROP** role and be pinged whenever an **SSR** card drops in the card channel!\n\n' +
      'Remove your reaction to opt out at any time.'
    )
    .setColor(0x9c27b0)
    .setFooter({ text: 'WeeBee TCG' });

  const msg = await channel.send({ embeds: [embed] });
  await msg.react('🔔');

  const config = { roleId: role.id, messageId: msg.id, channelId: DROP_ROLE_CHANNEL_ID };
  await db.doc('discord_bot_state/drop_role').set(config, { merge: true });
  dropRoleConfig = config;

  await interaction.editReply({
    content: `✅ Done! **BIG DROP** role is ready (${role.id}) and the opt-in message is posted in <#${DROP_ROLE_CHANNEL_ID}>.`,
  });
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
// ── Reaction-role listeners ───────────────────────────────────────────────────
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (!dropRoleConfig?.messageId) return;
  if (reaction.message.id !== dropRoleConfig.messageId) return;
  if (reaction.emoji.name !== '🔔') return;
  try {
    const guild  = reaction.message.guild;
    const member = await guild.members.fetch(user.id);
    await member.roles.add(dropRoleConfig.roleId);
  } catch(e) { console.error('[drop-role] Add role failed:', e.message); }
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  if (!dropRoleConfig?.messageId) return;
  if (reaction.message.id !== dropRoleConfig.messageId) return;
  if (reaction.emoji.name !== '🔔') return;
  try {
    const guild  = reaction.message.guild;
    const member = await guild.members.fetch(user.id);
    await member.roles.remove(dropRoleConfig.roleId);
  } catch(e) { console.error('[drop-role] Remove role failed:', e.message); }
});

client.once('ready', async () => {
  console.log(`[bot] Online as ${client.user.tag}`);
  await loadFont();
  await loadDropRoleConfig();
  // Cache the opt-in message so reaction events fire reliably after restarts
  if (dropRoleConfig?.messageId && dropRoleConfig?.channelId) {
    try {
      const ch = await client.channels.fetch(dropRoleConfig.channelId);
      await ch.messages.fetch(dropRoleConfig.messageId);
      console.log('[drop-role] Opt-in message cached');
    } catch(e) { console.warn('[drop-role] Could not cache opt-in message:', e.message); }
  }

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
  const usingGuild = !!process.env.DISCORD_GUILD_ID;
  const commandRoute = usingGuild
    ? Routes.applicationGuildCommands(client.user.id, process.env.DISCORD_GUILD_ID)
    : Routes.applicationCommands(client.user.id);

  // Clear the OTHER scope so stale commands from previous deploys don't duplicate
  try {
    const staleRoute = usingGuild
      ? Routes.applicationCommands(client.user.id)
      : Routes.applicationGuildCommands(client.user.id, process.env.DISCORD_GUILD_ID);
    await rest.put(staleRoute, { body: [] });
    console.log('[bot] Cleared stale commands from opposite scope');
  } catch(e) { /* guild ID may not be set — that's fine */ }

  await rest.put(commandRoute, {
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
      new SlashCommandBuilder()
        .setName('buy-amber')
        .setDescription('Purchase Amber to spend in the WeeBee TCG store')
        .toJSON(),
      new SlashCommandBuilder()
        .setName('suggest')
        .setDescription('Submit a suggestion for the WeeBee website or Discord server')
        .toJSON(),
      new SlashCommandBuilder()
        .setName('setup-drop-role')
        .setDescription('Create the BIG DROP role and post the opt-in message (admin only)')
        .toJSON(),
      new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Post an announcement embed (Owner / Admin only)')
        .addStringOption(opt =>
          opt.setName('title')
            .setDescription('Announcement title')
            .setRequired(true)
            .setMaxLength(256)
        )
        .addStringOption(opt =>
          opt.setName('body')
            .setDescription('Announcement body text')
            .setRequired(true)
            .setMaxLength(2000)
        )
        .addAttachmentOption(opt =>
          opt.setName('image')
            .setDescription('Optional image to include in the embed')
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('destination')
            .setDescription('Which channel to post in (defaults to Announcements)')
            .setRequired(false)
            .addChoices(
              { name: '📢 Announcements', value: 'announcements' },
              { name: '🎉 Events',        value: 'events' },
              { name: '🎁 Giveaways',     value: 'giveaways' },
            )
        )
        .addChannelOption(opt =>
          opt.setName('channel')
            .setDescription('Override: post to a specific channel instead of a preset destination')
            .setRequired(false)
        )
        .toJSON(),
    ],
  });
  console.log('[bot] Slash commands registered');

  setTimeout(dropCard, 60 * 1000);
  setInterval(dropCard, DROP_INTERVAL_MS);
});

client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'link')       await handleLink(interaction);
    if (interaction.commandName === 'drop')       await handleDrop(interaction);
    if (interaction.commandName === 'buy-amber')  await handleBuyAmber(interaction);
    if (interaction.commandName === 'suggest')         await handleSuggest(interaction);
    if (interaction.commandName === 'setup-drop-role') await handleSetupDropRole(interaction);
    if (interaction.commandName === 'announce')        await handleAnnounce(interaction);
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('buy_amber_')) {
      const bundleId = interaction.customId.replace('buy_amber_', '');
      await handleBuyAmberButton(interaction, bundleId);
    }
    if (interaction.customId === 'suggest_cat_website') await handleSuggestCategory(interaction, 'website');
    if (interaction.customId === 'suggest_cat_discord')  await handleSuggestCategory(interaction, 'discord');
    if (interaction.customId.startsWith('suggest_review_'))  await handleSuggestStatus(interaction, 'under_review', interaction.customId.replace('suggest_review_', ''));
    if (interaction.customId.startsWith('suggest_approve_')) await handleSuggestStatus(interaction, 'approved',     interaction.customId.replace('suggest_approve_', ''));
    if (interaction.customId.startsWith('suggest_decline_')) await handleSuggestStatus(interaction, 'declined',     interaction.customId.replace('suggest_decline_', ''));
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('suggest_modal_')) await handleSuggestModal(interaction);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
