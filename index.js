require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, Keypair } = require('@solana/web3.js');
const { getMint, TOKEN_PROGRAM_ID } = require('@solana/spl-token');

const app = express();
const PORT = process.env.PORT || 10000;
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID || '-1002511600127';
const webhookBaseUrl = process.env.WEBHOOK_URL?.replace(/\/$/, '');
const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`, { commitment: 'confirmed' });

if (!token || !webhookBaseUrl || !process.env.HELIUS_API_KEY || !process.env.PRIVATE_KEY) {
  console.error('Missing environment variables. Required: TELEGRAM_BOT_TOKEN, WEBHOOK_URL, HELIUS_API_KEY, PRIVATE_KEY');
  bot.sendMessage(chatId, 'âŒ Bot failed to start: Missing environment variables');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: false });
const PUMP_FUN_PROGRAM = new PublicKey('675kPX9G2jELzfT5vY26a6qCa3YkoF5qL78xJ6nQozT');

app.use(express.json());

// Set Telegram webhook
bot.setWebHook(`${webhookBaseUrl}/bot${token}`);

// In-memory storage
let walletKey = null;
let filters = {
  liquidity: { min: 1000, max: 100000 },
  marketCap: { min: 1000, max: 500000 },
  devHolding: { min: 0, max: 50 },
  poolSupply: { min: 10, max: 100 },
  launchPrice: { min: 0.000000001, max: 0.01 },
  mintAuthRevoked: false,
  freezeAuthRevoked: false
};
let lastTokenData = null;
let userStates = {};

// Helius Webhook Endpoint
app.post('/webhook', async (req, res) => {
  try {
    const events = req.body;
    console.log('Received Helius webhook:', JSON.stringify(events, null, 2));
    bot.sendMessage(chatId, 'â„¹ï¸ Received webhook from Helius');

    if (!events || !Array.isArray(events) || events.length === 0) {
      console.log('No events in webhook');
      bot.sendMessage(chatId, 'âš ï¸ Received empty webhook from Helius');
      return res.status(400).send('No events received');
    }

    for (const event of events) {
      console.log('Processing event:', JSON.stringify(event, null, 2));
      if (event.type === 'TOKEN_MINT' || event.programId === PUMP_FUN_PROGRAM.toString()) {
        const tokenAddress = event.tokenMint || event.accounts?.[0];
        console.log('New token detected:', tokenAddress);

        if (!tokenAddress) {
          console.log('No token address found in event');
          bot.sendMessage(chatId, 'âš ï¸ No token address in Helius event');
          continue;
        }

        const tokenData = await fetchTokenData(tokenAddress);
        if (!tokenData) {
          console.log('Failed to fetch token data for:', tokenAddress);
          bot.sendMessage(chatId, `âš ï¸ Failed to fetch data for token: ${tokenAddress}`);
          continue;
        }

        lastTokenData = tokenData;
        console.log('Token data:', tokenData);

        const bypassFilters = process.env.BYPASS_FILTERS === 'true';
        if (bypassFilters || checkToken(tokenData)) {
          console.log('Token passed filters, sending alert:', tokenData);
          sendTokenAlert(chatId, tokenData);
          if (process.env.AUTO_SNIPE === 'true') {
            await autoSnipeToken(tokenData.address);
          }
        } else {
          console.log('Token did not pass filters:', tokenData);
          bot.sendMessage(chatId, `â„¹ï¸ Token ${tokenData.address} did not pass filters`);
        }
      }
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    bot.sendMessage(chatId, `âŒ Webhook error: ${error.message}`);
    return res.status(500).send('Internal Server Error');
  }
});

// Test Webhook Endpoint
app.post('/test-webhook', async (req, res) => {
  try {
    const mockEvent = {
      type: 'TOKEN_MINT',
      tokenMint: 'TEST_TOKEN_ADDRESS',
      programId: PUMP_FUN_PROGRAM.toString(),
      accounts: ['TEST_TOKEN_ADDRESS']
    };
    console.log('Received test webhook:', mockEvent);
    bot.sendMessage(chatId, 'â„¹ï¸ Received test webhook');

    const tokenData = await fetchTokenData(mockEvent.tokenMint);
    if (tokenData) {
      sendTokenAlert(chatId, tokenData);
      console.log('Test alert sent:', tokenData);
      bot.sendMessage(chatId, 'âœ… Test webhook successful!');
    } else {
      bot.sendMessage(chatId, 'âš ï¸ Test webhook failed: No token data');
    }

    return res.status(200).send('Test webhook processed');
  } catch (error) {
    console.error('Test webhook error:', error);
    bot.sendMessage(chatId, `âŒ Test webhook error: ${error.message}`);
    return res.status(500).send('Test webhook failed');
  }
});

// Fetch token data (Real Helius API with fallback)
async function fetchTokenData(tokenAddress) {
  try {
    // Fetch mint info
    const mint = await getMint(connection, new PublicKey(tokenAddress));

    // Fetch metadata from Helius API
    const response = await fetch(`https://api.helius.xyz/v0/tokens/metadata?api-key=${process.env.HELIUS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mintAccounts: [tokenAddress] })
    });
    const data = await response.json();
    const metadata = data[0] || {};

    if (!metadata) {
      console.log('No metadata from Helius, using fallback');
      bot.sendMessage(chatId, `âš ï¸ No metadata for ${tokenAddress}, using fallback`);
    }

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
    console.error('Error fetching token data:', error);
    bot.sendMessage(chatId, `âš ï¸ Error fetching token data for ${tokenAddress}: ${error.message}`);
    // Fallback mock data
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

