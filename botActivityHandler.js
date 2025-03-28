const { TeamsActivityHandler, MessageFactory, TurnContext, TeamsInfo } = require('botbuilder');
const axios = require('axios');
const WebSocket = require('ws');

class BotActivityHandler extends TeamsActivityHandler {
    constructor(adapter) {
        super();
        this.adapter = adapter;
        this.conversationReferences = new Map(); // Store conversation references per user
        this.userDataMap = new Map(); // Store user-specific data
        this.ws = null;
        this.messageQueue = [];
        this.inactivityTimeout = 5 * 60 * 1000; // 5 minutes

        this.onMessage(async (context, next) => {
            const userId = context.activity.from.id;
            const userMessage = context.activity.text.trim();
            this.conversationReferences.set(userId, TurnContext.getConversationReference(context.activity));
            console.log(`Conversation reference saved for ${userId}`);

            await this.handleUserInput(context, userMessage, userId);
            await next();
        });

        this.onMembersAdded(async (context, next) => {
            this.initWebSocket();
            await next();
        });
    }

    initWebSocket() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            console.log('WebSocket already open or connecting.');
            return;
        }

        console.log('Initializing WebSocket...');
        this.ws = new WebSocket('wss://zendeskendpoint-cadne9guf2g3bmf6.canadacentral-01.azurewebsites.net');

        this.ws.on('open', () => {
            console.log('WebSocket connected.');
            this.processMessageQueue();
        });

        this.ws.on('message', (data) => {
            try {
                const response = JSON.parse(data);
                if (response.message && response.userId) {
                    console.log(`WebSocket response for ${response.userId}:`, response.message);

                    if (response.resetToken) {
                        console.log(`Resetting message history for ${response.userId}`);
                        const userData = this.userDataMap.get(response.userId) || { messageHistory: [], resetToken: false };
                        userData.messageHistory = [];
                        userData.resetToken = true;
                        this.userDataMap.set(response.userId, userData);
                    }

                    this.sendProactiveMessage(response.userId, response.message);
                    this.resetInactivityTimer(response.userId);
                }
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        });

        this.ws.on('close', () => {
            console.log('WebSocket disconnected. Retrying in 5 seconds...');
            setTimeout(() => this.initWebSocket(), 5000);
        });

        this.ws.on('error', (err) => {
            console.error('WebSocket error:', err);
        });
    }

    async handleUserInput(context, userMessage, userId) {
        this.initWebSocket();
        this.resetInactivityTimer(userId);

        let userData = this.userDataMap.get(userId) || { messageHistory: [], resetToken: false };

        if (userData.resetToken) {
            console.log(`Clearing message history for ${userId}`);
            userData.messageHistory = [];
            userData.resetToken = false;
        }

        let userEmail = "default@example.com";
        try {
            const teamsMember = await TeamsInfo.getMember(context, userId);
            userEmail = teamsMember.email || userEmail;
        } catch (error) {
            console.error(`Unable to get user email for ${userId}:`, error);
        }

        userData.messageHistory.push(`user: ${userMessage}`);
        this.userDataMap.set(userId, userData);
        console.log(`User ${userId} email: ${userEmail}`);

        await context.sendActivity({ type: 'typing' });
        this.sendPayload(userId, userData, userEmail);
    }

    async sendPayload(userId, userData, userEmail) {
        const payload = { userId, email: userEmail, message: userData.messageHistory.join('\n') };
        console.log('Sending payload:', payload);

        await Promise.all([
            this.sendToWebSocket(payload),
            this.sendToHTTP(payload).catch(error => {
                console.error('HTTP Request Failed:', error.message);
            }),
        ]);
    }

    sendToWebSocket(payload) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(payload));
        } else {
            console.error('WebSocket not open. Adding message to queue.');
            this.messageQueue.push(payload);
        }
    }

    processMessageQueue() {
        while (this.messageQueue.length > 0) {
            this.sendToWebSocket(this.messageQueue.shift());
        }
    }

    async sendToHTTP(payload) {
        try {
            const response = await axios.post('https://your-api-endpoint.com', payload);
            console.log('✅ HTTP Request Successful:', response.status);
        } catch (error) {
            console.error('HTTP Request Failed:', error.response ? error.response.data : error.message);
            throw error;
        }
    }

    async sendProactiveMessage(userId, message) {
        const reference = this.conversationReferences.get(userId);
        if (reference) {
            this.adapter.continueConversation(reference, async (context) => {
                await context.sendActivity(MessageFactory.text(message));
                let userData = this.userDataMap.get(userId) || { messageHistory: [] };
                userData.messageHistory.push(`bot: ${message}`);
                this.userDataMap.set(userId, userData);
            });
        }
    }

    resetInactivityTimer(userId) {
        let userData = this.userDataMap.get(userId) || { messageHistory: [], inactivityTimer: null };
        clearTimeout(userData.inactivityTimer);

        userData.inactivityTimer = setTimeout(() => {
            console.log(`User ${userId} inactive for 5 minutes. Removing data.`);
            this.userDataMap.delete(userId);
            this.conversationReferences.delete(userId);
        }, this.inactivityTimeout);

        this.userDataMap.set(userId, userData);
    }
}

module.exports.BotActivityHandler = BotActivityHandler;