require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');

const app = express();
const PORT = process.env.PORT || 3000;
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: false });
const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`);
const PUMP_FUN_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

app.use(express.json());

// Set webhook
bot.setWebHook(`${process.env.WEBHOOK_URL}/bot${token}`);

// In-memory storage (Render free tier)
let walletKey = null;
let filters = {
  liquidity: { min: 1000, max: 50000 }, // Relaxed
  marketCap: { min: 500, max: 200000 }, // Relaxed
  devHolding: { min: 0, max: 20 }, // Relaxed
  poolSupply: { min: 20, max: 100 }, // Relaxed
  launchPrice: { min: 0.000000001, max: 0.01 }, // Relaxed
  mintAuthRevoked: false, // Relaxed
  freezeAuthRevoked: false // Relaxed
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
  👋 Welcome to @Moonsniperbot // Replace @Moongarphi_bot with your bot's actual username
  💰 Trade  |  🔐 Wallet
  ⚙️ Filters  |  📊 Portfolio
  ❓ Help
  `, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💰 Trade', callback_data: 'trade' }, { text: '🔐 Wallet', callback_data: 'wallet' }],
        [{ text: '⚙️ Filters', callback_data: 'filters' }, { text: '📊 Portfolio', callback_data: 'portfolio' }],
        [{ text: '❓ Help', callback_data: 'help' }]
      ]
    }
  });
});

// Handle Button Callbacks
bot.on('callback_query', (callbackQuery) => {
  const msg = callbackQuery.message;
  const data = callbackQuery.data;

  // Acknowledge the callback query to avoid Telegram timeout
  bot.answerCallbackQuery(callbackQuery.id);

  switch (data) {
    case 'trade':
      bot.sendMessage(msg.chat.id, '💰 Trade Menu\n🚀 Buy  |  📉 Sell', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Buy', callback_data: 'buy' }, { text: '📉 Sell', callback_data: 'sell' }],
            [{ text: '⬅️ Back', callback_data: 'back' }]
          ]
        }
      });
      break;

    case 'wallet':
      bot.sendMessage(msg.chat.id, '🔐 Wallet Menu\n💳 Your wallet: Not connected yet.\n🔗 Connect Wallet', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔗 Connect Wallet', callback_data: 'connect_wallet' }],
            [{ text: '⬅️ Back', callback_data: 'back' }]
          ]
        }
      });
      break;

    case 'filters':
      bot.sendMessage(msg.chat.id, `⚙️ Filters Menu\nCurrent Filters:\nLiquidity: ${filters.liquidity.min}-${filters.liquidity.max}\nMarket Cap: ${filters.marketCap.min}-${filters.marketCap.max}\nDev Holding: ${filters.devHolding.min}-${filters.devHolding.max}%`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✏️ Edit Filters', callback_data: 'edit_filters' }],
            [{ text: '⬅️ Back', callback_data: 'back' }]
          ]
        }
      });
      break;

    case 'portfolio':
      bot.sendMessage(msg.chat.id, '📊 Portfolio Menu\nYour portfolio is empty.\n💰 Start trading to build your portfolio!', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'back' }]
          ]
        }
      });
      break;

    case 'help':
      bot.sendMessage(msg.chat.id, '❓ Help Menu\nThis bot helps you snipe meme coins on Pump.fun!\nCommands:\n/start - Start the bot\nFor support, contact @YourSupportUsername', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'back' }]
          ]
        }
      });
      break;

    case 'back':
      bot.editMessageText(`👋 Welcome to @MoonSniperBot\n💰 Trade  |  🔐 Wallet\n⚙️ Filters  |  📊 Portfolio\n❓ Help`, {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [
            [{ text: '💰 Trade', callback_data: 'trade' }, { text: '🔐 Wallet', callback_data: 'wallet' }],
            [{ text: '⚙️ Filters', callback_data: 'filters' }, { text: '📊 Portfolio', callback_data: 'portfolio' }],
            [{ text: '❓ Help', callback_data: 'help' }]
          ]
        }
      });
      break;

    default:
      bot.sendMessage(msg.chat.id, 'Unknown command. Please use the buttons.');
  }
});

