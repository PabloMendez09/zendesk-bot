const { TeamsActivityHandler, MessageFactory, TurnContext, TeamsInfo } = require('botbuilder');
const axios = require('axios');

class BotActivityHandler extends TeamsActivityHandler {
    constructor(adapter) {
        super();
        this.adapter = adapter;
        this.userDataMap = new Map();

        this.onMessage(async (context, next) => {
            console.log('📥 Incoming message from user:', context.activity.text);
            const userID = context.activity.from.id;
            const conversationID = context.activity.conversation.id;
            const key = `${userID}:${conversationID}`;

            const conversationReference = TurnContext.getConversationReference(context.activity);

            // Retrieve existing user data or create new
            let userData = this.userDataMap.get(key) || { messageHistory: [] };
            userData.conversationReference = conversationReference;

            // Get user email
            let userEmail = "default@email.com";
            try {
                const teamsMember = await TeamsInfo.getMember(context, context.activity.from.id);
                userEmail = teamsMember.email || userEmail;
            } catch (error) {
                console.error("❌ Unable to retrieve Teams member info:", error.message);
            }

            // Add user message to history
            userData.messageHistory.push({ role: 'user', content: context.activity.text.trim() });
            this.userDataMap.set(key, userData);

            // Prepare payload
            const payload = {
                userID: userID,
                conversationID: conversationID,
                email: userEmail,
                message: context.activity.text.trim(),
                messageHistory: userData.messageHistory,
            };

            console.log('📤 Sending payload to AI:', JSON.stringify(payload, null, 2));

            try {
                const aiResponse = await axios.post('https://rag-zendesk.azurewebsites.net/api/ZendeskBot', payload);

                console.log('📥 AI raw response received:', aiResponse.data);

                if (aiResponse.data && aiResponse.data.message) {
                    const aiMessage = aiResponse.data.message;

                    // Add bot response to history
                    userData.messageHistory.push({ role: 'bot', content: aiMessage });
                    this.userDataMap.set(key, userData);

                    console.log('📤 Sending message back to user:', aiMessage);
                    await context.sendActivity(MessageFactory.text(aiMessage));
                } else {
                    console.error('⚠️ AI response missing expected "message" field:', aiResponse.data);
                    await context.sendActivity("Sorry, I couldn't understand the response from AI.");
                }
            } catch (error) {
                console.error('❌ Error communicating with AI:', error.message);
                await context.sendActivity("Sorry, I couldn't reach the AI service. Please try again later.");
            }

            await next();
        });
    }
}

module.exports.BotActivityHandler = BotActivityHandler;
