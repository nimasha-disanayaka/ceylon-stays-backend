import { Request, Response } from 'express';
import Stripe from 'stripe';
import { prisma } from '../config/db';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' as any }) : null;

/**
 * @route POST /api/payments/create-intent
 * @desc  Create a Stripe PaymentIntent for a booking
 */
export const createPaymentIntent = async (req: Request, res: Response) => {
  try {
    const { bookingId, amount, currency = 'usd' } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const amountInCents = Math.round(Number(amount) * 100);

    // If Stripe secret key is configured, use real Stripe API
    if (stripe) {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: currency.toLowerCase(),
        metadata: {
          bookingId: bookingId || 'direct',
        },
        automatic_payment_methods: {
          enabled: true,
        },
      });

      return res.status(200).json({
        success: true,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: Number(amount),
        currency,
        status: paymentIntent.status,
      });
    }

    // Seamless Test Mode fallback when running in local development
    const simulatedIntentId = `pi_test_${Date.now()}`;
    const simulatedClientSecret = `${simulatedIntentId}_secret_${Math.random().toString(36).substring(2, 10)}`;

    return res.status(200).json({
      success: true,
      clientSecret: simulatedClientSecret,
      paymentIntentId: simulatedIntentId,
      amount: Number(amount),
      currency,
      status: 'requires_payment_method',
      mode: 'DEV_SIMULATION',
    });
  } catch (error: any) {
    console.error('Create PaymentIntent Error:', error);
    return res.status(500).json({ error: error.message || 'Failed to create payment intent' });
  }
};

/**
 * @route POST /api/payments/confirm
 * @desc  Confirm payment completion and update booking in PostgreSQL
 */
export const confirmPayment = async (req: Request, res: Response) => {
  try {
    const { bookingId, paymentIntentId } = req.body;

    if (!bookingId) {
      return res.status(400).json({ error: 'bookingId is required' });
    }

    const updatedBooking = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        paymentStatus: 'PAID',
        status: 'CONFIRMED',
      },
      include: {
        listing: { include: { business: true } },
      },
    });

    return res.status(200).json({
      message: 'Payment confirmed successfully! Reservation status is now CONFIRMED.',
      paymentIntentId: paymentIntentId || `pi_confirmed_${Date.now()}`,
      booking: updatedBooking,
    });
  } catch (error: any) {
    console.error('Confirm Payment Error:', error);
    return res.status(500).json({ error: 'Failed to confirm payment status' });
  }
};
