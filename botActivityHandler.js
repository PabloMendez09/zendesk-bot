require('dotenv').config();
const { TeamsActivityHandler, MessageFactory, TurnContext, TeamsInfo } = require('botbuilder');
const axios = require('axios');
const { TableClient } = require("@azure/data-tables");

const AZURE_TABLE_CONNECTION_STRING = process.env.AZURE_TABLE_CONNECTION_STRING;
console.log("AZURE_TABLE_CONNECTION_STRING:", AZURE_TABLE_CONNECTION_STRING ? "Loaded" : "NOT SET");
const TABLE_NAME = "ConversationReferences";

function getTableClient() {
    return TableClient.fromConnectionString(AZURE_TABLE_CONNECTION_STRING, TABLE_NAME);
}

async function saveConversationReference(email, conversationReference) {
    try {
        const client = getTableClient();
        await client.createTable(); // Safe if already exists
        await client.upsertEntity({
            partitionKey: "user",
            rowKey: email.toLowerCase(),
            conversationReference: JSON.stringify(conversationReference)
        });
        console.log("Saved conversation reference for", email);
    } catch (e) {
        console.error("Error saving conversation reference:", e);
    }
}

async function loadConversationReference(email) {
    try {
        const client = getTableClient();
        const entity = await client.getEntity("user", email.toLowerCase());
        return JSON.parse(entity.conversationReference);
    } catch (e) {
        console.error("Error loading conversation reference:", e);
        return null;
    }
}

class BotActivityHandler extends TeamsActivityHandler {
    constructor(adapter) {
        super();
        this.adapter = adapter;
        this.userDataMap = new Map();

        // Start keep-alive timer for a specific user (Paul.Connolly@lionbridge.com)
        const KEEP_ALIVE_EMAIL = "Paul.Connolly@lionbridge.com";
        setInterval(async () => {
            try {
                const conversationReference = await loadConversationReference(KEEP_ALIVE_EMAIL);
                if (conversationReference) {
                    await this.adapter.continueConversation(
                        conversationReference,
                        async (proactiveContext) => {
                            await proactiveContext.sendActivity(MessageFactory.text("Keep alive"));
                        }
                    );
                    console.log(`🚀 Sent keep alive to ${KEEP_ALIVE_EMAIL}`);
                } else {
                    console.log(`ℹ️ No conversation reference found for ${KEEP_ALIVE_EMAIL}`);
                }
            } catch (err) {
                console.error(`❌ Failed to send keep alive:`, err && (err.stack || err.message || err));
            }
        }, 5 * 60 * 1000); // Every 5 minutes

        this.onMessage(async (context, next) => {
            const startTime = Date.now();

            const userMessage = context.activity.text?.trim();
            const userID = context.activity.from.id;
            const conversationReference = TurnContext.getConversationReference(context.activity);
            const conversationID = context.activity.conversation.id;
            const key = `${userID}:${conversationID}`;

            console.log('📩 User message received:', userMessage);
            console.log('📩 Conversation key:', key);

            let userData = this.userDataMap.get(key) || { messageHistory: [], resetToken: false };
            userData.conversationReference = conversationReference;

            // Try to get user email
            let userEmail = "default@email.com";
            try {
                const teamsMember = await TeamsInfo.getMember(context, userID);
                userEmail = teamsMember.email || userEmail;
            } catch (error) {
                console.error("❌ Unable to get user email:", error.message);
            }
            userData.email = userEmail; // Store email for proactive messaging
            console.log(`📧 User email: ${userEmail}`);
            if (userEmail.toLowerCase() === KEEP_ALIVE_EMAIL.toLowerCase()) {
                console.log(`✅ Stored conversation reference for keep-alive user: ${userEmail}`);
            }
            // Save conversation reference to Azure Table Storage for keep-alive
            await saveConversationReference(userEmail, conversationReference);

            // Add user message to history (even if resetToken is active)
            userData.messageHistory.push({ role: 'user', content: userMessage });

            // Build conversation string
            const fullConversation = userData.messageHistory
                .map(entry => `${entry.role}: ${entry.content}`)
                .join('  '); // Two spaces between messages

            const payload = {
                userID,
                conversationID,
                email: userEmail,
                message: fullConversation,
            };

            console.log('📤 Payload sending to AI:', JSON.stringify(payload, null, 2));

            // Send typing indicator
            await context.sendActivity({ type: 'typing' });

            try {
                const aiResponse = await postWithRetry('https://rag-zendesk.azurewebsites.net/api/ZendeskBot', payload);
                console.log('📥 AI raw response received:', JSON.stringify(aiResponse.data, null, 2));

                const { message, resetToken } = aiResponse.data || {};

                if (message) {
                    console.log('💬 Sending AI reply to user:', message);
                    await context.sendActivity(MessageFactory.text(message));
                    userData.messageHistory.push({ role: 'bot', content: message });
                }

                if (resetToken) {
                    console.log('🔄 AI instructed to reset conversation.');
                    userData.messageHistory = [];
                    userData.resetToken = true;
                } else {
                    userData.resetToken = false;
                }

            } catch (error) {
                console.error('❌ AI endpoint call failed:', error.response?.data || error.message);
                await context.sendActivity(MessageFactory.text("Sorry, something went wrong contacting AI."));
            }

            this.userDataMap.set(key, userData);

            const elapsedTime = Date.now() - startTime;
            console.log(`✅ Finished handling message in ${elapsedTime}ms`);

            await next();
        });
    }
}

// 🔁 Retry utility function
async function postWithRetry(url, payload, retries = 3, delay = 1500) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await axios.post(url, payload, { timeout: 8000 }); // Set timeout to avoid hanging
        } catch (error) {
            console.warn(`⚠️ Attempt ${attempt} failed: ${error.message}`);
            if (attempt === retries) throw error;
            await new Promise(res => setTimeout(res, delay));
        }
    }
}

module.exports.BotActivityHandler = BotActivityHandler;
