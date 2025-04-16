const axios = require("axios");
require("dotenv").config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // e.g., your Render domain with https

const registerWebhook = async () => {
  try {
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
