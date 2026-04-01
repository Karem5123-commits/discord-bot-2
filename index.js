import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";

// ✅ SAFE CANVAS IMPORT
let createCanvas, loadImage;
try {
  const canvas = await import("@napi-rs/canvas");
  createCanvas = canvas.createCanvas;
  loadImage = canvas.loadImage;
} catch {
  console.log("⚠️ Canvas disabled (no native support)");
}

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
  PermissionsBitField,
  AttachmentBuilder,
  ActivityType
} from "discord.js";

dotenv.config();

// ===== DATABASE =====
await mongoose.connect(process.env.MONGO_URI);

// ===== SCHEMAS =====
const User = mongoose.model("User", new mongoose.Schema({
  userId: { type: String, unique: true },
  currentRank: { type: String, default: "Unranked" },
  totalSubmissions: { type: Number, default: 0 },
  lastLink: String,
  history: [{
    rank: String,
    feedback: String,
    staffId: String,
    date: { type: Date, default: Date.now }
  }]
}));

const Staff = mongoose.model("Staff", new mongoose.Schema({
  staffId: { type: String, unique: true },
  reviewsCount: { type: Number, default: 0 },
  lastReview: Date
}));

// ===== CONFIG =====
const CONFIG = {
  RANKS: ["A","S","S+","SS","SS+","SSS"],
  COLORS: {
    A:"#95a5a6", S:"#f1c40f", "S+":"#f39c12",
    SS:"#e67e22","SS+":"#d35400","SSS":"#e74c3c"
  },
  ROLES: {
    A:"1488208696759685190",
    S:"1488208584142753863",
    "S+":"1488208494170738793",
    SS:"1488208281930432602",
    "SS+":"1488208185633280041",
    SSS:"1488208025859788860"
  },
  COOLDOWNS: new Map(),
  PROCESSING: new Set()
};

// ===== CLIP PREVIEW DETECTOR =====
function getPreviewEmbed(link, userId) {
  let embed = new EmbedBuilder()
    .setTitle("🎬 Submission")
    .setDescription(`**User:** <@${userId}>\n**Link:** [Click to view clip](${link})`)
    .setColor("#5865F2")
    .setTimestamp();

  if (link.includes("youtube.com") || link.includes("youtu.be")) {
    embed.setTitle("📺 YouTube Submission").setColor("#FF0000");
  } 
  else if (link.includes("tiktok.com")) {
    embed.setTitle("🎵 TikTok Submission").setColor("#010101");
  } 
  else if (link.includes("streamable.com")) {
    embed.setTitle("🎞️ Streamable Submission").setColor("#0f90ff");
  }

  return embed;
}

// ===== CLIENT =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// ===== SAFE RANK CARD =====
async function generateCard(user, rank) {
  if (!createCanvas) return null;
  const canvas = createCanvas(800, 300);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1a1c1e";
  ctx.fillRect(0,0,800,300);
  ctx.fillStyle = CONFIG.COLORS[rank] || "#fff";
  ctx.font = "bold 50px sans-serif";
  ctx.fillText(rank, 600, 160);
  ctx.fillStyle = "#fff";
  ctx.font = "30px sans-serif";
  ctx.fillText(user.username, 250, 140);
  try {
    const avatar = await loadImage(user.displayAvatarURL({ extension:"png" }));
    ctx.drawImage(avatar, 50, 75, 150, 150);
  } catch {}
  return canvas.toBuffer();
}

// ===== KEEP ALIVE =====
const app = express();
app.get("/", (_, res) => res.send("OK"));
app.listen(process.env.PORT || 3000);

