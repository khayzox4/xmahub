import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType,
  PermissionsBitField,
  REST,
  Routes,
  Colors,
  AttachmentBuilder,
} from "discord.js";

import { db } from "./db.js";
import { giveawaysTable, giveawayParticipantsTable, mediaDispatchesTable } from "./schema.js";
import { eq, and } from "drizzle-orm";

const TOKEN = process.env.DISCORD_TOKEN;
const ROLE_HOMME_ID = process.env.DISCORD_ROLE_HOMME;
const ROLE_FEMME_ID = process.env.DISCORD_ROLE_FEMME;
const ROLE_NUDE1_ID = process.env.DISCORD_ROLE_NUDE1;
const ROLE_NUDE2_ID = process.env.DISCORD_ROLE_NUDE2;
const ROLE_NUDE3_ID = process.env.DISCORD_ROLE_NUDE3;
const ROLE_MP1_ID = process.env.DISCORD_ROLE_MP1;
const ROLE_MP2_ID = process.env.DISCORD_ROLE_MP2;
const ROLE_MP3_ID = process.env.DISCORD_ROLE_MP3;
const TICKET_CATEGORY_OPEN = process.env.DISCORD_TICKET_CATEGORY_OPEN;
const TICKET_CATEGORY_CLOSED = process.env.DISCORD_TICKET_CATEGORY_CLOSED;
const TICKET_LOG_CHANNEL = process.env.DISCORD_TICKET_LOG_CHANNEL;
const STAFF_ROLE_ID = process.env.DISCORD_STAFF_ROLE;
const RATING_CHANNEL_ID = process.env.DISCORD_RATING_CHANNEL;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

const VIOLET_FONCE = 0x4b0082;
const TICKET_REMINDER_AFTER_MS = 12 * 60 * 60 * 1000;
const TICKET_AUTO_CLOSE_AFTER_MS = 24 * 60 * 60 * 1000;
const TICKET_INACTIVITY_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const MEDIA_DISPATCH_POLL_INTERVAL_MS = 60 * 1000;
const XMAHUB_CHANNEL_NAME = "xmahub";
const XMAHUB_CHANNEL_TOPIC = "[XMAHUB_ADMIN_HUB]";

if (!TOKEN) {
  console.error("Erreur : DISCORD_TOKEN est manquant.");
  process.exit(1);
}

if (!DISCORD_CLIENT_ID) {
  console.error("Erreur : DISCORD_CLIENT_ID est manquant.");
  process.exit(1);
}

