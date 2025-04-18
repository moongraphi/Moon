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

// Telegram & Helius config
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID || '-1002511600127';
const webhookBaseUrl = process.env.WEBHOOK_URL?.replace(/\/$/, ''); // must be the root URL, e.g. https://your-app.onrender.com
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// Validate required env vars early
if (!token || !webhookBaseUrl || !HELIUS_API_KEY || !PRIVATE_KEY) {
  console.error('❌ Missing environment variables. Required: TELEGRAM_BOT_TOKEN, WEBHOOK_URL, HELIUS_API_KEY, PRIVATE_KEY');
  process.exit(1);
}

// Initialize Telegram bot (no polling—using webhooks)
const bot = new TelegramBot(token, { polling: false });

// Set Telegram webhook for bot commands
bot.setWebHook(`${webhookBaseUrl}/bot${token}`);

// Connection to Solana via Helius RPC
const connection = new Connection(
  `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`,
  { commitment: 'confirmed' }
);

const PUMP_FUN_PROGRAM = new PublicKey('675kPX9G2jELzfT5vY26a6qCa3YkoF5qL78xJ6nQozT');

// Parse JSON bodies
app.use(express.json());

// Log every incoming request (helps verify if Helius is hitting the right path)
app.use((req, res, next) => {
  console.log(`➡️ Incoming request: ${req.method} ${req.path}`);
  next();
});

/**
 * Helius Webhook Endpoint
 * Helius should be configured to POST to: `${WEBHOOK_URL}/webhook`
 */
app.post('/webhook', async (req, res) => {
  try {
    const events = req.body;
    console.log('📥 Received Helius webhook payload:', JSON.stringify(events, null, 2));

    if (!events || !Array.isArray(events) || events.length === 0) {
      console.warn('⚠️ No events in Helius webhook');
      return res.status(400).send('No events received');
    }

    // Acknowledge immediately
    res.status(200).send('OK');

    for (const event of events) {
      console.log('🔍 Processing event:', JSON.stringify(event, null, 2));
      if (event.type === 'TOKEN_MINT' || event.programId === PUMP_FUN_PROGRAM.toString()) {
        const tokenAddress = event.tokenMint || event.accounts?.[0];
        console.log('🆕 Detected new token:', tokenAddress);

        if (!tokenAddress) {
          console.warn('⚠️ No token address found in event');
          bot.sendMessage(chatId, '⚠️ No token address in Helius event');
          continue;
        }

        const tokenData = await fetchTokenData(tokenAddress);
        if (!tokenData) {
          console.error('❌ Failed to fetch token data for:', tokenAddress);
          bot.sendMessage(chatId, `⚠️ Failed to fetch data for token: ${tokenAddress}`);
          continue;
        }

        // Decide whether to alert
        const bypassFilters = process.env.BYPASS_FILTERS === 'true';
        if (bypassFilters || checkToken(tokenData)) {
          console.log('✅ Token passed filters, sending Telegram alert:', tokenData);
          sendTokenAlert(chatId, tokenData);
          if (process.env.AUTO_SNIPE === 'true') {
            await autoSnipeToken(tokenData.address);
          }
        } else {
          console.log('❌ Token did not pass filters:', tokenData);
        }
      }
    }
  } catch (error) {
    console.error('❌ Webhook handler error:', error);
    bot.sendMessage(chatId, `❌ Webhook error: ${error.message}`);
    res.status(500).send('Internal Server Error');
  }
});

/**
 * Test Webhook Endpoint
 * Use this to simulate a Helius event
 */
app.post('/test-webhook', async (req, res) => {
  try {
    const mockEvent = {
      type: 'TOKEN_MINT',
      tokenMint: 'TEST_TOKEN_ADDRESS',
      programId: PUMP_FUN_PROGRAM.toString(),
      accounts: ['TEST_TOKEN_ADDRESS']
    };
    console.log('👷‍♂️ Received test webhook:', mockEvent);

    const tokenData = await fetchTokenData(mockEvent.tokenMint);
    if (tokenData) {
      sendTokenAlert(chatId, tokenData);
      console.log('✅ Test alert sent:', tokenData);
      bot.sendMessage(chatId, '✅ Test webhook successful!');
    } else {
      console.warn('⚠️ Test webhook: No token data');
      bot.sendMessage(chatId, '⚠️ Test webhook failed: No token data');
    }

    res.status(200).send('Test webhook processed');
  } catch (error) {
    console.error('❌ Test webhook error:', error);
    bot.sendMessage(chatId, `❌ Test webhook error: ${error.message}`);
    res.status(500).send('Test webhook failed');
  }
});

/**
 * Fetch token data via Helius and on‐chain
 */
async function fetchTokenData(tokenAddress) {
  try {
    const mint = await getMint(connection, new PublicKey(tokenAddress));

    const response = await fetch(
      `https://api.helius.xyz/v0/tokens/metadata?api-key=${HELIUS_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mintAccounts: [tokenAddress] })
      }
    );
    const data = await response.json();
    const metadata = data[0] || {};

    return {
      name: metadata.name || `Token_${tokenAddress.slice(0, 8)}`,
      address: tokenAddress,
      liquidity: metadata.liquidity || 1000,
      marketCap: metadata.marketCap || 1000,
      devHolding: metadata.devHolding || 5,
      poolSupply: metadata.poolSupply || 50,
      launchPrice: metadata.price || 0.000005,
      mintAuthRevoked: metadata.mintAuthorityRevoked || false,
      freezeAuthRevoked: metadata.freezeAuthorityRevoked || false
    };
  } catch (error) {
    console.error('⚠️ Error fetching token data:', error);
    bot.sendMessage(chatId, `⚠️ Error fetching data for ${tokenAddress}: ${error.message}`);
    // fallback mock
    return {
      name: `Token_${tokenAddress.slice(0, 8)}`,
      address: tokenAddress,
      liquidity: 1000,
      marketCap: 1000,
      devHolding: 5,
      poolSupply: 50,
      launchPrice: 0.000005,
      mintAuthRevoked: false,
      freezeAuthRevoked: false
    };
  }
}

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
