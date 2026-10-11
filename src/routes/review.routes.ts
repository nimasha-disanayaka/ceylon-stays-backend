import { Router } from 'express';
import { createReview, getOwnerReviews, replyToReview, getListingReviews } from '../controllers/review.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Traveler submits review
router.post('/', createReview);

// Public: Get reviews for a specific listing
router.get('/listing/:listingId', getListingReviews);

// Owner reviews list & metrics (UI Mockup 1)
router.get('/owner', getOwnerReviews);

// Owner replies to review
router.post('/:id/reply', replyToReview);

export default router;