if (!DISCORD_GUILD_ID) {
  console.error("Erreur : DISCORD_GUILD_ID est manquant.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

client.on("error", (err) => {
  console.error("Erreur Discord client :", err);
});

process.on("unhandledRejection", (err) => {
  console.error("Rejection non gérée complète :", err);
});

process.on("uncaughtException", (err) => {
  console.error("Exception non capturée :", err);
});

let ticketCounter = 0;
let isTicketInactivityScanRunning = false;
const processingMediaDispatchIds = new Set();

function formatTicketNumber(n) {
  return String(n).padStart(4, "0");
}

function getTicketNumFromChannel(channel) {
  if (!channel?.name) return null;
  const match = channel.name.match(/(?:ticket|closed)-(\d+)/);
  return match ? match[1] : null;
}

function parseTicketTopic(topic) {
  if (!topic) {
    return { ownerId: null, openedAt: null, warnedAt: null, autoCloseDisabled: false };
  }

  const trimmedTopic = topic.trim();

  if (/^\d+$/.test(trimmedTopic)) {
    return { ownerId: trimmedTopic, openedAt: null, warnedAt: null, autoCloseDisabled: false };
  }

  const rawMeta = {};

  for (const part of trimmedTopic.split("|")) {
    const [key, ...rest] = part.split(":");
    if (!key) continue;
    rawMeta[key] = rest.join(":");
  }

  const openedAt = Number(rawMeta.opened);
  const warnedAt = Number(rawMeta.warned);

  return {
    ownerId: rawMeta.owner && /^\d+$/.test(rawMeta.owner) ? rawMeta.owner : null,
    openedAt: Number.isFinite(openedAt) && openedAt > 0 ? openedAt : null,
    warnedAt: Number.isFinite(warnedAt) && warnedAt > 0 ? warnedAt : null,
    autoCloseDisabled: rawMeta.protected === "1",
  };
}

function serializeTicketTopic({ ownerId, openedAt, warnedAt, autoCloseDisabled }) {
  if (!ownerId) return null;

  const parts = [`owner:${ownerId}`];

  if (openedAt) parts.push(`opened:${openedAt}`);
  if (warnedAt) parts.push(`warned:${warnedAt}`);
  if (autoCloseDisabled) parts.push("protected:1");

  return parts.join("|");
}

function getTicketMeta(channel) {
  return parseTicketTopic(channel?.topic);
}

function getTicketOwnerId(channel) {
  return getTicketMeta(channel).ownerId;
}

function isTicketProtected(channel) {
  return getTicketMeta(channel).autoCloseDisabled;
}

function isOpenTicketChannel(channel) {
  return channel?.type === ChannelType.GuildText && channel.name?.startsWith("ticket-");
}

async function updateTicketTopic(channel, patch) {
  const currentMeta = getTicketMeta(channel);

  if (!currentMeta.ownerId) {
    return currentMeta;
  }

  const nextMeta = { ...currentMeta, ...patch };
  const nextTopic = serializeTicketTopic(nextMeta);

  if (!nextTopic || channel.topic === nextTopic) {
    return nextMeta;
  }

  await channel.setTopic(nextTopic).catch((err) => {
    console.error("Erreur mise à jour topic ticket :", err);
  });

  return nextMeta;
}

async function getLatestHumanTicketMessage(channel) {
  const meta = getTicketMeta(channel);
  const historyStart = meta.openedAt ?? channel.createdTimestamp ?? 0;

  const messages = await channel.messages.fetch({ limit: 100 }).catch((err) => {
    console.error(`Erreur lecture messages ticket ${channel.name} :`, err);
    return null;
  });

  if (!messages) return null;

  return (
    [...messages.values()]
      .filter((message) => !message.author.bot && message.createdTimestamp >= historyStart)
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0] ?? null
  );
}

// ─── TRANSCRIPT UTILITIES ─────────────────────────────────────────────────────

async function fetchAllMessages(channel) {
  const allMessages = [];
  let lastId = null;

  try {
    while (true) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;

      const batch = await channel.messages.fetch(options).catch((err) => {
        console.error(`Erreur fetch messages transcript (before=${lastId}) :`, err);
        return null;
      });

      if (!batch || batch.size === 0) break;

      allMessages.push(...batch.values());
      lastId = batch.last()?.id ?? null;

      if (batch.size < 100) break;
    }
  } catch (err) {
    console.error("Erreur fetchAllMessages :", err);
  }

  // Sort oldest → newest
  return allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function generateTranscript(messages, ticketNum) {
  try {
    const lines = [];

    lines.push(`=== Transcript du ticket #${ticketNum} ===`);
    lines.push(`Généré le : ${new Date().toISOString()}`);
    lines.push(`Nombre de messages : ${messages.length}`);
    lines.push("=".repeat(50));
    lines.push("");

    for (const message of messages) {
      const date = new Date(message.createdTimestamp);
      const dateStr = date.toISOString().replace("T", " ").slice(0, 19);
      const username = message.author?.username ?? "Inconnu";
      const content = message.content?.trim() ?? "";

      if (content) {
        lines.push(`[${dateStr}] ${username}: ${content}`);
      } else if (message.attachments.size > 0) {
        lines.push(`[${dateStr}] ${username}: [No text content]`);
      } else {
        lines.push(`[${dateStr}] ${username}: `);
      }

      for (const attachment of message.attachments.values()) {
        lines.push(`  📎 ${attachment.url}`);
      }

      if (message.embeds.length > 0) {
        lines.push(`  [Embed present]`);
      }
    }

    return lines.join("\n");
  } catch (err) {
    console.error("Erreur generateTranscript :", err);
    return `=== Transcript du ticket #${ticketNum} ===\nErreur lors de la génération du transcript.`;
  }
}

async function sendTranscriptLog(guild, channel, closedBy, ticketNum, messageCount, transcriptText) {
  try {
    if (!TICKET_LOG_CHANNEL) return;

    const logChannel = guild.channels.cache.get(TICKET_LOG_CHANNEL);
    if (!logChannel) {
      console.error("Salon de log introuvable pour le transcript.");
      return;
    }

    console.log(`Transcript généré : ${messageCount} messages (ticket #${ticketNum})`);

    const transcriptBuffer = Buffer.from(transcriptText, "utf-8");
    const attachment = new AttachmentBuilder(transcriptBuffer, {
      name: `transcript-${ticketNum}.txt`,
    });

    const ownerId = getTicketOwnerId(channel);
    const ownerLabel = ownerId ? `<@${ownerId}>` : "Inconnu";

    const actorLabel =
      typeof closedBy === "string"
        ? closedBy
        : closedBy?.user?.tag
        ? `${closedBy} (${closedBy.user.tag})`
        : "Système";

    const transcriptEmbed = new EmbedBuilder()
      .setTitle("📋 Ticket Transcript")
      .addFields(
        { name: "👤 Utilisateur", value: ownerLabel, inline: true },
        { name: "🛡️ Staff qui ferme", value: actorLabel, inline: true },
        { name: "💬 Nombre de messages", value: `${messageCount}`, inline: true },
        { name: "🎫 Nom du ticket", value: `ticket-${ticketNum}`, inline: true }
      )
      .setColor(VIOLET_FONCE)
      .setFooter({ text: ".gg/xma" })
      .setTimestamp();

    await logChannel.send({ embeds: [transcriptEmbed], files: [attachment] }).catch((err) => {
      console.error("Erreur envoi transcript log :", err);
    });
  } catch (err) {
    console.error("Erreur sendTranscriptLog :", err);
  }
}

async function closeTicketChannel({
  guild,
  channel,
  closedBy,
  closeDescription,
  logAction = "🔴 Ticket fermé",
  logReason = null,
}) {
  const ticketNum = getTicketNumFromChannel(channel);

  if (!ticketNum || !isOpenTicketChannel(channel)) {
    return false;
  }

  const closedCategory = guild.channels.cache.get(TICKET_CATEGORY_CLOSED);
  const ownerId = getTicketOwnerId(channel);

  // Fetch all messages and generate transcript before closing
  const allMessages = await fetchAllMessages(channel);
  const transcriptText = generateTranscript(allMessages, ticketNum);
  await sendTranscriptLog(guild, channel, closedBy, ticketNum, allMessages.length, transcriptText);

  if (ownerId) {
    const ticketUser = await guild.members.fetch(ownerId).catch((err) => {
      console.error("Erreur fetch membre fermeture ticket :", err);
      return null;
    });

    if (ticketUser) {
      await channel.permissionOverwrites.edit(ticketUser, {
        ViewChannel: false,
        SendMessages: false,
      }).catch((err) => {
        console.error("Erreur edit perms fermeture ticket :", err);
      });
    }
  }

  await channel.setName(`closed-${ticketNum}`);

  if (closedCategory) {
    await channel.setParent(closedCategory.id, { lockPermissions: false });
  }

  const closedEmbed = new EmbedBuilder()
    .setTitle("🔒 Ticket fermé")
    .setDescription(closeDescription)
    .setColor(VIOLET_FONCE)
    .setFooter({ text: `.gg/xma` })
    .setTimestamp();

  const reopenRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_reopen")
      .setLabel("🔓 Réouvrir")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("ticket_delete")
      .setLabel("🗑️ Supprimer")
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({ embeds: [closedEmbed], components: [reopenRow] });
  await sendLog(guild, logAction, closedBy, ticketNum, channel, logReason);

  if (ownerId) {
    await sendRatingDM(guild, ownerId, ticketNum);
  }

  return true;
}

async function handleInactiveTickets() {
  if (isTicketInactivityScanRunning) return;
  isTicketInactivityScanRunning = true;

  try {
    const guild = await client.guilds.fetch(DISCORD_GUILD_ID).catch((err) => {
      console.error("Erreur fetch guild tickets :", err);
      return null;
    });

    if (!guild) return;

    const channels = await guild.channels.fetch().catch((err) => {
      console.error("Erreur fetch salons tickets :", err);
      return null;
    });

    if (!channels) return;

    const openTicketChannels = [...channels.values()].filter((channel) => isOpenTicketChannel(channel));

    for (const channel of openTicketChannels) {
      const ownerId = getTicketOwnerId(channel);
      if (!ownerId) continue;
      if (isTicketProtected(channel)) continue;

      const latestHumanMessage = await getLatestHumanTicketMessage(channel);
      if (!latestHumanMessage) continue;

      if (latestHumanMessage.author.id === ownerId) {
        continue;
      }

      const inactivityMs = Date.now() - latestHumanMessage.createdTimestamp;
      const { warnedAt } = getTicketMeta(channel);
      const reminderAlreadySent = warnedAt && warnedAt >= latestHumanMessage.createdTimestamp;

      if (inactivityMs >= TICKET_AUTO_CLOSE_AFTER_MS) {
        await closeTicketChannel({
          guild,
          channel,
          closedBy: "Système",
          closeDescription: `Ce ticket a été fermé automatiquement après 24h sans réponse de <@${ownerId}>.`,
          logAction: "🔴 Ticket fermé automatiquement",
          logReason: "Fermeture auto après 24h sans réponse du créateur du ticket.",
        });
        continue;
      }

      if (inactivityMs >= TICKET_REMINDER_AFTER_MS && !reminderAlreadySent) {
        await channel.send(
          `⏰ <@${ownerId}>, nous attendons toujours ta réponse. Sans réponse de ta part dans les 12 prochaines heures, ce ticket sera fermé automatiquement.`
        ).catch((err) => {
          console.error("Erreur envoi rappel ticket inactif :", err);
        });

        await updateTicketTopic(channel, { warnedAt: Date.now() });
        await sendLog(
          guild,
          "⏰ Rappel ticket inactif",
          "Système",
          getTicketNumFromChannel(channel),
          channel,
          "Rappel envoyé après 12h sans réponse du créateur du ticket."
        );
      }
    }
  } finally {
    isTicketInactivityScanRunning = false;
  }
}

function isXmahubChannel(channel) {
  return (
    channel?.type === ChannelType.GuildText &&
    (channel.name === XMAHUB_CHANNEL_NAME || channel.topic === XMAHUB_CHANNEL_TOPIC)
  );
}

async function ensureXmahubChannel(guild) {
  await guild.channels.fetch().catch((err) => {
    console.error("Erreur fetch salons XMAHUB :", err);
  });

  const existingChannel = guild.channels.cache.find((channel) => isXmahubChannel(channel));
  if (existingChannel) return existingChannel;

  const xmahubChannel = await guild.channels.create({
    name: XMAHUB_CHANNEL_NAME,
    type: ChannelType.GuildText,
    topic: XMAHUB_CHANNEL_TOPIC,
  });

  try {
    const adminRoles = guild.roles.cache.filter((role) =>
      role.permissions.has(PermissionFlagsBits.Administrator)
    );

    for (const [, role] of adminRoles) {
      await xmahubChannel.permissionOverwrites.create(role, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      }).catch((err) => {
        console.error(`Erreur overwrite admin XMAHUB ${role.name} :`, err);
      });
    }
  } catch (err) {
    console.error("Erreur application des permissions admin XMAHUB :", err);
  }

  await xmahubChannel.send(
    "Espace admin XMAHUB créé.\n\n" +
      "1. Postez votre image, vidéo ou texte ici.\n" +
      "2. Utilisez `/programmermedia` dans ce salon.\n" +
      "3. Choisissez un salon cible et un mode : temps ou réactions."
  ).catch((err) => {
    console.error("Erreur message de bienvenue XMAHUB :", err);
  });

  return xmahubChannel;
}

function getDispatchMessageParts(dispatch) {
  const parts = [];

  if (dispatch.content?.trim()) {
    parts.push(dispatch.content.trim());
  }

  if (Array.isArray(dispatch.attachmentUrls)) {
    for (const url of dispatch.attachmentUrls) {
      if (url) parts.push(url);
    }
  }

  return parts;
}

async function sendDispatchParts(channel, parts) {
  let buffer = "";

  for (const part of parts) {
    const nextChunk = buffer ? `${buffer}\n${part}` : part;

    if (nextChunk.length > 1900) {
      if (buffer) {
        await channel.send({ content: buffer });
      }
      buffer = part;
      continue;
    }

    buffer = nextChunk;
  }

  if (buffer) {
    await channel.send({ content: buffer });
  }
}

async function sendMediaDispatch(dispatch) {
  if (processingMediaDispatchIds.has(dispatch.id)) {
    return false;
  }

  processingMediaDispatchIds.add(dispatch.id);

  try {
    const [freshDispatch] = await db
      .select()
      .from(mediaDispatchesTable)
      .where(eq(mediaDispatchesTable.id, dispatch.id));

    if (!freshDispatch || freshDispatch.status !== "pending") {
      return false;
    }

  const targetChannel = await client.channels.fetch(dispatch.targetChannelId).catch((err) => {
    console.error(`Erreur fetch salon cible diffusion #${dispatch.id} :`, err);
    return null;
  });

  if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
    console.error(`Salon cible introuvable pour la diffusion #${dispatch.id}`);
    return false;
  }

  const parts = getDispatchMessageParts(freshDispatch);
  if (parts.length === 0) {
    console.error(`Aucun contenu à envoyer pour la diffusion #${dispatch.id}`);
    return false;
  }

  await sendDispatchParts(targetChannel, parts);

  await db
    .update(mediaDispatchesTable)
    .set({ status: "sent", sentAt: new Date() })
    .where(eq(mediaDispatchesTable.id, dispatch.id));

  return true;
  } finally {
    processingMediaDispatchIds.delete(dispatch.id);
  }
}

