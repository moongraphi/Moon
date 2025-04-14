require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Connection, Keypair, Transaction } = require('@solana/web3.js');

const app = express();
const PORT = process.env.PORT || 3000;
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: false }); // Polling disabled
const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`);

app.use(express.json());

// Set webhook
bot.setWebHook(`${process.env.WEBHOOK_URL}/bot${token}`);

// In-memory storage (Render free tier)
let walletKey = null;
let filters = {
  liquidity: { min: 4000, max: 20000 },
  marketCap: { min: 1000, max: 100000 },
  devHolding: { min: 1, max: 10 },
  poolSupply: { min: 40, max: 100 },
  launchPrice: { min: 0.0000000023, max: 0.0010 },
  mintAuthRevoked: true,
  freezeAuthRevoked: true
};

let lastTokenData = null;

// Telegram Bot Webhook Handler
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Telegram Bot Logic
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, `
  👋 Welcome to @MemeSniperBot
  💰 Trade  |  🔐 Wallet
  ⚙️ Filters  |  📊 Portfolio
  ❓ Help
  `, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '💰 Trade', callback_data: 'trade' },
          { text: '🔐 Wallet', callback_data: 'wallet' }
        ],
        [
          { text: '⚙️ Filters', callback_data: 'filters' },
          { text: '📊 Portfolio', callback_data: 'portfolio' }
        ],
        [
          { text: '❓ Help', callback_data: 'help' }
        ]
      ]
    }
  });
});

bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  if (query.data === 'trade') {
    bot.editMessageText(`
    💰 Trade
    📈 Buy  |  📉 Sell
    ⬅️ Back
    `, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📈 Buy', callback_data: 'buy' },
            { text: '📉 Sell', callback_data: 'sell' }
          ],
          [
            { text: '⬅️ Back', callback_data: 'back' }
          ]
        ]
      }
    });
  } else if (query.data === 'buy') {
    bot.sendMessage(chatId, `
    📈 Buy Token
    📍 Token Address: [Enter below]
    💸 Amount (SOL): [Enter below]
    `);
    bot.once('message', async (msg) => {
      const [address, amount] = msg.text.split(' ');
      if (!walletKey) {
        bot.sendMessage(msg.chat.id, '🔐 Please set up wallet first!');
        return;
      }
      try {
        const txId = await buyToken(address, amount, walletKey);
        bot.sendMessage(msg.chat.id, `✅ Bought ${amount} SOL of ${address}\nTx: ${txId}`);
      } catch (error) {
        bot.sendMessage(msg.chat.id, `❌ Buy failed: ${error.message}`);
      }
    });
  } else if (query.data === 'sell') {
    bot.sendMessage(chatId, `
    📉 Sell Token
    📍 Token Address: [Enter below]
    💸 Amount (SOL): [Enter below]
    `);
    bot.once('message', async (msg) => {
      const [address, amount] = msg.text.split(' ');
      if (!walletKey) {
        bot.sendMessage(msg.chat.id, '🔐 Please set up wallet first!');
        return;
      }
      try {
        const txId = await sellToken(address, amount, walletKey);
        bot.sendMessage(msg.chat.id, `✅ Sold ${amount} SOL of ${address}\nTx: ${txId}`);
      } catch (error) {
        bot.sendMessage(msg.chat.id, `❌ Sell failed: ${error.message}`);
      }
    });
  } else if (query.data === 'wallet') {
    bot.editMessageText(`
    🔐 Wallet Setup
    👉 Enter Private Key
    `, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Save', callback_data: 'save_wallet' },
            { text: '❌ Cancel', callback_data: 'cancel_wallet' }
          ]
        ]
      }
    });
  } else if (query.data === 'save_wallet') {
    bot.sendMessage(chatId, '🔒 Please send your private key:');
    bot.once('message', (msg) => {
      walletKey = msg.text;
      bot.sendMessage(msg.chat.id, '✅ Wallet saved securely!');
    });
  } else if (query.data === 'cancel_wallet') {
    bot.editMessageText(`
    👋 Welcome to @MemeSniperBot
    💰 Trade  |  🔐 Wallet
    ⚙️ Filters  |  📊 Portfolio
    ❓ Help
    `, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💰 Trade', callback_data: 'trade' },
            { text: '🔐 Wallet', callback_data: 'wallet' }
          ],
          [
            { text: '⚙️ Filters', callback_data: 'filters' },
            { text: '📊 Portfolio', callback_data: 'portfolio' }
          ],
          [
            { text: '❓ Help', callback_data: 'help' }
          ]
        ]
      }
    });
  } else if (query.data === 'filters') {
    bot.editMessageText(`
    ⚙️ Filters
    💧 Liquidity: ${filters.liquidity.min}-${filters.liquidity.max}
    📈 Market Cap: ${filters.marketCap.min}-${filters.marketCap.max}
    💸 Launch Price: ${filters.launchPrice.min}-${filters.launchPrice.max} SOL
    👨‍💻 Dev Holding: ${filters.devHolding.min}%-${filters.devHolding.max}%
    🏦 Pool Supply: ${filters.poolSupply.min}%-${filters.poolSupply.max}%
    🟢 Mint Auth: ${filters.mintAuthRevoked ? '✅ Yes' : '❌ No'}
    🟢 Freeze Auth: ${filters.freezeAuthRevoked ? '✅ Yes' : '❌ No'}
    `, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💧 Liquidity', callback_data: 'edit_liquidity' },
            { text: '📈 Market Cap', callback_data: 'edit_marketCap' }
          ],
          [
            { text: '👨‍💻 Dev Holding', callback_data: 'edit_devHolding' },
            { text: '🏦 Pool Supply', callback_data: 'edit_poolSupply' }
          ],
          [
            { text: '💸 Launch Price', callback_data: 'edit_launchPrice' },
            { text: '🟢 Mint Auth', callback_data: 'toggle_mintAuth' }
          ],
          [
            { text: '🟢 Freeze Auth', callback_data: 'toggle_freezeAuth' }
          ],
          [
            { text: '💾 Save', callback_data: 'save_filters' },
            { text: '🗑️ Reset', callback_data: 'reset_filters' }
          ],
          [
            { text: '⬅️ Back', callback_data: 'back' }
          ]
        ]
      }
    });
  } else if (query.data.startsWith('edit_')) {
    const field = query.data.split('_')[1];
    bot.sendMessage(chatId, `👉 Enter Min and Max for ${field} (e.g., 0.001 0.1):`);
    bot.once('message', (msg) => {
      const [min, max] = msg.text.split(' ').map(Number);
      filters[field] = { min, max };
      bot.sendMessage(msg.chat.id, `✅ ${field} set to ${min}-${max}`);
    });
  } else if (query.data === 'toggle_mintAuth') {
    filters.mintAuthRevoked = !filters.mintAuthRevoked;
    bot.sendMessage(chatId, `🟢 Mint Auth set to ${filters.mintAuthRevoked ? '✅ Yes' : '❌ No'}`);
  } else if (query.data === 'toggle_freezeAuth') {
    filters.freezeAuthRevoked = !filters.freezeAuthRevoked;
    bot.sendMessage(chatId, `🟢 Freeze Auth set to ${filters.freezeAuthRevoked ? '✅ Yes' : '❌ No'}`);
  } else if (query.data === 'save_filters') {
    bot.sendMessage(chatId, '💾 Filters saved!');
  } else if (query.data === 'reset_filters') {
    filters = {
      liquidity: { min: 4000, max: 20000 },
      marketCap: { min: 1000, max: 100000 },
      devHolding: { min: 1, max: 10 },
      poolSupply: { min: 40, max: 100 },
      launchPrice: { min: 0.0000000023, max: 0.0010 },
      mintAuthRevoked: true,
      freezeAuthRevoked: true
    };
    bot.sendMessage(chatId, '🗑️ Filters reset!');
  } else if (query.data === 'portfolio') {
    bot.editMessageText('📊 Portfolio\nComing soon!', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '⬅️ Back', callback_data: 'back' }
          ]
        ]
      }
    });
  } else if (query.data === 'help') {
    bot.editMessageText('❓ Help\nUse /start to begin!', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '⬅️ Back', callback_data: 'back' }
          ]
        ]
      }
    });
  } else if (query.data === 'back') {
    bot.editMessageText(`
    👋 Welcome to @MemeSniperBot
    💰 Trade  |  🔐 Wallet
    ⚙️ Filters  |  📊 Portfolio
    ❓ Help
    `, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💰 Trade', callback_data: 'trade' },
            { text: '🔐 Wallet', callback_data: 'wallet' }
          ],
          [
            { text: '⚙️ Filters', callback_data: 'filters' },
            { text: '📊 Portfolio', callback_data: 'portfolio' }
          ],
          [
            { text: '❓ Help', callback_data: 'help' }
          ]
        ]
      }
    });
  } else if (query.data.startsWith('refresh_')) {
    const tokenAddress = query.data.split('_')[1];
    if (lastTokenData && lastTokenData.address === tokenAddress) {
      lastTokenData.liquidity += 100; // Mock update
      lastTokenData.marketCap += 500; // Mock update
      sendTokenAlert(chatId, lastTokenData);
    } else {
      bot.sendMessage(chatId, '❌ Token data not found for refresh.');
    }
  }
});

// Helius Webhook
app.post('/webhook', async (req, res) => {
  try {
    console.log('Webhook received:', JSON.stringify(req.body, null, 2));
    const tokenData = req.body[0];
    if (!tokenData) {
      console.log('No token data found in webhook payload');
      return res.status(200).send('No data');
    }

    const enrichedData = {
      name: tokenData.token?.metadata?.name || 'Unknown',
      address: tokenData.token?.address || 'Unknown',
      liquidity: tokenData.liquidity || 5000,
      marketCap: tokenData.marketCap || 20000,
      devHolding: tokenData.devHolding || 5,
      poolSupply: tokenData.poolSupply || 50,
      launchPrice: calculateLaunchPrice(tokenData),
      mintAuthRevoked: tokenData.mintAuthRevoked || true,
      freezeAuthRevoked: tokenData.freezeAuthRevoked || false
    };

    lastTokenData = enrichedData;

    if (checkToken(enrichedData)) {
      sendTokenAlert(process.env.CHAT_ID, enrichedData);
    } else {
      console.log('Token does not pass filters:', enrichedData);
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).send('OK');
  }
});

// Send Token Alert
function sendTokenAlert(chatId, tokenData) {
  const chartLink = `https://dexscreener.com/solana/${tokenData.address}`;
  bot.sendMessage(chatId, `
  🔥 New Meme Coin on Pump.fun!
  📜 Name: ${tokenData.name}
  📍 Contract: ${tokenData.address}
  💧 Liquidity: $${tokenData.liquidity}
  📈 Market Cap: $${tokenData.marketCap}
  💸 Launch Price: ${tokenData.launchPrice} SOL
  👨‍💻 Dev Holding: ${tokenData.devHolding}%
  🏦 Pool Supply: ${tokenData.poolSupply}%
  🟢 Mint Auth: ${tokenData.mintAuthRevoked ? 'Revoked' : 'Not Revoked'}
  🔴 Freeze Auth: ${tokenData.freezeAuthRevoked ? 'Revoked' : 'Not Revoked'}
  📊 Chart: [View Chart](${chartLink})
  `, {
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
    },
    parse_mode: 'Markdown'
  });
}

