import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import { exec as ytdl } from "yt-dlp-exec";
import { exec } from "child_process";
import { promisify } from "util";
import {
  Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, REST, Routes,
  EmbedBuilder, PermissionsBitField, AttachmentBuilder, ActivityType
} from "discord.js";

const execPromise = promisify(exec);
dotenv.config();

// ===== DATABASE =====
await mongoose.connect(process.env.MONGO_URI);
const User = mongoose.model("User", new mongoose.Schema({
  userId: { type: String, unique: true, index: true },
  currentRank: { type: String, default: "Unranked" },
  totalSubmissions: { type: Number, default: 0 },
  history: [{ rank: String, feedback: String, date: { type: Date, default: Date.now } }]
}));

// ===== TASK QUEUE (Prevents Render Crashing) =====
const queue = [];
let processing = false;

async function processQueue() {
  if (processing || queue.length === 0) return;
  processing = true;
  const { task, interaction } = queue.shift();
  try {
    await task();
  } catch (err) {
    console.error("Queue Error:", err);
    await interaction.editReply("⚠️ Task failed during processing.");
  }
  processing = false;
  processQueue();
}

// ===== CONFIG =====
const CONFIG = {
  RANKS: ["A", "S", "S+", "SS", "SS+", "SSS"],
  COLORS: { A: "#95a5a6", S: "#f1c40f", "S+": "#f39c12", SS: "#e67e22", "SS+": "#d35400", SSS: "#e74c3c" },
  ROLES: { A: "1488208696759685190", S: "1488208584142753863", "S+": "1488208494170738793", SS: "1488208281930432602", "SS+": "1488208185633280041", SSS: "1488208025859788860" }
};

// ===== DISCORD CLIENT =====
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// ===== KEEP ALIVE =====
const app = express();
app.get("/", (req, res) => res.send("System: Ultra Mode Active"));
app.listen(process.env.PORT || 3000);

// ===== SLASH COMMANDS SETUP =====
client.once("ready", async () => {
  console.log(`⚡ LIMIT BREAKER ONLINE: ${client.user.tag}`);
  const commands = [
    { name: "submit", description: "Submit edit" },
    { name: "profile", description: "View Rank" },
    { name: "quality_method", description: "ULTRA 4K 4:5 ENCODE", options: [{ name: "url", type: 3, description: "Video URL", required: true }] },
    { name: "dl", description: "Fast Download", options: [{ name: "url", type: 3, description: "URL", required: true }] }
  ];
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
});

// ===== INTERACTION ENGINE =====
client.on("interactionCreate", async (i) => {
  if (i.isChatInputCommand()) {
    
    // --- ULTRA QUALITY METHOD ---
    if (i.commandName === "quality_method") {
      await i.reply("📥 Added to the processing queue. Please wait...");
      
      queue.push({
        interaction: i,
        task: async () => {
          await i.editReply("⚙️ Processing: Downloading & Encoding...");
          const url = i.options.getString("url");
          const input = `in_${i.user.id}.mp4`;
          const output = `out_${i.user.id}.mp4`;

          try {
            // Step 1: High speed download
            await ytdl(url, { output: input, format: 'bestvideo[height<=1080]+bestaudio/best' });

            // Step 2: The "Limit Breaker" FFmpeg String
            // Uses 'ultrafast' to save Render CPU and 'threads 1' to prevent RAM spikes
            const ffmpegCmd = `ffmpeg -i ${input} -vf "crop=ih*4/5:ih,scale=1080:1350:flags=lanczos" -c:v libx264 -preset ultrafast -crf 22 -threads 1 -c:a copy ${output}`;
            
            await execPromise(ffmpegCmd);

            if (fs.statSync(output).size > 25000000) {
                return i.editReply("❌ Result too heavy for Discord (>25MB). Try a shorter clip.");
            }

            await i.editReply({ content: "✨ **ULTRA 4K RENDER COMPLETE**", files: [new AttachmentBuilder(output)] });
          } catch (e) {
            console.error(e);
            await i.editReply("❌ System Overload or Invalid Link.");
          } finally {
            [input, output].forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
          }
        }
      });
      processQueue();
    }

    // --- SUBMIT SYSTEM ---
    if (i.commandName === "submit") {
      const modal = new ModalBuilder().setCustomId("sub_modal").setTitle("Submit Edit");
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("link").setLabel("Clip Link").setStyle(TextInputStyle.Short).setRequired(true)));
      return i.showModal(modal);
    }

    // --- PROFILE ---
    if (i.commandName === "profile") {
      const data = await User.findOne({ userId: i.user.id });
      if (!data) return i.reply("No profile found.");
      const embed = new EmbedBuilder()
        .setTitle(`${i.user.username}'s Editor Profile`)
        .addFields({ name: "Current Rank", value: `**${data.currentRank}**`, inline: true }, { name: "Submissions", value: `${data.totalSubmissions}`, inline: true })
        .setColor(CONFIG.COLORS[data.currentRank] || "#ffffff")
        .setThumbnail(i.user.displayAvatarURL());
      return i.reply({ embeds: [embed] });
    }
  }

  // --- MODAL HANDLING ---
  if (i.isModalSubmit() && i.customId === "sub_modal") {
    const link = i.fields.getTextInputValue("link");
    const reviewChan = await i.guild.channels.fetch(process.env.REVIEW_CHANNEL_ID);
    const rows = [
      new ActionRowBuilder().addComponents(CONFIG.RANKS.slice(0, 3).map(r => new ButtonBuilder().setCustomId(`rank_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Primary))),
      new ActionRowBuilder().addComponents(CONFIG.RANKS.slice(3).map(r => new ButtonBuilder().setCustomId(`rank_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Primary)))
    ];
    await reviewChan.send({ content: `🎬 **New Submission from <@${i.user.id}>**\n${link}`, components: rows });
    return i.reply({ content: "✅ Clip sent to staff!", ephemeral: true });
  }

  // --- STAFF RANKING BUTTONS ---
  if (i.isButton() && i.customId.startsWith("rank_")) {
    if (!i.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) return i.reply({ content: "Staff Only", ephemeral: true });
    const [_, rank, userId] = i.customId.split("_");
    
    await User.findOneAndUpdate({ userId }, { currentRank: rank, $inc: { totalSubmissions: 1 } }, { upsert: true });
    
    const member = await i.guild.members.fetch(userId).catch(() => null);
    if (member) {
      await member.roles.remove(Object.values(CONFIG.ROLES)).catch(() => {});
      if (CONFIG.ROLES[rank]) await member.roles.add(CONFIG.ROLES[rank]);
    }

    const resChan = await i.guild.channels.fetch(process.env.RESULT_CHANNEL_ID);
    await resChan.send({ embeds: [new EmbedBuilder().setTitle("Editor Ranked!").setDescription(`<@${userId}> has been ranked **${rank}**`).setColor(CONFIG.COLORS[rank])] });
    
    await i.message.delete();
    return i.reply({ content: "Success", ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);
