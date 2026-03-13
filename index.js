import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
  PermissionsBitField,
  MessageFlags,
} from "discord.js";

const TOKEN = process.env.DISCORD_TOKEN;
const ROLE_HOMME_ID = process.env.DISCORD_ROLE_HOMME;
const ROLE_FEMME_ID = process.env.DISCORD_ROLE_FEMME;
const TICKET_CATEGORY_OPEN = process.env.DISCORD_TICKET_CATEGORY_OPEN;
const TICKET_CATEGORY_CLOSED = process.env.DISCORD_TICKET_CATEGORY_CLOSED;
const TICKET_LOG_CHANNEL = process.env.DISCORD_TICKET_LOG_CHANNEL;

const VIOLET_FONCE = 0x4b0082;

if (!TOKEN) {
  console.error("Erreur : DISCORD_TOKEN est manquant.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Gestion globale des erreurs pour éviter les crashes
client.on("error", (err) => console.error("Erreur Discord :", err.message));
process.on("unhandledRejection", (err) => console.error("Rejection non gérée :", err?.message ?? err));

// Stockage en mémoire des tickets
const ticketData = new Map();
let ticketCounter = 0;

function formatTicketNumber(n) {
  return String(n).padStart(4, "0");
}

// Réponse éphémère sécurisée (évite les crashes si l'interaction a expiré)
async function safeDefer(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return true;
  } catch {
    return false;
  }
}

async function safeReply(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch {
    // Interaction expirée, on ignore silencieusement
  }
}

// ─── READY ───────────────────────────────────────────────────────────────────
client.once("clientReady", () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
});

// ─── COMMANDES TEXTE ──────────────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const cmd = message.content.toLowerCase().trim();

  // ── !embedrôle ──
  if (cmd === "!embedrôle" || cmd === "!embedrole") {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply({ content: "❌ Tu n'as pas la permission d'utiliser cette commande. (Administrateur requis)" });
    }

    const embed = new EmbedBuilder()
      .setTitle("✨ Choisis ton genre ✨")
      .setDescription(
        "Bienvenue sur le serveur ! Sélectionne ton genre ci-dessous en cliquant sur le bouton correspondant.\n\n" +
        "🔵 **Homme** — Clique pour obtenir le rôle Homme\n" +
        "🌸 **Femme** — Clique pour obtenir le rôle Femme\n\n" +
        "_Tu peux changer de rôle à tout moment en recliquant sur un bouton._"
      )
      .setColor(VIOLET_FONCE)
      .setFooter({ text: "Un seul rôle de genre peut être actif à la fois." })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("role_homme").setLabel("🔵 Homme").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("role_femme").setLabel("🌸 Femme").setStyle(ButtonStyle.Secondary)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
    await message.delete().catch(() => {});
    return;
  }

  // ── !panneauticket ──
  if (cmd === "!panneauticket") {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply({ content: "❌ Tu n'as pas la permission d'utiliser cette commande. (Administrateur requis)" });
    }

    const embed = new EmbedBuilder()
      .setTitle("🎫 Support — Créer un ticket")
      .setDescription(
        "Besoin d'aide ? Créez un ticket en cliquant sur le bouton ci-dessous.\n\n" +
        "Un canal privé sera créé où vous pourrez discuter avec notre équipe de support.\n\n" +
        "**📋 Comment ça marche ?**\n" +
        "• Cliquez sur **Ouvrir un ticket**\n" +
        "• Expliquez votre demande\n" +
        "• Notre équipe vous répondra rapidement\n" +
        "• Le ticket sera fermé une fois résolu\n\n" +
        "**⚡ Temps de réponse**\nGénéralement sous 24h\n\n" +
        "**🔒 Confidentialité**\nSeuls vous et le staff peuvent voir le ticket"
      )
      .setColor(VIOLET_FONCE)
      .setFooter({ text: "Support XMAHUB" })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket_open")
        .setLabel("📩 Ouvrir un ticket")
        .setStyle(ButtonStyle.Primary)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
    await message.delete().catch(() => {});
    return;
  }
});

