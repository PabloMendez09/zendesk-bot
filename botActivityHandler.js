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

            // Try to get user email
            let userEmail = "default@email.com";
            try {
                const teamsMember = await TeamsInfo.getMember(context, userID);
                userEmail = teamsMember.email || userEmail;
            } catch (error) {
                console.error("❌ Unable to get user email:", error.message);
            }
            console.log(`📧 User email: ${userEmail}`);

            // Add user message to history (even if resetToken is active)
            userData.messageHistory.push({ role: 'user', content: userMessage });

            // Build conversation string
            const fullConversation = userData.messageHistory
                .map(entry => `${entry.role}: ${entry.content}`)
                .join('  '); // Two spaces between messages

            const payload = {
                userID: userID,
                conversationID: conversationID,
                email: userEmail,
                message: fullConversation,
            };

            console.log('📤 Payload sending to AI:', JSON.stringify(payload, null, 2));

            // Send typing indicator
            await context.sendActivity({ type: 'typing' });

            try {
                const aiResponse = await axios.post('https://rag-zendesk.azurewebsites.net/api/ZendeskBot', payload);
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
                console.error('❌ AI endpoint call failed:', error.response ? error.response.data : error.message);
                await context.sendActivity(MessageFactory.text("Sorry, something went wrong contacting AI."));
            }

            this.userDataMap.set(key, userData);

            const elapsedTime = Date.now() - startTime;
            console.log(`✅ Finished handling message in ${elapsedTime}ms`);

            await next();
        });
    }
}

module.exports.BotActivityHandler = BotActivityHandler;
