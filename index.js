const { BotFrameworkAdapter } = require('botbuilder');
const express = require('express');
const axios = require('axios');
const { BotActivityHandler } = require('./botActivityHandler');
require('dotenv').config();

// Create the adapter
const adapter = new BotFrameworkAdapter({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword,
});

// Error handling
adapter.onTurnError = async (context, error) => {
    console.error('[onTurnError] Unhandled error:', error);
    await context.sendActivity('Oops! Something went wrong. Please try again later.');
};

// Create the bot
const bot = new BotActivityHandler(adapter);

// Set up Express server
const app = express();
app.use(express.json());

// ✅ Lightweight ping endpoint
app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});

// ✅ Optional: existing health endpoint
app.get('/health', (req, res) => {
    res.status(200).send('Bot is healthy and running!');
});

// Endpoint for messages
app.post('/api/messages', (req, res) => {
    adapter.processActivity(req, res, async (context) => {
        try {
            await bot.run(context);
        } catch (error) {
            console.error('Error processing activity:', error);
            res.status(500).send('Internal Server Error');
        }
    });
});

// ✅ Keep-alive ping (self-ping every 5 minutes)
setInterval(() => {
    const botUrl = process.env.KEEP_ALIVE_URL || `zendeskendpoint-cadne9guf2g3bmf6.canadacentral-01.azurewebsites.net/api/messages`;
    axios.get(botUrl)
        .then(() => console.log('✅ Keep-alive ping sent to:', botUrl))
        .catch(err => console.error('❌ Keep-alive ping failed:', err.message));
}, 5 * 60 * 1000); // 5 minutes

// Start the server
const PORT = process.env.PORT || 3978;
app.listen(PORT, () => {
    console.log(`Bot is running on http://localhost:${PORT}`);
});
