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

        // Initialize user data when the bot starts
        this.onMembersAdded(async (context, next) => {
            const userId = context.activity.from.id;
            this.userDataMap.set(userId, { isFirstInteraction: true, messageHistory: [], botResponseHistory: [] });

            try {
                const email = await this.getUserEmail(context);
                if (email) {
                    const userData = this.userDataMap.get(userId);
                    userData.email = email;
                    this.userDataMap.set(userId, userData);
                    await context.sendActivity(`Thanks! Your email is ${email}. How can I assist you?`);
                } else {
                    await context.sendActivity('Please sign in to continue.');
                }
            } catch (error) {
                console.error('Error fetching email:', error);
                await context.sendActivity('Unable to retrieve your email. Please sign in manually.');
            }

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
        const userData = this.userDataMap.get(userId) || { isFirstInteraction: true, messageHistory: [], botResponseHistory: [] };

        userData.messageHistory.push({ role: 'user', text: userMessage });

        if (userData.isFirstInteraction) {
            if (!userData.email) {
                const email = await this.getUserEmail(context);
                if (email) {
                    userData.email = email;
                    this.userDataMap.set(userId, userData);
                    await this.storeAndSendMessage(context, userId, `Thanks! Your email is ${email}. How can I assist you?`);
                } else {
                    await this.storeAndSendMessage(context, userId, 'Please sign in to continue.');
                }
            } else {
                userData.isFirstInteraction = false;
                this.userDataMap.set(userId, userData);
                await this.sendPayload(userData);
            }
        } else {
            this.userDataMap.set(userId, userData);
            await this.sendPayload(userData);
        }
    }

    /**
     * Fetch user email using Microsoft Graph API
     */
    async getUserEmail(context) {
        const token = await this.getUserToken(context);
        if (!token) {
            await context.sendActivity({
                type: 'message',
                text: 'Please sign in to continue.',
                attachments: [
                    {
                        contentType: 'application/vnd.microsoft.card.oauth',
                        content: {
                            text: 'Sign in to proceed',
                            connectionName: process.env.OAUTH_CONNECTION_NAME,
                        },
                    },
                ],
            });
            return null;
        }

        try {
            const response = await axios.get('https://graph.microsoft.com/v1.0/me', {
                headers: { Authorization: `Bearer ${token}` },
            });

            return response.data.mail || response.data.userPrincipalName;
        } catch (error) {
            console.error('Error fetching email:', error);
            return null;
        }
    }

    /**
     * Get user token using OAuth
     */
    async getUserToken(context) {
        try {
            const tokenResponse = await this.adapter.getUserToken(context, process.env.OAUTH_CONNECTION_NAME);
            return tokenResponse?.token || null;
        } catch (error) {
            console.error('Error fetching token:', error);
            return null;
        }
    }

    /**
     * Send payload to WebSocket and HTTP endpoint
     */
    async sendPayload(userData) {
        const payload = {
            email: userData.email,
            userMessages: userData.messageHistory,
            botResponses: userData.botResponseHistory,
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
            this.initWebSocket();
        }
    }

    /**
     * Store and send bot message
     */
    async storeAndSendMessage(context, userId, botMessage) {
        const userData = this.userDataMap.get(userId);
        userData.botResponseHistory.push({ role: 'bot', text: botMessage });
        this.userDataMap.set(userId, userData);
        await context.sendActivity(MessageFactory.text(botMessage));
    }

    /**
     * Send proactive message to user
     */
    sendProactiveMessage(message) {
        if (this.conversationReference) {
            this.adapter.continueConversation(this.conversationReference, async (context) => {
                await this.storeAndSendMessage(context, this.conversationReference.user.id, message);
            });
        } else {
            console.error('No conversation reference available for proactive messaging.');
        }
    }
}

module.exports.BotActivityHandler = BotActivityHandler;
