const { TeamsActivityHandler, MessageFactory, TurnContext, TeamsInfo } = require('botbuilder');
const axios = require('axios');

class BotActivityHandler extends TeamsActivityHandler {
    constructor(adapter) {
        super();
        this.adapter = adapter;
        this.userDataMap = new Map();

        this.onMessage(async (context, next) => {
            const userMessage = context.activity.text.trim();
            const userID = context.activity.from.id;
            const conversationID = context.activity.conversation.id;
            const key = `${userID}:${conversationID}`;
            const conversationReference = TurnContext.getConversationReference(context.activity);

            let userData = this.userDataMap.get(key) || { messageHistory: [] };
            userData.conversationReference = conversationReference;

            if (userData.resetToken) {
                userData.messageHistory = [];
                userData.resetToken = false;
            }

            // Attempt to fetch user email
            let userEmail = "Unknown";
            try {
                const teamsMember = await TeamsInfo.getMember(context, userID);
                userEmail = teamsMember.email || userEmail;
            } catch (error) {
                console.warn("Unable to fetch user email:", error.message);
            }

            userData.messageHistory.push({ role: 'user', content: userMessage });
            this.userDataMap.set(key, userData);

            await context.sendActivity({ type: 'typing' });

            const payload = {
                userID,
                conversationID,
                email: userEmail,
                message: userMessage,
                messageHistory: userData.messageHistory,
            };

            try {
                const aiResponse = await axios.post(
                    'https://rag-zendesk.azurewebsites.net/api/ZendeskBot',
                    payload
                );

                const replyText = aiResponse.data?.message || '🤖 No response from AI.';
                await context.sendActivity(MessageFactory.text(replyText));

                userData.messageHistory.push({ role: 'bot', content: replyText });
                this.userDataMap.set(key, userData);

            } catch (error) {
                console.error("Failed to contact AI service:", error.message);
                await context.sendActivity("⚠️ Sorry, I couldn't get a response right now.");
            }

            await next();
        });
    }
}

module.exports.BotActivityHandler = BotActivityHandler;
