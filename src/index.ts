import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import businessRoutes from './routes/business.routes';
import listingRoutes from './routes/listing.routes';
import bookingRoutes from './routes/booking.routes';
import reviewRoutes from './routes/review.routes';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/reviews', reviewRoutes);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'OK',
    message: 'Booking Platform Backend API is running smoothly!',
    timestamp: new Date().toISOString(),
  });
});

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`🚀 Server is running on http://0.0.0.0:${PORT} (Accessible at http://192.168.8.138:${PORT})`);
});
