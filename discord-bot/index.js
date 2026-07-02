require('dotenv').config();

const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, EmbedBuilder, ComponentType,
} = require('discord.js');

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp }  = require('firebase-admin/firestore');

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
const DROP_INTERVAL_MS  = 5 * 60 * 1000;        // drop every 5 minutes
const CLAIM_WINDOW_MS   = 15 * 1000;            // 15-second claim window
const SR_COOLDOWN_MS    = 60 * 60 * 1000;       // 1 hour after winning SR
const SSR_COOLDOWN_MS   = 3 * 60 * 60 * 1000;  // 3 hours after winning SSR
const SSR_BLACKOUT_MS   = 44 * 60 * 60 * 1000; // SSR locked for 44h after each drop
const SSR_ACTIVE_CHANCE = 0.01;                 // 1% per roll once blackout lifts

const RARITY_CONFIG = {
  common: { label: 'Common', emoji: '⬜', color: 0x9e9e9e },
  rare:   { label: 'Rare',   emoji: '🔵', color: 0x2196f3 },
  sr:     { label: 'SR',     emoji: '⭐', color: 0xffc107 },
  ssr:    { label: 'SSR',    emoji: '💜', color: 0x9c27b0 },
};

// ── Rarity roll ───────────────────────────────────────────────────────────────
async function rollRarity() {
  const stateDoc = await db.doc('discord_bot_state/drops').get();
  const lastSSRTime = stateDoc.exists ? (stateDoc.data().lastSSRDropTime?.toMillis() || 0) : 0;

  if (Date.now() - lastSSRTime > SSR_BLACKOUT_MS && Math.random() < SSR_ACTIVE_CHANCE) {
    return 'ssr';
  }

  const r = Math.random();
  if (r < 0.05)  return 'sr';    // 5%
  if (r < 0.368) return 'rare';  // 31.8%
  return 'common';               // 63.2%
}

// ── Card selection ────────────────────────────────────────────────────────────
async function pickCard(rarity) {
  const snap = await db.collection('characters').where('rarityTier', '==', rarity).get();
  if (snap.empty) return null;
  const doc = snap.docs[Math.floor(Math.random() * snap.docs.length)];
  return { id: doc.id, ...doc.data() };
}

// ── Serial assignment (atomic counter per card) ───────────────────────────────
async function getNextSerial(name, anime) {
  const key = `${name}__${anime}`.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
  const ref = db.doc(`discord_serials/${key}`);
  return db.runTransaction(async t => {
    const doc = await t.get(ref);
    const next = (doc.exists ? doc.data().serial : 0) + 1;
    t.set(ref, { serial: next });
    return next;
  });
}

// ── Cooldown + link check ─────────────────────────────────────────────────────
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

    const embed = new EmbedBuilder()
      .setTitle(`${cfg.emoji}  Card Drop — ${cfg.label}`)
      .setDescription(
        `**${card.name}**\n*${card.anime}*\n\n` +
        `Click **Claim** to enter the draw!\n` +
        `Winner picked in 15 seconds.`
      )
      .setImage(card.image)
      .setColor(cfg.color)
      .setFooter({ text: 'WeeBee TCG  •  Link your account at weebee-fbbd8.web.app' });

    const claimBtn = new ButtonBuilder()
      .setCustomId('claim_card')
      .setLabel('✋  Claim')
      .setStyle(ButtonStyle.Primary);

    const message = await channel.send({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(claimBtn)],
    });

    const claimants = new Map(); // discordId → username

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
      // Disable button
      await message.edit({
        components: [new ActionRowBuilder().addComponents(
          ButtonBuilder.from(claimBtn).setDisabled(true)
        )],
      }).catch(() => {});

      if (claimants.size === 0) {
        return channel.send('No one claimed the card — it vanished! 💨');
      }

      // Filter to eligible claimants
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

      const winner = eligible[Math.floor(Math.random() * eligible.length)];
      const serial = await getNextSerial(card.name, card.anime);

      // Write card to winner's WeeBee collection
      await db.collection('card_collections').doc(winner.uid).collection('cards').add({
        name:       card.name,
        anime:      card.anime,
        image:      card.image,
        rarityTier: rarity,
        serial,
        source:     'discord_drop',
        claimedAt:  Timestamp.now(),
      });

      // Update winner cooldowns
      const cooldownUpdate = {};
      if (rarity === 'sr')  cooldownUpdate.lastSRWin  = Timestamp.now();
      if (rarity === 'ssr') cooldownUpdate.lastSSRWin = Timestamp.now();
      if (Object.keys(cooldownUpdate).length > 0) {
        await db.doc(`discord_links/${winner.discordId}`).update(cooldownUpdate);
      }

      // Record SSR drop time for blackout tracking
      if (rarity === 'ssr') {
        await db.doc('discord_bot_state/drops').set(
          { lastSSRDropTime: Timestamp.now() },
          { merge: true }
        );
      }

      const msg =
        rarity === 'ssr' ? `🎊 **SSR DROP!** <@${winner.discordId}> claimed **${card.name}** (SSR)! Added to their WeeBee collection.` :
        rarity === 'sr'  ? `⭐ <@${winner.discordId}> claimed **${card.name}** (SR)! Added to their WeeBee collection.` :
                           `🎉 <@${winner.discordId}> claimed **${card.name}**! Added to their WeeBee collection.`;

      await channel.send(msg);
    });
  } catch (err) {
    console.error('[drop] Error:', err);
  }
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
    ],
  });
  console.log('[bot] Slash commands registered');

  // First drop 1 minute after startup, then every 5 minutes
  setTimeout(dropCard, 60 * 1000);
  setInterval(dropCard, DROP_INTERVAL_MS);
});

client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'link') {
    await handleLink(interaction);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
