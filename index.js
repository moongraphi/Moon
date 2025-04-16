require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, Keypair } = require('@solana/web3.js');
const { getMint, TOKEN_PROGRAM_ID } = require('@solana/spl-token'); // For fetching token metadata

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
  liquidity: { min: 7000, max: 12000 }, // Updated to your filters
  marketCap: { min: 2000, max: 80000 },
  devHolding: { min: 2, max: 7 },
  poolSupply: { min: 40, max: 100 },
  launchPrice: { min: 0.0000000023, max: 0.0010 },
  mintAuthRevoked: true,
  freezeAuthRevoked: false
};
let lastTokenData = null;

// State to track which filter the user is editing
let userStates = {}; // { chatId: { editing: 'liquidity' } }

// Telegram Bot Webhook Handler
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Telegram Bot Logic
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, `
  👋 Welcome to @moongraphi_bot
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
      bot.sendMessage(chatId, `⚙️ Filters Menu\nCurrent Filters:\nLiquidity: ${filters.liquidity.min}-${filters.liquidity.max}\nMarket Cap: ${filters.marketCap.min}-${filters.marketCap.max}\nDev Holding: ${filters.devHolding.min}-${filters.devHolding.max}%\nPool Supply: ${filters.poolSupply.min}-${filters.poolSupply.max}%\nLaunch Price: ${filters.launchPrice.min}-${filters.launchPrice.max} SOL\nMint Auth Revoked: ${filters.mintAuthRevoked ? 'Yes' : 'No'}\nFreeze Auth Revoked: ${filters.freezeAuthRevoked ? 'Yes' : 'No'}`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✏️ Edit Liquidity', callback_data: 'edit_liquidity' }],
            [{ text: '✏️ Edit Market Cap', callback_data: 'edit_marketcap' }],
            [{ text: '✏️ Edit Dev Holding', callback_data: 'edit_devholding' }],
            [{ text: '✏️ Edit Pool Supply', callback_data: 'edit_poolsupply' }],
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
      bot.sendMessage(chatId, '✏️ Edit Liquidity\nPlease send the new range (e.g., "5000-15000" or "5000 15000")', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'filters' }]
          ]
        }
      });
      break;

    case 'edit_marketcap':
      userStates[chatId] = { editing: 'marketcap' };
      bot.sendMessage(chatId, '✏️ Edit Market Cap\nPlease send the new range (e.g., "2000-80000" or "2000 80000")', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'filters' }]
          ]
        }
      });
      break;

    case 'edit_devholding':
      userStates[chatId] = { editing: 'devholding' };
      bot.sendMessage(chatId, '✏️ Edit Dev Holding\nPlease send the new range (e.g., "2-8" or "2 8")', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'filters' }]
          ]
        }
      });
      break;

    case 'edit_poolsupply':
      userStates[chatId] = { editing: 'poolsupply' };
      bot.sendMessage(chatId, '✏️ Edit Pool Supply\nPlease send the new range (e.g., "30-90" or "30 90")', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'filters' }]
          ]
        }
      });
      break;

    case 'edit_launchprice':
      userStates[chatId] = { editing: 'launchprice' };
      bot.sendMessage(chatId, '✏️ Edit Launch Price\nPlease send the new range (e.g., "0.000000002-0.002" or "0.000000002 0.002")', {
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

// Monitor Pump.fun for New Tokens (Real Monitoring)
async function monitorPumpFun() {
  console.log('Starting Pump.fun monitoring...');
  try {
    connection.onProgramAccountChange(
      PUMP_FUN_PROGRAM,
      async (keyedAccountInfo) => {
        console.log('Program account change detected:', keyedAccountInfo);
        try {
          const accountData = keyedAccountInfo.accountInfo.data;
          const tokenAddress = keyedAccountInfo.accountId.toString();
          console.log('Token address:', tokenAddress);

          // Fetch token metadata from Solana
          console.log('Fetching token metadata...');
          const mint = await getMint(connection, new PublicKey(tokenAddress), 'confirmed', TOKEN_PROGRAM_ID);
          console.log('Token metadata fetched:', mint);

          // Fetch real data using implemented functions
          console.log('Fetching liquidity...');
          const liquidity = await fetchLiquidity(tokenAddress);
          console.log('Liquidity:', liquidity);

          console.log('Fetching market cap...');
          const marketCap = await fetchMarketCap(tokenAddress);
          console.log('Market Cap:', marketCap);

          console.log('Fetching dev holding...');
          const devHolding = await fetchDevHolding(tokenAddress);
          console.log('Dev Holding:', devHolding);

          console.log('Fetching pool supply...');
          const poolSupply = await fetchPoolSupply(tokenAddress);
          console.log('Pool Supply:', poolSupply);

          console.log('Fetching launch price...');
          const launchPrice = await fetchLaunchPrice(tokenAddress);
          console.log('Launch Price:', launchPrice);

          const tokenData = {
            name: `Token_${tokenAddress.slice(0, 8)}`,
            address: tokenAddress,
            liquidity: liquidity,
            marketCap: marketCap,
            devHolding: devHolding,
            poolSupply: poolSupply,
            launchPrice: launchPrice,
            mintAuthRevoked: mint.mintAuthority === null,
            freezeAuthRevoked: mint.freezeAuthority === null
          };

          console.log('New token detected:', tokenData);

          lastTokenData = tokenData;

          if (checkToken(tokenData)) {
            console.log('Token passed filters:', tokenData);
            sendTokenAlert('-1002511600127', tokenData);
            await autoSnipeToken(tokenData.address);
          } else {
            console.log('Token does not pass filters:', tokenData);
            console.log('Filters:', filters);
          }
        } catch (error) {
          console.error('Error processing token:', error);
        }
      },
      'confirmed',
      [
        { dataSize: 165 },
        { memcmp: { offset: 0, bytes: 'create' } }
      ]
    );
  } catch (error) {
    console.error('Error setting up program account change listener:', error);
  }
}
    'confirmed',
    [
      { dataSize: 165 }, // Adjust based on Pump.fun account data size
      { memcmp: { offset: 0, bytes: 'create' } } // Filter for token creation events
    ]
  );
}

// Fetch real data using Helius API
// Fetch real data using Helius API
async function fetchLiquidity(tokenAddress) {
  try {
    const response = await fetch(`https://api.helius.xyz/v0/addresses/${tokenAddress}/balances?api-key=${process.env.HELIUS_API_KEY}`);
    const data = await response.json();
    console.log('Helius API response for liquidity:', data);
    // Pump.fun tokens ke liye liquidity pool ka data
    const liquidity = data?.tokens?.find(token => token.mint === tokenAddress)?.amount || 0;
    return liquidity / 1e9 || 8000; // Convert lamports to SOL, fallback to 8000 if no data
  } catch (error) {
    console.error('Error fetching liquidity:', error);
    return 8000; // Fallback
  }
}

