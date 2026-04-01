import express from "express";
import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits
} from "discord.js";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

// =====================
// KEEP ALIVE (RENDER)
// =====================
const app = express();

app.get("/", (req, res) => {
  res.send("Bot is alive!");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("🌐 Web server running");
});

// =====================
// DATABASE
// =====================
await mongoose.connect(process.env.MONGO_URI);
console.log("✅ MongoDB connected");

const schema = new mongoose.Schema({
  userId: String,
  rank: String
});

const User = mongoose.model("User", schema);

// =====================
// DISCORD CLIENT
// =====================
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  // =====================
  // REGISTER COMMANDS AUTO
  // =====================
  const commands = [
    new SlashCommandBuilder()
      .setName("panel")
      .setDescription("Open rank panel"),

    new SlashCommandBuilder()
      .setName("ban")
      .setDescription("Ban a user")
      .addUserOption(opt => opt.setName("user").setDescription("User").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    new SlashCommandBuilder()
      .setName("kick")
      .setDescription("Kick a user")
      .addUserOption(opt => opt.setName("user").setDescription("User").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

    new SlashCommandBuilder()
      .setName("timeout")
      .setDescription("Timeout a user")
      .addUserOption(opt => opt.setName("user").setDescription("User").setRequired(true))
      .addIntegerOption(opt =>
        opt.setName("minutes").setDescription("Minutes").setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  try {
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log("✅ Slash commands registered");
  } catch (err) {
    console.error(err);
  }
});

// =====================
// INTERACTIONS
// =====================
client.on("interactionCreate", async (interaction) => {

  // SLASH COMMANDS
  if (interaction.isChatInputCommand()) {

    // PANEL
    if (interaction.commandName === "panel") {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("rank")
          .setLabel("Choose Rank")
          .setStyle(ButtonStyle.Primary)
      );

      return interaction.reply({
        content: "Click to choose your rank:",
        components: [row]
      });
    }

    // BAN
    if (interaction.commandName === "ban") {
      const user = interaction.options.getUser("user");
      const member = await interaction.guild.members.fetch(user.id);

      await member.ban();
      return interaction.reply(`🔨 Banned ${user.tag}`);
    }

    // KICK
    if (interaction.commandName === "kick") {
      const user = interaction.options.getUser("user");
      const member = await interaction.guild.members.fetch(user.id);

      await member.kick();
      return interaction.reply(`👢 Kicked ${user.tag}`);
    }

    // TIMEOUT
    if (interaction.commandName === "timeout") {
      const user = interaction.options.getUser("user");
      const minutes = interaction.options.getInteger("minutes");

      const member = await interaction.guild.members.fetch(user.id);
      await member.timeout(minutes * 60 * 1000);

      return interaction.reply(`⏳ Timed out ${user.tag} for ${minutes}m`);
    }
  }

  // BUTTON
  if (interaction.isButton()) {
    if (interaction.customId === "rank") {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`select-${interaction.user.id}`)
        .setPlaceholder("Choose your rank")
        .addOptions([
          { label: "Bronze", value: "Bronze" },
          { label: "Silver", value: "Silver" },
          { label: "Gold", value: "Gold" }
        ]);

      const row = new ActionRowBuilder().addComponents(menu);

      return interaction.reply({
        content: "Select your rank:",
        components: [row],
        ephemeral: true
      });
    }
  }

  // SELECT MENU
  if (interaction.isStringSelectMenu()) {
    const userId = interaction.user.id;
    const rank = interaction.values[0];

    await User.findOneAndUpdate(
      { userId },
      { userId, rank },
      { upsert: true }
    );

    return interaction.reply({
      content: `🏆 Saved rank: ${rank}`,
      ephemeral: true
    });
  }
});

// =====================
// LOGIN
// =====================
client.login(process.env.DISCORD_TOKEN);
