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
    console.log("✅ Commands deployed");
  } catch (err) {
    console.error(err);
  }
}

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await deployCommands();
});

// =====================
// RANK ORDER
// =====================
const rankOrder = ["A","S","S+","SS","SS+","SSS"];

// =====================
// INTERACTIONS
// =====================
client.on("interactionCreate", async (interaction) => {
  try {

    // =====================
    // COMMANDS
    // =====================
    if (interaction.isChatInputCommand()) {

      if (interaction.commandName === "rank") {
        const data = await Submission.findOne({ userId: interaction.user.id });

        if (!data || !data.rank) {
          return interaction.reply({ content: "❌ No rank yet.", flags: 64 });
        }

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

      // 🔥 FIXED CROSS SERVER CHANNEL FETCH
      let channel;

      try {
        const guild = await client.guilds.fetch(process.env.TARGET_GUILD_ID);
        channel = await guild.channels.fetch(process.env.REVIEW_CHANNEL_ID);
      } catch (err) {
        console.error("Channel error:", err);
      }

      if (!channel) {
        return interaction.reply({
          content: "❌ Bot cannot access review channel.",
          flags: 64
        });
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

      await interaction.user.send("✅ Submission sent!");
      return interaction.reply({ content: "Submitted!", flags: 64 });
    }

    // =====================
    // RANK BUTTON
    // =====================
    if (interaction.isButton() && interaction.customId.startsWith("rank_")) {

      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: "❌ Admin only.", flags: 64 });
      }

      const [_, rank, userId] = interaction.customId.split("_");

      await Submission.findOneAndUpdate({ userId }, { rank });

      const user = await client.users.fetch(userId);

      await user.send(`🏆 Rank: **${rank}**`);

      return interaction.reply({ content: "✅ Ranked!", flags: 64 });
    }

  } catch (err) {
    console.error("❌ ERROR:", err);

    if (interaction.replied || interaction.deferred) {
      interaction.followUp({ content: "❌ Error occurred.", flags: 64 }).catch(()=>{});
    } else {
      interaction.reply({ content: "❌ Error occurred.", flags: 64 }).catch(()=>{});
    }
  }
});

// =====================
// LOGIN
// =====================
client.login(process.env.DISCORD_TOKEN);
