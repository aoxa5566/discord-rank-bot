const { Client, GatewayIntentBits } = require("discord.js");
const Redis = require("ioredis");

// Redis
const redis = new Redis(process.env.REDIS_URL);

// Bot
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
let current = { mentions: {}, votes: {}, reactions: {} };

// ------------------
// 監聽訊息
// ------------------
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!allowedChannels.includes(message.channel.id)) return;

  if (message.mentions.users.size > 0) {
    const mentioned = message.mentions.users.first();
    if (!current.mentions[mentioned.id]) current.mentions[mentioned.id] = 0;
    current.mentions[mentioned.id]++;

    current.reactions[message.id] = {
      userId: mentioned.id,
      content: message.content,
      count: 0,
    };
  }

  // 查詢歷史排行榜
  const match = message.content.match(/^!(\d+)月排行$/);
  if (match) {
    const month = parseInt(match[1]);
    const year = new Date().getFullYear();
    const key = `rank:${year}-${month - 1}`;
    const data = await redis.get(key);
    if (!data) return message.reply(`❌ ${month} 月沒有紀錄`);
    message.reply(formatResult(JSON.parse(data), `${year}-${month - 1}`));
  }
});

// ------------------
// 監聽表情
// ------------------
client.on("messageReactionAdd", async (reaction) => {
  if (reaction.message.author.bot) return;
  if (!allowedChannels.includes(reaction.message.channel.id)) return;

  const mentioned = reaction.message.mentions.users.first();
  if (!mentioned) return;

  if (!current.votes[mentioned.id]) current.votes[mentioned.id] = 0;
  current.votes[mentioned.id]++;

  if (current.reactions[reaction.message.id]) {
    current.reactions[reaction.message.id].count++;
  }
});

// ------------------
// 每月結算
// ------------------
async function monthlyReport() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const key = `rank:${year}-${month}`;

  await redis.set(key, JSON.stringify(current), "EX", 60 * 60 * 24 * 30 * 6); // 半年有效

  const channel = await client.channels.fetch(allowedChannels[0]); // 公告可以選第一個頻道
  channel.send(formatResult(current, `${year}-${month}`));

  current = { mentions: {}, votes: {}, reactions: {} };
}

// 每天檢查是否 1 號
setInterval(() => {
  const now = new Date();
  if (now.getDate() === 1 && now.getHours() === 0 && now.getMinutes() < 5) {
    monthlyReport();
  }
}, 60 * 1000);

// ------------------
// 排行格式化
// ------------------
function formatResult(data, title) {
  let result = `📊 ${title} 排行榜\n`;

  // @次數
  const mentionRank = Object.entries(data.mentions || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  result += "\n🏆 被 @ 次數排行：\n";
  mentionRank.forEach(
    ([id, count], i) => (result += `${i + 1}. <@${id}> - ${count} 次\n`)
  );

  // 投票
  const voteRank = Object.entries(data.votes || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  result += "\n❤️ 投票排行：\n";
  voteRank.forEach(
    ([id, count], i) => (result += `${i + 1}. <@${id}> - ${count} 票\n`)
  );

  // 熱門訊息
  const hotRank = Object.values(data.reactions || {})
    .sort((a, b) => b.count - b.count)
    .slice(0, 3);
  result += "\n🔥 熱門訊息排行：\n";
  hotRank.forEach((item, i) => {
    let text = item.content.replace(/\n/g, " ");
    if (text.length > 30) text = text.slice(0, 30) + "...";
    result += `${i + 1}. <@${item.userId}> 「${text}」 - ${item.count} 票\n`;
  });

  return result;
}

// ------------------
// 啟動 Bot
// ------------------
client.once("ready", () => console.log(`✅ Logged in as ${client.user.tag}`));
client.login(process.env.DISCORD_TOKEN);
