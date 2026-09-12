import 'dotenv/config';
import app from './app.js';
import { connectDB } from './config/database.js';

const PORT = process.env.PORT || 5001;

async function startServer() {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(`Gateway server running on port ${PORT}`);
    });
  } catch (error) {
    console.error(`Failed to start Gateway server: ${error.message}`);
    process.exit(1);
  }
}

startServer();
