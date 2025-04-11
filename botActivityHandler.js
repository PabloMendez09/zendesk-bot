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
            
            this.ws.on('message', async (data) => {
                try {
                    // Log received WebSocket message
                    const decodedMessage = data.toString();  // Convert Buffer to string
                    console.log('WebSocket message received:', decodedMessage);
            
                    const response = JSON.parse(decodedMessage);
            
                    if (response.userId && response.conversationId && response.message) {
                        console.log('Received userId:', response.userId);
                        console.log('Received conversationId:', response.conversationId);
                        const key = `${response.userId}:${response.conversationId}`;
                        
                        // Log the key being used for the userDataMap
                        console.log('Key for sending proactive message:', key);
                        
                        // Retrieve user data from map or initialize if not present
                        let userData = this.userDataMap.get(key) || { messageHistory: [], resetToken: false };
            
                        // Log the current state of userData
                        console.log('Current user data:', userData);
                        
                        // If resetToken is true, clear message history
                        if (response.resetToken === true) {
                            console.log('Reset token detected. Clearing message history.');
                            userData.messageHistory = [];
                            userData.resetToken = true;
                        }
            
                        // Log before calling sendProactiveMessageToConversation
                        console.log('Calling sendProactiveMessageToConversation...');
                        await this.sendProactiveMessageToConversation(key, response.message);
            
                        // Log message being sent to user after reset
                        console.log('Sending message to user after reset:', response.message);
            
                        // Update the message history and store the updated user data
                        userData.messageHistory.push(`bot: ${response.message}`);
                        this.userDataMap.set(key, userData);
                    }

                 else {
                    console.error('Missing userId or conversationId in WebSocket message');
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
        console.log('Handling user input:', userMessage); // Log the user's message
        if (!this.isWebSocketConnected && (!this.ws || this.ws.readyState !== WebSocket.CONNECTING)) {
            console.log('Reconnecting WebSocket due to user activity...');
            this.initWebSocket();
        }
        this.resetInactivityTimer();
    
        const conversationId = context.activity.conversation.id;
        const key = `${userId}:${conversationId}`; // 🆕 composite key

            let userData = this.userDataMap.get(key) || { messageHistory: [], resetToken: false };

            // 🆕 Store conversationReference
            const conversationReference = TurnContext.getConversationReference(context.activity);
            this.userDataMap.set(key, {
            ...userData,
                conversationReference,
            });

    
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
        await this.sendPayload(context, userData, userEmail, userId);
    }
    

    async sendPayload(context, userData, userEmail, userId) {
        const payload = {
            userId: userId,
            conversationId: context.activity.conversation.id,
            email: userEmail, // Now sending the real user email
            message: userData.messageHistory.join('\n'),
        };
        console.log('Sending payload:', payload);

        console.log('WebSocket open:', this.ws.readyState === WebSocket.OPEN); // Log WebSocket state
    
        await Promise.all([
            this.sendToWebSocket(payload),
            this.sendToHTTP(payload).catch(error => {
                console.error('HTTP Request Failed:', error.message);
            }),
        ]);
    }
    

    sendToWebSocket(payload) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('WebSocket is open. Sending payload:', payload); // Log when sending a payload
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

    async sendProactiveMessageToConversation(key, message) {
        console.log("can you see me")
        const userData = this.userDataMap.get(key);
        if (!userData || !userData.conversationReference) {
            console.error(`No conversation reference found for key: ${key}`);
            return;
        }
    
        // Log the message being sent
        console.log(`Sending message to user: ${message}`);
    
        try {
            // Log that the conversation is being continued
            console.log('Continuing conversation...');
    
            await this.adapter.continueConversation(userData.conversationReference, async (context) => {
                console.log(`Sending message: ${message}`);
                await context.sendActivity(MessageFactory.text(message));
            });
    
            // Confirm message was sent
            console.log('Message sent to user successfully.');
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }
    
    
}

module.exports.BotActivityHandler = BotActivityHandler;