// Monitor Pump.fun for New Tokens
async function monitorPumpFun() {
  console.log('Starting Pump.fun monitoring...');
  connection.onProgramAccountChange(
    PUMP_FUN_PROGRAM,
    async (keyedAccountInfo) => {
      try {
        const accountData = keyedAccountInfo.accountInfo.data;
        const tokenAddress = keyedAccountInfo.accountId.toString();

        // Fetch token metadata (simplified; in production, use Pump.fun API or Solana metadata program)
        const tokenData = {
          name: 'TestToken', // Replace with actual metadata parsing
          address: tokenAddress,
          liquidity: 3000, // Replace with actual data
          marketCap: 15000, // Replace with actual data
          devHolding: 8, // Replace with actual data
          poolSupply: 60, // Replace with actual data
          launchPrice: 0.000003, // Replace with actual data
          mintAuthRevoked: true, // Replace with actual data
          freezeAuthRevoked: false // Replace with actual data
        };

        console.log('New token detected:', tokenData);

        lastTokenData = tokenData;

        if (checkToken(tokenData)) {
          console.log('Token passed filters:', tokenData);
          sendTokenAlert(process.env.CHAT_ID, tokenData);
          await autoSnipeToken(tokenData.address);
        } else {
          console.log('Token does not pass filters:', tokenData);
        }
      } catch (error) {
        console.error('Error monitoring Pump.fun:', error);
      }
    },
    'confirmed',
    [
      { dataSize: 165 }, // Adjust based on Pump.fun account size
      { memcmp: { offset: 0, bytes: 'create' } } // Filter for "create" instruction
    ]
  );
}

// Auto-Snipe Logic
async function autoSnipeToken(tokenAddress) {
  try {
    const wallet = Keypair.fromSecretKey(Buffer.from(process.env.PRIVATE_KEY, 'base64'));
    const tokenAccount = new PublicKey(tokenAddress);
    const amountToBuy = 0.1; // 0.1 SOL

    // Simplified buy transaction (replace with actual Pump.fun buy logic)
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: tokenAccount,
        lamports: amountToBuy * 1e9 // Convert SOL to lamports
      })
    );

    const signature = await sendAndConfirmTransaction(connection, transaction, [wallet]);
    console.log(`Bought token ${tokenAddress} with signature ${signature}`);

    bot.sendMessage(process.env.CHAT_ID, `✅ Bought token ${tokenAddress} for ${amountToBuy} SOL! Signature: ${signature}`);
  } catch (error) {
    console.error('Error auto-sniping token:', error);
    bot.sendMessage(process.env.CHAT_ID, `❌ Failed to buy token ${tokenAddress}: ${error.message}`);
  }
}

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
        [{ text: '🔄 Refresh', callback_data: `refresh_${tokenData.address}` }, { text: '💰 Buy Now', callback_data: `buy_${tokenData.address}` }],
        [{ text: '➡️ Details', callback_data: `details_${tokenData.address}` }, { text: '❌ Ignore', callback_data: 'ignore' }]
      ]
    },
    parse_mode: 'Markdown'
  });
}

// Filter Logic
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

// Helius Webhook (for backup)
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
      await autoSnipeToken(enrichedData.address);
    } else {
      console.log('Token does not pass filters:', enrichedData);
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).send('OK');
  }
});

function calculateLaunchPrice(tokenData) {
  const solSpent = tokenData.initialSwap?.solAmount || 1;
  const tokensReceived = tokenData.initialSwap?.tokenAmount || 200000;
  return solSpent / tokensReceived;
}

// Health Check
app.get('/', (req, res) => res.send('Bot running!'));

// Start Server and Monitoring
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  monitorPumpFun(); // Start monitoring Pump.fun
});