// ─── INTERACTIONS (boutons) ───────────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const { customId, member, guild } = interaction;

  // ── Rôles genre ──────────────────────────────────────────────────────────
  if (customId === "role_homme" || customId === "role_femme") {
    const ok = await safeDefer(interaction);
    if (!ok) return;
    try {
      const roleHomme = await guild.roles.fetch(ROLE_HOMME_ID);
      const roleFemme = await guild.roles.fetch(ROLE_FEMME_ID);
      if (!roleHomme || !roleFemme) {
        return safeReply(interaction, "❌ Rôles introuvables. Contacte un administrateur.");
      }
      if (customId === "role_homme") {
        if (member.roles.cache.has(ROLE_HOMME_ID)) return safeReply(interaction, "ℹ️ Tu as déjà le rôle **Homme**.");
        await member.roles.remove(roleFemme).catch(() => {});
        await member.roles.add(roleHomme);
        return safeReply(interaction, "✅ Le rôle **Homme** t'a été attribué !");
      }
      if (customId === "role_femme") {
        if (member.roles.cache.has(ROLE_FEMME_ID)) return safeReply(interaction, "ℹ️ Tu as déjà le rôle **Femme**.");
        await member.roles.remove(roleHomme).catch(() => {});
        await member.roles.add(roleFemme);
        return safeReply(interaction, "✅ Le rôle **Femme** t'a été attribué !");
      }
    } catch (err) {
      console.error(err);
      return safeReply(interaction, "❌ Une erreur est survenue lors de l'attribution du rôle.");
    }
  }

  // ── Ouvrir un ticket ─────────────────────────────────────────────────────
  if (customId === "ticket_open") {
    const ok = await safeDefer(interaction);
    if (!ok) return;

    const existing = [...ticketData.values()].find(
      (t) => t.userId === member.id && t.status === "open"
    );
    if (existing) {
      const ch = guild.channels.cache.get(existing.channelId);
      return safeReply(interaction, `❌ Tu as déjà un ticket ouvert : ${ch ? ch.toString() : "introuvable"}.`);
    }

    ticketCounter++;
    const ticketNum = formatTicketNumber(ticketCounter);
    const channelName = `ticket-${ticketNum}`;

    try {
      const category = guild.channels.cache.get(TICKET_CATEGORY_OPEN);
      const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category ?? null,
        permissionOverwrites: [
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
        ],
      });

      const adminRoles = guild.roles.cache.filter((r) =>
        r.permissions.has(PermissionFlagsBits.Administrator)
      );
      for (const [, role] of adminRoles) {
        await ticketChannel.permissionOverwrites.create(role, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        }).catch(() => {});
      }

      ticketData.set(ticketChannel.id, {
        channelId: ticketChannel.id,
        userId: member.id,
        ticketNumber: ticketNum,
        status: "open",
        openedAt: new Date(),
      });

      const avatarUrl = member.user.displayAvatarURL({ size: 64 });
      const now = new Date();
      const dateStr = now.toLocaleDateString("fr-FR") + " " + now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

      const ticketEmbed = new EmbedBuilder()
        .setTitle("🎫 Nouveau ticket créé")
        .setDescription(`Bonjour ${member} ! Merci d'avoir créé un ticket. Un membre du staff vous aidera bientôt.`)
        .addFields(
          { name: "👤 Créé par", value: `${member}`, inline: true },
          { name: "🆔 Ticket ID", value: `#${ticketNum}`, inline: true },
          { name: "📝 Raison", value: "Non spécifiée", inline: false },
          {
            name: "📋 Instructions",
            value: "• Décrivez votre problème en détail\n• Un membre du staff vous aidera bientôt\n• Utilisez le bouton **Fermer** pour clore ce ticket",
            inline: false,
          }
        )
        .setColor(VIOLET_FONCE)
        .setThumbnail(avatarUrl)
        .setFooter({ text: `Merci de votre patience • .gg/xma • ${dateStr}` })
        .setTimestamp();

      const ticketRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket_close").setLabel("🔒 Fermer le ticket").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("ticket_delete").setLabel("🗑️ Supprimer").setStyle(ButtonStyle.Secondary)
      );

      await ticketChannel.send({ content: `${member}`, embeds: [ticketEmbed], components: [ticketRow] });
      await sendLog(guild, "🟢 Ticket ouvert", member, ticketNum, ticketChannel);
      return safeReply(interaction, `✅ Ton ticket a été créé : ${ticketChannel}`);
    } catch (err) {
      console.error("Erreur création ticket :", err);
      ticketCounter--;
      return safeReply(interaction, "❌ Impossible de créer le ticket. Vérifie les permissions du bot.");
    }
  }

  // ── Fermer un ticket ─────────────────────────────────────────────────────
  if (customId === "ticket_close") {
    const ok = await safeDefer(interaction);
    if (!ok) return;
    const data = ticketData.get(interaction.channelId);
    if (!data || data.status === "closed") {
      return safeReply(interaction, "❌ Ce ticket est déjà fermé ou introuvable.");
    }

    try {
      const channel = interaction.channel;
      const closedCategory = guild.channels.cache.get(TICKET_CATEGORY_CLOSED);

      const ticketUser = await guild.members.fetch(data.userId).catch(() => null);
      if (ticketUser) {
        await channel.permissionOverwrites.edit(ticketUser, { ViewChannel: false, SendMessages: false }).catch(() => {});
      }

      if (closedCategory) {
        await channel.setParent(closedCategory.id, { lockPermissions: false });
      }

      data.status = "closed";
      ticketData.set(channel.id, data);

      const closedEmbed = new EmbedBuilder()
        .setTitle("🔒 Ticket fermé")
        .setDescription(`Ce ticket a été fermé par ${member}.`)
        .setColor(VIOLET_FONCE)
        .setFooter({ text: `.gg/xma` })
        .setTimestamp();

      const reopenRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket_reopen").setLabel("🔓 Réouvrir").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("ticket_delete").setLabel("🗑️ Supprimer").setStyle(ButtonStyle.Danger)
      );

      await channel.send({ embeds: [closedEmbed], components: [reopenRow] });
      await sendLog(guild, "🔴 Ticket fermé", member, data.ticketNumber, channel);
      return safeReply(interaction, "✅ Le ticket a été fermé.");
    } catch (err) {
      console.error("Erreur fermeture ticket :", err);
      return safeReply(interaction, "❌ Une erreur est survenue lors de la fermeture.");
    }
  }

  // ── Réouvrir un ticket ────────────────────────────────────────────────────
  if (customId === "ticket_reopen") {
    const ok = await safeDefer(interaction);
    if (!ok) return;
    const data = ticketData.get(interaction.channelId);
    if (!data || data.status === "open") {
      return safeReply(interaction, "❌ Ce ticket est déjà ouvert ou introuvable.");
    }

    try {
      const channel = interaction.channel;
      const openCategory = guild.channels.cache.get(TICKET_CATEGORY_OPEN);

      const ticketUser = await guild.members.fetch(data.userId).catch(() => null);
      if (ticketUser) {
        await channel.permissionOverwrites.edit(ticketUser, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        }).catch(() => {});
      }

      if (openCategory) {
        await channel.setParent(openCategory.id, { lockPermissions: false });
      }

      data.status = "open";
      ticketData.set(channel.id, data);

      const reopenEmbed = new EmbedBuilder()
        .setTitle("🔓 Ticket réouvert")
        .setDescription(`Ce ticket a été réouvert par ${member}.`)
        .setColor(VIOLET_FONCE)
        .setFooter({ text: `.gg/xma` })
        .setTimestamp();

      const ticketRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket_close").setLabel("🔒 Fermer le ticket").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("ticket_delete").setLabel("🗑️ Supprimer").setStyle(ButtonStyle.Secondary)
      );

      await channel.send({ embeds: [reopenEmbed], components: [ticketRow] });
      await sendLog(guild, "🟢 Ticket réouvert", member, data.ticketNumber, channel);
      return safeReply(interaction, "✅ Le ticket a été réouvert.");
    } catch (err) {
      console.error("Erreur réouverture ticket :", err);
      return safeReply(interaction, "❌ Une erreur est survenue lors de la réouverture.");
    }
  }

  // ── Supprimer un ticket ───────────────────────────────────────────────────
  if (customId === "ticket_delete") {
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
      return safeReply(interaction, "❌ Seuls les administrateurs peuvent supprimer un ticket.");
    }

    try {
      await interaction.reply({ content: "🗑️ Suppression du ticket dans 5 secondes...", flags: MessageFlags.Ephemeral });
    } catch { return; }

    const data = ticketData.get(interaction.channelId);
    if (data) {
      await sendLog(guild, "🗑️ Ticket supprimé", member, data.ticketNumber, interaction.channel);
      ticketData.delete(interaction.channelId);
    }

    setTimeout(async () => {
      await interaction.channel.delete().catch(console.error);
    }, 5000);
  }
});

// ─── FONCTION LOG ─────────────────────────────────────────────────────────────
async function sendLog(guild, action, member, ticketNum, channel) {
  if (!TICKET_LOG_CHANNEL) return;
  const logChannel = guild.channels.cache.get(TICKET_LOG_CHANNEL);
  if (!logChannel) return;

  const logEmbed = new EmbedBuilder()
    .setTitle(`📋 Log — ${action}`)
    .addFields(
      { name: "👤 Membre", value: `${member} (${member.user.tag})`, inline: true },
      { name: "🆔 Ticket", value: `#${ticketNum}`, inline: true },
      { name: "📌 Salon", value: channel ? `${channel}` : "Supprimé", inline: true }
    )
    .setColor(VIOLET_FONCE)
    .setFooter({ text: ".gg/xma" })
    .setTimestamp();

  await logChannel.send({ embeds: [logEmbed] }).catch(console.error);
}

client.login(TOKEN);
