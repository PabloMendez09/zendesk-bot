import express from 'express';
import { WebSocketServer } from 'ws';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Map to store email-to-WebSocket mapping
const clients = new Map();

// POST endpoint to receive data
app.post('/post-endpoint', (req, res) => {
  const data = req.body;
  const { email, message, resetToken } = data;

  console.log('Received data:', data);

  // Route message to the correct WebSocket client
  if (clients.has(email)) {
    const client = clients.get(email);
    if (client.readyState === client.OPEN) {
      // Include resetToken in the WebSocket response if it exists
      const response = { message };
      if (resetToken !== undefined) {
        response.resetToken = resetToken;
      }
      client.send(JSON.stringify(response));
      console.log(`Message sent to client with email: ${email}`);
    } else {
      console.warn(`WebSocket for email ${email} is not open.`);
    }
  } else {
    console.warn(`No WebSocket client found for email: ${email}`);
  }

  res.json({
    message: 'Data received successfully!',
    receivedData: data,
  });
});

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, request) => {
  console.log('WebSocket connection established.');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const { email } = data;

      if (email) {
        // Map the email to this WebSocket connection
        clients.set(email, ws);
        console.log(`WebSocket client registered for email: ${email}`);
      } else {
        console.error('No email provided in WebSocket message.');
      }

      console.log('Received from client:', data);
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed.');

    // Remove WebSocket from the map
    for (const [email, client] of clients.entries()) {
      if (client === ws) {
        clients.delete(email);
        console.log(`WebSocket client removed for email: ${email}`);
        break;
      }
    }
  });
});

const server = app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});