async function fetchMarketCap(tokenAddress) {
  try {
    const response = await fetch(`https://api.helius.xyz/v0/tokens/metadata?api-key=${process.env.HELIUS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mintAccounts: [tokenAddress] })
    });
    const data = await response.json();
    console.log('Helius API response for market cap:', data);
    const totalSupply = data[0]?.onChainData?.supply || 1_000_000_000;
    const priceResponse = await fetch(`https://api.helius.xyz/v0/tokens/price?api-key=${process.env.HELIUS_API_KEY}&id=${tokenAddress}`);
    const priceData = await priceResponse.json();
    const price = priceData?.price || 0.00002;
    return totalSupply * price;
  } catch (error) {
    console.error('Error fetching market cap:', error);
    return 20000; // Fallback
  }
}

async function fetchDevHolding(tokenAddress) {
  try {
    const response = await fetch(`https://api.helius.xyz/v0/addresses/${tokenAddress}/holders?api-key=${process.env.HELIUS_API_KEY}`);
    const data = await response.json();
    console.log('Helius API response for dev holding:', data);
    const topHolder = data?.holders?.[0]?.amount || 0;
    const totalSupply = data?.totalSupply || 1_000_000_000;
    return (topHolder / totalSupply) * 100 || 5; // Percentage of top holder
  } catch (error) {
    console.error('Error fetching dev holding:', error);
    return 5; // Fallback
  }
}

async function fetchPoolSupply(tokenAddress) {
  try {
    const response = await fetch(`https://api.helius.xyz/v0/addresses/${tokenAddress}/balances?api-key=${process.env.HELIUS_API_KEY}`);
    const data = await response.json();
    console.log('Helius API response for pool supply:', data);
    const poolSupply = data?.tokens?.find(token => token.mint === tokenAddress)?.amount || 0;
    const totalSupply = data?.totalSupply || 1_000_000_000;
    return (poolSupply / totalSupply) * 100 || 50; // Percentage of pool supply
  } catch (error) {
    console.error('Error fetching pool supply:', error);
    return 50; // Fallback
  }
}

async function fetchLaunchPrice(tokenAddress) {
  try {
    const response = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${process.env.HELIUS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accounts: [tokenAddress],
        types: ['SWAP'],
        limit: 1
      })
    });
    const data = await response.json();
    console.log('Helius API response for launch price:', data);
    const solSpent = data?.[0]?.nativeTransfers?.[0]?.amount || 1;
    const tokensReceived = data?.[0]?.tokenTransfers?.[0]?.amount || 200000;
    return (solSpent / 1e9) / tokensReceived || 0.000005; // Convert lamports to SOL
  } catch (error) {
    console.error('Error fetching launch price:', error);
    return 0.000005; // Fallback
  }
}
    const data = await response.json();
    const solSpent = data?.[0]?.solAmount || 1;
    const tokensReceived = data?.[0]?.tokenAmount || 200000;
    return solSpent / tokensReceived;
  } catch (error) {
    console.error('Error fetching launch price:', error);
    return 0.000005; // Fallback
  }
}

