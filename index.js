const { BotFrameworkAdapter } = require('botbuilder');
const express = require('express');
const { BotActivityHandler } = require('./botActivityHandler');

// Load environment variables
require('dotenv').config();

// Create the adapter
const adapter = new BotFrameworkAdapter({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword,
});

// Error handling for the adapter
adapter.onTurnError = async (context, error) => {
    console.error('[onTurnError] Unhandled error:', error);

    // Send a message to the user
    await context.sendActivity('Oops! Something went wrong. Please try again later.');

    // Log the error and clear the conversation state (if applicable)
    console.error('Full error details:', JSON.stringify(error, null, 2));
};

// Create the bot
const bot = new BotActivityHandler(adapter); // Pass the adapter to the bot

// Set up Express server
const app = express();
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send('Bot is healthy and running!');
});

// Endpoint for Bot Framework messages
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

// Start the server
const PORT = process.env.PORT || 3978;
app.listen(PORT, () => {
    console.log(`Bot is running on http://localhost:${PORT}`);
});