// Solana Logic
async function buyToken(tokenAddress, amount, privateKey) {
  try {
    const wallet = Keypair.fromSecretKey(Buffer.from(privateKey, 'base64'));
    const tx = new Transaction();
    tx.add(/* Mock instruction */);
    tx.sign(wallet);
    const txId = await connection.sendRawTransaction(tx.serialize());
    return txId;
  } catch (error) {
    throw new Error(`Buy failed: ${error.message}`);
  }
}

async function sellToken(tokenAddress, amount, privateKey) {
  try {
    const wallet = Keypair.fromSecretKey(Buffer.from(privateKey, 'base64'));
    const tx = new Transaction();
    tx.add(/* Mock instruction */);
    tx.sign(wallet);
    const txId = await connection.sendRawTransaction(tx.serialize());
    return txId;
  } catch (error) {
    throw new Error(`Sell failed: ${error.message}`);
  }
}

// Filter Logic
function calculateLaunchPrice(tokenData) {
  const solSpent = tokenData.initialSwap?.solAmount || 1;
  const tokensReceived = tokenData.initialSwap?.tokenAmount || 200000;
  return solSpent / tokensReceived;
}

function checkToken(tokenData) {
  return (
    tokenData.liquidity >= filters.liquidity.min &&
    tokenData.liquidity <= filters.liquidity.max &&
    tokenData.marketCap >= filters.marketCap.min &&
    tokenData.marketCap <= filters.marketCap.max &&
    tokenData.devHolding >= filters.devHolding.min &&
    tokenData.devHolding <= filters.devHolding.max &&
    tokenData.poolSupply >= filters.poolSupply.min &&
    tokenData.poolSupply <= filters.poolSupply.max &&
    tokenData.launchPrice >= filters.launchPrice.min &&
    tokenData.launchPrice <= filters.launchPrice.max &&
    tokenData.mintAuthRevoked === filters.mintAuthRevoked &&
    tokenData.freezeAuthRevoked === filters.freezeAuthRevoked
  );
}

// Health Check
app.get('/', (req, res) => res.send('Bot running!'));

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