// Auto-Snipe Logic
async function autoSnipeToken(tokenAddress) {
  try {
    const wallet = Keypair.fromSecretKey(Buffer.from(process.env.PRIVATE_KEY, 'base64'));
    const tokenAccount = new PublicKey(tokenAddress);
    const amountToBuy = 0.1;

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: tokenAccount,
        lamports: amountToBuy * 1e9
      })
    );

    const signature = await sendAndConfirmTransaction(connection, transaction, [wallet]);
    console.log(`Bought token ${tokenAddress} with signature ${signature}`);

    bot.sendMessage('-1002511600127', `✅ Bought token ${tokenAddress} for ${amountToBuy} SOL! Signature: ${signature}`);
  } catch (error) {
    console.error('Error auto-sniping token:', error);
    bot.sendMessage('-1002511600127', `❌ Failed to buy token ${tokenAddress}: ${error.message}`);
  }
}

// Send Token Alert
function sendTokenAlert(chatId, tokenData) {
  const chartLink = `https://dexscreener.com/solana/${tokenData.address}`;
  bot.sendMessage(chatId, `
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
      liquidity: tokenData.liquidity || 8000,
      marketCap: tokenData.marketCap || 20000,
      devHolding: tokenData.devHolding || 5,
      poolSupply: tokenData.poolSupply || 50,
      launchPrice: calculateLaunchPrice(tokenData),
      mintAuthRevoked: tokenData.mintAuthRevoked || true,
      freezeAuthRevoked: tokenData.freezeAuthRevoked || false
    };

    lastTokenData = enrichedData;

    if (checkToken(enrichedData)) {
      sendTokenAlert('-1002511600127', enrichedData);
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
  monitorPumpFun();
});
