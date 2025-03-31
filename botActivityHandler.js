Explain this:

const { TeamsActivityHandler, MessageFactory, TurnContext, TeamsInfo  } = require('botbuilder');
const axios = require('axios');
const WebSocket = require('ws');

class BotActivityHandler extends TeamsActivityHandler {
    constructor(adapter) {
        super();
        this.adapter = adapter;
        this.conversationReference = null;
        this.ws = null;
        this.userDataMap = new Map();
        this.isWebSocketConnected = false;
        this.messageQueue = [];
        this.inactivityTimeout = 5 * 60 * 1000; // Disconnect WebSocket after 5 minutes of inactivity
        this.inactivityTimer = null;

        this.onMessage(async (context, next) => {
            const startTime = Date.now();

            const userMessage = context.activity.text.trim();
            const userId = context.activity.from.id;
            this.conversationReference = TurnContext.getConversationReference(context.activity);
            console.log('Conversation reference saved:', this.conversationReference);

            await this.handleUserInput(context, userMessage, userId);

            const elapsedTime = Date.now() - startTime;
            console.log(`Response Time: ${elapsedTime}ms`);

            await next();
        });

        this.onMembersAdded(async (context, next) => {
            if (!this.isWebSocketConnected && (!this.ws || this.ws.readyState !== WebSocket.CONNECTING)) {
                console.log('Initializing WebSocket due to bot being opened...');
                this.initWebSocket();
            }
            await next();
        });
    }

    initWebSocket() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('WebSocket is already open.');
            return;
        }

        console.log('Initializing WebSocket...');
        this.ws = new WebSocket('wss://zendeskendpoint-cadne9guf2g3bmf6.canadacentral-01.azurewebsites.net');

        this.ws.on('open', () => {
            console.log('WebSocket connected.');
            this.isWebSocketConnected = true;
            this.resetInactivityTimer();
            this.processMessageQueue();
           
        });

        this.ws.on('message', (data) => {
            try {
                const response = JSON.parse(data);
                if (response.message) {
                    console.log('WebSocket response:', response.message);
        
                    // Check for resetToken in the response
                    if (response.resetToken === true) {
                        console.log('Reset token detected. Clearing message history.');
                        const userId = this.conversationReference.user.id;
                        let userData = this.userDataMap.get(userId) || { messageHistory: [], resetToken: false };
                        userData.messageHistory = []; // Clear the message history
                        userData.resetToken = true; // Set the resetToken flag
                        this.userDataMap.set(userId, userData);
                    }
        
                    // Send the response message to the user
                    this.sendProactiveMessage(response.message);
                    this.resetInactivityTimer();
                }
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        });

        this.ws.on('close', () => {
            console.log('WebSocket disconnected.');
            this.isWebSocketConnected = false;
        });

        this.ws.on('error', (err) => {
            console.error('WebSocket error:', err);
        });
    }

    resetInactivityTimer() {
        clearTimeout(this.inactivityTimer);
        this.inactivityTimer = setTimeout(() => {
            console.log('User inactive for 5 minutes. Closing WebSocket to free resources.');
            if (this.ws) this.ws.close();
            this.isWebSocketConnected = false;
        }, this.inactivityTimeout);
    }

    async handleUserInput(context, userMessage, userId) {
        if (!this.isWebSocketConnected && (!this.ws || this.ws.readyState !== WebSocket.CONNECTING)) {
            console.log('Reconnecting WebSocket due to user activity...');
            this.initWebSocket();
        }
        this.resetInactivityTimer();
    
        let userData = this.userDataMap.get(userId) || { messageHistory: [], resetToken: false };
    
        // Check if resetToken is true and clear the message history
        if (userData.resetToken) {
            console.log('Reset token detected. Clearing message history.');
            userData.messageHistory = []; // Clear the message history
            userData.resetToken = false; // Reset the flag
        }
    
        let userEmail = "Chris.Chapman@lionbridge.com"; // Default fallback
        try {
            const teamsMember = await TeamsInfo.getMember(context, context.activity.from.id);
            userEmail = teamsMember.email || userEmail;
        } catch (error) {
            console.error("❌ Unable to get user email:", error);
        }
    
        userData.messageHistory.push(`user: ${userMessage}`);
        this.userDataMap.set(userId, userData);
    
        console.log(`✅ Retrieved User Email: ${userEmail}`);
    
        await context.sendActivity({ type: 'typing'});
    
        // ✅ Send message to WebSocket & API with user real email
        this.sendPayload(context, userData, userEmail);
    }
    

    async sendPayload(context, userData, userEmail) {
        const payload = {
            email: userEmail, // Now sending the real user email
            message: userData.messageHistory.join('\n'),
        };
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
        if (this.messageQueue.length > 0) {
            console.log(`Processing ${this.messageQueue.length} queued messages.`);
            this.messageQueue.forEach(payload => this.sendToWebSocket(payload));
            this.messageQueue = [];
        }
    }

    async sendToHTTP(payload) {
        try {
            const response = await axios.post('https://prod-143.westus.logic.azure.com:443/workflows/1b698ab5d2804c3e973103875b8ad8e1/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=G1ojtX0jlpkRO-HAUfSHz7zDWb4SIl_WDQWBiZIHjgo', payload);
            console.log('✅ HTTP Request Successful:', response.status);
        } catch (error) {
            console.error('HTTP Request Failed:', error.response ? error.response.data : error.message);
            throw error;
        }
    }

    async sendProactiveMessage(message) {
        if (this.conversationReference) {
            this.adapter.continueConversation(this.conversationReference, async (context) => {
                await context.sendActivity(MessageFactory.text(message));
                
                // ✅ Add bot response to message history
                const userId = this.conversationReference.user.id;
                let userData = this.userDataMap.get(userId) || { messageHistory: [] };
                userData.messageHistory.push(`bot: ${message}`);
                this.userDataMap.set(userId, userData);
            });
        }
    }
}

module.exports.BotActivityHandler = BotActivityHandler;
