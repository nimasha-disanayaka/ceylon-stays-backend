import { Router } from 'express';
import { createPaymentIntent, confirmPayment } from '../controllers/payment.controller';

const router = Router();

// Create Stripe PaymentIntent
router.post('/create-intent', createPaymentIntent);

// Confirm payment status
router.post('/confirm', confirmPayment);

export default router;
