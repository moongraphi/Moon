require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, Keypair } = require('@solana/web3.js');
const { getMint, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const { checkNewTokens } = require('./Alert.function');
const { extractTokenInfo, checkAgainstFilters, formatTokenMessage } = require('./Helper.function');

const app = express();
const PORT = process.env.PORT || 10000;
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID || '-1002511600127';
const webhookBaseUrl = process.env.WEBHOOK_URL?.replace(/\/$/, ''); // Remove trailing slash if any
const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`, { commitment: 'confirmed' });

if (!token || !webhookBaseUrl || !process.env.HELIUS_API_KEY || !process.env.PRIVATE_KEY) {
  console.error('Missing environment variables. Required: TELEGRAM_BOT_TOKEN, WEBHOOK_URL, HELIUS_API_KEY, PRIVATE_KEY');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: false });
const PUMP_FUN_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

app.use(express.json());

// Set Telegram webhook
bot.setWebHook(`${webhookBaseUrl}/bot${token}`);

// In-memory storage
let filters = {
  liquidity: { min: 4000, max: 25000 },
  poolSupply: { min: 60, max: 95 },
  devHolding: { min: 2, max: 10 },
  launchPrice: { min: 0.0000000022, max: 0.0000000058 },
  mintAuthRevoked: false,
  freezeAuthRevoked: false
};
let lastTokenData = null;
let userStates = {};

// Helius Webhook Endpoint
app.post('/webhook', async (req, res) => {
  try {
    const events = req.body;
    console.log('Webhook received, type:', events.type, 'data:', JSON.stringify(events, null, 2));
    bot.sendMessage(chatId, 'ℹ️ Received webhook from Helius');

    if (!events || !Array.isArray(events) || events.length === 0) {
      console.log('No events in webhook');
      bot.sendMessage(chatId, '⚠️ Received empty webhook from Helius');
      return res.status(400).send('No events received');
    }

    for (const event of events) {
      console.log('Processing event (detailed):', JSON.stringify(event, null, 2));
      console.log('Program ID from event:', event.programId); // Debug log
      console.log('Accounts from event:', event.accounts); // Debug log
      if (event.type === 'CREATE') {
        let tokenAddress = event.tokenMint || event.accounts?.[0] || event.signature;
        console.log('Extracted token address:', tokenAddress);

        if (!tokenAddress) {
          console.log('No token address found in event, trying to extract:', JSON.stringify(event));
          bot.sendMessage(chatId, `⚠️ No token address found in event: ${JSON.stringify(event)}`);
          continue;
        }

        // Improved check for Pump.fun program ID
        if (event.programId === PUMP_FUN_PROGRAM.toString() || (event.accounts && event.accounts.some(acc => acc === PUMP_FUN_PROGRAM.toString()))) {
          const tokenData = await extractTokenInfo(event);
          if (!tokenData) {
            console.log('Failed to fetch token data for:', tokenAddress);
            bot.sendMessage(chatId, `⚠️ Failed to fetch data for token: ${tokenAddress}`);
            continue;
          }

          lastTokenData = tokenData;
          console.log('Token data:', tokenData);

          const bypassFilters = process.env.BYPASS_FILTERS === 'true';
          if (bypassFilters || checkAgainstFilters(tokenData, filters)) {
            console.log('Token passed filters, sending alert:', tokenData);
            sendTokenAlert(chatId, tokenData);
            if (process.env.AUTO_SNIPE === 'true') {
              await autoSnipeToken(tokenData.address);
            }
          } else {
            console.log('Token did not pass filters:', tokenData);
            bot.sendMessage(chatId, `ℹ️ Token ${tokenData.address} did not pass filters`);
          }
        } else {
          console.log('Event not from Pump.fun, ignored. Program ID check failed:', {
            eventProgramId: event.programId,
            pumpFunProgram: PUMP_FUN_PROGRAM.toString(),
            accounts: event.accounts
          });
        }
      } else {
        console.log('Event type ignored (not CREATE):', JSON.stringify(event));
      }
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    bot.sendMessage(chatId, `❌ Webhook error: ${error.message}`);
    return res.status(500).send('Internal Server Error');
  }
});

// Test Webhook Endpoint
app.post('/test-webhook', async (req, res) => {
  try {
    const mockEvent = {
      type: 'CREATE',
      tokenMint: 'TEST_TOKEN_ADDRESS',
      programId: PUMP_FUN_PROGRAM.toString(),
      accounts: ['TEST_TOKEN_ADDRESS']
    };
    console.log('Received test webhook:', JSON.stringify(mockEvent, null, 2));
    bot.sendMessage(chatId, 'ℹ️ Received test webhook');

    const tokenData = await extractTokenInfo(mockEvent);
    if (tokenData) {
      sendTokenAlert(chatId, tokenData);
      console.log('Test alert sent:', tokenData);
      bot.sendMessage(chatId, '✅ Test webhook successful!');
    } else {
      bot.sendMessage(chatId, '⚠️ Test webhook failed: No token data');
    }

    return res.status(200).send('Test webhook processed');
  } catch (error) {
    console.error('Test webhook error:', error);
    bot.sendMessage(chatId, `❌ Test webhook error: ${error.message}`);
    return res.status(500).send('Test webhook failed');
  }
});

// Fetch token data (Real Helius API with fallback) - Moved to Helper.function
function sendTokenAlert(chatId, tokenData) {
  if (!tokenData) return;
  const chartLink = `https://dexscreener.com/solana/${tokenData.address}`;
  bot.sendMessage(chatId, formatTokenMessage(tokenData), { parse_mode: 'Markdown' });
}