async function processDueMediaDispatches() {
  try {
    const pendingDispatches = await db
      .select()
      .from(mediaDispatchesTable)
      .where(and(eq(mediaDispatchesTable.status, "pending"), eq(mediaDispatchesTable.mode, "time")));

    const now = Date.now();

    for (const dispatch of pendingDispatches) {
      const scheduledForMs = dispatch.scheduledFor ? new Date(dispatch.scheduledFor).getTime() : null;

      if (!scheduledForMs || scheduledForMs > now) continue;

      await sendMediaDispatch(dispatch);
    }
  } catch (err) {
    console.error("Erreur traitement diffusions programmées :", err);
  }
}

function getReactionCount(message) {
  let total = 0;

  for (const reaction of message.reactions.cache.values()) {
    total += Math.max((reaction.count ?? 0) - (reaction.me ? 1 : 0), 0);
  }

  return total;
}

async function checkReactionDispatchesForMessage(message) {
  try {
    const pendingDispatches = await db
      .select()
      .from(mediaDispatchesTable)
      .where(
        and(
          eq(mediaDispatchesTable.status, "pending"),
          eq(mediaDispatchesTable.mode, "reactions"),
          eq(mediaDispatchesTable.sourceMessageId, message.id)
        )
      );

    if (pendingDispatches.length === 0) return;

    const reactionCount = getReactionCount(message);

    for (const dispatch of pendingDispatches) {
      await db
        .update(mediaDispatchesTable)
        .set({ lastReactionCount: reactionCount })
        .where(eq(mediaDispatchesTable.id, dispatch.id));

      if (!dispatch.reactionTarget || reactionCount < dispatch.reactionTarget) {
        continue;
      }

      await sendMediaDispatch(dispatch);
    }
  } catch (err) {
    console.error("Erreur vérification diffusions à réactions :", err);
  }
}

async function processPendingReactionDispatches() {
  try {
    const pendingDispatches = await db
      .select()
      .from(mediaDispatchesTable)
      .where(and(eq(mediaDispatchesTable.status, "pending"), eq(mediaDispatchesTable.mode, "reactions")));

    for (const dispatch of pendingDispatches) {
      const sourceChannel = await client.channels.fetch(dispatch.sourceChannelId).catch((err) => {
        console.error(`Erreur fetch salon source diffusion #${dispatch.id} :`, err);
        return null;
      });

      if (!sourceChannel || sourceChannel.type !== ChannelType.GuildText) continue;

      const sourceMessage = await sourceChannel.messages.fetch(dispatch.sourceMessageId).catch((err) => {
        console.error(`Erreur fetch message source diffusion #${dispatch.id} :`, err);
        return null;
      });

      if (!sourceMessage) continue;

      await checkReactionDispatchesForMessage(sourceMessage);
    }
  } catch (err) {
    console.error("Erreur reprise diffusions à réactions :", err);
  }
}

async function resolveSourceMessage(interaction, hubChannel) {
  const messageId = interaction.options.getString("message_id");

  if (messageId) {
    return await hubChannel.messages.fetch(messageId).catch(() => null);
  }

  const recentMessages = await hubChannel.messages.fetch({ limit: 25 }).catch((err) => {
    console.error("Erreur lecture messages XMAHUB :", err);
    return null;
  });

  if (!recentMessages) return null;

  return (
    [...recentMessages.values()].find(
      (message) =>
        message.author.id === interaction.user.id &&
        !message.author.bot &&
        (message.attachments.size > 0 || message.content.trim().length > 0)
    ) ?? null
  );
}

function logInteraction(interaction) {
  const name = interaction.isChatInputCommand()
    ? `/${interaction.commandName}`
    : interaction.isButton()
    ? `button:${interaction.customId}`
    : interaction.isModalSubmit()
    ? `modal:${interaction.customId}`
    : `type:${interaction.type}`;

  console.log(
    `[INTERACTION] ${name} | user=${interaction.user?.tag ?? "unknown"} | guild=${interaction.guild?.name ?? "DM"}`
  );
}

async function safeDefer(interaction, label = "interaction") {
  try {
    await interaction.deferReply({ ephemeral: true });
    return true;
  } catch (err) {
    console.error(`[safeDefer:${label}]`, err);
    return false;
  }
}

async function safeReply(interaction, content, label = "interaction") {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
  } catch (err) {
    console.error(`[safeReply:${label}]`, err);
  }
}

