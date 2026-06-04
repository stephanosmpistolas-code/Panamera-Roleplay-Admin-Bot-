const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');
const express = require('express');
const app = express();
app.use(express.json());

// =============================================
// ⚙️  ΡΥΘΜΙΣΕΙΣ - Άλλαξε αυτά τα values!
// =============================================
require('dotenv').config();

const CONFIG = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  CLIENT_ID: process.env.CLIENT_ID,
  GUILD_ID: process.env.GUILD_ID,
  LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID,
  COMMAND_CHANNEL_ID: process.env.COMMAND_CHANNEL_ID,
  API_SECRET: process.env.API_SECRET,  
PORT: 3000,
};

// =============================================
// 🤖 Discord Client
// =============================================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// =============================================
// 📋 Slash Commands
// =============================================
const commands = [
  new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Στείλε HD Admin command στο Roblox')
    .addStringOption(opt =>
      opt.setName('command').setDescription('π.χ. :kick PlayerName Reason').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban παίκτη από Discord')
    .addStringOption(opt =>
      opt.setName('username').setDescription('Roblox username').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('reason').setDescription('Λόγος ban').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick παίκτη από Discord')
    .addStringOption(opt =>
      opt.setName('username').setDescription('Roblox username').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('reason').setDescription('Λόγος kick').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('players')
    .setDescription('Δες τους παίκτες που είναι online'),

  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Κάνε announcement στο Roblox server')
    .addStringOption(opt =>
      opt.setName('message').setDescription('Το μήνυμα').setRequired(true)
    ),
];

// =============================================
// 📦 Pending commands queue (Discord → Roblox)
// =============================================
let pendingCommands = [];
let serverStatus = { players: [], lastSeen: null };

// =============================================
// 🎮 Interaction Handler
// =============================================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, user, channelId } = interaction;

  // Μόνο στο command channel
  if (channelId !== CONFIG.COMMAND_CHANNEL_ID) {
    return interaction.reply({ content: '❌ Χρησιμοποίησε το σωστό κανάλι!', ephemeral: true });
  }

  const logChannel = client.channels.cache.get(CONFIG.LOG_CHANNEL_ID);

  if (commandName === 'admin') {
    const command = interaction.options.getString('command');
    pendingCommands.push({ type: 'admin', command });

    const embed = new EmbedBuilder()
      .setTitle('🔧 Admin Command Σταλθηκε')
      .setDescription(`\`\`\`${command}\`\`\``)
      .addFields({ name: 'Από', value: `${user.tag}`, inline: true })
      .setColor(0x5865f2)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    logChannel?.send({ embeds: [embed] });

  } else if (commandName === 'ban') {
    const username = interaction.options.getString('username');
    const reason = interaction.options.getString('reason') || 'Κανένας λόγος';
    pendingCommands.push({ type: 'admin', command: `:ban ${username} ${reason}` });

    const embed = new EmbedBuilder()
      .setTitle('🔨 Ban')
      .addFields(
        { name: 'Παίκτης', value: username, inline: true },
        { name: 'Λόγος', value: reason, inline: true },
        { name: 'Moderator', value: user.tag, inline: true }
      )
      .setColor(0xed4245)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    logChannel?.send({ embeds: [embed] });

  } else if (commandName === 'kick') {
    const username = interaction.options.getString('username');
    const reason = interaction.options.getString('reason') || 'Κανένας λόγος';
    pendingCommands.push({ type: 'admin', command: `:kick ${username} ${reason}` });

    const embed = new EmbedBuilder()
      .setTitle('👢 Kick')
      .addFields(
        { name: 'Παίκτης', value: username, inline: true },
        { name: 'Λόγος', value: reason, inline: true },
        { name: 'Moderator', value: user.tag, inline: true }
      )
      .setColor(0xfee75c)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    logChannel?.send({ embeds: [embed] });

  } else if (commandName === 'players') {
    const players = serverStatus.players;
    const embed = new EmbedBuilder()
      .setTitle('👥 Online Παίκτες')
      .setDescription(players.length > 0 ? players.map(p => `• ${p}`).join('\n') : '_Κανένας online_')
      .addFields({ name: 'Σύνολο', value: `${players.length}`, inline: true })
      .setColor(0x57f287)
      .setFooter({ text: serverStatus.lastSeen ? `Τελευταία ενημέρωση: ${new Date(serverStatus.lastSeen).toLocaleTimeString()}` : 'Δεν έχει συνδεθεί ακόμα' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

  } else if (commandName === 'announce') {
    const message = interaction.options.getString('message');
    pendingCommands.push({ type: 'admin', command: `:m ${message}` });

    const embed = new EmbedBuilder()
      .setTitle('📢 Announcement')
      .setDescription(message)
      .addFields({ name: 'Από', value: user.tag, inline: true })
      .setColor(0x57f287)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    logChannel?.send({ embeds: [embed] });
  }
});

// =============================================
// 🌐 Express API (Roblox ↔ Bot)
// =============================================

// Roblox στέλνει logs εδώ
app.post('/log', async (req, res) => {
  const { secret, executor, command, time } = req.body;

  if (secret !== CONFIG.API_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const logChannel = client.channels.cache.get(CONFIG.LOG_CHANNEL_ID);
  if (logChannel) {
    const embed = new EmbedBuilder()
      .setTitle('📜 HD Admin Log')
      .addFields(
        { name: '👤 Παίκτης', value: executor || 'Unknown', inline: true },
        { name: '🔧 Command', value: `\`${command}\`` || 'Unknown', inline: true },
        { name: '🕐 Ώρα', value: time || new Date().toISOString(), inline: true }
      )
      .setColor(0x5865f2)
      .setTimestamp();

    await logChannel.send({ embeds: [embed] });
  }

  res.json({ success: true });
});

// Roblox παίρνει pending commands εδώ
app.get('/commands', (req, res) => {
  const { secret } = req.query;
  if (secret !== CONFIG.API_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const cmds = [...pendingCommands];
  pendingCommands = []; // Clear queue
  res.json({ commands: cmds });
});

// Roblox ανεβάζει player list εδώ
app.post('/status', (req, res) => {
  const { secret, players } = req.body;
  if (secret !== CONFIG.API_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  serverStatus = { players: players || [], lastSeen: Date.now() };
  res.json({ success: true });
});

// =============================================
// 🚀 Start
// =============================================
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(CONFIG.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID), {
    body: commands.map(c => c.toJSON()),
  });
  console.log('✅ Slash commands registered!');
}

client.once('ready', async () => {
  console.log(`✅ Bot συνδέθηκε ως ${client.user.tag}`);
  await registerCommands();
  app.listen(CONFIG.PORT, () => console.log(`✅ API server τρέχει στο port ${CONFIG.PORT}`));
});

client.login(CONFIG.DISCORD_TOKEN);
