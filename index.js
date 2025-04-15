require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Connection, PublicKey } = require('@solana/web3.js');
const { getMint, TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');

const app = express();
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: false });

const connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');

app.use(express.json());

// Store filters for users
let filters = {
  'default': {
    liquidity: { min: 7000, max: 12000 },
    marketCap: { min: 2000, max: 80000 },
    devHolding: { min: 2, max: 7 },
    poolSupply: { min: 40, max: 100 },
    launchPrice: { min: 0.0000000023, max: 0.0010 },
    mintAuthRevoked: true,
    freezeAuthRevoked: false
  }
};

// Save filters for each user
const userFilters = {};

// Helper function to parse filter input
function parseFilterInput(input) {
  const params = input.split(',').map(param => param.trim());
  const filter = {};
  
  params.forEach(param => {
    const [key, value] = param.split(':').map(item => item.trim());
    if (key && value) {
      if (key.includes('liquidity') || key.includes('marketCap') || key.includes('devHolding') || key.includes('poolSupply') || key.includes('launchPrice')) {
        const [min, max] = value.split('-').map(Number);
        filter[key] = { min, max };
      } else if (key.includes('mintAuthRevoked') || key.includes('freezeAuthRevoked')) {
        filter[key] = value.toLowerCase() === 'true';
      }
    }
  });
  
  return filter;
}

// Telegram Bot Commands
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Welcome to MoonGraphi Bot! 🚀\nUse /setfilter to set your token filters.\nUse /getfilter to see your current filters.');
});

bot.onText(/\/setfilter (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const filterInput = match[1];
  
  try {
    const filter = parseFilterInput(filterInput);
    userFilters[chatId] = filter;
    bot.sendMessage(chatId, 'Filters updated successfully! Use /getfilter to see your filters.');
  } catch (error) {
    bot.sendMessage(chatId, 'Invalid filter format. Example: /setfilter liquidity:7000-12000, marketCap:2000-80000, devHolding:2-7, poolSupply:40-100, launchPrice:0.0000000023-0.0010, mintAuthRevoked:true, freezeAuthRevoked:false');
  }
});

bot.onText(/\/getfilter/, (msg) => {
  const chatId = msg.chat.id;
  const userFilter = userFilters[chatId] || filters['default'];
  
  const filterMessage = `
  Your Filters:
  Liquidity: ${userFilter.liquidity.min} - ${userFilter.liquidity.max}
  Market Cap: ${userFilter.marketCap.min} - ${userFilter.marketCap.max}
  Dev Holding: ${userFilter.devHolding.min} - ${userFilter.devHolding.max}%
  Pool Supply: ${userFilter.poolSupply.min} - ${userFilter.poolSupply.max}%
  Launch Price: ${userFilter.launchPrice.min} - ${userFilter.launchPrice.max}
  Mint Auth Revoked: ${userFilter.mintAuthRevoked}
  Freeze Auth Revoked: ${userFilter.freezeAuthRevoked}
  `;
  
  bot.sendMessage(chatId, filterMessage);
});

// Monitor Pump.fun for new tokens
async function monitorPumpFun() {
  console.log('Starting Pump.fun monitoring...');
  const tokenAddress = 'DUMMY_ADDRESS_' + Date.now();
  const tokenData = {
    name: 'TestToken',
    address: tokenAddress,
    liquidity: 8000,
    marketCap: 20000,
    devHolding: 5,
    poolSupply: 50,
    launchPrice: 0.000005,
    mintAuthRevoked: true,
    freezeAuthRevoked: false
  };

  const userFilters = filters['default'] || {
    liquidity: { min: 7000, max: 12000 },
    marketCap: { min: 2000, max: 80000 },
    devHolding: { min: 2, max: 7 },
    poolSupply: { min: 40, max: 100 },
    launchPrice: { min: 0.0000000023, max: 0.0010 },
    mintAuthRevoked: true,
    freezeAuthRevoked: false
  };

  if (
    tokenData.liquidity >= userFilters.liquidity.min &&
    tokenData.liquidity <= userFilters.liquidity.max &&
    tokenData.marketCap >= userFilters.marketCap.min &&
    tokenData.marketCap <= userFilters.marketCap.max &&
    tokenData.devHolding >= userFilters.devHolding.min &&
    tokenData.devHolding <= userFilters.devHolding.max &&
    tokenData.poolSupply >= userFilters.poolSupply.min &&
    tokenData.poolSupply <= userFilters.poolSupply.max &&
    tokenData.launchPrice >= userFilters.launchPrice.min &&
    tokenData.launchPrice <= userFilters.launchPrice.max &&
    tokenData.mintAuthRevoked === userFilters.mintAuthRevoked &&
    tokenData.freezeAuthRevoked === userFilters.freezeAuthRevoked
  ) {
    const alertMessage = `
🚀 New Token Alert on Pump.fun! 🚀
Name: ${tokenData.name}
Contract: ${tokenData.address}
Liquidity: $${tokenData.liquidity}
Market Cap: $${tokenData.marketCap}
Dev Holding: ${tokenData.devHolding}%
Pool Supply: ${tokenData.poolSupply}%
Launch Price: $${tokenData.launchPrice}
Mint Revoked: ${tokenData.mintAuthRevoked}
Freeze Revoked: ${tokenData.freezeAuthRevoked}
    `;
    bot.sendMessage('-1002511600127', alertMessage); // Your chat ID
  }

  setTimeout(monitorPumpFun, 60000); // Run every 60 seconds
}

monitorPumpFun();

// Express Routes
app.get('/', (req, res) => {
  res.send('Bot is running');
});

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
