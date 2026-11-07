import { Router, Request, Response, NextFunction } from 'express';
import {
  createBooking,
  getMyBookings,
  getOwnerBookings,
  updateBookingStatus,
  createBlockedDate,
  handleEmailBookingAction,
  cancelBooking,
} from '../controllers/booking.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { verifyToken } from '../utils/jwt';

const router = Router();

// Middleware to extract user from token if present without rejecting public fallbacks
const optionalAuthenticate = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const payload = verifyToken(token);
      req.user = payload;
    } catch {}
  }
  next();
};

// Public 1-Click Email Action Route
router.get('/action', handleEmailBookingAction);

// Foreigner Routes
router.post('/', optionalAuthenticate, createBooking);
router.get('/my-bookings', optionalAuthenticate, getMyBookings);

// Cancel Booking Route
router.post('/:id/cancel', optionalAuthenticate, cancelBooking);

// Owner Routes
router.get('/owner-bookings', authenticate, authorize(['OWNER']), getOwnerBookings);
router.post('/blocked-dates', authenticate, authorize(['OWNER']), createBlockedDate);

// Shared Protected Route (Owner or Foreigner involved in booking)
router.patch('/:id/status', authenticate, updateBookingStatus);

export default router;

