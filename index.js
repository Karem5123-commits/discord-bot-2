import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import { exec as ytExec } from "child_process";
import { promisify } from "util";
import ytdl from "yt-dlp-exec"; 
import {
  Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, REST, Routes,
  EmbedBuilder, PermissionsBitField, AttachmentBuilder, ActivityType
} from "discord.js";

const execPromise = promisify(ytExec);
dotenv.config();

/**
 * 🚀 PERFORMANCE CONFIGURATION
 * Optimized for Render Free Tier (512MB RAM / 0.5 CPU)
 */
const CONFIG = {
  RANKS: ["A", "S", "S+", "SS", "SS+", "SSS"],
  COLORS: { A: "#95a5a6", S: "#f1c40f", "S+": "#f39c12", SS: "#e67e22", "SS+": "#d35400", SSS: "#e74c3c" },
  ROLES: { 
    A: "1488208696759685190", S: "1488208584142753863", "S+": "1488208494170738793", 
    SS: "1488208281930432602", "SS+": "1488208185633280041", SSS: "1488208025859788860" 
  },
  FFMPEG_LIMITER: "-threads 1 -preset superfast -crf 22", // Balanced for Render
  MAX_MB: 25
};

// ===== DATABASE =====
const userSchema = new mongoose.Schema({
  userId: { type: String, unique: true, index: true },
  currentRank: { type: String, default: "Unranked" },
  totalSubmissions: { type: Number, default: 0 },
  history: [{ rank: String, feedback: String, date: { type: Date, default: Date.now } }]
});
const User = mongoose.model("User", userSchema);

// ===== PRO-LEVEL TASK QUEUE =====
class MediaQueue {
  constructor() {
    this.queue = [];
    this.active = false;
  }
  async push(task) {
    this.queue.push(task);
    this.next();
  }
  async next() {
    if (this.active || this.queue.length === 0) return;
    this.active = true;
    const currentTask = this.queue.shift();
    try { await currentTask(); } catch (e) { console.error("Queue Task Failed:", e); }
    this.active = false;
    this.next();
  }
}
const VideoQueue = new MediaQueue();

