import { Router } from 'express';
import {
  createBooking,
  getMyBookings,
  getOwnerBookings,
  updateBookingStatus,
  createBlockedDate,
  handleEmailBookingAction,
} from '../controllers/booking.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

// Public 1-Click Email Action Route
router.get('/action', handleEmailBookingAction);

// Foreigner Routes
router.post('/', authenticate, createBooking);
router.get('/my-bookings', getMyBookings);

// Owner Routes
router.get('/owner-bookings', authenticate, authorize(['OWNER']), getOwnerBookings);
router.post('/blocked-dates', authenticate, authorize(['OWNER']), createBlockedDate);

// Shared Protected Route (Owner or Foreigner involved in booking)
router.patch('/:id/status', authenticate, updateBookingStatus);

export default router;

