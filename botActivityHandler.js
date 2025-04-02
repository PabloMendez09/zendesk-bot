const { TeamsActivityHandler, MessageFactory, TurnContext, TeamsInfo } = require('botbuilder');
const axios = require('axios');
const WebSocket = require('ws');

class BotActivityHandler extends TeamsActivityHandler {
    constructor(adapter) {
        super();
        this.adapter = adapter;
        this.conversationReferences = new Map(); 
        this.userDataMap = new Map(); 
        this.ws = null;
        this.messageQueue = [];
        this.inactivityTimeout = 5 * 60 * 1000;
        this.reconnectTimeout = null;

        this.onMessage(async (context, next) => {
            const userId = context.activity.from.id;
            const userMessage = context.activity.text.trim();
            this.conversationReferences.set(userId, TurnContext.getConversationReference(context.activity));
            console.log(`Conversation reference saved for ${userId}`);

            await context.sendActivity(MessageFactory.text("Processing your request..."));
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
            if (this.reconnectTimeout) {
                clearTimeout(this.reconnectTimeout);
                this.reconnectTimeout = null;
            }
        });

        this.ws.on('message', (data) => {
            console.log("Raw WebSocket message:", data); // Add logging for raw message
            try {
                const response = JSON.parse(data);
                if (response.message && response.userId) {
                    console.log(`WebSocket response for ${response.userId}:`, response.message);
                    if (response.resetToken) {
                        console.log(`Resetting message history for ${response.userId}`);
                        this.userDataMap.set(response.userId, { messageHistory: [], resetToken: true });
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
            if (!this.reconnectTimeout) {
                this.reconnectTimeout = setTimeout(() => this.initWebSocket(), 5000);
            }
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

        let userEmail = "Chris.Chapman@lionbridge.com"; // Default fallback
try {
    const teamsMember = await TeamsInfo.getMember(context, context.activity.from.id);
    userEmail = teamsMember.email || userEmail;
    console.log(`✅ Retrieved User Email: ${userEmail}`);
} catch (error) {
    console.error("❌ Unable to get user email:", error);
    console.log(`✅ Using fallback email: ${userEmail}`);
}

userData.messageHistory.push(`user: ${userMessage}`);
this.userDataMap.set(userId, userData);

await context.sendActivity({ type: 'typing' });

// ✅ Send message to WebSocket & API with user real email
this.sendPayload(userId, userData, userEmail);
    }

    async sendPayload(userId, userData, userEmail) {
        const payload = { userId, email: userEmail, message: userData.messageHistory.join('\n') };
        console.log('Sending payload:', payload);

        await Promise.all([
            this.sendToWebSocket(payload),
            this.sendToHTTP(payload).catch(error => console.error('HTTP Request Failed:', error.message))
        ]);
    }

    sendToWebSocket(payload) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log("Sending to WebSocket:", JSON.stringify(payload));
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
            const apiUrl = 'https://prod-143.westus.logic.azure.com:443/workflows/1b698ab5d2804c3e973103875b8ad8e1/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=G1ojtX0jlpkRO-HAUfSHz7zDWb4SIl_WDQWBiZIHjgo';
    
            console.log("📤 Sending HTTP Request with payload:", JSON.stringify(payload, null, 2));
    
            const response = await axios.post(apiUrl, payload, {
                headers: { "Content-Type": "application/json" }
            });
    
            console.log('✅ HTTP Request Successful:', response.status, response.data);
        } catch (error) {
            console.error('❌ HTTP Request Failed:', error.response ? error.response.data : error.message);
        }
    }
    

    async sendProactiveMessage(userId, message) {
        const reference = this.conversationReferences.get(userId);
        if (reference && this.adapter) {
            console.log(`Sending proactive message to user ${userId}:`, message); // Log the message
            this.adapter.continueConversation(reference, async (context) => {
                await context.sendActivity(MessageFactory.text(message));
                let userData = this.userDataMap.get(userId) || { messageHistory: [] };
                userData.messageHistory.push(`bot: ${message}`);
                this.userDataMap.set(userId, userData);
            });
        } else {
            console.error(`No adapter or reference found for ${userId}`);
        }
    }

    resetInactivityTimer(userId) {
        let userData = this.userDataMap.get(userId) || { messageHistory: [], inactivityTimer: null };
        if (userData.inactivityTimer) {
            clearTimeout(userData.inactivityTimer);
        }
        userData.inactivityTimer = setTimeout(() => {
            console.log(`User ${userId} inactive for 5 minutes. Removing data.`);
            this.userDataMap.delete(userId);
            this.conversationReferences.delete(userId);
        }, this.inactivityTimeout);
        this.userDataMap.set(userId, userData);
    }
}

module.exports.BotActivityHandler = BotActivityHandler;
