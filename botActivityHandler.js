const { TeamsActivityHandler, MessageFactory, TurnContext, TeamsInfo } = require('botbuilder');
const axios = require('axios');

class BotActivityHandler extends TeamsActivityHandler {
    constructor(adapter) {
        super();
        this.adapter = adapter;
        this.userDataMap = new Map();

        this.onMessage(async (context, next) => {
            console.log('📥 Incoming message received');

            const startTime = Date.now();
            const userMessage = context.activity.text.trim();
            const userID = context.activity.from.id;
            const conversationID = context.activity.conversation.id;
            const key = `${userID}:${conversationID}`;

            // Retrieve or create user data
            let userData = this.userDataMap.get(key) || { messageHistory: [] };
            const conversationReference = TurnContext.getConversationReference(context.activity);
            userData.conversationReference = conversationReference;
            this.userDataMap.set(key, userData);

            console.log('🧠 UserData before processing:', JSON.stringify(userData));

            let userEmail = "Chris.Chapman@lionbridge.com"; // Default fallback email
            try {
                const teamsMember = await TeamsInfo.getMember(context, context.activity.from.id);
                userEmail = teamsMember.email || userEmail;
                console.log('📧 Retrieved user email:', userEmail);
            } catch (error) {
                console.error('❌ Failed to get user email:', error.message);
            }

            // Add user message to history
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

            console.log('🚀 Sending payload to AI:', JSON.stringify(payload));

            try {
                const aiResponse = await axios.post('https://rag-zendesk.azurewebsites.net/api/ZendeskBot', payload);
                console.log('📥 AI raw response received:', aiResponse.data);

                if (aiResponse.data && aiResponse.data.message) {
                    const aiMessage = aiResponse.data.message;

                    // 👉 Handle resetToken if present
                    if (aiResponse.data.resetToken === true) {
                        console.log('🔄 Reset token detected. Clearing message history.');
                        userData.messageHistory = []; // Clear previous messages
                    }

                    // Add bot response to history
                    userData.messageHistory.push({ role: 'bot', content: aiMessage });
                    this.userDataMap.set(key, userData);

                    console.log('📤 Sending AI reply back to user:', aiMessage);
                    await context.sendActivity(MessageFactory.text(aiMessage));
                } else {
                    console.error('⚠️ AI response missing "message" field.');
                }
            } catch (error) {
                console.error('❌ Error communicating with AI service:', error.message);
                await context.sendActivity(MessageFactory.text('Sorry, there was an error processing your request.'));
            }

            const elapsedTime = Date.now() - startTime;
            console.log(`⏱️ Response Time: ${elapsedTime}ms`);

            await next();
        });

        this.onMembersAdded(async (context, next) => {
            console.log('➕ New member added to conversation.');
            await next();
        });
    }
}

module.exports.BotActivityHandler = BotActivityHandler;