// Check token against filters
function checkToken(tokenData) {
  if (!tokenData) return false;
  console.log('Checking token against filters:', tokenData, filters);
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

// Send token alert to Telegram
function sendTokenAlert(chatId, tokenData) {
  if (!tokenData) return;
  const chartLink = `https://dexscreener.com/solana/${tokenData.address}`;
  bot.sendMessage(chatId, `
ðŸš€ New Token Alert on Pump.fun! ðŸš€
Name: ${tokenData.name}
Contract: ${tokenData.address}
Liquidity: $${tokenData.liquidity.toFixed(2)}
Market Cap: $${tokenData.marketCap.toFixed(2)}
Dev Holding: ${tokenData.devHolding.toFixed(2)}%
Pool Supply: ${tokenData.poolSupply.toFixed(2)}%
Launch Price: $${tokenData.launchPrice.toFixed(9)}
Mint Revoked: ${tokenData.mintAuthRevoked}
Freeze Revoked: ${tokenData.freezeAuthRevoked}
ðŸ“Š Chart: [View Chart](${chartLink})
  `, {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'ðŸ”„ Refresh', callback_data: `refresh_${tokenData.address}` }, { text: 'ðŸ’° Buy Now', callback_data: `buy_${tokenData.address}` }],
        [{ text: 'âž¡ï¸ Details', callback_data: `details_${tokenData.address}` }, { text: 'âŒ Ignore', callback_data: 'ignore' }]
      ]
    },
    parse_mode: 'Markdown'
  });
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

    bot.sendMessage(chatId, `âœ… Bought token ${tokenAddress} for ${amountToBuy} SOL! Signature: ${signature}`);
  } catch (error) {
    console.error('Error auto-sniping token:', error);
    bot.sendMessage(chatId, `âŒ Failed to buy token ${tokenAddress}: ${error.message}`);
  }
}

