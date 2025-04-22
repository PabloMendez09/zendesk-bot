const { TeamsActivityHandler, MessageFactory, TurnContext, TeamsInfo } = require('botbuilder');
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
            const userID = context.activity.from.id;
            this.conversationReference = TurnContext.getConversationReference(context.activity);
            console.log('Conversation reference saved:', this.conversationReference);

            await this.handleUserInput(context, userMessage, userID);

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

                if (response.userID && response.conversationID && response.message) {
                    console.log('Received userID:', response.userID);
                    console.log('Received conversationID:', response.conversationID);
                    const key = `${response.userID}:${response.conversationID}`;

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
                } else {
                    console.error('Missing userID or conversationID in WebSocket message');
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

    async handleUserInput(context, userMessage, userID) {
        console.log('Handling user input:', userMessage);
        if (!this.isWebSocketConnected && (!this.ws || this.ws.readyState !== WebSocket.CONNECTING)) {
            console.log('Reconnecting WebSocket due to user activity...');
            this.initWebSocket();
        }
        this.resetInactivityTimer();
    
        const conversationID = context.activity.conversation.id;
        const key = `${userID}:${conversationID}`;
    
        let userData = this.userDataMap.get(key) || { messageHistory: [], resetToken: false };
    
        const conversationReference = TurnContext.getConversationReference(context.activity);
        userData.conversationReference = conversationReference;
this.userDataMap.set(key, userData);
    
        if (userData.resetToken) {
            console.log('Reset token detected. Clearing message history.');
            userData.messageHistory = [];
            userData.resetToken = false;
        }
    
        let userEmail = "Chris.Chapman@lionbridge.com";
        try {
            const teamsMember = await TeamsInfo.getMember(context, context.activity.from.id);
            userEmail = teamsMember.email || userEmail;
        } catch (error) {
            console.error("❌ Unable to get user email:", error);
        }
    
        // ✅ Save user message in structured format
        userData.messageHistory.push({
            role: 'user',
            content: userMessage,
        });
        this.userDataMap.set(key, userData);
    
        console.log(`✅ Retrieved User Email: ${userEmail}`);
        await context.sendActivity({ type: 'typing' });
    
        await this.sendPayload(context, userData, userEmail, userID);
    }
    

    async sendPayload(context, userData, userEmail, userID) {
        const payload = {
            userID: userID,
            conversationID: context.activity.conversation.id,
            email: userEmail,
            message: context.activity.text.trim(), // this was missing earlier!
            messageHistory: userData.messageHistory, // ✅ send as array, not string
        };
    
        console.log('Sending payload:', payload);
        console.log('WebSocket open:', this.ws.readyState === WebSocket.OPEN);
    
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
    
                const userID = this.conversationReference.user.id;
                let userData = this.userDataMap.get(userID) || { messageHistory: [] };
    
                // ✅ Add structured bot message
                userData.messageHistory.push({
                    role: 'bot',
                    content: message,
                });
                this.userDataMap.set(userID, userData);
            });
        }
    }
    

    async sendProactiveMessageToConversation(key, message) {
        console.log("can you see me");
        const userData = this.userDataMap.get(key);
        if (!userData || !userData.conversationReference) {
            console.error(`No conversation reference found for key: ${key}`);
            return;
        }
    
        console.log(`Sending message to user with key ${key}: ${message}`);
        const conversationReference = userData.conversationReference;
    
        await this.adapter.continueConversation(conversationReference, async (context) => {
            await context.sendActivity(MessageFactory.text(message));
    
            // ✅ Add structured bot message
            userData.messageHistory.push({
                role: 'bot',
                content: message,
            });
            this.userDataMap.set(key, userData);
        });
    }
    
}

module.exports.BotActivityHandler = BotActivityHandler;
