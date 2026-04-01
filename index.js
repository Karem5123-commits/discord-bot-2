import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  REST,
  Routes,
  EmbedBuilder,
  PermissionsBitField
} from "discord.js";

dotenv.config();

// =====================
// KEEP ALIVE
// =====================
const app = express();
app.get("/", (req, res) => res.send("Bot running"));
app.listen(process.env.PORT || 3000);

// =====================
// DATABASE
// =====================
await mongoose.connect(process.env.MONGO_URI);

const schema = new mongoose.Schema({
  userId: String,
  link: String,
  rank: String,
  date: Date
});

const Submission = mongoose.model("Submission", schema);

// =====================
// ROLE MAP
// =====================
const rankRoles = {
  "A": "1488208696759685190",
  "S": "1488208584142753863",
  "S+": "1488208494170738793",
  "SS": "1488208281930432602",
  "SS+": "1488208185633280041",
  "SSS": "1488208025859788860"
};

const rankOrder = ["A","S","S+","SS","SS+","SSS"];

// =====================
// CLIENT
// =====================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// =====================
// COMMANDS
// =====================
const commands = [
  { name: "submit", description: "Submit your edit" },
  { name: "rank", description: "Check your rank" },
  { name: "leaderboard", description: "Top ranked users" }
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

async function deployCommands() {
  try {
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );
    console.log("✅ Commands updated!");
  } catch (err) {
    console.error("❌ Command error:", err);
  }
}

// =====================
// READY
// =====================
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await deployCommands();
});

// =====================
// COOLDOWN
// =====================
const cooldown = new Map();

// =====================
// INTERACTIONS
// =====================
client.on("interactionCreate", async (interaction) => {

  // =====================
  // COMMANDS
  // =====================
  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "rank") {
      const data = await Submission.findOne({ userId: interaction.user.id });
      if (!data?.rank) return interaction.reply("❌ No rank yet.");
      return interaction.reply(`🏆 Your rank: **${data.rank}**`);
    }

    if (interaction.commandName === "leaderboard") {
      const data = await Submission.find();

      const sorted = data
        .filter(x => x.rank)
        .sort((a, b) =>
          rankOrder.indexOf(b.rank) - rankOrder.indexOf(a.rank)
        )
        .slice(0, 10);

      const text = sorted.map((x, i) =>
        `#${i + 1} <@${x.userId}> → ${x.rank}`
      ).join("\n");

      return interaction.reply(`🏆 Leaderboard:\n\n${text || "No data yet."}`);
    }

    if (interaction.commandName === "submit") {

      if (cooldown.has(interaction.user.id)) {
        return interaction.reply({
          content: "⏳ Wait before submitting again.",
          ephemeral: true
        });
      }

      cooldown.set(interaction.user.id, true);
      setTimeout(() => cooldown.delete(interaction.user.id), 30000);

      const modal = new ModalBuilder()
        .setCustomId("submit_modal")
        .setTitle("Submit Edit");

      const link = new TextInputBuilder()
        .setCustomId("link")
        .setLabel("Streamable Link")
        .setStyle(TextInputStyle.Short);

      modal.addComponents(
        new ActionRowBuilder().addComponents(link)
      );

      return interaction.showModal(modal);
    }
  }

  // =====================
  // MODAL SUBMIT (FIXED + DEBUG)
// =====================
  if (interaction.isModalSubmit() && interaction.customId === "submit_modal") {

    try {
      const link = interaction.fields.getTextInputValue("link");

      console.log("✅ Modal received:", link);

      await Submission.findOneAndUpdate(
        { userId: interaction.user.id },
        { link, date: new Date() },
        { upsert: true }
      );

      let channel;

      try {
        channel = await client.channels.fetch(process.env.CHANNEL_ID);
      } catch {
        console.log("⚠️ Using fallback channel");
        channel = interaction.channel;
      }

      const embed = new EmbedBuilder()
        .setTitle("📩 New Submission")
        .setDescription(`👤 <@${interaction.user.id}>\n🔗 ${link}`)
        .setColor("Blue");

      const buttons = new ActionRowBuilder().addComponents(
        rankOrder.map(rank =>
          new ButtonBuilder()
            .setCustomId(`rank_${rank}_${interaction.user.id}`)
            .setLabel(rank)
            .setStyle(ButtonStyle.Primary)
        )
      );

      await channel.send({ embeds: [embed], components: [buttons] });

      await interaction.reply({
        content: "✅ Submitted successfully!",
        ephemeral: true
      });

    } catch (err) {
      console.error("❌ MODAL ERROR:", err);

      if (!interaction.replied) {
        await interaction.reply({
          content: "❌ Internal error. Check logs.",
          ephemeral: true
        });
      }
    }
  }

  // =====================
  // RANK BUTTON
  // =====================
  if (interaction.isButton() && interaction.customId.startsWith("rank_")) {

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: "❌ Admin only.", ephemeral: true });
    }

    const [_, rank, userId] = interaction.customId.split("_");

    await Submission.findOneAndUpdate({ userId }, { rank });

    const user = await client.users.fetch(userId);

    await user.send(`🏆 You were ranked: **${rank}**`).catch(() => {});

    return interaction.reply({
      content: `✅ Ranked as ${rank}`,
      ephemeral: true
    });
  }

});

// =====================
// LOGIN
// =====================
client.login(process.env.DISCORD_TOKEN);
