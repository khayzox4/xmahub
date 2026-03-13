import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
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

client.on("error", (err) => console.error("Erreur Discord :", err.message));
process.on("unhandledRejection", (err) => console.error("Rejection non gérée :", err?.message ?? err));

// Compteur de tickets (persisté dans le nom du canal)
let ticketCounter = 0;

function formatTicketNumber(n) {
  return String(n).padStart(4, "0");
}

// Extrait le numéro de ticket depuis le nom du canal (ticket-0001 ou close-0001)
function getTicketNumFromChannel(channel) {
  const match = channel.name.match(/(?:ticket|close)-(\d+)/);
  return match ? match[1] : null;
}

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
  } catch { /* interaction expirée */ }
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

// ─── INTERACTIONS ─────────────────────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  const { guild, member } = interaction;

  // ── Rôles genre (boutons) ─────────────────────────────────────────────────
  if (interaction.isButton() && (interaction.customId === "role_homme" || interaction.customId === "role_femme")) {
    const ok = await safeDefer(interaction);
    if (!ok) return;
    try {
      const roleHomme = await guild.roles.fetch(ROLE_HOMME_ID);
      const roleFemme = await guild.roles.fetch(ROLE_FEMME_ID);
      if (!roleHomme || !roleFemme) return safeReply(interaction, "❌ Rôles introuvables. Contacte un administrateur.");

      if (interaction.customId === "role_homme") {
        if (member.roles.cache.has(ROLE_HOMME_ID)) return safeReply(interaction, "ℹ️ Tu as déjà le rôle **Homme**.");
        await member.roles.remove(roleFemme).catch(() => {});
        await member.roles.add(roleHomme);
        return safeReply(interaction, "✅ Le rôle **Homme** t'a été attribué !");
      }
      if (interaction.customId === "role_femme") {
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

  // ── Bouton : ouvrir un ticket → affiche le modal ──────────────────────────
  if (interaction.isButton() && interaction.customId === "ticket_open") {
    // Vérifier si l'utilisateur a déjà un ticket ouvert (nom du canal commence par "ticket-")
    const existing = guild.channels.cache.find(
      (c) => c.name.startsWith("ticket-") && c.topic === member.id
    );
    if (existing) {
      return interaction.reply({
        content: `❌ Tu as déjà un ticket ouvert : ${existing}`,
        flags: MessageFlags.Ephemeral,
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
    await interaction.showModal(modal);
    return;
  }

  // ── Modal soumis : créer le canal ticket ──────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === "ticket_modal") {
    const ok = await safeDefer(interaction);
    if (!ok) return;

    const reason = interaction.fields.getTextInputValue("ticket_reason");

    ticketCounter++;
    const ticketNum = formatTicketNumber(ticketCounter);
    const channelName = `ticket-${ticketNum}`;

    try {
      const category = guild.channels.cache.get(TICKET_CATEGORY_OPEN);
      const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        topic: member.id, // on stocke l'ID du membre dans le topic pour le retrouver
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

      // Accès aux rôles admin
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

      const avatarUrl = member.user.displayAvatarURL({ size: 64 });
      const now = new Date();
      const dateStr = now.toLocaleDateString("fr-FR") + " " + now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

      const ticketEmbed = new EmbedBuilder()
        .setTitle("🎫 Nouveau ticket créé")
        .setDescription(`Bonjour ${member} ! Merci d'avoir créé un ticket. Un membre du staff vous aidera bientôt.`)
        .addFields(
          { name: "👤 Créé par", value: `${member}`, inline: true },
          { name: "🆔 Ticket ID", value: `#${ticketNum}`, inline: true },
          { name: "📝 Raison", value: reason, inline: false },
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
      await sendLog(guild, "🟢 Ticket ouvert", member, ticketNum, ticketChannel, reason);
      return safeReply(interaction, `✅ Ton ticket a été créé : ${ticketChannel}`);
    } catch (err) {
      console.error("Erreur création ticket :", err);
      ticketCounter--;
      return safeReply(interaction, "❌ Impossible de créer le ticket. Vérifie les permissions du bot.");
    }
  }

  // ── Bouton : fermer un ticket ─────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === "ticket_close") {
    const ok = await safeDefer(interaction);
    if (!ok) return;

    const channel = interaction.channel;
    const ticketNum = getTicketNumFromChannel(channel);

    if (!ticketNum || !channel.name.startsWith("ticket-")) {
      return safeReply(interaction, "❌ Ce salon n'est pas un ticket ouvert.");
    }

    try {
      const closedCategory = guild.channels.cache.get(TICKET_CATEGORY_CLOSED);
      const userId = channel.topic;

      // Retirer l'accès au membre
      if (userId) {
        const ticketUser = await guild.members.fetch(userId).catch(() => null);
        if (ticketUser) {
          await channel.permissionOverwrites.edit(ticketUser, {
            ViewChannel: false,
            SendMessages: false,
          }).catch(() => {});
        }
      }

      // Renommer le canal en close-XXXX
      await channel.setName(`close-${ticketNum}`);

      // Déplacer dans la catégorie closed
      if (closedCategory) {
        await channel.setParent(closedCategory.id, { lockPermissions: false });
      }

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
      await sendLog(guild, "🔴 Ticket fermé", member, ticketNum, channel);
      return safeReply(interaction, "✅ Le ticket a été fermé.");
    } catch (err) {
      console.error("Erreur fermeture ticket :", err);
      return safeReply(interaction, "❌ Une erreur est survenue lors de la fermeture.");
    }
  }

  // ── Bouton : réouvrir un ticket ───────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === "ticket_reopen") {
    const ok = await safeDefer(interaction);
    if (!ok) return;

    const channel = interaction.channel;
    const ticketNum = getTicketNumFromChannel(channel);

    if (!ticketNum || !channel.name.startsWith("close-")) {
      return safeReply(interaction, "❌ Ce salon n'est pas un ticket fermé.");
    }

    try {
      const openCategory = guild.channels.cache.get(TICKET_CATEGORY_OPEN);
      const userId = channel.topic;

      if (userId) {
        const ticketUser = await guild.members.fetch(userId).catch(() => null);
        if (ticketUser) {
          await channel.permissionOverwrites.edit(ticketUser, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
          }).catch(() => {});
        }
      }

      // Renommer en ticket-XXXX
      await channel.setName(`ticket-${ticketNum}`);

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
        new ButtonBuilder().setCustomId("ticket_close").setLabel("🔒 Fermer le ticket").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("ticket_delete").setLabel("🗑️ Supprimer").setStyle(ButtonStyle.Secondary)
      );

      await channel.send({ embeds: [reopenEmbed], components: [ticketRow] });
      await sendLog(guild, "🟢 Ticket réouvert", member, ticketNum, channel);
      return safeReply(interaction, "✅ Le ticket a été réouvert.");
    } catch (err) {
      console.error("Erreur réouverture ticket :", err);
      return safeReply(interaction, "❌ Une erreur est survenue lors de la réouverture.");
    }
  }

  // ── Bouton : supprimer un ticket ──────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === "ticket_delete") {
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
      return safeReply(interaction, "❌ Seuls les administrateurs peuvent supprimer un ticket.");
    }

    try {
      await interaction.reply({ content: "🗑️ Suppression du ticket dans 5 secondes...", flags: MessageFlags.Ephemeral });
    } catch { return; }

    const ticketNum = getTicketNumFromChannel(interaction.channel);
    if (ticketNum) {
      await sendLog(guild, "🗑️ Ticket supprimé", member, ticketNum, interaction.channel);
    }

    setTimeout(async () => {
      await interaction.channel.delete().catch(console.error);
    }, 5000);
  }
});

// ─── FONCTION LOG ─────────────────────────────────────────────────────────────
async function sendLog(guild, action, member, ticketNum, channel, reason = null) {
  if (!TICKET_LOG_CHANNEL) return;
  const logChannel = guild.channels.cache.get(TICKET_LOG_CHANNEL);
  if (!logChannel) return;

  const fields = [
    { name: "👤 Membre", value: `${member} (${member.user.tag})`, inline: true },
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

  await logChannel.send({ embeds: [logEmbed] }).catch(console.error);
}

client.login(TOKEN);