// Envoie un DM de notation à l'utilisateur quand son ticket est fermé
async function sendRatingDM(guild, userId, ticketNum) {
  try {
    const user = await client.users.fetch(userId);
    if (!user) return;

    const embed = new EmbedBuilder()
      .setTitle("⭐ Comment s'est passé ton support ?")
      .setDescription(
        `Ton ticket **#${ticketNum}** sur **${guild.name}** vient d'être fermé.\n\n` +
          "Merci de noter la qualité de l'aide reçue en cliquant sur une étoile ci-dessous."
      )
      .setColor(VIOLET_FONCE)
      .setFooter({ text: ".gg/xma" })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rate_1_${guild.id}_${ticketNum}`)
        .setLabel("⭐")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`rate_2_${guild.id}_${ticketNum}`)
        .setLabel("⭐⭐")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`rate_3_${guild.id}_${ticketNum}`)
        .setLabel("⭐⭐⭐")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`rate_4_${guild.id}_${ticketNum}`)
        .setLabel("⭐⭐⭐⭐")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`rate_5_${guild.id}_${ticketNum}`)
        .setLabel("⭐⭐⭐⭐⭐")
        .setStyle(ButtonStyle.Primary)
    );

    await user.send({ embeds: [embed], components: [row] });
  } catch (err) {
    console.error("Impossible d'envoyer le DM de notation :", err);
  }
}

const giveawayCommands = [
  {
    name: "creategiveaway",
    description: "🎉 Lancer un nouveau giveaway",
    options: [
      {
        name: "prix",
        description: "Le prix du giveaway",
        type: 3,
        required: true,
      },
      {
        name: "duree",
        description: "Durée du giveaway en minutes",
        type: 4,
        required: true,
      },
      {
        name: "gagnants",
        description: "Nombre de gagnants",
        type: 4,
        required: true,
      },
      {
        name: "conditions",
        description: "Conditions pour participer",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "listgiveaways",
    description: "📋 Voir tous les giveaways actifs",
  },
  {
    name: "endgiveaway",
    description: "🏁 Terminer un giveaway manuellement",
    options: [
      {
        name: "id",
        description: "ID du giveaway",
        type: 4,
        required: true,
      },
    ],
  },
  {
    name: "reroll",
    description: "🔁 Relancer le tirage d'un giveaway terminé",
    options: [
      {
        name: "id",
        description: "ID du giveaway",
        type: 4,
        required: true,
      },
    ],
  },
  {
    name: "rename",
    description: "✏️ Renommer un ticket",
    options: [
      {
        name: "nom",
        description: "Nouveau nom du ticket",
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: "adduser",
    description: "➕ Ajouter un utilisateur à un ticket",
    options: [
      {
        name: "utilisateur",
        description: "Utilisateur à ajouter au ticket",
        type: 6,
        required: true,
      },
    ],
  },
  {
    name: "removeuser",
    description: "➖ Retirer un utilisateur d'un ticket",
    options: [
      {
        name: "utilisateur",
        description: "Utilisateur à retirer du ticket",
        type: 6,
        required: true,
      },
    ],
  },
  {
    name: "ticketactif",
    description: "🛡️ Désactiver ou réactiver l'auto-fermeture d'un ticket",
    options: [
      {
        name: "protection",
        description: "true = le ticket ne sera plus fermé automatiquement",
        type: 5,
        required: false,
      },
    ],
  },
  {
    name: "programmermedia",
    description: "📤 Programmer la diffusion d'un média depuis le salon XMAHUB",
    options: [
      {
        name: "salon",
        description: "Salon cible où le média sera envoyé",
        type: 7,
        required: true,
      },
      {
        name: "mode",
        description: "Choisir un déclenchement par temps ou par réactions",
        type: 3,
        required: true,
        choices: [
          { name: "Temps", value: "time" },
          { name: "Réactions", value: "reactions" },
        ],
      },
      {
        name: "minutes",
        description: "Nombre de minutes avant l'envoi",
        type: 4,
        required: false,
      },
      {
        name: "reactions",
        description: "Nombre de réactions nécessaires",
        type: 4,
        required: false,
      },
      {
        name: "message_id",
        description: "ID du message média dans XMAHUB si besoin",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "listemedias",
    description: "📋 Voir les diffusions média en attente",
  },
  {
    name: "annulermedia",
    description: "🗑️ Annuler une diffusion média programmée",
    options: [
      {
        name: "id",
        description: "ID de la diffusion à annuler",
        type: 4,
        required: true,
      },
    ],
  },
];

async function registerGiveawayCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    console.log("🔄 Enregistrement des commandes giveaways...");
    await rest.put(
      Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID),
      { body: giveawayCommands }
    );
    console.log("✅ Commandes giveaways enregistrées !");
  } catch (error) {
    console.error("❌ Erreur enregistrement giveaways :", error);
  }
}

function buildGiveawayEmbed(giveaway) {
  const endsAtTimestamp = Math.floor(new Date(giveaway.endsAt).getTime() / 1000);
  const isEnded = giveaway.status === "ended";

  const embed = new EmbedBuilder()
    .setTitle("🎉 GIVEAWAY 🎉")
    .setColor(isEnded ? Colors.Grey : 0x9b59b6)
    .setDescription(
      isEnded
        ? "Le giveaway est **terminé** !"
        : "Réagissez avec 🎉 à ce message pour participer !"
    )
    .addFields(
      { name: "🏆 Prix", value: giveaway.prize, inline: true },
      { name: "⏱️ Durée", value: `${giveaway.durationMinutes} minute(s)`, inline: true },
      { name: "🥇 Gagnants", value: `${giveaway.winnersCount}`, inline: true }
    )
    .setFooter({ text: `ID: ${giveaway.id} • Giveaway Bot` })
    .setTimestamp(new Date(giveaway.endsAt));

  if (giveaway.conditions) {
    embed.addFields({ name: "📋 Conditions", value: giveaway.conditions });
  }

  if (!isEnded) {
    embed.addFields({
      name: "⏰ Se termine",
      value: `<t:${endsAtTimestamp}:R>`,
      inline: true,
    });
  }

  if (isEnded && giveaway.winners?.length > 0) {
    embed.addFields({
      name: "🏆 Gagnant(s)",
      value: giveaway.winners.map((w) => `🎊 **${w}**`).join("\n"),
    });
  }

  return embed;
}

async function scheduleGiveawayEnd(giveawayId, endsAt) {
  const delay = new Date(endsAt).getTime() - Date.now();
  if (delay <= 0) return;

  setTimeout(async () => {
    try {
      const [giveaway] = await db
        .select()
        .from(giveawaysTable)
        .where(eq(giveawaysTable.id, giveawayId));

      if (!giveaway || giveaway.status === "ended") return;

      const participants = await db
        .select()
        .from(giveawayParticipantsTable)
        .where(eq(giveawayParticipantsTable.giveawayId, giveawayId));

      const shuffled = [...participants].sort(() => Math.random() - 0.5);
      const selectedWinners = shuffled
        .slice(0, giveaway.winnersCount)
        .map((p) => p.username);

      const [updated] = await db
        .update(giveawaysTable)
        .set({ status: "ended", winners: selectedWinners })
        .where(eq(giveawaysTable.id, giveawayId))
        .returning();

      if (giveaway.channelId && giveaway.messageId) {
        const channel = await client.channels.fetch(giveaway.channelId).catch((err) => {
          console.error("Erreur fetch channel giveaway :", err);
          return null;
        });

        if (channel && channel.isTextBased()) {
          const message = await channel.messages.fetch(giveaway.messageId).catch((err) => {
            console.error("Erreur fetch message giveaway :", err);
            return null;
          });

          if (message) {
            await message.edit({ embeds: [buildGiveawayEmbed(updated)] });

            await channel.send(
              `🎉 Giveaway terminé : **${giveaway.prize}**\n🏆 Gagnants : ${
                selectedWinners.join(", ") || "Aucun participant"
              }`
            );
          }
        }
      }
    } catch (err) {
      console.error("Erreur fin giveaway :", err);
    }
  }, delay);
}

async function handleRerollGiveaway(interaction) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const id = interaction.options.getInteger("id", true);

    const [giveaway] = await db
      .select()
      .from(giveawaysTable)
      .where(eq(giveawaysTable.id, id));

    if (!giveaway) {
      return await interaction.editReply("❌ Giveaway introuvable.");
    }

    const participants = await db
      .select()
      .from(giveawayParticipantsTable)
      .where(eq(giveawayParticipantsTable.giveawayId, id));

    if (participants.length === 0) {
      return await interaction.editReply("❌ Aucun participant.");
    }

    const shuffled = [...participants].sort(() => Math.random() - 0.5);
    const winners = shuffled
      .slice(0, giveaway.winnersCount)
      .map((p) => p.username);

    const [updated] = await db
      .update(giveawaysTable)
      .set({ status: "ended", winners })
      .where(eq(giveawaysTable.id, id))
      .returning();

    const channel = await client.channels.fetch(giveaway.channelId).catch((err) => {
      console.error("Erreur fetch channel reroll :", err);
      return null;
    });

    if (channel && channel.isTextBased()) {
      const message = await channel.messages.fetch(giveaway.messageId).catch((err) => {
        console.error("Erreur fetch message reroll :", err);
        return null;
      });

      if (message) {
        await message.edit({
          embeds: [buildGiveawayEmbed(updated)],
        });

        await channel.send(
          `🔁 **Reroll du giveaway ${giveaway.prize}**\n🏆 Nouveaux gagnants : ${winners.join(", ")}`
        );
      }
    }

    return await interaction.editReply(
      `✅ Nouveau tirage effectué : ${winners.join(", ")}`
    );
  } catch (err) {
    console.error("Erreur reroll :", err);

    if (interaction.deferred || interaction.replied) {
      return interaction.editReply("❌ Une erreur est survenue.").catch((editErr) => {
        console.error("Erreur editReply reroll :", editErr);
      });
    }

    return interaction.reply({
      content: "❌ Une erreur est survenue.",
      ephemeral: true,
    }).catch((replyErr) => {
      console.error("Erreur reply reroll :", replyErr);
    });
  }
}

// ─── READY ───────────────────────────────────────────────────────────────────
client.once("clientReady", async () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
  await registerGiveawayCommands();

  const guild = await client.guilds.fetch(DISCORD_GUILD_ID).catch((err) => {
    console.error("Erreur fetch guild ready :", err);
    return null;
  });

  if (guild) {
    await ensureXmahubChannel(guild).catch((err) => {
      console.error("Erreur création salon XMAHUB :", err);
    });
  }

  try {
    const activeGiveaways = await db
      .select()
      .from(giveawaysTable)
      .where(eq(giveawaysTable.status, "active"));

    for (const g of activeGiveaways) {
      if (new Date(g.endsAt) > new Date()) {
        scheduleGiveawayEnd(g.id, new Date(g.endsAt));
      }
    }

    console.log(`⏰ ${activeGiveaways.length} giveaway(s) actif(s) récupéré(s)`);
  } catch (err) {
    console.error("Erreur chargement giveaways :", err);
  }

  await handleInactiveTickets();
  setInterval(handleInactiveTickets, TICKET_INACTIVITY_CHECK_INTERVAL_MS);
  await processDueMediaDispatches();
  await processPendingReactionDispatches();
  setInterval(processDueMediaDispatches, MEDIA_DISPATCH_POLL_INTERVAL_MS);
});

// ─── COMMANDES TEXTE ──────────────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const cmd = message.content.toLowerCase().trim();

  if (cmd === "!embedrôle" || cmd === "!embedrole") {
    if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply({
        content: "❌ Tu n'as pas la permission d'utiliser cette commande. (Administrateur requis)",
      });
    }

    const embed = new EmbedBuilder()
      .setTitle("💜 - Choisis ton genre")
      .setDescription(
        "Sélectionne ton genre ci-dessous en cliquant sur le bouton correspondant.\n\n" +
          "<:61218male:1494173924660084796> **Homme** — Clique pour obtenir le rôle Homme\n\n" +
          "<:4654pinkfemalesymbol:1494173818359513289> **Femme** — Clique pour obtenir le rôle Femme\n\n" +
          "_Tu peux changer de rôle à tout moment en recliquant sur un bouton._"
      )
      .setColor(VIOLET_FONCE)
      .setFooter({ text: "Un seul rôle de genre peut être actif à la fois." })

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("role_homme")
        .setLabel("Homme")
        .setEmoji("<:61218male:1494173924660084796>")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("role_femme")
        .setLabel("Femme")
        .setEmoji("<:4654pinkfemalesymbol:1494173818359513289>")
        .setStyle(ButtonStyle.Secondary)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
    await message.delete().catch((err) => {
      console.error("Erreur suppression message embedrole :", err);
    });
    return;
  }

if (cmd === "!embedrôle2" || cmd === "!embedrole2") {
  if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
    return message.reply({
      content: "❌ Tu n'as pas la permission d'utiliser cette commande. (Administrateur requis)",
    });
  }

  const embed = new EmbedBuilder()
    .setTitle("💜 - Choisis ton NSFW")
.setDescription(
  "Sélectionne ton NSFW ci-dessous en cliquant sur le bouton correspondant.\n\n" +
    "<:7561purpnum1:1494225979126845490> **je n\\*de** — Clique pour obtenir le rôle je n\\*de\n\n" +
    "<:4388purpnum2:1494226037792440321> **je n\\*de si affinité** — Clique pour obtenir le rôle je n\\*de si affinité\n\n" +
    "<:2300purpnum3:1494226093429751818> **je n\\*de pas** — Clique pour obtenir le rôle je n\\*de pas\n\n" +
    "_Tu peux changer de rôle à tout moment en recliquant sur un bouton._"
)
    .setColor(VIOLET_FONCE)
    .setFooter({ text: "Un seul rôle NSFW peut être actif à la fois." });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("role_nude1")
      .setLabel("je n*de")
      .setEmoji("1494225979126845490")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("role_nude2")
      .setLabel("je n*de si affinité")
      .setEmoji("1494226037792440321")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("role_nude3")
      .setLabel("je n*de pas")
      .setEmoji("1494226093429751818")
      .setStyle(ButtonStyle.Secondary)
  );

  await message.channel.send({ embeds: [embed], components: [row] });
  await message.delete().catch((err) => {
    console.error("Erreur suppression message embedrole2 :", err);
  });
  return;
}

  if (cmd === "!embedmp") {
  if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
    return message.reply({
      content: "❌ Tu n'as pas la permission d'utiliser cette commande. (Administrateur requis)",
    });
  }

  const embed = new EmbedBuilder()
    .setTitle("💜 - Choisis tes Messages Privés")
    .setDescription(
      "Choisissez parmi les options suivantes le type de vos MP sur ce serveur :\n\n" +
        "<:7561purpnum1:1494225979126845490> **MP ouvert** — Tout le monde peut te DM\n\n" +
        "<:4388purpnum2:1494226037792440321> **MP sur demande** — Demande avant d’envoyer un message\n\n" +
        "<:2300purpnum3:1494226093429751818> **MP fermé** — Aucun message privé\n\n" +
        "_Tu peux changer de rôle à tout moment en recliquant sur un bouton._"
    )
    .setColor(VIOLET_FONCE)
    .setFooter({ text: "Un seul rôle MP peut être actif à la fois." });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("role_mp1")
      .setLabel("MP ouvert")
      .setEmoji("1494225979126845490")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("role_mp2")
      .setLabel("MP sur demande")
      .setEmoji("1494226037792440321")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("role_mp3")
      .setLabel("MP fermé")
      .setEmoji("1494226093429751818")
      .setStyle(ButtonStyle.Secondary)
  );

  await message.channel.send({ embeds: [embed], components: [row] });
  await message.delete().catch(() => {});
  return;
}
  if (cmd === "!panneauticket") {
    if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply({
        content: "❌ Tu n'as pas la permission d'utiliser cette commande. (Administrateur requis)",
      });
    }

    const embed = new EmbedBuilder()
      .setTitle("Support — Créer un ticket")
      .setDescription(
        "Besoin d'aide ? Créez un ticket en cliquant sur le bouton ci-dessous.\n\n" +
          "Un canal privé sera créé où vous pourrez discuter avec notre équipe de support.\n\n" +
          "**<:398041book:1494168601651974264>Comment ça marche ?**\n" +
          "• Cliquez sur **Ouvrir un ticket**\n" +
          "• Expliquez votre demande\n" +
          "• Notre équipe vous répondra rapidement\n" +
          "• Le ticket sera fermé une fois résolu\n\n" +
          "**<:8610purpleone:1494162685326266378>Temps de réponse**\nGénéralement sous 24h\n\n" +
          "**<:7577purple:1494162709963345970> Confidentialité**\nSeuls vous et le staff peuvent voir le ticket"
      )
      .setColor(VIOLET_FONCE)
      .setThumbnail("https://cdn.discordapp.com/attachments/1081968565831352391/1494170511104671864/telechargement.gif?")
      .setImage("https://cdn.discordapp.com/attachments/1081968565831352391/1494165733750476920/XMAHUB_1.png?ex=69e19dc7&is=69e04c47&hm=910f5e22abf3e4a0d399d1d01602f80d7a673c7569aa0c5c5dce2812ea7cfd41&")
      .setFooter({ text: "Support XMAHUB" })

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket_open")
        .setLabel("Ouvrir un ticket")
        .setStyle(ButtonStyle.Secondary)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
    await message.delete().catch((err) => {
      console.error("Erreur suppression message panneau ticket :", err);
    });
    return;
  }
});

// ─── INTERACTIONS ─────────────────────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  logInteraction(interaction);

  const { guild, member } = interaction;

if (interaction.isChatInputCommand()) {
  try {
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    const hasStaffRole = STAFF_ROLE_ID ? member.roles.cache.has(STAFF_ROLE_ID) : false;

    if (["rename", "adduser", "removeuser", "ticketactif"].includes(interaction.commandName)) {
      if (!isAdmin && !hasStaffRole) {
        return await interaction.reply({
          content: "❌ Seuls le staff et les administrateurs peuvent utiliser cette commande.",
          ephemeral: true,
        });
      }
    } else {
      if (!isAdmin) {
        return await interaction.reply({
          content: "❌ Seuls les administrateurs peuvent utiliser ces commandes.",
          ephemeral: true,
        });
      }
    }

    if (interaction.commandName === "rename") {
      await interaction.deferReply({ ephemeral: true });

      const channel = interaction.channel;
      const newNameRaw = interaction.options.getString("nom", true);

      if (!channel || channel.type !== ChannelType.GuildText) {
        return await interaction.editReply("❌ Cette commande doit être utilisée dans un salon texte.");
      }

      const ticketNum = getTicketNumFromChannel(channel);

      if (!ticketNum || (!channel.name.startsWith("ticket-") && !channel.name.startsWith("closed-"))) {
        return await interaction.editReply("❌ Cette commande peut uniquement être utilisée dans un salon ticket.");
      }

      const sanitized = newNameRaw
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9- ]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 80);

      if (!sanitized) {
        return await interaction.editReply("❌ Le nom fourni est invalide.");
      }

      const prefix = channel.name.startsWith("closed-") ? "closed" : "ticket";
      const finalName = `${prefix}-${ticketNum}-${sanitized}`;

      await channel.setName(finalName);

      await sendLog(
        guild,
        "✏️ Ticket renommé",
        member,
        ticketNum,
        channel,
        `Nouveau nom : ${finalName}`
      );

      return await interaction.editReply(`✅ Le ticket a été renommé en **${finalName}**.`);
    }

    if (interaction.commandName === "adduser") {
      await interaction.deferReply({ ephemeral: true });

      const channel = interaction.channel;
      const targetUser = interaction.options.getUser("utilisateur", true);

      if (!channel || channel.type !== ChannelType.GuildText) {
        return await interaction.editReply("❌ Cette commande doit être utilisée dans un salon texte.");
      }

      const ticketNum = getTicketNumFromChannel(channel);

      if (!ticketNum || (!channel.name.startsWith("ticket-") && !channel.name.startsWith("closed-"))) {
        return await interaction.editReply("❌ Cette commande peut uniquement être utilisée dans un salon ticket.");
      }

      const targetMember = await guild.members.fetch(targetUser.id).catch((err) => {
        console.error("Erreur fetch membre adduser :", err);
        return null;
      });

      if (!targetMember) {
        return await interaction.editReply("❌ Impossible de trouver cet utilisateur sur le serveur.");
      }

      const alreadyHasAccess = channel.permissionsFor(targetMember)?.has([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ]);

      if (alreadyHasAccess) {
        return await interaction.editReply(`ℹ️ ${targetMember} a déjà accès à ce ticket.`);
      }

      await channel.permissionOverwrites.edit(targetMember.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });

      await sendLog(
        guild,
        "➕ Utilisateur ajouté au ticket",
        member,
        ticketNum,
        channel,
        `Utilisateur ajouté : ${targetMember.user.tag}`
      );

      await channel.send(`➕ ${targetMember} a été ajouté au ticket par ${member}.`);

      return await interaction.editReply(`✅ ${targetMember} a bien été ajouté au ticket.`);
    }

    if (interaction.commandName === "removeuser") {
      await interaction.deferReply({ ephemeral: true });

      const channel = interaction.channel;
      const targetUser = interaction.options.getUser("utilisateur", true);

      if (!channel || channel.type !== ChannelType.GuildText) {
        return await interaction.editReply("❌ Cette commande doit être utilisée dans un salon texte.");
      }

      const ticketNum = getTicketNumFromChannel(channel);

      if (!ticketNum || (!channel.name.startsWith("ticket-") && !channel.name.startsWith("closed-"))) {
        return await interaction.editReply("❌ Cette commande peut uniquement être utilisée dans un salon ticket.");
      }

      const ownerId = getTicketOwnerId(channel);

      if (targetUser.id === ownerId) {
        return await interaction.editReply("❌ Tu ne peux pas retirer le créateur du ticket.");
      }

      if (targetUser.id === client.user.id) {
        return await interaction.editReply("❌ Tu ne peux pas retirer le bot du ticket.");
      }

      const targetMember = await guild.members.fetch(targetUser.id).catch((err) => {
        console.error("Erreur fetch membre removeuser :", err);
        return null;
      });

      if (!targetMember) {
        return await interaction.editReply("❌ Impossible de trouver cet utilisateur sur le serveur.");
      }

      await channel.permissionOverwrites.delete(targetMember.id).catch(async () => {
        await channel.permissionOverwrites.edit(targetMember.id, {
          ViewChannel: false,
          SendMessages: false,
          ReadMessageHistory: false,
        });
      });

      await sendLog(
        guild,
        "➖ Utilisateur retiré du ticket",
        member,
        ticketNum,
        channel,
        `Utilisateur retiré : ${targetMember.user.tag}`
      );

      await channel.send(`➖ ${targetMember} a été retiré du ticket par ${member}.`);

      return await interaction.editReply(`✅ ${targetMember} a bien été retiré du ticket.`);
    }

    if (interaction.commandName === "ticketactif") {
      await interaction.deferReply({ ephemeral: true });

      const channel = interaction.channel;

      if (!channel || channel.type !== ChannelType.GuildText) {
        return await interaction.editReply("❌ Cette commande doit être utilisée dans un salon texte.");
      }

      const ticketNum = getTicketNumFromChannel(channel);

      if (!ticketNum || !channel.name.startsWith("ticket-")) {
        return await interaction.editReply("❌ Cette commande peut uniquement être utilisée dans un ticket ouvert.");
      }

      const currentMeta = getTicketMeta(channel);
      const requestedState = interaction.options.getBoolean("protection");
      const nextProtectedState = requestedState ?? !currentMeta.autoCloseDisabled;

      if (requestedState !== null && requestedState === currentMeta.autoCloseDisabled) {
        return await interaction.editReply(
          requestedState
            ? "ℹ️ L'auto-fermeture est déjà désactivée pour ce ticket."
            : "ℹ️ L'auto-fermeture est déjà active pour ce ticket."
        );
      }

      await updateTicketTopic(channel, {
        autoCloseDisabled: nextProtectedState,
        warnedAt: null,
        openedAt: nextProtectedState ? currentMeta.openedAt : Date.now(),
      });

      if (nextProtectedState) {
        await channel.send(`🛡️ L'auto-fermeture de ce ticket a été désactivée par ${member}.`);
        await sendLog(
          guild,
          "🛡️ Auto-fermeture désactivée",
          member,
          ticketNum,
          channel,
          "Le ticket ne recevra plus de rappel ni de fermeture automatique."
        );

        return await interaction.editReply(
          "✅ L'auto-fermeture est maintenant désactivée pour ce ticket."
        );
      }

      await channel.send(`✅ L'auto-fermeture de ce ticket a été réactivée par ${member}.`);
      await sendLog(
        guild,
        "✅ Auto-fermeture réactivée",
        member,
        ticketNum,
        channel,
        "Le suivi d'inactivité repart à partir de maintenant."
      );

      return await interaction.editReply(
        "✅ L'auto-fermeture est à nouveau active pour ce ticket. Le délai repart de maintenant."
      );
    }

    if (interaction.commandName === "listemedias") {
      await interaction.deferReply({ ephemeral: true });

      const pendingDispatches = await db
        .select()
        .from(mediaDispatchesTable)
        .where(eq(mediaDispatchesTable.status, "pending"));

      if (pendingDispatches.length === 0) {
        return await interaction.editReply("📋 Aucune diffusion média en attente.");
      }

      const lines = pendingDispatches
        .sort((a, b) => a.id - b.id)
        .slice(0, 20)
        .map((dispatch) => {
          const trigger =
            dispatch.mode === "time"
              ? `temps: ${dispatch.scheduledFor ? new Date(dispatch.scheduledFor).toLocaleString("fr-FR") : "inconnu"}`
              : `réactions: ${dispatch.lastReactionCount}/${dispatch.reactionTarget}`;

          return `#${dispatch.id} • <#${dispatch.targetChannelId}> • ${trigger}`;
        })
        .join("\n");

      const more =
        pendingDispatches.length > 20
          ? `\n… et ${pendingDispatches.length - 20} autre(s) diffusion(s).`
          : "";

      return await interaction.editReply(`📋 **Diffusions en attente :**\n${lines}${more}`);
    }

    if (interaction.commandName === "programmermedia") {
      await interaction.deferReply({ ephemeral: true });

      const hubChannel = await ensureXmahubChannel(guild).catch((err) => {
        console.error("Erreur récupération salon XMAHUB :", err);
        return null;
      });

      if (!hubChannel) {
        return await interaction.editReply("❌ Impossible de préparer le salon XMAHUB.");
      }

      if (interaction.channelId !== hubChannel.id) {
        return await interaction.editReply(`❌ Cette commande doit être utilisée dans ${hubChannel}.`);
      }

      const targetChannel = interaction.options.getChannel("salon", true);
      const mode = interaction.options.getString("mode", true);
      const minutes = interaction.options.getInteger("minutes");
      const reactionTarget = interaction.options.getInteger("reactions");

      if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
        return await interaction.editReply("❌ Le salon cible doit être un salon texte.");
      }

      if (mode === "time" && (!minutes || minutes <= 0)) {
        return await interaction.editReply("❌ Tu dois renseigner `minutes` avec une valeur supérieure à 0.");
      }

      if (mode === "reactions" && (!reactionTarget || reactionTarget <= 0)) {
        return await interaction.editReply("❌ Tu dois renseigner `reactions` avec une valeur supérieure à 0.");
      }

      const sourceMessage = await resolveSourceMessage(interaction, hubChannel);

      if (!sourceMessage) {
        return await interaction.editReply(
          "❌ Aucun message média trouvé. Poste ton image/vidéo dans XMAHUB puis relance la commande."
        );
      }

      const content = sourceMessage.content?.trim() ?? "";
      const attachmentUrls = [...sourceMessage.attachments.values()].map((attachment) => attachment.url);

      if (!content && attachmentUrls.length === 0) {
        return await interaction.editReply("❌ Le message sélectionné ne contient ni texte, ni média.");
      }

      const scheduledFor = mode === "time" ? new Date(Date.now() + minutes * 60 * 1000) : null;
      const [dispatch] = await db
        .insert(mediaDispatchesTable)
        .values({
          guildId: guild.id,
          sourceChannelId: hubChannel.id,
          sourceMessageId: sourceMessage.id,
          targetChannelId: targetChannel.id,
          createdById: interaction.user.id,
          mode,
          content,
          attachmentUrls,
          reactionTarget: mode === "reactions" ? reactionTarget : null,
          scheduledFor,
        })
        .returning();

      if (mode === "reactions") {
        await checkReactionDispatchesForMessage(sourceMessage);
      }

      const summary =
        mode === "time"
          ? `dans ${minutes} minute(s)`
          : `dès que le message atteint ${reactionTarget} réaction(s)`;

      return await interaction.editReply(
        `✅ Média programmé vers ${targetChannel} ${summary}.\nID de diffusion : **${dispatch.id}**`
      );
    }

    if (interaction.commandName === "annulermedia") {
      await interaction.deferReply({ ephemeral: true });

      const dispatchId = interaction.options.getInteger("id", true);
      const [dispatch] = await db
        .select()
        .from(mediaDispatchesTable)
        .where(eq(mediaDispatchesTable.id, dispatchId));

      if (!dispatch) {
        return await interaction.editReply("❌ Diffusion introuvable.");
      }

      if (dispatch.status !== "pending") {
        return await interaction.editReply("❌ Cette diffusion n'est plus en attente.");
      }

      await db
        .update(mediaDispatchesTable)
        .set({ status: "cancelled" })
        .where(eq(mediaDispatchesTable.id, dispatchId));

      return await interaction.editReply(`✅ La diffusion **#${dispatchId}** a été annulée.`);
    }

    if (interaction.commandName === "creategiveaway") {
      await interaction.deferReply();

      const prize = interaction.options.getString("prix", true);
      const durationMinutes = interaction.options.getInteger("duree", true);
      const winnersCount = interaction.options.getInteger("gagnants", true);
      const conditions = interaction.options.getString("conditions") ?? "";

      const endsAt = new Date(Date.now() + durationMinutes * 60 * 1000);

      const [giveaway] = await db
        .insert(giveawaysTable)
        .values({
          prize,
          durationMinutes,
          winnersCount,
          conditions,
          endsAt,
          channelId: interaction.channelId,
          guildId: interaction.guildId ?? undefined,
        })
        .returning();

      const embed = buildGiveawayEmbed({ ...giveaway, endsAt });
      const reply = await interaction.editReply({ embeds: [embed] });

      await db
        .update(giveawaysTable)
        .set({ messageId: reply.id })
        .where(eq(giveawaysTable.id, giveaway.id));

      await reply.react("🎉").catch((err) => {
        console.error("Erreur réaction giveaway :", err);
      });

      scheduleGiveawayEnd(giveaway.id, endsAt);
      return;
    }

    if (interaction.commandName === "listgiveaways") {
      await interaction.deferReply({ ephemeral: true });

      const giveaways = await db
        .select()
        .from(giveawaysTable)
        .where(eq(giveawaysTable.status, "active"));

      if (giveaways.length === 0) {
        return await interaction.editReply("📋 Aucun giveaway actif en ce moment.");
      }

      const list = giveaways
        .map((g) => {
          const ts = Math.floor(new Date(g.endsAt).getTime() / 1000);
          return `• **ID ${g.id}** — 🏆 ${g.prize} | 🥇 ${g.winnersCount} gagnant(s) | ⏰ <t:${ts}:R>`;
        })
        .join("\n");

      return await interaction.editReply(`📋 **Giveaways actifs :**\n${list}`);
    }

    if (interaction.commandName === "endgiveaway") {
      await interaction.deferReply();

      const id = interaction.options.getInteger("id", true);

      const [giveaway] = await db
        .select()
        .from(giveawaysTable)
        .where(eq(giveawaysTable.id, id));

      if (!giveaway) {
        return await interaction.editReply("❌ Giveaway introuvable.");
      }

      if (giveaway.status === "ended") {
        return await interaction.editReply("❌ Ce giveaway est déjà terminé.");
      }

      const participants = await db
        .select()
        .from(giveawayParticipantsTable)
        .where(eq(giveawayParticipantsTable.giveawayId, id));

      const shuffled = [...participants].sort(() => Math.random() - 0.5);
      const selectedWinners = shuffled
        .slice(0, giveaway.winnersCount)
        .map((p) => p.username);

      const [updated] = await db
        .update(giveawaysTable)
        .set({ status: "ended", winners: selectedWinners })
        .where(eq(giveawaysTable.id, id))
        .returning();

      if (giveaway.channelId && giveaway.messageId) {
        const channel = await client.channels.fetch(giveaway.channelId).catch((err) => {
          console.error("Erreur fetch channel endgiveaway :", err);
          return null;
        });

        if (channel && channel.isTextBased()) {
          const message = await channel.messages.fetch(giveaway.messageId).catch((err) => {
            console.error("Erreur fetch message endgiveaway :", err);
            return null;
          });

          if (message) {
            await message.edit({ embeds: [buildGiveawayEmbed(updated)] });
          }
        }
      }

      return await interaction.editReply(
        `✅ Giveaway **${giveaway.prize}** terminé ! Gagnants : ${
          selectedWinners.join(", ") || "Aucun participant"
        }`
      );
    }

    if (interaction.commandName === "reroll") {
      return await handleRerollGiveaway(interaction);
    }
  } catch (err) {
    console.error("Erreur commande slash :", err);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("❌ Une erreur s'est produite.").catch((editErr) => {
        console.error("Erreur editReply commande slash :", editErr);
      });
    } else {
      await interaction.reply({
        content: "❌ Une erreur s'est produite.",
        ephemeral: true,
      }).catch((replyErr) => {
        console.error("Erreur reply commande slash :", replyErr);
      });
    }
    return;
  }
}
  // ── Notation (DM)
  if (interaction.isButton() && interaction.customId.startsWith("rate_")) {
    const parts = interaction.customId.split("_");
    const stars = parseInt(parts[1], 10);
    const guildId = parts[2];
    const ticketNum = parts[3];

    let acknowledged = false;

    try {
      await interaction.update({ components: [] });
      acknowledged = true;
    } catch (err) {
      console.error("[rate update]", err);
    }

    try {
      const targetGuild = await client.guilds.fetch(guildId).catch((err) => {
        console.error("Erreur fetch guild notation :", err);
        return null;
      });
      if (!targetGuild) return;

      const ratingChannel = targetGuild.channels.cache.get(RATING_CHANNEL_ID);
      if (!ratingChannel) {
        console.error("Salon de notation introuvable.");
        return;
      }

      const starsDisplay = "⭐".repeat(stars);
      const ratingEmbed = new EmbedBuilder()
        .setTitle("⭐ Nouvelle notation reçue")
        .addFields(
          { name: "👤 Membre", value: `${interaction.user} (${interaction.user.tag})`, inline: true },
          { name: "🆔 Ticket", value: `#${ticketNum}`, inline: true },
          { name: "⭐ Note", value: `${starsDisplay} (${stars}/5)`, inline: false }
        )
        .setColor(VIOLET_FONCE)
        .setThumbnail(interaction.user.displayAvatarURL({ size: 64 }))
        .setFooter({ text: ".gg/xma" })
        .setTimestamp();

      await ratingChannel.send({ embeds: [ratingEmbed] });

      if (acknowledged) {
        await interaction.followUp({
          content: `✅ Merci pour ta note de **${stars}/5** ! Ton avis nous aide à améliorer notre support.`,
          ephemeral: true,
        }).catch((err) => {
          console.error("[rate followUp]", err);
        });
      } else {
        await interaction.user.send(
          `✅ Merci pour ta note de **${stars}/5** ! Ton avis nous aide à améliorer notre support.`
        ).catch((err) => {
          console.error("[rate DM fallback]", err);
        });
      }
    } catch (err) {
      console.error("Erreur notation :", err);
    }
    return;
  }

  // ── Auto Rôles