// ===== READY =====
client.once("ready", async () => {
  console.log(`🚀 ${client.user.tag}`);
  client.user.setActivity("Ranking editors", { type: ActivityType.Watching });
  const commands = [
    { name:"submit", description:"Submit edit" },
    { name:"profile", description:"View rank card" },
    { name:"leaderboard", description:"Top users" }
  ];
  const rest = new REST({ version:"10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
});

// ===== INTERACTIONS =====
client.on("interactionCreate", async (i) => {
  try {
    if (i.isChatInputCommand() && i.commandName === "profile") {
      await i.deferReply();
      const data = await User.findOne({ userId: i.user.id });
      if (!data) return i.editReply("No profile yet");
      const card = await generateCard(i.user, data.currentRank);
      if (!card) return i.editReply(`Rank: ${data.currentRank}`);
      return i.editReply({ files:[new AttachmentBuilder(card,{name:"rank.png"})] });
    }

    if (i.isChatInputCommand() && i.commandName === "leaderboard") {
      const users = await User.find().sort({ totalSubmissions:-1 }).limit(10);
      const text = users.map((u,idx)=> `#${idx+1} <@${u.userId}> - ${u.currentRank}`).join("\n");
      return i.reply({ content:text || "No data", ephemeral:true });
    }

    if (i.isChatInputCommand() && i.commandName === "submit") {
      const cd = CONFIG.COOLDOWNS.get(i.user.id);
      if (cd && Date.now() < cd) return i.reply({ content:"⏳ Wait", ephemeral:true });
      const modal = new ModalBuilder().setCustomId("submit_modal").setTitle("Submit");
      modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("link").setLabel("Link").setStyle(TextInputStyle.Short).setRequired(true)
      ));
      return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId === "submit_modal") {
      const link = i.fields.getTextInputValue("link");
      try { new URL(link); } catch { return i.reply({ content:"Invalid URL", ephemeral:true }); }

      await User.findOneAndUpdate({ userId:i.user.id }, { lastLink:link }, { upsert:true });
      const guild = await client.guilds.fetch(process.env.TARGET_GUILD_ID);
      const reviewChan = await guild.channels.fetch(process.env.REVIEW_CHANNEL_ID);

      // Using the CLIP PREVIEW DETECTOR here
      const embed = getPreviewEmbed(link, i.user.id);

      const rows = [
        new ActionRowBuilder().addComponents(
          CONFIG.RANKS.slice(0,3).map(r=>new ButtonBuilder().setCustomId(`rank_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Primary))
        ),
        new ActionRowBuilder().addComponents(
          CONFIG.RANKS.slice(3).map(r=>new ButtonBuilder().setCustomId(`rank_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Primary))
        )
      ];

      await reviewChan.send({ embeds:[embed], components:rows });
      CONFIG.COOLDOWNS.set(i.user.id, Date.now()+60000);
      return i.reply({ content:"Sent!", ephemeral:true });
    }

    // Rank Button & Final logic remains the same...
    if (i.isButton() && i.customId.startsWith("rank_")) {
      if (!i.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) return i.reply({ content:"Staff only", ephemeral:true });
      const [_, rank, userId] = i.customId.split("_");
      if (CONFIG.PROCESSING.has(userId)) return i.reply({ content:"Processing", ephemeral:true });
      const modal = new ModalBuilder().setCustomId(`final_${rank}_${userId}`).setTitle(`Rank ${rank}`);
      modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("feedback").setLabel("Feedback").setStyle(TextInputStyle.Paragraph)
      ));
      return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId.startsWith("final_")) {
      await i.deferReply({ ephemeral:true });
      const [_, rank, userId] = i.customId.split("_");
      const feedback = i.fields.getTextInputValue("feedback");
      CONFIG.PROCESSING.add(userId);

      try {
        await User.findOneAndUpdate({ userId }, {
            currentRank:rank,
            $inc:{ totalSubmissions:1 },
            $push:{ history:{ rank, feedback, staffId:i.user.id } }
        }, { upsert:true });

        await Staff.findOneAndUpdate({ staffId:i.user.id }, { $inc:{ reviewsCount:1 }, lastReview:new Date() }, { upsert:true });

        const guild = await client.guilds.fetch(process.env.TARGET_GUILD_ID);
        const member = await guild.members.fetch(userId).catch(()=>null);
        if (member) {
          await member.roles.remove(Object.values(CONFIG.ROLES)).catch(()=>{});
          if (CONFIG.ROLES[rank]) await member.roles.add(CONFIG.ROLES[rank]).catch(()=>{});
        }

        const resChan = await guild.channels.fetch(process.env.RESULT_CHANNEL_ID);
        await resChan.send({
          embeds:[new EmbedBuilder().setTitle("Ranked").setDescription(`<@${userId}> → ${rank}\n${feedback}`).setColor(CONFIG.COLORS[rank])]
        });

        const user = await client.users.fetch(userId).catch(()=>null);
        if (user) await user.send(`Rank: ${rank}\n${feedback}`).catch(()=>{});

        const disabledRows = i.message.components.map(row => {
          return new ActionRowBuilder().addComponents(row.components.map(btn => ButtonBuilder.from(btn).setDisabled(true)));
        });
        await i.message.edit({ components: disabledRows });
        return i.editReply("Done");
      } finally {
        CONFIG.PROCESSING.delete(userId);
      }
    }
  } catch (err) {
    console.error(err);
    if (!i.replied && !i.deferred) i.reply({ content:"Error occurred", ephemeral:true }).catch(()=>{});
  }
});

client.login(process.env.DISCORD_TOKEN);
