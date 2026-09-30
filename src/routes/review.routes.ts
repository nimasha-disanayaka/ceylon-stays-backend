import { Router } from 'express';
import { createReview, getOwnerReviews, replyToReview } from '../controllers/review.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// Traveler submits review
router.post('/', authenticateToken, createReview);

// Owner reviews list & metrics (UI Mockup 1)
router.get('/owner', authenticateToken, getOwnerReviews);

// Owner replies to review
router.post('/:id/reply', authenticateToken, replyToReview);

export default router;
