import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
} from "discord.js";
import { db, pool } from "./db.js";
import { giveawaysTable, giveawayParticipantsTable } from "./schema.js";
import { eq, and } from "drizzle-orm";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  console.error("❌ DISCORD_TOKEN et DISCORD_CLIENT_ID sont requis dans le fichier .env");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: ["MESSAGE", "CHANNEL", "REACTION"],
});

const commands = [
  new SlashCommandBuilder()
    .setName("creategiveaway")
    .setDescription("🎉 Lancer un nouveau giveaway")
    .addStringOption((opt) =>
      opt.setName("prix").setDescription("Le prix du giveaway").setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt.setName("duree").setDescription("Durée en minutes").setRequired(true).setMinValue(1)
    )
    .addIntegerOption((opt) =>
      opt.setName("gagnants").setDescription("Nombre de gagnants").setRequired(true).setMinValue(1)
    )
    .addStringOption((opt) =>
      opt.setName("conditions").setDescription("Conditions (optionnel)").setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("listgiveaways")
    .setDescription("📋 Voir tous les giveaways actifs")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("endgiveaway")
    .setDescription("🏁 Terminer un giveaway manuellement")
    .addIntegerOption((opt) =>
      opt.setName("id").setDescription("ID du giveaway").setRequired(true)
    )
    .toJSON(),
];

async function registerCommands() {
  const rest = new REST().setToken(DISCORD_TOKEN);
  try {
    console.log("🔄 Enregistrement des commandes slash...");
    await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body: commands });
    console.log("✅ Commandes slash enregistrées !");
  } catch (error) {
    console.error("❌ Erreur lors de l'enregistrement des commandes:", error);
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
      { name: "⏱️ Durée", value: `${giveaway.durationMinutes} minute${giveaway.durationMinutes > 1 ? "s" : ""}`, inline: true },
      { name: "🥇 Nombre de gagnants", value: `${giveaway.winnersCount}`, inline: true }
    )
    .setFooter({ text: `ID: ${giveaway.id} • Giveaway Bot` })
    .setTimestamp(new Date(giveaway.endsAt));

  if (giveaway.conditions && giveaway.conditions.trim().length > 0) {
    embed.addFields({ name: "📋 Conditions", value: giveaway.conditions });
  }

  if (!isEnded) {
    embed.addFields({ name: "⏰ Se termine", value: `<t:${endsAtTimestamp}:R>`, inline: true });
  }

  if (isEnded && giveaway.winners.length > 0) {
    embed.addFields({ name: "🏆 Gagnant(s)", value: giveaway.winners.map((w) => `🎊 **${w}**`).join("\n") });
    embed.setDescription("✅ Le giveaway est **terminé** ! Félicitations aux gagnants !");
  } else if (isEnded && giveaway.winners.length === 0) {
    embed.addFields({ name: "❌ Gagnants", value: "Aucun participant n'a été trouvé." });
    embed.setDescription("❌ Le giveaway est **terminé** mais personne n'a participé.");
  }

  return embed;
}

async function scheduleGiveawayEnd(giveawayId, endsAt) {
  const delay = new Date(endsAt).getTime() - Date.now();
  if (delay <= 0) return;

  setTimeout(async () => {
    try {
      const [giveaway] = await db.select().from(giveawaysTable).where(eq(giveawaysTable.id, giveawayId));
      if (!giveaway || giveaway.status === "ended") return;

      const participants = await db.select().from(giveawayParticipantsTable).where(eq(giveawayParticipantsTable.giveawayId, giveawayId));
      const shuffled = [...participants].sort(() => Math.random() - 0.5);
      const selectedWinners = shuffled.slice(0, giveaway.winnersCount).map((p) => p.username);

      const [updated] = await db
        .update(giveawaysTable)
        .set({ status: "ended", winners: selectedWinners })
        .where(eq(giveawaysTable.id, giveawayId))
        .returning();

      if (giveaway.channelId && giveaway.messageId) {
        try {
          const channel = await client.channels.fetch(giveaway.channelId);
          if (channel && channel.isTextBased()) {
            const message = await channel.messages.fetch(giveaway.messageId);
            if (message) {
              await message.edit({ embeds: [buildGiveawayEmbed(updated)] });
              if (selectedWinners.length > 0) {
                await channel.send(`🎊 Félicitations aux gagnants de **${giveaway.prize}** : ${selectedWinners.map((w) => `**${w}**`).join(", ")} !`);
              } else {
                await channel.send(`❌ Le giveaway **${giveaway.prize}** est terminé mais aucun participant n'a été trouvé.`);
              }
            }
          }
        } catch (err) {
          console.error("Erreur lors de la mise à jour du message:", err);
        }
      }

      console.log(`✅ Giveaway #${giveawayId} terminé. Gagnants: ${selectedWinners.join(", ") || "Aucun"}`);
    } catch (err) {
      console.error(`❌ Erreur giveaway #${giveawayId}:`, err);
    }
  }, delay);

  console.log(`⏰ Giveaway #${giveawayId} se terminera dans ${Math.round(delay / 1000)}s`);
}