// Auto-Snipe Logic (Placeholder)
async function autoSnipeToken(tokenAddress) {
  try {
    const wallet = Keypair.fromSecretKey(Buffer.from(process.env.PRIVATE_KEY, 'base64'));
    const amountToBuy = 0.1;

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: new PublicKey(tokenAddress),
        lamports: amountToBuy * 1e9
      })
    );

    const signature = await sendAndConfirmTransaction(connection, transaction, [wallet]);
    console.log(`Bought token ${tokenAddress} with signature ${signature}`);

    bot.sendMessage(chatId, `✅ Bought token ${tokenAddress} for ${amountToBuy} SOL! Signature: ${signature}`);
  } catch (error) {
    console.error('Error auto-sniping token:', error);
    bot.sendMessage(chatId, `❌ Failed to buy token ${tokenAddress}: ${error.message}`);
  }
}

// Telegram Bot Webhook Handler
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Telegram Bot Logic
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, `👋 Welcome to @moongraphi_bot
💰 Trade  |  🔐 Wallet
⚙️ Filters  |  📊 Portfolio
❓ Help`, {
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
  const chatId = msg.chat.id;

  bot.answerCallbackQuery(callbackQuery.id);

  switch (data) {
    case 'trade':
      bot.sendMessage(chatId, '💰 Trade Menu\n🚀 Buy  |  📉 Sell', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Buy', callback_data: 'buy' }, { text: '📉 Sell', callback_data: 'sell' }],
            [{ text: '⬅️ Back', callback_data: 'back' }]
          ]
        }
      });
      break;

    case 'wallet':
      bot.sendMessage(chatId, '🔐 Wallet Menu\n💳 Your wallet: Not connected yet.\n🔗 Connect Wallet', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔗 Connect Wallet', callback_data: 'connect_wallet' }],
            [{ text: '⬅️ Back', callback_data: 'back' }]
          ]
        }
      });
      break;

    case 'filters':
      bot.sendMessage(chatId, `⚙️ Filters Menu\nCurrent Filters:\nLiquidity: ${filters.liquidity.min}-${filters.liquidity.max}\nPool Supply: ${filters.poolSupply.min}-${filters.poolSupply.max}%\nDev Holding: ${filters.devHolding.min}-${filters.devHolding.max}%\nLaunch Price: ${filters.launchPrice.min}-${filters.launchPrice.max} SOL\nMint Auth Revoked: ${filters.mintAuthRevoked ? 'Yes' : 'No'}\nFreeze Auth Revoked: ${filters.freezeAuthRevoked ? 'Yes' : 'No'}`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✏️ Edit Liquidity', callback_data: 'edit_liquidity' }],
            [{ text: '✏️ Edit Pool Supply', callback_data: 'edit_poolsupply' }],
            [{ text: '✏️ Edit Dev Holding', callback_data: 'edit_devholding' }],
            [{ text: '✏️ Edit Launch Price', callback_data: 'edit_launchprice' }],
            [{ text: '✏️ Edit Mint Auth', callback_data: 'edit_mintauth' }],
            [{ text: '✏️ Edit Freeze Auth', callback_data: 'edit_freezeauth' }],
            [{ text: '⬅️ Back', callback_data: 'back' }]
          ]
        }
      });
      break;

    case 'portfolio':
      bot.sendMessage(chatId, '📊 Portfolio Menu\nYour portfolio is empty.\n💰 Start trading to build your portfolio!', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'back' }]
          ]
        }
      });
      break;

    case 'help':
      bot.sendMessage(chatId, '❓ Help Menu\nThis bot helps you snipe meme coins on Pump.fun!\nCommands:\n/start - Start the bot\nFor support, contact @YourSupportUsername', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'back' }]
          ]
        }
      });
      break;

    case 'back':
      bot.editMessageText(`👋 Welcome to @moongraphi_bot\n💰 Trade  |  🔐 Wallet\n⚙️ Filters  |  📊 Portfolio\n❓ Help`, {
        chat_id: chatId,
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

    case 'edit_liquidity':
      userStates[chatId] = { editing: 'liquidity' };
      bot.sendMessage(chatId, '✏️ Edit Liquidity\nPlease send the new range (e.g., "4000-25000" or "4000 25000")', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'filters' }]
          ]
        }
      });
      break;

    case 'edit_poolsupply':
      userStates[chatId] = { editing: 'poolsupply' };
      bot.sendMessage(chatId, '✏️ Edit Pool Supply\nPlease send the new range (e.g., "60-95" or "60 95")', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'filters' }]
          ]
        }
      });
      break;

    case 'edit_devholding':
      userStates[chatId] = { editing: 'devholding' };
      bot.sendMessage(chatId, '✏️ Edit Dev Holding\nPlease send the new range (e.g., "2-10" or "2 10")', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'filters' }]
          ]
        }
      });
      break;

    case 'edit_launchprice':
      userStates[chatId] = { editing: 'launchprice' };
      bot.sendMessage(chatId, '✏️ Edit Launch Price\nPlease send the new range (e.g., "0.0000000022-0.0000000058" or "0.0000000022 0.0000000058")', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'filters' }]
          ]
        }
      });
      break;

    case 'edit_mintauth':
      userStates[chatId] = { editing: 'mintauth' };
      bot.sendMessage(chatId, '✏️ Edit Mint Auth Revoked\nSend "Yes" or "No"', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'filters' }]
          ]
        }
      });
      break;

    case 'edit_freezeauth':
      userStates[chatId] = { editing: 'freezeauth' };
      bot.sendMessage(chatId, '✏️ Edit Freeze Auth Revoked\nSend "Yes" or "No"', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'filters' }]
          ]
        }
      });
      break;

    default:
      bot.sendMessage(chatId, 'Unknown command. Please use the buttons');
  }
});

