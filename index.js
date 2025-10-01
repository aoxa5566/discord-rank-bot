require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const Redis = require("ioredis");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

const redis = new Redis(process.env.REDIS_URL);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

// 允許的頻道（多頻道）
const allowedChannels = process.env.CHANNEL_ID.split(",");

// 當月暫存
let current = {}; // { channelId: { mentions: {}, votes: {}, reactions: {} } }

// ------------------
// 查詢歷史排行
// ------------------
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!allowedChannels.includes(message.channel.id)) return;

  const channelId = message.channel.id;
  if (!current[channelId])
    current[channelId] = { mentions: {}, votes: {}, reactions: {} };
  const data = current[channelId];

  // 查詢歷史排行 !9月排行
  const match = message.content.match(/^!(\d+)月排行$/);
  if (match) {
    const month = String(match[1]).padStart(2, "0");
    const year = dayjs().tz("Asia/Taipei").year();
    const key = `rank:${year}-${month}:${channelId}`;
    const stored = await redis.get(key);
    if (!stored) return message.reply(`❌ ${month} 月沒有紀錄`);
    return message.reply(formatResult(JSON.parse(stored), `${year}-${month}`));
  }

  // 查詢本月排行
  if (message.content === "!本月排行") {
    if (!current[channelId]) return message.reply("❌ 本月暫無紀錄");
    return message.reply(formatResult(current[channelId], "本月"));
  }
});

// ------------------
// 每月結算 (台灣時間 00:00)
// ------------------
async function monthlyReport() {
  const now = dayjs().tz("Asia/Taipei");
  const year = now.year();
  const month = now.month(); // 0–11
  const monthStr = String(month + 1).padStart(2, "0");

  for (const channelId in current) {
    const data = current[channelId];
    const key = `rank:${year}-${monthStr}:${channelId}`;

    await redis.set(key, JSON.stringify(data), "EX", 60 * 60 * 24 * 30 * 6);

    const channel = await client.channels.fetch(channelId);
    channel.send(formatResult(data, `${year}-${monthStr}`));
  }

  current = {}; // 清空
}

// 用 node-cron 定時台灣時間 0 點執行
const cron = require("node-cron");
cron.schedule(
  "0 0 1 * *",
  () => {
    monthlyReport();
  },
  { timezone: "Asia/Taipei" }
);
