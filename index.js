const { BotFrameworkAdapter } = require('botbuilder');
const restify = require('restify');
require('dotenv').config(); // Load environment variables from .env file

// Create adapter
const adapter = new BotFrameworkAdapter({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword,
});

// Error handling for the adapter
adapter.onTurnError = async (context, error) => {
    console.error('Bot error:', error);
    await context.sendActivity('Oops! Something went wrong. Please try again later.');
};

// Create server
const server = restify.createServer();
server.listen(process.env.PORT || 3978, () => {
    console.log(`Bot is running on http://localhost:${process.env.PORT || 3978}`);
});

// Listen for incoming requests
server.post('/api/messages', async (req, res) => {
    try {
        await adapter.processActivity(req, res, async (context) => {
            await context.sendActivity('Hello from your bot!');
        });
    } catch (error) {
        console.error('Error processing activity:', error);
        res.status(500).send('Internal Server Error');
    }
});