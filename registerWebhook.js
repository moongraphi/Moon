const axios = require("axios");
require("dotenv").config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // e.g., https://moon-ovgg.onrender.com

const registerWebhook = async () => {
  try {
    console.log("Setting Telegram webhook with URL:", WEBHOOK_URL); // Debug log
    const response = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
      {
        params: {
          url: WEBHOOK_URL
        }
      }
    );

    console.log("Webhook set:", response.data);
  } catch (error) {
    console.error("Error Registering Webhook:", error.response?.data || error);
  }
};

registerWebhook();
