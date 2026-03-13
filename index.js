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
  MessageFlags,
  REST,
  Routes,
  Colors,
} from "discord.js";

import { db } from "./db.js";
import { giveawaysTable, giveawayParticipantsTable } from "./schema.js";
import { eq, and } from "drizzle-orm";

const TOKEN                = process.env.DISCORD_TOKEN;
const ROLE_HOMME_ID        = process.env.DISCORD_ROLE_HOMME;
const ROLE_FEMME_ID        = process.env.DISCORD_ROLE_FEMME;
const TICKET_CATEGORY_OPEN = process.env.DISCORD_TICKET_CATEGORY_OPEN;
const TICKET_CATEGORY_CLOSED = process.env.DISCORD_TICKET_CATEGORY_CLOSED;
const TICKET_LOG_CHANNEL   = process.env.DISCORD_TICKET_LOG_CHANNEL;
const STAFF_ROLE_ID        = process.env.DISCORD_STAFF_ROLE;
const RATING_CHANNEL_ID    = process.env.DISCORD_RATING_CHANNEL;
const DISCORD_CLIENT_ID    = process.env.DISCORD_CLIENT_ID;
const DISCORD_GUILD_ID     = process.env.DISCORD_GUILD_ID;

const VIOLET_FONCE = 0x4b0082;

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

client.on("error", (err) => console.error("Erreur Discord :", err.message));
process.on("unhandledRejection", (err) => console.error("Rejection non gérée :", err?.message ?? err));

let ticketCounter = 0;

function formatTicketNumber(n) {
  return String(n).padStart(4, "0");
}

function getTicketNumFromChannel(channel) {
  const match = channel.name.match(/(?:ticket|closed)-(\d+)/);
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
      new ButtonBuilder().setCustomId(`rate_1_${guild.id}_${ticketNum}`).setLabel("⭐").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`rate_2_${guild.id}_${ticketNum}`).setLabel("⭐⭐").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`rate_3_${guild.id}_${ticketNum}`).setLabel("⭐⭐⭐").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`rate_4_${guild.id}_${ticketNum}`).setLabel("⭐⭐⭐⭐").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`rate_5_${guild.id}_${ticketNum}`).setLabel("⭐⭐⭐⭐⭐").setStyle(ButtonStyle.Primary)
    );

    await user.send({ embeds: [embed], components: [row] });
  } catch (err) {
    console.error("Impossible d'envoyer le DM de notation :", err.message);
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

async function scheduleGiveawayEnd(giveawayId, endsAt) 
{async function handleRerollGiveaway(interaction) {
  const id = interaction.options.getInteger("id", true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
    return await interaction.editReply("❌ Aucun participant pour refaire le tirage.");
  }

  const shuffled = [...participants].sort(() => Math.random() - 0.5);
  const selectedWinners = shuffled
    .slice(0, giveaway.winnersCount)
    .map((p) => p.username);

  const [updated] = await db
    .update(giveawaysTable)
    .set({
      status: "ended",
      winners: selectedWinners,
    })
    .where(eq(giveawaysTable.id, id))
    .returning();

  if (giveaway.channelId && giveaway.messageId) {
    const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
    if (channel && channel.isTextBased()) {
      const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
      if (message) {
        await message.edit({ embeds: [buildGiveawayEmbed(updated)] });
        await channel.send(
          `🔁 **Reroll du giveaway ${giveaway.prize}**\nNouveaux gagnants : ${selectedWinners.join(", ") || "Aucun participant"}`
        );
      }
    }
  }

  return await interaction.editReply(
    `✅ Nouveau tirage effectué pour **${giveaway.prize}**.\nGagnants : ${selectedWinners.join(", ") || "Aucun participant"}`
  );
}
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
        const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
        if (channel && channel.isTextBased()) {
          const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
          if (message) {
            await message.edit({ embeds: [buildGiveawayEmbed(updated)] });
          }
        }
      }
    } catch (err) {
      console.error("Erreur fin giveaway :", err);
    }
  }, delay);
}

// ─── READY ───────────────────────────────────────────────────────────────────
client.once("clientReady", async () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
  await registerGiveawayCommands();

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
});