// ===== DISCORD ENGINE =====
const client = new Client({ 
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

// ===== WEB INTERFACE (KEEP-ALIVE) =====
const app = express();
app.get("/", (req, res) => res.status(200).json({ status: "online", memory: process.memoryUsage().rss }));
app.listen(process.env.PORT || 3000);

// ===== CORE LOGIC =====
client.once("ready", async () => {
  console.log(`[SYSTEM] Logged in as ${client.user.tag}`);
  client.user.setActivity("4K Quality Engine", { type: ActivityType.Competing });

  const commands = [
    { name: "submit", description: "Submit your edit" },
    { name: "profile", description: "Check your stats" },
    { name: "quality_method", description: "Apply 4K 4:5 Enhancement", options: [{ name: "url", type: 3, description: "Video URL", required: true }] },
    { name: "dl", description: "Direct Video Download", options: [{ name: "url", type: 3, description: "Video URL", required: true }] }
  ];

  try {
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log("[SYSTEM] Commands Synced");
  } catch (e) { console.error("[ERROR] Command Sync Failed:", e); }
});

client.on("interactionCreate", async (i) => {
  if (i.isChatInputCommand()) {
    const { commandName, options, user } = i;

    // --- ENHANCED QUALITY METHOD ---
    if (commandName === "quality_method") {
      await i.reply("⏳ **Queueing Request...** This process uses high-CPU resources.");
      
      VideoQueue.push(async () => {
        const input = `in_${user.id}.mp4`;
        const output = `out_${user.id}.mp4`;
        
        try {
          await i.editReply("📥 **Downloading Source...**");
          await ytdl(options.getString("url"), { output: input, format: 'bestvideo[height<=1080]+bestaudio/best' });
          
          await i.editReply("⚙️ **Applying 4K Mathematical Scaling...**");
          const cmd = `ffmpeg -i ${input} -vf "crop=ih*4/5:ih,scale=1080:1350:flags=lanczos,unsharp=3:3:1.0:3:3:1.0" ${CONFIG.FFMPEG_LIMITER} -c:a copy ${output}`;
          await execPromise(cmd);

          const stats = fs.statSync(output);
          if (stats.size > CONFIG.MAX_MB * 1024 * 1024) {
            return await i.editReply("❌ **Error:** Output file exceeds Discord's 25MB limit.");
          }

          await i.editReply({ content: "✨ **Enhancement Complete**", files: [new AttachmentBuilder(output)] });
        } catch (e) {
          await i.editReply("❌ **Failed:** The URL is invalid or the video is too long.");
        } finally {
          [input, output].forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
        }
      });
    }

    // --- FAST PROFILE ---
    if (commandName === "profile") {
      const data = await User.findOne({ userId: user.id });
      if (!data) return i.reply("No profile found. Submit an edit first!");
      
      const embed = new EmbedBuilder()
        .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
        .setTitle("Editor Statistics")
        .addFields(
          { name: "Current Rank", value: `\`${data.currentRank}\``, inline: true },
          { name: "Total Submissions", value: `\`${data.totalSubmissions}\``, inline: true }
        )
        .setColor(CONFIG.COLORS[data.currentRank] || "#2b2d31")
        .setTimestamp();
      
      return i.reply({ embeds: [embed] });
    }

    // --- SUBMISSION MODAL ---
    if (commandName === "submit") {
      const modal = new ModalBuilder().setCustomId("sub_modal").setTitle("Edit Submission");
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("link").setLabel("Clip Link (YouTube/TikTok/Streamable)").setStyle(TextInputStyle.Short).setRequired(true)
      ));
      await i.showModal(modal);
    }
  }

  // --- MODAL HANDLING ---
  if (i.isModalSubmit() && i.customId === "sub_modal") {
    const link = i.fields.getTextInputValue("link");
    const reviewChan = await i.guild.channels.fetch(process.env.REVIEW_CHANNEL_ID).catch(() => null);
    
    const rows = [
      new ActionRowBuilder().addComponents(CONFIG.RANKS.slice(0, 3).map(r => new ButtonBuilder().setCustomId(`rank_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Secondary))),
      new ActionRowBuilder().addComponents(CONFIG.RANKS.slice(3).map(r => new ButtonBuilder().setCustomId(`rank_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Secondary)))
    ];

    await reviewChan?.send({ content: `🎬 **New Submission: <@${i.user.id}>**\n${link}`, components: rows });
    return i.reply({ content: "🚀 **Success!** Your edit is now with staff.", ephemeral: true });
  }

  // --- STAFF ACTIONS ---
  if (i.isButton() && i.customId.startsWith("rank_")) {
    if (!i.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) return i.reply({ content: "Unauthorized.", ephemeral: true });
    
    const [_, rank, userId] = i.customId.split("_");
    await User.findOneAndUpdate({ userId }, { currentRank: rank, $inc: { totalSubmissions: 1 } }, { upsert: true });
    
    const member = await i.guild.members.fetch(userId).catch(() => null);
    if (member) {
      await member.roles.remove(Object.values(CONFIG.ROLES)).catch(() => {});
      if (CONFIG.ROLES[rank]) await member.roles.add(CONFIG.ROLES[rank]);
    }

    const resChan = await i.guild.channels.fetch(process.env.RESULT_CHANNEL_ID).catch(() => null);
    resChan?.send({ embeds: [new EmbedBuilder().setTitle("Rank Updated").setDescription(`<@${userId}> is now rank **${rank}**`).setColor(CONFIG.COLORS[rank])] });
    
    await i.message.delete();
    return i.reply({ content: "Ranked successfully.", ephemeral: true });
  }
});

// ===== GRACEFUL SHUTDOWN =====
process.on("SIGINT", async () => {
  await mongoose.disconnect();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
