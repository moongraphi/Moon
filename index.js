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
  👋 Welcome to @MoonSniperBot  // Replace @MoonSniperBot with your bot's actual username
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

// Monitor Pump.fun for New Tokens
async function monitorPumpFun() {
  console.log('Starting Pump.fun monitoring...');
  connection.onProgramAccountChange(
    PUMP_FUN_PROGRAM,
    async (keyedAccountInfo) => {
      try {
        const accountData = keyedAccountInfo.accountInfo.data;
        // Decode account data (simplified for example; use Anchor IDL in production)
        const tokenData = {
          name: 'Unknown', // Replace with actual metadata parsing
          address: keyedAccountInfo.accountId.toString(),
          liquidity: 5000, // Replace with actual data
          marketCap: 20000, // Replace with actual data
          devHolding: 5, // Replace with actual data
          poolSupply: 50, // Replace with actual data
          launchPrice: 0.000005, // Replace with actual data
          mintAuthRevoked: true, // Replace with actual data
          freezeAuthRevoked: false // Replace with actual data
        };

        lastTokenData = tokenData;

        if (checkToken(tokenData)) {
          // Send alert to Telegram
          sendTokenAlert(process.env.CHAT_ID, tokenData);

          // Auto-snipe (buy token)
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
