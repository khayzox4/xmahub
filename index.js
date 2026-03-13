import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} from "discord.js";

const TOKEN = process.env.DISCORD_TOKEN;
const ROLE_HOMME_ID = process.env.DISCORD_ROLE_HOMME;
const ROLE_FEMME_ID = process.env.DISCORD_ROLE_FEMME;

if (!TOKEN) {
  console.error("Erreur : DISCORD_TOKEN est manquant.");
  process.exit(1);
}
if (!ROLE_HOMME_ID || !ROLE_FEMME_ID) {
  console.error("Erreur : DISCORD_ROLE_HOMME ou DISCORD_ROLE_FEMME est manquant.");
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

client.once("ready", () => {
  console.log(`Bot connecté en tant que ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.content.toLowerCase() === "!embedrôle" || message.content.toLowerCase() === "!embedrole") {
    const member = message.member;

    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply({
        content: "❌ Tu n'as pas la permission d'utiliser cette commande. (Administrateur requis)",
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setTitle("✨ Choisis ton genre ✨")
      .setDescription(
        "Bienvenue sur le serveur ! Sélectionne ton genre ci-dessous en cliquant sur le bouton correspondant.\n\n" +
        "🔵 **Homme** — Clique pour obtenir le rôle Homme\n" +
        "🌸 **Femme** — Clique pour obtenir le rôle Femme\n\n" +
        "_Tu peux changer de rôle à tout moment en recliquant sur un bouton._"
      )
      .setColor(0x5865f2)
      .setFooter({ text: "Un seul rôle de genre peut être actif à la fois." })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("role_homme")
        .setLabel("🔵 Homme")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("role_femme")
        .setLabel("🌸 Femme")
        .setStyle(ButtonStyle.Secondary)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
    await message.delete().catch(() => {});
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const { customId, member, guild } = interaction;

  if (customId !== "role_homme" && customId !== "role_femme") return;

  await interaction.deferReply({ ephemeral: true });

  try {
    const roleHomme = await guild.roles.fetch(ROLE_HOMME_ID);
    const roleFemme = await guild.roles.fetch(ROLE_FEMME_ID);

    if (!roleHomme || !roleFemme) {
      return interaction.editReply({
        content: "❌ Impossible de trouver les rôles configurés. Contacte un administrateur.",
      });
    }

    if (customId === "role_homme") {
      if (member.roles.cache.has(ROLE_HOMME_ID)) {
        return interaction.editReply({
          content: "ℹ️ Tu as déjà le rôle **Homme**.",
        });
      }
      await member.roles.remove(roleFemme).catch(() => {});
      await member.roles.add(roleHomme);
      return interaction.editReply({
        content: "✅ Le rôle **Homme** t'a été attribué !",
      });
    }

    if (customId === "role_femme") {
      if (member.roles.cache.has(ROLE_FEMME_ID)) {
        return interaction.editReply({
          content: "ℹ️ Tu as déjà le rôle **Femme**.",
        });
      }
      await member.roles.remove(roleHomme).catch(() => {});
      await member.roles.add(roleFemme);
      return interaction.editReply({
        content: "✅ Le rôle **Femme** t'a été attribué !",
      });
    }
  } catch (err) {
    console.error("Erreur lors de l'attribution du rôle :", err);
    return interaction.editReply({
      content: "❌ Une erreur est survenue lors de l'attribution du rôle. Vérifie que le bot a bien la permission de gérer les rôles.",
    });
  }
});

client.login(TOKEN);
