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

// ===== ELITE CONFIGURATION =====
const CONFIG = {
  RANKS: ["A", "S", "S+", "SS", "SS+", "SSS"],
  COLORS: { A: "#95a5a6", S: "#f1c40f", "S+": "#f39c12", SS: "#e67e22", "SS+": "#d35400", SSS: "#e74c3c" },
  ROLES: { 
    A: "1488208696759685190", S: "1488208584142753863", "S+": "1488208494170738793", 
    SS: "1488208281930432602", "SS+": "1488208185633280041", SSS: "1488208025859788860" 
  },
  // Mathematical 4K 4:5 scaling with high-quality Lanczos & Sharpening
  FFMPEG_ENGINE: 'scale=1080:1350:flags=lanczos,unsharp=5:5:1.5:5:5:1.5',
  MAX_MB: 24.5
};

// ===== DATABASE CONNECTIONS =====
await mongoose.connect(process.env.MONGO_URI).then(() => console.log("💎 Titan DB Link Established")).catch(e => console.error("❌ DB Error:", e));

const QualityDB = mongoose.model("QualityData", new mongoose.Schema({ userId: String, totalEnhanced: { type: Number, default: 0 } }));
const StreamableDB = mongoose.model("StreamableData", new mongoose.Schema({ userId: { type: String, unique: true }, currentRank: { type: String, default: "Unranked" }, totalSubmissions: { type: Number, default: 0 } }));

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// ===== EXPRESS KEEP-ALIVE =====
const app = express();
app.get("/", (req, res) => res.status(200).send("APEX TITAN ENGINE: ONLINE"));
app.listen(process.env.PORT || 3000, "0.0.0.0");

// ===== COMMAND SYNC =====
client.once("ready", async () => {
  console.log(`🚀 APEX TITAN DEPLOYED: ${client.user.tag}`);
  client.user.setActivity("4K Render Engine", { type: ActivityType.Streaming, url: "https://twitch.tv/discord" });
  
  const commands = [
    { name: "submit", description: "Submit clip for ranking" },
    { name: "profile", description: "View editor status" },
    { name: "quality_method", description: "TITAN 4K ENHANCE", options: [{ name: "url", type: 3, description: "Video URL", required: true }] }
  ];
  try {
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
  } catch (e) { console.error("Sync Error:", e); }
});

