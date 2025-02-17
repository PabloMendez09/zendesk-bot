const { TeamsActivityHandler, MessageFactory, TurnContext } = require('botbuilder');
const axios = require('axios');
const WebSocket = require('ws');

class BotActivityHandler extends TeamsActivityHandler {
    constructor(adapter) {
        super();

        this.adapter = adapter; // Save adapter for proactive messaging
        this.conversationReference = null; // Save conversation reference
        this.ws = null; // WebSocket instance
        this.userDataMap = new Map(); // Store user-specific data
        this.initWebSocket(); // Initialize WebSocket connection

        // Handle user messages
        this.onMessage(async (context, next) => {
            const userMessage = context.activity.text.trim();
            const userId = context.activity.from.id; // Unique user ID

            // Save conversation reference for proactive messaging
            this.conversationReference = TurnContext.getConversationReference(context.activity);
            console.log('Conversation reference saved:', this.conversationReference);

            // Handle user input and send payload
            await this.handleUserInput(context, userMessage, userId);

            await next();
        });

        // Send the email prompt as soon as the bot starts
        this.onMembersAdded(async (context, next) => {
            const userId = context.activity.from.id; // Unique user ID
            this.userDataMap.set(userId, { isFirstInteraction: true, messageHistory: [] }); // Initialize user data
            await context.sendActivity(MessageFactory.text('What is your email?'));
            await next();
        });
    }

    /**
     * Initialize WebSocket connection with reconnection logic
     */
    initWebSocket() {
        this.ws = new WebSocket('wss://zendeskendpoint-cadne9guf2g3bmf6.canadacentral-01.azurewebsites.net');

        this.ws.on('open', () => {
            console.log('WebSocket connected.');
        });

        this.ws.on('message', (data) => {
            try {
                const response = JSON.parse(data);
                if (response.message) {
                    console.log('WebSocket response:', response.message);
                    this.sendProactiveMessage(response.message);
                } else {
                    console.warn('Empty message received from WebSocket.');
                }
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        });

        this.ws.on('close', () => {
            console.log('WebSocket disconnected. Attempting to reconnect...');
            setTimeout(() => this.initWebSocket(), 5000); // Reconnect after 5 seconds
        });

        this.ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });
    }

    /**
     * Handle user input and send payloads
     */
    async handleUserInput(context, userMessage, userId) {
        const userData = this.userDataMap.get(userId) || { isFirstInteraction: true, messageHistory: [] };

        if (userData.isFirstInteraction) {
            // First interaction: Ask for email
            if (!userData.email) {
                userData.email = userMessage; // Save email
                this.userDataMap.set(userId, userData); // Update user data
                await context.sendActivity(MessageFactory.text('Please provide your message:'));
            } else if (!userData.message) {
                userData.message = userMessage; // Save message
                userData.messageHistory.push(userMessage); // Add message to history
                userData.isFirstInteraction = false; // Mark first interaction as complete
                this.userDataMap.set(userId, userData); // Update user data

                // Send the initial payload
                await this.sendPayload(userData);
            }
        } else {
            // Subsequent interactions: Update message and send payload
            userData.message = userMessage; // Update message
            userData.messageHistory.push(userMessage); // Add message to history
            this.userDataMap.set(userId, userData); // Update user data

            // Send the updated payload
            await this.sendPayload(userData);
        }
    }

    /**
     * Send payload to WebSocket and HTTP endpoint
     */
    async sendPayload(userData) {
        const payload = {
            email: userData.email,
            message: userData.messageHistory.join('\n'), // Combine all messages into one
        };

        console.log('Sending payload to WebSocket:', payload);
        this.sendToWebSocket(payload);

        console.log('Sending payload to HTTP endpoint:', payload);
        await this.sendToHTTP(payload);
    }

    /**
     * Send data to HTTP endpoint
     */
    async sendToHTTP(payload) {
        try {
            const response = await axios.post(
                'https://prod-143.westus.logic.azure.com:443/workflows/1b698ab5d2804c3e973103875b8ad8e1/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=G1ojtX0jlpkRO-HAUfSHz7zDWb4SIl_WDQWBiZIHjgo',
                payload
            );
            console.log('HTTP response:', response.data);
        } catch (error) {
            console.error('Error sending to HTTP endpoint:', error.response ? error.response.data : error.message);
        }
    }

    /**
     * Send data to WebSocket server
     */
    sendToWebSocket(payload) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(payload));
        } else {
            console.error('WebSocket is not open. Attempting to reconnect...');
            this.initWebSocket(); // Attempt to reconnect
        }
    }

    /**
     * Send proactive message to user
     */
    sendProactiveMessage(message) {
        if (this.conversationReference) {
            this.adapter.continueConversation(this.conversationReference, async (context) => {
                await context.sendActivity(MessageFactory.text(message));
            });
        } else {
            console.error('No conversation reference available for proactive messaging.');
        }
    }
}

module.exports.BotActivityHandler = BotActivityHandler;