async function handleCreateGiveaway(interaction) {
  const prize = interaction.options.getString("prix", true);
  const durationMinutes = interaction.options.getInteger("duree", true);
  const winnersCount = interaction.options.getInteger("gagnants", true);
  const conditions = interaction.options.getString("conditions") ?? "";

  await interaction.deferReply();

  const endsAt = new Date(Date.now() + durationMinutes * 60 * 1000);

  const [giveaway] = await db
    .insert(giveawaysTable)
    .values({ prize, durationMinutes, winnersCount, conditions, endsAt, channelId: interaction.channelId, guildId: interaction.guildId })
    .returning();

  const embed = buildGiveawayEmbed(giveaway);
  const reply = await interaction.editReply({ embeds: [embed] });

  if (reply) {
    await db.update(giveawaysTable).set({ messageId: reply.id }).where(eq(giveawaysTable.id, giveaway.id));
  }

  try { await reply.react("🎉"); } catch {}

  scheduleGiveawayEnd(giveaway.id, endsAt);
  console.log(`🎉 Giveaway #${giveaway.id} créé: ${prize} (${durationMinutes}min, ${winnersCount} gagnant(s))`);
}

async function handleListGiveaways(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const giveaways = await db.select().from(giveawaysTable).where(eq(giveawaysTable.status, "active")).orderBy(giveawaysTable.createdAt);

  if (giveaways.length === 0) {
    await interaction.editReply("📋 Aucun giveaway actif en ce moment.");
    return;
  }

  const list = giveaways.map((g) => {
    const ts = Math.floor(new Date(g.endsAt).getTime() / 1000);
    return `• **ID ${g.id}** — 🏆 ${g.prize} | 🥇 ${g.winnersCount} gagnant(s) | ⏰ <t:${ts}:R>`;
  }).join("\n");

  await interaction.editReply(`📋 **Giveaways actifs :**\n${list}`);
}

async function handleEndGiveaway(interaction) {
  const id = interaction.options.getInteger("id", true);
  await interaction.deferReply({ ephemeral: true });

  const [giveaway] = await db.select().from(giveawaysTable).where(eq(giveawaysTable.id, id));

  if (!giveaway) { await interaction.editReply("❌ Giveaway introuvable."); return; }
  if (giveaway.status === "ended") { await interaction.editReply("❌ Ce giveaway est déjà terminé."); return; }

  const participants = await db.select().from(giveawayParticipantsTable).where(eq(giveawayParticipantsTable.giveawayId, id));
  const shuffled = [...participants].sort(() => Math.random() - 0.5);
  const selectedWinners = shuffled.slice(0, giveaway.winnersCount).map((p) => p.username);

  const [updated] = await db
    .update(giveawaysTable)
    .set({ status: "ended", winners: selectedWinners })
    .where(eq(giveawaysTable.id, id))
    .returning();

  if (giveaway.channelId && giveaway.messageId) {
    try {
      const channel = await client.channels.fetch(giveaway.channelId);
      if (channel && channel.isTextBased()) {
        const message = await channel.messages.fetch(giveaway.messageId);
        if (message) await message.edit({ embeds: [buildGiveawayEmbed(updated)] });
      }
    } catch {}
  }

  const winnersText = selectedWinners.length > 0 ? selectedWinners.join(", ") : "Aucun participant";
  await interaction.editReply(`✅ Giveaway **${giveaway.prize}** terminé ! Gagnants : ${winnersText}`);
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    if (interaction.commandName === "creategiveaway") await handleCreateGiveaway(interaction);
    else if (interaction.commandName === "listgiveaways") await handleListGiveaways(interaction);
    else if (interaction.commandName === "endgiveaway") await handleEndGiveaway(interaction);
  } catch (err) {
    console.error("Erreur:", err);
    const msg = "❌ Une erreur s'est produite.";
    if (interaction.deferred) await interaction.editReply(msg).catch(() => {});
    else await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
  }
});

client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot) return;
  if (reaction.emoji.name !== "🎉") return;
  try {
    if (reaction.partial) await reaction.fetch();
    if (user.partial) await user.fetch();

    const [giveaway] = await db.select().from(giveawaysTable).where(eq(giveawaysTable.messageId, reaction.message.id));
    if (!giveaway || giveaway.status === "ended") return;

    const existing = await db.select().from(giveawayParticipantsTable).where(
      and(eq(giveawayParticipantsTable.giveawayId, giveaway.id), eq(giveawayParticipantsTable.userId, user.id))
    );
    if (existing.length > 0) return;

    await db.insert(giveawayParticipantsTable).values({ giveawayId: giveaway.id, userId: user.id, username: user.username });
    console.log(`✅ ${user.username} a participé au giveaway #${giveaway.id}`);
  } catch (err) {
    console.error("Erreur réaction:", err);
  }
});

client.once("ready", async () => {
  console.log(`✅ Bot connecté en tant que ${client.user?.tag}`);
  await registerCommands();

  const activeGiveaways = await db.select().from(giveawaysTable).where(eq(giveawaysTable.status, "active"));
  for (const g of activeGiveaways) {
    if (new Date(g.endsAt) > new Date()) scheduleGiveawayEnd(g.id, g.endsAt);
  }
  console.log(`⏰ ${activeGiveaways.length} giveaway(s) actif(s) récupéré(s)`);
});

process.on("SIGINT", async () => {
  console.log("🔴 Arrêt du bot...");
  await pool.end();
  client.destroy();
  process.exit(0);
});

client.login(DISCORD_TOKEN);