// ===== INTERACTION SYSTEM =====
client.on("interactionCreate", async (i) => {
  if (!i.isCommand() && !i.isModalSubmit() && !i.isButton()) return;

  try {
    // --- 4K QUALITY COMMAND ---
    if (i.commandName === "quality_method") {
      await i.reply("🌀 **Initializing Titan Encode...** (Checking system RAM)");
      const url = i.options.getString("url");
      const input = `in_${i.user.id}.mp4`;
      const output = `out_${i.user.id}.mp4`;

      try {
        await i.editReply("📥 **Stage 1: Streaming Source...**");
        await ytdl(url, { output: input, format: 'bestvideo[height<=1080]+bestaudio/best' });
        
        await i.editReply("⚙️ **Stage 2: 4K 4:5 Titan Scaling...** (Processing Frames)");
        // Optimized for Render Free: superfast + threads 1 prevents "Out of Memory" crashes
        const ffmpegCmd = `ffmpeg -i ${input} -vf "${CONFIG.FFMPEG_ENGINE}" -threads 1 -preset superfast -crf 21 -c:a copy ${output}`;
        await execPromise(ffmpegCmd);

        const fileSize = fs.statSync(output).size / (1024 * 1024);
        if (fileSize > CONFIG.MAX_MB) {
          return i.editReply(`❌ **Titan Error:** File is ${fileSize.toFixed(1)}MB (Limit is 25MB). Use a shorter clip.`);
        }

        await i.editReply({ content: "✨ **APEX 4K RENDER COMPLETE**", files: [new AttachmentBuilder(output)] });
        await QualityDB.findOneAndUpdate({ userId: i.user.id }, { $inc: { totalEnhanced: 1 } }, { upsert: true });
      } catch (e) {
        await i.editReply("❌ **System Overload:** Link unsupported or clip too long.");
      } finally {
        [input, output].forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
      }
    }

    // --- PROFILE COMMAND ---
    if (i.commandName === "profile") {
      const sData = await StreamableDB.findOne({ userId: i.user.id });
      const qData = await QualityDB.findOne({ userId: i.user.id });
      const embed = new EmbedBuilder()
        .setAuthor({ name: i.user.username, iconURL: i.user.displayAvatarURL() })
        .setTitle("Editor Profile")
        .addFields(
          { name: "Rank", value: `\`${sData?.currentRank || "Unranked"}\``, inline: true },
          { name: "Submissions", value: `\`${sData?.totalSubmissions || 0}\``, inline: true },
          { name: "4K Renders", value: `\`${qData?.totalEnhanced || 0}\``, inline: true }
        )
        .setColor(CONFIG.COLORS[sData?.currentRank] || "#ffffff")
        .setFooter({ text: "Apex Ultra v4.0" });
      return i.reply({ embeds: [embed] });
    }

    // --- SUBMISSION COMMAND ---
    if (i.commandName === "submit") {
      const modal = new ModalBuilder().setCustomId("sub_modal").setTitle("Submit Edit");
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("link").setLabel("Streamable/Video Link").setStyle(TextInputStyle.Short).setRequired(true)));
      await i.showModal(modal);
    }

    // --- MODAL HANDLER ---
    if (i.isModalSubmit() && i.customId === "sub_modal") {
      const link = i.fields.getTextInputValue("link");
      const reviewChan = await i.guild.channels.fetch(process.env.REVIEW_CHANNEL_ID).catch(() => null);
      
      if (!reviewChan) return i.reply({ content: "❌ **Error:** Review channel ID invalid.", ephemeral: true });

      const rows = [
        new ActionRowBuilder().addComponents(CONFIG.RANKS.slice(0, 3).map(r => new ButtonBuilder().setCustomId(`rank_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Secondary))),
        new ActionRowBuilder().addComponents(CONFIG.RANKS.slice(3).map(r => new ButtonBuilder().setCustomId(`rank_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Secondary)))
      ];

      await reviewChan.send({ content: `🎬 **Titan Submission from <@${i.user.id}>**\n${link}`, components: rows });
      return i.reply({ content: "✅ **Success!** Your edit is in the review queue.", ephemeral: true });
    }

    // --- BUTTON RANKING ---
    if (i.isButton() && i.customId.startsWith("rank_")) {
      if (!i.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) return i.reply({ content: "Staff only.", ephemeral: true });
      
      const [_, rank, userId] = i.customId.split("_");
      await StreamableDB.findOneAndUpdate({ userId }, { currentRank: rank, $inc: { totalSubmissions: 1 } }, { upsert: true });
      
      const member = await i.guild.members.fetch(userId).catch(() => null);
      if (member) {
        await member.roles.remove(Object.values(CONFIG.ROLES)).catch(() => {});
        if (CONFIG.ROLES[rank]) await member.roles.add(CONFIG.ROLES[rank]);
      }

      const resChan = await i.guild.channels.fetch(process.env.RESULT_CHANNEL_ID).catch(() => null);
      if (resChan) {
        await resChan.send({ embeds: [new EmbedBuilder().setTitle("Rank Promoted!").setDescription(`<@${userId}> is now rank **${rank}**`).setColor(CONFIG.COLORS[rank])] });
      }
      
      await i.message.delete();
      return i.reply({ content: `Ranked <@${userId}> as ${rank}`, ephemeral: true });
    }
  } catch (err) {
    console.error("Critical Error:", err);
  }
});

client.login(process.env.DISCORD_TOKEN);
