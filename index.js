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
  StringSelectMenuBuilder,
  REST,
  Routes
} from "discord.js";

dotenv.config();

// =====================
// KEEP ALIVE (Render)
// =====================
const app = express();
app.get("/", (req, res) => res.send("Bot is alive!"));
app.listen(process.env.PORT || 3000, () => {
  console.log("🌐 Web server running");
});

// =====================
// DATABASE
// =====================
await mongoose.connect(process.env.MONGO_URI);
console.log("✅ MongoDB connected");

const submissionSchema = new mongoose.Schema({
  userId: String,
  rank: String,
});

const Submission = mongoose.model("Submission", submissionSchema);

// =====================
// CLIENT
// =====================
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

// =====================
// SLASH COMMANDS (AUTO REGISTER)
// =====================
const commands = [
  {
    name: "setup",
    description: "Show buttons"
  },
  {
    name: "ping",
    description: "Check bot"
  },
  {
    name: "kick",
    description: "Kick a user",
    options: [
      {
        name: "user",
        type: 6,
        description: "User to kick",
        required: true
      }
    ]
  },
  {
    name: "ban",
    description: "Ban a user",
    options: [
      {
        name: "user",
        type: 6,
        description: "User to ban",
        required: true
      }
    ]
  }
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("🔄 Registering slash commands...");
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log("✅ Slash commands registered!");
  } catch (err) {
    console.error(err);
  }
})();

// =====================
// INTERACTIONS
// =====================
client.on("interactionCreate", async (interaction) => {

  // SLASH COMMANDS
  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "ping") {
      return interaction.reply("🏓 Pong!");
    }

    if (interaction.commandName === "setup") {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("rank")
          .setLabel("Select Rank")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("msg")
          .setLabel("Send Message")
          .setStyle(ButtonStyle.Secondary)
      );

      return interaction.reply({
        content: "Setup panel:",
        components: [row]
      });
    }

    if (interaction.commandName === "kick") {
      const user = interaction.options.getUser("user");
      const member = await interaction.guild.members.fetch(user.id);

      await member.kick();
      return interaction.reply(`👢 Kicked ${user.tag}`);
    }

    if (interaction.commandName === "ban") {
      const user = interaction.options.getUser("user");
      const member = await interaction.guild.members.fetch(user.id);

      await member.ban();
      return interaction.reply(`🔨 Banned ${user.tag}`);
    }
  }

  // BUTTONS
  if (interaction.isButton()) {
    const userId = interaction.user.id;

    if (interaction.customId === "rank") {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`select-${userId}`)
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

    if (interaction.customId === "msg") {
      const modal = new ModalBuilder()
        .setCustomId(`msg_${userId}`)
        .setTitle("Send Message");

      const input = new TextInputBuilder()
        .setCustomId("msg")
        .setLabel("Your message")
        .setStyle(TextInputStyle.Paragraph);

      modal.addComponents(
        new ActionRowBuilder().addComponents(input)
      );

      return interaction.showModal(modal);
    }
  }

  // SELECT MENU
  if (interaction.isStringSelectMenu()) {
    const userId = interaction.customId.split("-")[1];
    const rank = interaction.values[0];

    await Submission.findOneAndUpdate(
      { userId },
      { userId, rank },
      { upsert: true }
    );

    const user = await client.users.fetch(userId);
    await user.send(`🏆 Your rank is now: ${rank}`);

    return interaction.reply({ content: "✅ Saved!", ephemeral: true });
  }

  // MODAL
  if (interaction.isModalSubmit()) {
    const userId = interaction.customId.split("_")[1];
    const msg = interaction.fields.getTextInputValue("msg");

    const channel = await client.channels.fetch(process.env.CHANNEL_ID);

    await channel.send(`📩 Message from <@${userId}>:\n${msg}`);

    return interaction.reply({ content: "✅ Sent!", ephemeral: true });
  }
});

// =====================
// LOGIN
// =====================
client.login(process.env.DISCORD_TOKEN);
