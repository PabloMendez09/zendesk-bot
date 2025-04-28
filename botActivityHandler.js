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
            const conversationID = context.activity.conversation.id;
            const key = `${userID}:${conversationID}`;

            console.log('📩 New message received:', userMessage);
            console.log('👤 From userID:', userID);
            console.log('🧵 Conversation ID:', conversationID);

            let userData = this.userDataMap.get(key) || { messageHistory: [] };

            if (!userData.conversationReference) {
                userData.conversationReference = TurnContext.getConversationReference(context.activity);
            }

            // Get user email
            let userEmail = "default@email.com";
            try {
                const teamsMember = await TeamsInfo.getMember(context, context.activity.from.id);
                userEmail = teamsMember.email || userEmail;
                console.log('📧 Retrieved User Email:', userEmail);
            } catch (error) {
                console.error('❌ Unable to get user email:', error.message);
            }

            // Add user message to history
            userData.messageHistory.push({ role: 'user', content: userMessage });
            this.userDataMap.set(key, userData);

            await context.sendActivity({ type: 'typing' });

            // Send payload to AI endpoint
            await this.sendToAI(context, userData, userEmail, userID, conversationID, key);

            const elapsedTime = Date.now() - startTime;
            console.log(`⏱️ Response Time: ${elapsedTime}ms`);

            await next();
        });
    }

    async sendToAI(context, userData, userEmail, userID, conversationID, key) {
        const payload = {
            userID: userID,
            conversationID: conversationID,
            email: userEmail,
            message: context.activity.text.trim(),
            messageHistory: userData.messageHistory,
        };

        console.log('🚀 Sending payload to AI endpoint:', payload);

        try {
            const aiResponse = await axios.post('https://rag-zendesk.azurewebsites.net/api/ZendeskBot', payload);
            console.log('📥 AI raw response received:', aiResponse.data);

            if (aiResponse.data && aiResponse.data.message) {
                const aiMessage = aiResponse.data.message;

                if (aiResponse.data.resetToken === true) {
                    console.log('🔄 Reset token detected. Clearing message history.');
                    userData.messageHistory = [];
                    this.userDataMap.set(key, userData);
                } else {
                    userData.messageHistory.push({ role: 'bot', content: aiMessage });
                    this.userDataMap.set(key, userData);
                }

                console.log('📤 Sending AI reply back to user:', aiMessage);
                await context.sendActivity(MessageFactory.text(aiMessage));
            } else {
                console.error('⚠️ AI response missing message field.');
            }
        } catch (error) {
            console.error('❌ Error communicating with AI endpoint:', error.message);
            await context.sendActivity(MessageFactory.text("Sorry, there was an error processing your request."));
        }
    }
}

module.exports.BotActivityHandler = BotActivityHandler;