if (
  interaction.isButton() &&
  ["role_nude1", "role_nude2", "role_nude3"].includes(interaction.customId)
) {
  if (!guild) return;

  try {
    await interaction.reply({ content, flags: 64 });

    console.log("NSFW click:", interaction.customId);
    console.log("ROLE_NUDE1_ID =", ROLE_NUDE1_ID);
    console.log("ROLE_NUDE2_ID =", ROLE_NUDE2_ID);
    console.log("ROLE_NUDE3_ID =", ROLE_NUDE3_ID);

    const roleNude1 = await guild.roles.fetch(ROLE_NUDE1_ID);
    const roleNude2 = await guild.roles.fetch(ROLE_NUDE2_ID);
    const roleNude3 = await guild.roles.fetch(ROLE_NUDE3_ID);

    console.log("roleNude1 =", roleNude1?.name);
    console.log("roleNude2 =", roleNude2?.name);
    console.log("roleNude3 =", roleNude3?.name);

    if (!roleNude1 || !roleNude2 || !roleNude3) {
      return await interaction.editReply("❌ Un ou plusieurs rôles NSFW sont introuvables.");
    }

    if (interaction.customId === "role_nude1") {
      await member.roles.remove([ROLE_NUDE2_ID, ROLE_NUDE3_ID]);
      await member.roles.add(ROLE_NUDE1_ID);
      return await interaction.editReply("✅ Le rôle **je n\\*de** t'a été attribué !");
    }

    if (interaction.customId === "role_nude2") {
      await member.roles.remove([ROLE_NUDE1_ID, ROLE_NUDE3_ID]);
      await member.roles.add(ROLE_NUDE2_ID);
      return await interaction.editReply("✅ Le rôle **je n\\*de si affinité** t'a été attribué !");
    }

    if (interaction.customId === "role_nude3") {
      await member.roles.remove([ROLE_NUDE1_ID, ROLE_NUDE2_ID]);
      await member.roles.add(ROLE_NUDE3_ID);
      return await interaction.editReply("✅ Le rôle **je n\\*de pas** t'a été attribué !");
    }
  } catch (err) {
    console.error("Erreur complète rôle NSFW :", err);

    return await interaction.editReply(
      "❌ Erreur lors de l'attribution du rôle NSFW."
    ).catch(console.error);
  }
}
  // ── Bouton : ouvrir un ticket
  if (interaction.isButton() && interaction.customId === "ticket_open") {
    if (!guild) return;

    const existing = guild.channels.cache.find(
      (c) => c.name.startsWith("ticket-") && getTicketOwnerId(c) === member.id
    );

    if (existing) {
      return interaction.reply({
        content: `❌ Tu as déjà un ticket ouvert : ${existing}`,
        ephemeral: true,
      }).catch((err) => {
        console.error("Erreur reply ticket_open existing :", err);
      });
    }

    const modal = new ModalBuilder()
      .setCustomId("ticket_modal")
      .setTitle("📩 Créer un ticket");

    const reasonInput = new TextInputBuilder()
      .setCustomId("ticket_reason")
      .setLabel("Quelle est la raison de votre ticket ?")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Décrivez votre problème en détail...")
      .setRequired(true)
      .setMaxLength(500);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

    await interaction.showModal(modal).catch((err) => {
      console.error("Erreur showModal ticket_open :", err);
    });
    return;
  }

  // ── Modal soumis : créer le canal ticket
  if (interaction.isModalSubmit() && interaction.customId === "ticket_modal") {
    if (!guild) return;

    const ok = await safeDefer(interaction, "ticket_modal");
    if (!ok) return;

    const reason = interaction.fields.getTextInputValue("ticket_reason");

    ticketCounter++;
    const ticketNum = formatTicketNumber(ticketCounter);
    const channelName = `ticket-${ticketNum}`;

    try {
      const category = guild.channels.cache.get(TICKET_CATEGORY_OPEN);

      const permOverwrites = [
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        {
          id: member.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
        {
          id: client.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ManageChannels,
          ],
        },
      ];

      if (STAFF_ROLE_ID) {
        permOverwrites.push({
          id: STAFF_ROLE_ID,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        });
      }

      const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        topic: serializeTicketTopic({
          ownerId: member.id,
          openedAt: Date.now(),
          warnedAt: null,
        }),
        parent: category ?? null,
        permissionOverwrites: permOverwrites,
      });

      const adminRoles = guild.roles.cache.filter(
        (r) => r.permissions.has(PermissionFlagsBits.Administrator) && r.id !== STAFF_ROLE_ID
      );

      for (const [, role] of adminRoles) {
        await ticketChannel.permissionOverwrites.create(role, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        }).catch((err) => {
          console.error(`Erreur overwrite admin ${role.name} :`, err);
        });
      }

      const avatarUrl = member.user.displayAvatarURL({ size: 64 });
      const now = new Date();
      const dateStr =
        now.toLocaleDateString("fr-FR") +
        " " +
        now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

      const ticketEmbed = new EmbedBuilder()
        .setTitle("🎫 Nouveau ticket créé")
        .setDescription(
          `Bonjour ${member} ! Merci d'avoir créé un ticket. Un membre du staff vous aidera bientôt.`
        )
        .addFields(
          { name: "👤 Créé par", value: `${member}`, inline: true },
          { name: "🆔 Ticket ID", value: `#${ticketNum}`, inline: true },
          { name: "📝 Raison", value: reason, inline: false },
          {
            name: "📋 Instructions",
            value:
              "• Décrivez votre problème en détail\n• Un membre du staff vous aidera bientôt\n• Utilisez le bouton **Fermer** pour clore ce ticket",
            inline: false,
          }
        )
        .setColor(VIOLET_FONCE)
        .setThumbnail(avatarUrl)
        .setFooter({ text: `Merci de votre patience • .gg/xma • ${dateStr}` })
        .setTimestamp();

      const ticketRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket_close")
          .setLabel("🔒 Fermer le ticket")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("ticket_delete")
          .setLabel("🗑️ Supprimer")
          .setStyle(ButtonStyle.Secondary)
      );

      const staffPing = STAFF_ROLE_ID ? `<@&${STAFF_ROLE_ID}> ` : "";

      await ticketChannel.send({
        content: `${staffPing}${member}`,
        embeds: [ticketEmbed],
        components: [ticketRow],
      });

      await sendLog(guild, "🟢 Ticket ouvert", member, ticketNum, ticketChannel, reason);

      const goRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("📂 Aller au ticket")
          .setStyle(ButtonStyle.Link)
          .setURL(`https://discord.com/channels/${guild.id}/${ticketChannel.id}`)
      );

      await interaction.editReply({
        content: `✅ Ton ticket **#${ticketNum}** a été créé !`,
        components: [goRow],
      }).catch((err) => {
        console.error("Erreur editReply ticket_modal :", err);
      });

      return;
    } catch (err) {
      console.error("Erreur création ticket :", err);
      ticketCounter--;
      return safeReply(
        interaction,
        "❌ Impossible de créer le ticket. Vérifie les permissions du bot.",
        "ticket_modal_error"
      );
    }
  }

  // ── Bouton : fermer un ticket
  if (interaction.isButton() && interaction.customId === "ticket_close") {
    if (!guild) return;

    const ok = await safeDefer(interaction, "ticket_close");
    if (!ok) return;

    const channel = interaction.channel;
    const ticketNum = getTicketNumFromChannel(channel);

    if (!ticketNum || !channel.name.startsWith("ticket-")) {
      return safeReply(interaction, "❌ Ce salon n'est pas un ticket ouvert.", "ticket_close_invalid");
    }

    try {
      await closeTicketChannel({
        guild,
        channel,
        closedBy: member,
        closeDescription: `Ce ticket a été fermé par ${member}.`,
      });

      return safeReply(
        interaction,
        "✅ Le ticket a été fermé. Une notification de notation a été envoyée au membre.",
        "ticket_close_done"
      );
    } catch (err) {
      console.error("Erreur fermeture ticket :", err);
      return safeReply(
        interaction,
        "❌ Une erreur est survenue lors de la fermeture.",
        "ticket_close_error"
      );
    }
  }

  // ── Bouton : réouvrir un ticket
  if (interaction.isButton() && interaction.customId === "ticket_reopen") {
    if (!guild) return;

    const ok = await safeDefer(interaction, "ticket_reopen");
    if (!ok) return;

    const channel = interaction.channel;
    const ticketNum = getTicketNumFromChannel(channel);

    if (!ticketNum || !channel.name.startsWith("closed-")) {
      return safeReply(interaction, "❌ Ce salon n'est pas un ticket fermé.", "ticket_reopen_invalid");
    }

    try {
      const openCategory = guild.channels.cache.get(TICKET_CATEGORY_OPEN);
      const userId = getTicketOwnerId(channel);

      if (userId) {
        const ticketUser = await guild.members.fetch(userId).catch((err) => {
          console.error("Erreur fetch membre ticket_reopen :", err);
          return null;
        });

        if (ticketUser) {
          await channel.permissionOverwrites.edit(ticketUser, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
          }).catch((err) => {
            console.error("Erreur edit perms reouverture ticket :", err);
          });
        }
      }

      await channel.setName(`ticket-${ticketNum}`);
      await updateTicketTopic(channel, {
        openedAt: Date.now(),
        warnedAt: null,
      });

      if (openCategory) {
        await channel.setParent(openCategory.id, { lockPermissions: false });
      }

      const reopenEmbed = new EmbedBuilder()
        .setTitle("🔓 Ticket réouvert")
        .setDescription(`Ce ticket a été réouvert par ${member}.`)
        .setColor(VIOLET_FONCE)
        .setFooter({ text: `.gg/xma` })
        .setTimestamp();

      const ticketRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket_close")
          .setLabel("🔒 Fermer le ticket")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("ticket_delete")
          .setLabel("🗑️ Supprimer")
          .setStyle(ButtonStyle.Secondary)
      );

      await channel.send({ embeds: [reopenEmbed], components: [ticketRow] });
      await sendLog(guild, "🟢 Ticket réouvert", member, ticketNum, channel);

      return safeReply(interaction, "✅ Le ticket a été réouvert.", "ticket_reopen_done");
    } catch (err) {
      console.error("Erreur réouverture ticket :", err);
      return safeReply(
        interaction,
        "❌ Une erreur est survenue lors de la réouverture.",
        "ticket_reopen_error"
      );
    }
  }

  // ── Bouton : supprimer un ticket
  if (interaction.isButton() && interaction.customId === "ticket_delete") {
    if (!guild) return;

    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
      return safeReply(
        interaction,
        "❌ Seuls les administrateurs peuvent supprimer un ticket.",
        "ticket_delete_no_perm"
      );
    }

    try {
      await interaction.reply({
        content: "🗑️ Suppression du ticket dans 5 secondes...",
        ephemeral: true,
      });
    } catch (err) {
      console.error("Erreur reply ticket_delete :", err);
      return;
    }

    const ticketNum = getTicketNumFromChannel(interaction.channel);
    if (ticketNum) {
      await sendLog(guild, "🗑️ Ticket supprimé", member, ticketNum, interaction.channel);
    }

    setTimeout(async () => {
      await interaction.channel.delete().catch((err) => {
        console.error("Erreur suppression channel ticket :", err);
      });
    }, 5000);
  }
});