// Handle user input for filter changes
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text.startsWith('/')) return;

  if (!userStates[chatId] || !userStates[chatId].editing) return;

  const editingField = userStates[chatId].editing;

  try {
    if (editingField === 'liquidity' || editingField === 'poolsupply' || editingField === 'devholding' || editingField === 'launchprice') {
      let [min, max] = [];
      if (text.includes('-')) {
        [min, max] = text.split('-').map(val => parseFloat(val.trim()));
      } else {
        [min, max] = text.split(/\s+/).map(val => parseFloat(val.trim()));
      }

      if (isNaN(min) || isNaN(max) || min > max) {
        bot.sendMessage(chatId, 'Invalid range. Please send a valid range (e.g., "4000-25000" or "4000 25000").');
        return;
      }

      if (editingField === 'liquidity') {
        filters.liquidity.min = min;
        filters.liquidity.max = max;
      } else if (editingField === 'poolsupply') {
        filters.poolSupply.min = min;
        filters.poolSupply.max = max;
      } else if (editingField === 'devholding') {
        filters.devHolding.min = min;
        filters.devHolding.max = max;
      } else if (editingField === 'launchprice') {
        filters.launchPrice.min = min;
        filters.launchPrice.max = max;
      }

      bot.sendMessage(chatId, `✅ ${editingField.charAt(0).toUpperCase() + editingField.slice(1)} updated to ${min}-${max}!`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back to Filters', callback_data: 'filters' }]
          ]
        }
      });
    } else if (editingField === 'mintauth' || editingField === 'freezeauth') {
      const value = text.trim().toLowerCase();
      if (value !== 'yes' && value !== 'no') {
        bot.sendMessage(chatId, 'Invalid input. Please send "Yes" or "No".');
        return;
      }

      const boolValue = value === 'yes';
      if (editingField === 'mintauth') {
        filters.mintAuthRevoked = boolValue;
      } else if (editingField === 'freezeauth') {
        filters.freezeAuthRevoked = boolValue;
      }

      bot.sendMessage(chatId, `✅ ${editingField.charAt(0).toUpperCase() + editingField.slice(1)} updated to ${value === 'yes' ? 'Yes' : 'No'}!`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back to Filters', callback_data: 'filters' }]
          ]
        }
      });
    }

    delete userStates[chatId];
  } catch (error) {
    bot.sendMessage(chatId, 'Error processing your input. Please try again.');
  }
});

// Start periodic token checking
setInterval(() => checkNewTokens(bot, chatId, PUMP_FUN_PROGRAM, filters), 10000);

// Health Check
app.get('/', (req, res) => res.send('Bot running!'));

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  const heliusWebhookUrl = webhookBaseUrl.endsWith('/webhook') ? webhookBaseUrl : `${webhookBaseUrl}/webhook`;
  console.log('Helius Webhook URL:', heliusWebhookUrl);
  console.log('Starting Helius webhook and periodic monitoring...');
  bot.sendMessage(chatId, '🚀 Bot started! Waiting for Pump.fun token alerts...');
});
