require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  Keypair
} = require('@solana/web3.js');
const { getMint, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const fetch = require('node-fetch');

const app = express();

// Use the port provided by Render, fallback to 10000 for local testing
const PORT = process.env.PORT || 10000;

function checkToken(tokenData) {
  // your filters logic here...
  return true;
}

function sendTokenAlert(chatId, tokenData) {
  const chartLink = `https://dexscreener.com/solana/${tokenData.address}`;
  bot.sendMessage(
    chatId,
    `
🚀 New Token Alert on Pump.fun! 🚀
Name: ${tokenData.name}
Contract: ${tokenData.address}
Liquidity: $${tokenData.liquidity.toFixed(2)}
Market Cap: $${tokenData.marketCap.toFixed(2)}
Dev Holding: ${tokenData.devHolding.toFixed(2)}%
Pool Supply: ${tokenData.poolSupply.toFixed(2)}%
Launch Price: $${tokenData.launchPrice.toFixed(9)}
Mint Revoked: ${tokenData.mintAuthRevoked}
Freeze Revoked: ${tokenData.freezeAuthRevoked}
📊 Chart: [View Chart](${chartLink})
    `,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔄 Refresh', callback_data: `refresh_${tokenData.address}` },
            { text: '💰 Buy Now', callback_data: `buy_${tokenData.address}` }
          ],
          [
            { text: '➡️ Details', callback_data: `details_${tokenData.address}` },
            { text: '❌ Ignore', callback_data: 'ignore' }
          ]
        ]
      }
    }
  );
}

async function autoSnipeToken(tokenAddress) {
  // your auto-snipe logic...
}

// Telegram webhook for bot commands
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Health check endpoint
app.get('/', (req, res) => res.send('Bot running!'));

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`➡️ Helius Webhook URL (configure in Helius): ${webhookBaseUrl}/webhook`);
  bot.sendMessage(chatId, '🚀 Bot started! Waiting for Pump.fun token alerts...');
});
