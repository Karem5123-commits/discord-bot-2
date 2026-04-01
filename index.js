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
// KEEP ALIVE (RENDER)
// =====================
const app = express();
app.get("/", (req, res) => res.send("Bot running"));
app.listen(process.env.PORT || 3000);

// =====================
// DATABASE
// =====================
await mongoose.connect(process.env.MONGO_URI);

const Submission = mongoose.model("Submission", new mongoose.Schema({
  userId: String,
  link: String,
  rank: String,
  date: Date
}));

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

// AUTO DEPLOY
async function deployCommands() {
  try {
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );
    console.log("✅ Commands deployed");
  } catch (err) {
    console.error("❌ Command error:", err);
  }
}

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await deployCommands();
});

// =====================
// INTERACTIONS
// =====================
client.on("interactionCreate", async (interaction) => {

  try {

    // =====================
    // SLASH COMMANDS
    // =====================
    if (interaction.isChatInputCommand()) {

      if (interaction.commandName === "rank") {
        const data = await Submission.findOne({ userId: interaction.user.id });
        return interaction.reply(
          data?.rank ? `🏆 Rank: **${data.rank}**` : "❌ No rank yet."
        );
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

        const modal = new ModalBuilder()
          .setCustomId("submit_modal")
          .setTitle("Submit Edit");

        const link = new TextInputBuilder()
          .setCustomId("link")
          .setLabel("Streamable Link")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(link)
        );

        return interaction.showModal(modal);
      }
    }

    // =====================
    // MODAL SUBMIT
    // =====================
    if (interaction.isModalSubmit() && interaction.customId === "submit_modal") {

      const link = interaction.fields.getTextInputValue("link");

      await Submission.findOneAndUpdate(
        { userId: interaction.user.id },
        { link, date: new Date() },
        { upsert: true }
      );

      // SAFE CHANNEL FETCH
      let channel;
      try {
        channel = await client.channels.fetch(process.env.CHANNEL_ID);
      } catch {
        channel = null;
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

      // TRY SEND TO CHANNEL
      if (channel) {
        try {
          await channel.send({ embeds: [embed], components: [buttons] });
        } catch (err) {
          console.error("❌ Channel send failed:", err);
        }
      }

      // ALWAYS DM USER
      try {
        await interaction.user.send("✅ Submission received!");
      } catch {}

      return interaction.reply({
        content: "✅ Submitted!",
        ephemeral: true
      });
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
    // FEEDBACK MODAL
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

      // DM USER
      await user.send(`🏆 Rank: **${rank}**\n\n💬 ${msg}`);

      // SAFE RESULT CHANNEL
      try {
        const resultChannel = await client.channels.fetch(process.env.RESULT_CHANNEL_ID);

        const embed = new EmbedBuilder()
          .setTitle("🏆 Ranked Result")
          .setDescription(`<@${userId}> → **${rank}**\n\n💬 ${msg}`)
          .setColor("Green");

        await resultChannel.send({ embeds: [embed] });

      } catch (err) {
        console.error("❌ Result channel failed:", err);
      }

      return interaction.reply({ content: "✅ Done!", ephemeral: true });
    }

  } catch (err) {
    console.error("🔥 ERROR:", err);

    if (interaction.replied || interaction.deferred) {
      interaction.followUp({ content: "❌ Something broke.", ephemeral: true });
    } else {
      interaction.reply({ content: "❌ Internal error.", ephemeral: true });
    }
  }

});

// =====================
// LOGIN
// =====================
client.login(process.env.DISCORD_TOKEN);