// ─── COMMANDES TEXTE ──────────────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const cmd = message.content.toLowerCase().trim();

  // ── !embedrôle ──
  if (cmd === "!embedrôle" || cmd === "!embedrole") {
    if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
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
    if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
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
    if (interaction.isChatInputCommand()) {
    try {
          if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return await interaction.reply({
        content: "❌ Seuls les administrateurs peuvent utiliser ces commandes.",
        flags: MessageFlags.Ephemeral,
      });
    }
      if (interaction.commandName === "creategiveaway") {
        const prize = interaction.options.getString("prix", true);
        const durationMinutes = interaction.options.getInteger("duree", true);
        const winnersCount = interaction.options.getInteger("gagnants", true);
        const conditions = interaction.options.getString("conditions") ?? "";

        await interaction.deferReply();

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

        await reply.react("🎉").catch(() => {});
        scheduleGiveawayEnd(giveaway.id, endsAt);
        return;
      }

      if (interaction.commandName === "listgiveaways") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
        const id = interaction.options.getInteger("id", true);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

              if (interaction.commandName === "reroll") {
        return await handleRerollGiveaway(interaction);
      }

        const [giveaway] = await db
          .select()
          .from(giveawaysTable)
          .where(eq(giveawaysTable.id, id));

        if (!giveaway) return await interaction.editReply("❌ Giveaway introuvable.");
        if (giveaway.status === "ended") return await interaction.editReply("❌ Ce giveaway est déjà terminé.");

        const participants = await db
          .select()
          .from(giveawayParticipantsTable)
          .where(eq(giveawayParticipantsTable.giveawayId, id));

        const shuffled = [...participants].sort(() => Math.random() - 0.5);
        const selectedWinners = shuffled.slice(0, giveaway.winnersCount).map((p) => p.username);

        const [updated] = await db
          .update(giveawaysTable)
          .set({ status: "ended", winners: selectedWinners })
          .where(eq(giveawaysTable.id, id))
          .returning();

        if (giveaway.channelId && giveaway.messageId) {
          const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
          if (channel && channel.isTextBased()) {
            const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
            if (message) {
              await message.edit({ embeds: [buildGiveawayEmbed(updated)] });
            }
          }
        }

        return await interaction.editReply(
          `✅ Giveaway **${giveaway.prize}** terminé ! Gagnants : ${selectedWinners.join(", ") || "Aucun participant"}`
        );
      }
    } catch (err) {
      console.error("Erreur commande giveaway :", err);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply("❌ Une erreur s'est produite.").catch(() => {});
      } else {
        await interaction.reply({ content: "❌ Une erreur s'est produite.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      return;
    }
  }

  // ── Notation (DM) ─────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("rate_")) {
    const parts = interaction.customId.split("_");
    const stars = parseInt(parts[1]);
    const guildId = parts[2];
    const ticketNum = parts[3];

    try {
      await interaction.update({ components: [] }); // retire les boutons
    } catch { /* DM peut-être expiré */ }

    // Poster la notation dans le salon dédié
    try {
      const targetGuild = await client.guilds.fetch(guildId).catch(() => null);
      if (!targetGuild) return;

      const ratingChannel = targetGuild.channels.cache.get(RATING_CHANNEL_ID);
      if (!ratingChannel) return;

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

      // Confirmer à l'utilisateur en DM
      await interaction.followUp({
        content: `✅ Merci pour ta note de **${stars}/5** ! Ton avis nous aide à améliorer notre support.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {
        interaction.user.send(`✅ Merci pour ta note de **${stars}/5** ! Ton avis nous aide à améliorer notre support.`).catch(() => {});
      });
    } catch (err) {
      console.error("Erreur notation :", err.message);
    }
    return;
  }

  // ── Rôles genre (boutons, uniquement en serveur) ──────────────────────────
  if (interaction.isButton() && (interaction.customId === "role_homme" || interaction.customId === "role_femme")) {
    if (!guild) return;
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
    if (!guild) return;

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
    if (!guild) return;
    const ok = await safeDefer(interaction);
    if (!ok) return;

    const reason = interaction.fields.getTextInputValue("ticket_reason");

    ticketCounter++;
    const ticketNum = formatTicketNumber(ticketCounter);
    const channelName = `ticket-${ticketNum}`;

    try {
      const category = guild.channels.cache.get(TICKET_CATEGORY_OPEN);

      // Permissions de base
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

      // Rôle staff
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
        topic: member.id,
        parent: category ?? null,
        permissionOverwrites: permOverwrites,
      });

      // Accès aux rôles admin
      const adminRoles = guild.roles.cache.filter((r) =>
        r.permissions.has(PermissionFlagsBits.Administrator) && r.id !== STAFF_ROLE_ID
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

      // Ping du rôle staff + membre
      const staffPing = STAFF_ROLE_ID ? `<@&${STAFF_ROLE_ID}> ` : "";
      await ticketChannel.send({
        content: `${staffPing}${member}`,
        embeds: [ticketEmbed],
        components: [ticketRow],
      });

      await sendLog(guild, "🟢 Ticket ouvert", member, ticketNum, ticketChannel, reason);

      // Bouton lien direct vers le ticket
      const goRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("📂 Aller au ticket")
          .setStyle(ButtonStyle.Link)
          .setURL(`https://discord.com/channels/${guild.id}/${ticketChannel.id}`)
      );
      try {
        await interaction.editReply({ content: `✅ Ton ticket **#${ticketNum}** a été créé !`, components: [goRow] });
      } catch { /* interaction expirée */ }
      return;
    } catch (err) {
      console.error("Erreur création ticket :", err);
      ticketCounter--;
      return safeReply(interaction, "❌ Impossible de créer le ticket. Vérifie les permissions du bot.");
    }
  }

  // ── Bouton : fermer un ticket ─────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === "ticket_close") {
    if (!guild) return;
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

      await channel.setName(`closed-${ticketNum}`);

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

      // Envoyer le DM de notation au membre
      if (userId) {
        await sendRatingDM(guild, userId, ticketNum);
      }

      return safeReply(interaction, "✅ Le ticket a été fermé. Une notification de notation a été envoyée au membre.");
    } catch (err) {
      console.error("Erreur fermeture ticket :", err);
      return safeReply(interaction, "❌ Une erreur est survenue lors de la fermeture.");
    }
  }

  // ── Bouton : réouvrir un ticket ───────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === "ticket_reopen") {
    if (!guild) return;
    const ok = await safeDefer(interaction);
    if (!ok) return;

    const channel = interaction.channel;
    const ticketNum = getTicketNumFromChannel(channel);

    if (!ticketNum || !channel.name.startsWith("closed-")) {
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
    if (!guild) return;
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

  if (reason) fields.push({ name: "📝 Raison", value: reason, inline: false });

  const logEmbed = new EmbedBuilder()
    .setTitle(`📋 Log — ${action}`)
    .addFields(fields)
    .setColor(VIOLET_FONCE)
    .setFooter({ text: ".gg/xma" })
    .setTimestamp();

  await logChannel.send({ embeds: [logEmbed] }).catch(console.error);
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

client.login(TOKEN);
