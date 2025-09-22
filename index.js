const { Client, GatewayIntentBits } = require("discord.js");
const Redis = require("ioredis");
const cron = require("node-cron");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

const redis = new Redis(process.env.REDIS_URL);
const channelIds = process.env.CHANNEL_ID.split(",");

// 當 Bot 啟動
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// 當有人在特定頻道發送訊息
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!channelIds.includes(message.channel.id)) return;

  const mentions = message.mentions.users;
  mentions.forEach(async (user) => {
    await redis.incr(`count:${getMonthKey()}:${user.id}`);
    await redis.set(
      `msg:${getMonthKey()}:${user.id}:${message.id}`,
      message.content
    );
  });
});

// 當有人對訊息加表情
client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot) return;
  if (!channelIds.includes(reaction.message.channel.id)) return;

  const msg = reaction.message;
  const mentions = msg.mentions.users;
  mentions.forEach(async (u) => {
    await redis.incr(`vote:${getMonthKey()}:${u.id}`);
  });
});

// 每月 1 號產生排行榜
cron.schedule("0 0 1 * *", async () => {
  const key = getMonthKey(-1); // 上個月
  const counts = await redis.keys(`count:${key}:*`);
  const votes = await redis.keys(`vote:${key}:*`);

  let countRank = [];
  for (let k of counts) {
    const userId = k.split(":")[2];
    const val = await redis.get(k);
    countRank.push({ userId, val: parseInt(val) });
  }
  countRank.sort((a, b) => b.val - a.val);

  let voteRank = [];
  for (let k of votes) {
    const userId = k.split(":")[2];
    const val = await redis.get(k);
    voteRank.push({ userId, val: parseInt(val) });
  }
  voteRank.sort((a, b) => b.val - a.val);

  // 發送排行榜
  for (let channelId of channelIds) {
    const channel = await client.channels.fetch(channelId);
    let msg = `📊 ${key} 排行榜\n\n🏅 提及次數前五名:\n`;
    countRank.slice(0, 5).forEach((u, i) => {
      msg += `${i + 1}. <@${u.userId}> - ${u.val} 次\n`;
    });

    msg += `\n🎭 投票前 3 名:\n`;
    voteRank.slice(0, 3).forEach((u, i) => {
      msg += `${i + 1}. <@${u.userId}> - ${u.val} 票\n`;
    });

    channel.send(msg);
  }
});

function getMonthKey(offset = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

client.login(process.env.DISCORD_TOKEN);
