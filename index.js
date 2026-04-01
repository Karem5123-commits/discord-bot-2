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
  proof: String,
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

// =====================
// CLIENT
// =====================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// =====================
// COMMANDS
// =====================
const commands = [
  { name: "submit", description: "Submit your edit" },
  { name: "rank", description: "Check your rank" },
  { name: "leaderboard", description: "Top ranked users" },
  { name: "resubmit", description: "Update your submission" }
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  await rest.put(
    Routes.applicationGuildCommands(
      process.env.CLIENT_ID,
      process.env.GUILD_ID
    ),
    { body: commands }
  );
})();

// =====================
// COOLDOWN
// =====================
const cooldown = new Map();

// =====================
// RANK ORDER
// =====================
const rankOrder = ["A","S","S+","SS","SS+","SSS"];

// =====================
// INTERACTIONS
// =====================
client.on("interactionCreate", async (interaction) => {

  // =====================
  // COMMANDS
  // =====================
  if (interaction.isChatInputCommand()) {

    // =====================
    // CHECK RANK
    // =====================
    if (interaction.commandName === "rank") {
      const data = await Submission.findOne({ userId: interaction.user.id });

      if (!data || !data.rank) {
        return interaction.reply("❌ No rank yet.");
      }

      return interaction.reply(`🏆 Your rank: **${data.rank}**`);
    }

    // =====================
    // LEADERBOARD
    // =====================
    if (interaction.commandName === "leaderboard") {

      const data = await Submission.find();

      const sorted = data
        .filter(x => x.rank)
        .sort((a, b) =>
          rankOrder.indexOf(b.rank) - rankOrder.indexOf(a.rank)
        )
        .slice(0, 10);

      let text = sorted.map((x, i) =>
        `#${i + 1} <@${x.userId}> → ${x.rank}`
      ).join("\n");

      return interaction.reply(`🏆 Leaderboard:\n\n${text}`);
    }

    // =====================
    // SUBMIT / RESUBMIT
    // =====================
    if (interaction.commandName === "submit" || interaction.commandName === "resubmit") {

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

      const proof = new TextInputBuilder()
        .setCustomId("proof")
        .setLabel("Proof it's yours")
        .setStyle(TextInputStyle.Paragraph);

      modal.addComponents(
        new ActionRowBuilder().addComponents(link),
        new ActionRowBuilder().addComponents(proof)
      );

      return interaction.showModal(modal);
    }
  }

  // =====================
  // SUBMIT
  // =====================
  if (interaction.isModalSubmit() && interaction.customId === "submit_modal") {

    const link = interaction.fields.getTextInputValue("link");
    const proof = interaction.fields.getTextInputValue("proof");

    await Submission.findOneAndUpdate(
      { userId: interaction.user.id },
      { link, proof, date: new Date() },
      { upsert: true }
    );

    const channel = await client.channels.fetch(process.env.CHANNEL_ID);

    const embed = new EmbedBuilder()
      .setTitle("📩 New Submission")
      .setDescription(`👤 <@${interaction.user.id}>\n🔗 ${link}\n📸 ${proof}`)
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

    await interaction.user.send("✅ Submission sent!");

    return interaction.reply({ content: "Submitted!", ephemeral: true });
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

    const modal = new ModalBuilder()
      .setCustomId(`feedback_${userId}_${rank}`)
      .setTitle(`Rank: ${rank}`);

    const input = new TextInputBuilder()
      .setCustomId("msg")
      .setLabel("Feedback")
      .setStyle(TextInputStyle.Paragraph);

    modal.addComponents(new ActionRowBuilder().addComponents(input));

    return interaction.showModal(modal);
  }

  // =====================
  // FINAL FEEDBACK
  // =====================
  if (interaction.isModalSubmit() && interaction.customId.startsWith("feedback_")) {

    const [_, userId, rank] = interaction.customId.split("_");
    const msg = interaction.fields.getTextInputValue("msg");

    const user = await client.users.fetch(userId);
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch(userId);

    // REMOVE OLD ROLES
    await member.roles.remove(Object.values(rankRoles)).catch(() => {});

    // ADD NEW ROLE
    const roleId = rankRoles[rank];
    if (roleId) await member.roles.add(roleId).catch(() => {});

    await user.send(`🏆 Rank: **${rank}**\n\n💬 ${msg}`);

    const resultChannel = await client.channels.fetch(process.env.RESULT_CHANNEL_ID);

    const embed = new EmbedBuilder()
      .setTitle("🏆 Ranked Result")
      .setDescription(`<@${userId}> → **${rank}**\n\n💬 ${msg}`)
      .setColor("Green");

    await resultChannel.send({ embeds: [embed] });

    return interaction.reply({ content: "✅ Done!", ephemeral: true });
  }

});

// =====================
// LOGIN
// =====================
client.login(process.env.DISCORD_TOKEN);
