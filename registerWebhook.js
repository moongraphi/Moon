const axios = require("axios");

const apiKey = "2922185d-63a2-429b-b209-e98d75c3aaaa";
const webhookURL = "https://moon-ovgg.onrender.com/webhook";

const data = {
  webhookURL: webhookURL,
  transactionTypes: ["ALL"],
  webhookType: "enhanced",
  accountAddresses: []
};

axios
  .post(`https://api.helius.xyz/v0/webhooks?api-key=${apiKey}`, data, {
    headers: { "Content-Type": "application/json" },
  })
  .then((res) => {
    console.log("Webhook Registered:", res.data);
  })
  .catch((err) => {
    console.error("Error Registering Webhook:", err.response?.data || err.message);
  });