// ─── FONCTION LOG ─────────────────────────────────────────────────────────────
async function sendLog(guild, action, member, ticketNum, channel, reason = null) {
  if (!TICKET_LOG_CHANNEL) return;

  const logChannel = guild.channels.cache.get(TICKET_LOG_CHANNEL);
  if (!logChannel) return;

  const actorLabel =
    typeof member === "string"
      ? member
      : member?.user?.tag
      ? `${member} (${member.user.tag})`
      : "Système";

  const fields = [
    { name: "👤 Action par", value: actorLabel, inline: true },
    { name: "🆔 Ticket", value: `#${ticketNum}`, inline: true },
    { name: "📌 Salon", value: channel ? `${channel}` : "Supprimé", inline: true },
  ];

  if (reason) {
    fields.push({ name: "📝 Raison", value: reason, inline: false });
  }

  const logEmbed = new EmbedBuilder()
    .setTitle(`📋 Log — ${action}`)
    .addFields(fields)
    .setColor(VIOLET_FONCE)
    .setFooter({ text: ".gg/xma" })
    .setTimestamp();

  await logChannel.send({ embeds: [logEmbed] }).catch((err) => {
    console.error("Erreur envoi log :", err);
  });
}

client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot) return;
  if (reaction.emoji.name !== "🎉") return;

  try {
    if (reaction.partial) await reaction.fetch();
    if (user.partial) await user.fetch();

    const messageId = reaction.message.id;

    const [giveaway] = await db
      .select()
      .from(giveawaysTable)
      .where(eq(giveawaysTable.messageId, messageId));

    if (!giveaway || giveaway.status === "ended") return;

    const existing = await db
      .select()
      .from(giveawayParticipantsTable)
      .where(
        and(
          eq(giveawayParticipantsTable.giveawayId, giveaway.id),
          eq(giveawayParticipantsTable.userId, user.id)
        )
      );

    if (existing.length > 0) return;

    await db.insert(giveawayParticipantsTable).values({
      giveawayId: giveaway.id,
      userId: user.id,
      username: user.username ?? user.id,
    });

    console.log(`✅ ${user.username} a participé au giveaway #${giveaway.id}`);
  } catch (err) {
    console.error("Erreur réaction giveaway :", err);
  }
});

client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot) return;

  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message?.partial) await reaction.message.fetch();

    await checkReactionDispatchesForMessage(reaction.message);
  } catch (err) {
    console.error("Erreur réaction diffusion média :", err);
  }
});

client.login(TOKEN);
