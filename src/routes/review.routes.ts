import { Router } from 'express';
import { createReview, getOwnerReviews, replyToReview } from '../controllers/review.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Traveler submits review
router.post('/', createReview);

// Owner reviews list & metrics (UI Mockup 1)
router.get('/owner', getOwnerReviews);

// Owner replies to review
router.post('/:id/reply', authenticate, replyToReview);

export default router;
