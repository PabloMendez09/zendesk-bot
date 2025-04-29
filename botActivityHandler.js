const { TeamsActivityHandler, MessageFactory, TurnContext, TeamsInfo } = require('botbuilder');
const axios = require('axios');

class BotActivityHandler extends TeamsActivityHandler {
    constructor(adapter) {
        super();
        this.adapter = adapter;
        this.userDataMap = new Map();

        this.onMessage(async (context, next) => {
            const startTime = Date.now();

            const userMessage = context.activity.text.trim();
            const userID = context.activity.from.id;
            const conversationReference = TurnContext.getConversationReference(context.activity);
            const conversationID = context.activity.conversation.id;
            const key = `${userID}:${conversationID}`;

            console.log('📩 User message received:', userMessage);
            console.log('📩 Conversation key:', key);

            let userData = this.userDataMap.get(key) || { messageHistory: [], resetToken: false };
            userData.conversationReference = conversationReference;

            // If resetToken is true, clear the history and reset everything
            if (userData.resetToken) {
                console.log('🔄 Reset token detected. Clearing message history and resetting session.');
                userData.messageHistory = []; // Completely clear message history
                userData.resetToken = false; // Reset the reset token flag
            }

            // Try to get user email
            let userEmail = "default@email.com";
            try {
                const teamsMember = await TeamsInfo.getMember(context, userID);
                userEmail = teamsMember.email || userEmail;
            } catch (error) {
                console.error("❌ Unable to get user email:", error.message);
            }
            console.log(`📧 User email: ${userEmail}`);

            // Build full conversation string (user: / bot: alternating)
            const conversationLines = userData.messageHistory.map(entry => {
                const role = entry.role === 'user' ? 'user' : 'bot';
                return `${role}: ${entry.content}`;
            });

            // Add current user message
            conversationLines.push(`user: ${userMessage}`);

            const fullConversation = conversationLines.join('  '); // Two spaces between messages

            // Build payload
            const payload = {
                userID: userID,
                conversationID: conversationID,
                email: userEmail,
                message: fullConversation, // 🆕 full conversation as one string
            };

            console.log('📤 Payload sending to AI:', JSON.stringify(payload, null, 2));

            // Send typing indicator
            await context.sendActivity({ type: 'typing' });

            try {
                const aiResponse = await axios.post('https://rag-zendesk.azurewebsites.net/api/ZendeskBot', payload);
                console.log('📥 AI raw response received:', JSON.stringify(aiResponse.data, null, 2));

                const { message, resetToken } = aiResponse.data || {};

                if (resetToken) {
                    console.log('🔄 AI instructed to reset conversation.');
                    userData.messageHistory = []; // Clear history if AI tells us to reset
                    userData.resetToken = true; // Set resetToken flag to ensure it's cleared next time
                }

                if (message) {
                    console.log('💬 Sending AI reply to user:', message);
                    await context.sendActivity(MessageFactory.text(message));

                    // Save bot reply into memory (after reset)
                    if (!userData.resetToken) {
                        userData.messageHistory.push({ role: 'bot', content: message });
                    }
                }

            } catch (error) {
                console.error('❌ AI endpoint call failed:', error.response ? error.response.data : error.message);
                await context.sendActivity(MessageFactory.text("Sorry, something went wrong contacting AI."));
            }

            // Save user's new message to history (after reset, this is the only message in history)
            if (!userData.resetToken) {
                userData.messageHistory.push({ role: 'user', content: userMessage });
            }
            this.userDataMap.set(key, userData);

            const elapsedTime = Date.now() - startTime;
            console.log(`✅ Finished handling message in ${elapsedTime}ms`);

            await next();
        });
    }
}

module.exports.BotActivityHandler = BotActivityHandler;