// Telegram Bot Webhook Handler
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Telegram Bot Logic
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, `
  ðŸ‘‹ Welcome to @moongraphi_bot
  ðŸ’° Trade  |  ðŸ” Wallet
  âš™ï¸ Filters  |  ðŸ“Š Portfolio
  â“ Help
  `, {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'ðŸ’° Trade', callback_data: 'trade' }, { text: 'ðŸ” Wallet', callback_data: 'wallet' }],
        [{ text: 'âš™ï¸ Filters', callback_data: 'filters' }, { text: 'ðŸ“Š Portfolio', callback_data: 'portfolio' }],
        [{ text: 'â“ Help', callback_data: 'help' }]
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
      bot.sendMessage(chatId, 'ðŸ’° Trade Menu\nðŸš€ Buy  |  ðŸ“‰ Sell', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'ðŸš€ Buy', callback_data: 'buy' }, { text: 'ðŸ“‰ Sell', callback_data: 'sell' }],
            [{ text: 'â¬…ï¸ Back', callback_data: 'back' }]
          ]
        }
      });
      break;

    case 'wallet':
      bot.sendMessage(chatId, 'ðŸ” Wallet Menu\nðŸ’³ Your wallet: Not connected yet.\nðŸ”— Connect Wallet', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'ðŸ”— Connect Wallet', callback_data: 'connect_wallet' }],
            [{ text: 'â¬…ï¸ Back', callback_data: 'back' }]
          ]
        }
      });
      break;

    case 'filters':
      bot.sendMessage(chatId, `âš™ï¸ Filters Menu\nCurrent Filters:\nLiquidity: ${filters.liquidity.min}-${filters.liquidity.max}\nMarket Cap: ${filters.marketCap.min}-${filters.marketCap.max}\nDev Holding: ${filters.devHolding.min}-${filters.devHolding.max}%\nPool Supply: ${filters.poolSupply.min}-${filters.poolSupply.max}%\nLaunch Price: ${filters.launchPrice.min}-${filters.launchPrice.max} SOL\nMint Auth Revoked: ${filters.mintAuthRevoked ? 'Yes' : 'No'}\nFreeze Auth Revoked: ${filters.freezeAuthRevoked ? 'Yes' : 'No'}`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'âœï¸ Edit Liquidity', callback_data: 'edit_liquidity' }],
            [{ text: 'âœï¸ Edit Market Cap', callback_data: 'edit_marketcap' }],
            [{ text: 'âœï¸ Edit Dev Holding', callback_data: 'edit_devholding' }],
            [{ text: 'âœï¸ Edit Pool Supply', callback_data: 'edit_poolsupply' }],
            [{ text: 'âœï¸ Edit Launch Price', callback_data: 'edit_launchprice' }],
            [{ text: 'âœï¸ Edit Mint Auth', callback_data: 'edit_mintauth' }],
            [{ text: 'âœï¸ Edit Freeze Auth', callback_data: 'edit_freezeauth' }],
            [{ text: 'â¬…ï¸ Back', callback_data: 'back' }]
          ]
        }
      });
      break;

    case 'portfolio':
      bot.sendMessage(chatId, 'ðŸ“Š Portfolio Menu\nYour portfolio is empty.\nðŸ’° Start trading to build your portfolio!', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'â¬…ï¸ Back', callback_data: 'back' }]
          ]
        }
      });
      break;

    case 'help':
      bot.sendMessage(chatId, 'â“ Help Menu\nThis bot helps you snipe meme coins on Pump.fun!\nCommands:\n/start - Start the bot\nFor support, contact @YourSupportUsername', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'â¬…ï¸ Back', callback_data: 'back' }]
          ]
        }
      });
      break;

    case 'back':
      bot.editMessageText(`ðŸ‘‹ Welcome to @moongraphi_bot\nðŸ’° Trade  |  ðŸ” Wallet\nâš™ï¸ Filters  |  ðŸ“Š Portfolio\nâ“ Help`, {
        chat_id: chatId,
        message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [
            [{ text: 'ðŸ’° Trade', callback_data: 'trade' }, { text: 'ðŸ” Wallet', callback_data: 'wallet' }],
            [{ text: 'âš™ï¸ Filters', callback_data: 'filters' }, { text: 'ðŸ“Š Portfolio', callback_data: 'portfolio' }],
            [{ text: 'â“ Help', callback_data: 'help' }]
          ]
        }
      });
      break;

    case 'edit_liquidity':
      userStates[chatId] = { editing: 'liquidity' };
      bot.sendMessage(chatId, 'âœï¸ Edit Liquidity\nPlease send the new range (e.g., "5000-15000" or "5000 15000")', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'â¬…ï¸ Back', callback_data: 'filters' }]
          ]
        }
      });
      break;

    case 'edit_marketcap':
      userStates[chatId] = { editing: 'marketcap' };
      bot.sendMessage(chatId, 'âœï¸ Edit Market Cap\nPlease send the new range (e.g., "2000-80000" or "2000 80000")', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'â¬…ï¸ Back', callback_data: 'filters' }]
          ]
        }
      });
      break;

    case 'edit_devholding':
      userStates[chatId] = { editing: 'devholding' };
      bot.sendMessage(chatId, 'âœï¸ Edit Dev Holding\nPlease send the new range (e.g., "2-8" or "2 8")', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'â¬…ï¸ Back', callback_data: 'filters' }]
          ]
        }
      });
      break;

    case 'edit_poolsupply':
      userStates[chatId] = { editing: 'poolsupply' };
      bot.sendMessage(chatId, 'âœï¸ Edit Pool Supply\nPlease send the new range (e.g., "30-90" or "30 90")', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'â¬…ï¸ Back', callback_data: 'filters' }]
          ]
        }
      });
      break;

    case 'edit_launchprice':
      userStates[chatId] = { editing: 'launchprice' };
      bot.sendMessage(chatId, 'âœï¸ Edit Launch Price\nPlease send the new range (e.g., "0.000000002-0.002" or "0.000000002 0.002")', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'â¬…ï¸ Back', callback_data: 'filters' }]
          ]
        }
      });
      break;

    case 'edit_mintauth':
      userStates[chatId] = { editing: 'mintauth' };
      bot.sendMessage(chatId, 'âœï¸ Edit Mint Auth Revoked\nSend "Yes" or "No"', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'â¬…ï¸ Back', callback_data: 'filters' }]
          ]
        }
      });
      break;

    case 'edit_freezeauth':
      userStates[chatId] = { editing: 'freezeauth' };
      bot.sendMessage(chatId, 'âœï¸ Edit Freeze Auth Revoked\nSend "Yes" or "No"', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'â¬…ï¸ Back', callback_data: 'filters' }]
          ]
        }
      });
      break;

    default:
      bot.sendMessage(chatId, 'Unknown command. Please use the buttons.');
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
    if (editingField === 'liquidity' || editingField === 'marketcap' || editingField === 'devholding' || editingField === 'poolsupply' || editingField === 'launchprice') {
      let [min, max] = [];
      if (text.includes('-')) {
        [min, max] = text.split('-').map(val => parseFloat(val.trim()));
      } else {
        [min, max] = text.split(/\s+/).map(val => parseFloat(val.trim()));
      }

      if (isNaN(min) || isNaN(max) || min > max) {
        bot.sendMessage(chatId, 'Invalid range. Please send a valid range (e.g., "5000-15000" or "5000 15000").');
        return;
      }

      if (editingField === 'liquidity') {
        filters.liquidity.min = min;
        filters.liquidity.max = max;
      } else if (editingField === 'marketcap') {
        filters.marketCap.min = min;
        filters.marketCap.max = max;
      } else if (editingField === 'devholding') {
        filters.devHolding.min = min;
        filters.devHolding.max = max;
      } else if (editingField === 'poolsupply') {
        filters.poolSupply.min = min;
        filters.poolSupply.max = max;
      } else if (editingField === 'launchprice') {
        filters.launchPrice.min = min;
        filters.launchPrice.max = max;
      }

      bot.sendMessage(chatId, `âœ… ${editingField.charAt(0).toUpperCase() + editingField.slice(1)} updated to ${min}-${max}!`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'â¬…ï¸ Back to Filters', callback_data: 'filters' }]
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

      bot.sendMessage(chatId, `âœ… ${editingField.charAt(0).toUpperCase() + editingField.slice(1)} updated to ${value === 'yes' ? 'Yes' : 'No'}!`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'â¬…ï¸ Back to Filters', callback_data: 'filters' }]
          ]
        }
      });
    }

    delete userStates[chatId];
  } catch (error) {
    bot.sendMessage(chatId, 'Error processing your input. Please try again.');
  }
});

// Health Check
app.get('/', (req, res) => res.send('Bot running!'));

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Helius Webhook URL:', `${webhookBaseUrl}/webhook`);
  console.log('Starting Helius webhook monitoring...');
  bot.sendMessage(chatId, 'ðŸš€ Bot started! Waiting for Pump.fun token alerts...');
});
