require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const Redis = require("ioredis");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault("Asia/Taipei");

// ------------------
// Redis
// ------------------
const redis = new Redis(process.env.REDIS_URL);

// ------------------
// Bot
// ------------------
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

// 當月暫存 (以頻道ID為 key)
let current = {}; // { channelId: { mentions: {}, votes: {}, reactions: {} } }

// ------------------
// 監聽訊息
// ------------------
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!allowedChannels.includes(message.channel.id)) return;

  const channelId = message.channel.id;
  if (!current[channelId])
    current[channelId] = { mentions: {}, votes: {}, reactions: {} };
  const data = current[channelId];

  // 計算 @ 次數
  if (message.mentions.users.size > 0) {
    const mentioned = message.mentions.users.first();
    if (!data.mentions[mentioned.id]) data.mentions[mentioned.id] = 0;
    data.mentions[mentioned.id]++;

    data.reactions[message.id] = {
      userId: mentioned.id,
      content: message.content,
      count: 0,
    };
  }

  // 查詢歷史排行 (!9月排行)
  const match = message.content.match(/^!(\d+)月排行$/);
  if (match) {
    const month = parseInt(match[1]); // 使用者輸入的月份
    const year = dayjs().year(); // 依照今年
    const key = `rank:${year}-${month}:${channelId}`;
    const stored = await redis.get(key);
    if (!stored) return message.reply(`❌ ${month} 月沒有紀錄`);
    message.reply(formatResult(JSON.parse(stored), `${year}-${month}`));
  }

  // 查詢本月排行
  if (message.content === "!本月排行") {
    if (!current[channelId]) return message.reply("❌ 本月暫無紀錄");
    const now = dayjs().tz();
    message.reply(
      formatResult(current[channelId], `${now.year()}-${now.month() + 1}`)
    );
  }

  // 清除本月暫存
  if (message.content === "!清空本月") {
    current[channelId] = { mentions: {}, votes: {}, reactions: {} };
    message.reply("✅ 本月暫存資料已清空");
  }
});

// ------------------
// 每月結算
// ------------------
async function monthlyReport() {
  const now = dayjs().tz();
  const year = now.year();
  const month = now.month() + 1; // 1~12

  for (const channelId in current) {
    const data = current[channelId];
    const key = `rank:${year}-${month}:${channelId}`;

    // 儲存 Redis (半年有效)
    await redis.set(key, JSON.stringify(data), "EX", 60 * 60 * 24 * 30 * 6);

    // 發送訊息到頻道
    const channel = await client.channels.fetch(channelId);
    channel.send(formatResult(data, `${year}-${month}`));
  }

  current = {}; // 清空當月暫存
}

// ------------------
// 定時檢查是否台灣時間 1號 00:00
// ------------------
setInterval(() => {
  const now = dayjs().tz();
  if (now.date() === 1 && now.hour() === 0 && now.minute() < 5) {
    monthlyReport();
  }
}, 60 * 1000);
