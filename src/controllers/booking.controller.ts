import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { BookingStatus, PaymentStatus } from '@prisma/client';
import { createBookingSchema, updateBookingStatusSchema, createBlockedDateSchema } from '../utils/validation';
import { sendOwnerBookingNotification, sendBookingCancellationNotification, verifyActionToken } from '../services/email.service';
import { sendBookingSMSAlert } from '../services/sms.service';
import { calculateCancellationRefund } from '../utils/cancellation';

/**
 * @route POST /api/bookings
 * @desc  Create a new booking reservation (Foreigner Only)
 *        Atomically verifies date overlap before reserving using row-level locking.
 */
export const createBooking = async (req: Request, res: Response) => {
  try {
    // 0. Enforce Traveler Authentication
    const foreignerId = req.user?.userId;
    if (!foreignerId) {
      return res.status(401).json({
        error: 'Unauthorized: You must be signed in as a traveler to reserve a room.',
      });
    }

    const guestUser = await prisma.user.findUnique({ where: { id: foreignerId } });
    if (!guestUser) {
      return res.status(401).json({ error: 'Guest user account not found in database' });
    }

    // 1. Validate Input Body with Zod
    const validationResult = createBookingSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation Error',
        details: validationResult.error.flatten().fieldErrors,
      });
    }

    const { listingId, checkIn, checkOut } = validationResult.data;
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);

    // 2. Fetch Listing details & verify active status from PostgreSQL
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        business: {
          include: {
            owner: true,
          },
        },
      },
    });

    if (!listing || !listing.isActive) {
      return res.status(404).json({ error: 'Listing not found or currently inactive' });
    }

    // 3. Calculate Total Nights & Price
    const diffInMs = checkOutDate.getTime() - checkInDate.getTime();
    const totalNights = Math.ceil(diffInMs / (1000 * 60 * 60 * 24));

    if (totalNights < 1) {
      return res.status(400).json({ error: 'Booking must be at least 1 night' });
    }

    const totalPrice = totalNights * listing.pricePerNight;

    const { paymentMethod, paymentStatus: bodyPaymentStatus } = req.body;
    // Preserve payment status: do not mark CAPTURED unless payment actually succeeded
    let bookingPaymentStatus: 'UNPAID' | 'PAID' | 'CAPTURED' = 'UNPAID';
    if (bodyPaymentStatus === 'PAID' || bodyPaymentStatus === 'CAPTURED') {
      bookingPaymentStatus = bodyPaymentStatus;
    } else if (paymentMethod === 'PAY_AT_PROPERTY') {
      bookingPaymentStatus = 'UNPAID';
    } else if (bodyPaymentStatus) {
      bookingPaymentStatus = bodyPaymentStatus;
    }

    // 4. Overlap Check & Atomic Transaction with Listing Row-Locking for Concurrency Safety
    const newBooking = await prisma.$transaction(async (tx) => {
      // Row lock on listing to serialize concurrent bookings on this specific listing
      await tx.$queryRaw`SELECT id FROM "Listing" WHERE id = ${listingId} FOR UPDATE`;

      // Check overlapping confirmed or pending bookings
      const existingOverlap = await tx.booking.findFirst({
        where: {
          listingId,
          status: { in: ['CONFIRMED', 'PENDING'] },
          AND: [
            { checkIn: { lt: checkOutDate } },
            { checkOut: { gt: checkInDate } },
          ],
        },
      });

      if (existingOverlap) {
        throw new Error('COLLISION_BOOKING_EXISTS');
      }

      // Check overlapping blocked dates set by owner
      const blockedOverlap = await tx.blockedDate.findFirst({
        where: {
          listingId,
          AND: [
            { startDate: { lt: checkOutDate } },
            { endDate: { gt: checkInDate } },
          ],
        },
      });

      if (blockedOverlap) {
        throw new Error('COLLISION_BLOCKED_DATE');
      }

      // Create Booking Record in PostgreSQL
      return await tx.booking.create({
        data: {
          foreignerId,
          listingId,
          checkIn: checkInDate,
          checkOut: checkOutDate,
          totalPrice,
          status: 'CONFIRMED',
          paymentStatus: bookingPaymentStatus,
        },
        include: {
          listing: {
            select: { id: true, name: true, pricePerNight: true, businessId: true },
          },
          foreigner: {
            select: { id: true, name: true, email: true },
          },
        },
      });
    });

    // 5. Async Trigger Owner Email & SMS Notifications
    const owner = listing.business.owner;
    if (owner && owner.email) {
      console.log(`[Booking] 📧 Sending confirmed booking email to owner: ${owner.email}`);
      sendOwnerBookingNotification({
        bookingId: newBooking.id,
        ownerEmail: owner.email,
        ownerName: owner.name || 'Property Host',
        guestName: guestUser.name || 'Traveler Guest',
        guestEmail: guestUser.email,
        listingTitle: listing.name,
        businessName: listing.business.name || 'Your Property',
        checkIn: checkIn,
        checkOut: checkOut,
        totalPrice: totalPrice,
      }).catch((err) => console.error('[EmailTriggerError]', err));

      sendBookingSMSAlert({
        ownerPhone: owner.phone || '+94771234567',
        guestName: guestUser.name || 'Traveler Guest',
        listingName: listing.name,
        businessName: listing.business.name || 'Your Property',
        checkIn: checkIn,
        checkOut: checkOut,
        totalPrice: totalPrice,
      }).catch((err) => console.error('[SMSTriggerError]', err));
    }

    return res.status(201).json({
      message: 'Booking reserved successfully',
      booking: {
        ...newBooking,
        totalNights,
      },
    });
  } catch (error: any) {
    if (error.message === 'COLLISION_BOOKING_EXISTS') {
      return res.status(409).json({ error: 'Conflict: This listing is already booked for the selected dates' });
    }
    if (error.message === 'COLLISION_BLOCKED_DATE') {
      return res.status(409).json({ error: 'Conflict: Owner has blocked availability for the selected dates' });
    }
    console.error('Create Booking Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error?.message || 'Database error creating booking' });
  }
};

/**
 * @route GET /api/bookings/action
 * @desc  1-Click Action Link processing via email token (Accept / Decline)
 */
export const handleEmailBookingAction = async (req: Request, res: Response) => {
  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Invalid Action Link</title></head>
      <body style="font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
        <div style="background: #1e293b; padding: 40px; border-radius: 16px; border: 1px solid #334155; text-align: center; max-width: 450px;">
          <h2 style="color: #ef4444; margin-top: 0;">⚠️ Action Link Missing</h2>
          <p style="color: #94a3b8;">This link is invalid or has expired.</p>
        </div>
      </body>
      </html>
    `);
  }

  try {
    const payload = verifyActionToken(token);
    const { bookingId, action } = payload;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        listing: {
          select: { name: true },
        },
      },
    });

    if (!booking) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Booking Not Found</title></head>
        <body style="font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
          <div style="background: #1e293b; padding: 40px; border-radius: 16px; border: 1px solid #334155; text-align: center; max-width: 450px;">
            <h2 style="color: #ef4444; margin-top: 0;">🔍 Booking Not Found</h2>
            <p style="color: #94a3b8;">The requested booking record no longer exists.</p>
          </div>
        </body>
        </html>
      `);
    }

    const isConfirmed = action === 'CONFIRMED';
    const finalStatus: BookingStatus = isConfirmed ? BookingStatus.CONFIRMED : BookingStatus.DECLINED;
    const finalPaymentStatus: PaymentStatus = isConfirmed ? PaymentStatus.CAPTURED : PaymentStatus.RELEASED;

    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: finalStatus,
        paymentStatus: finalPaymentStatus,
      },
    });

    const statusColor = isConfirmed ? '#16a34a' : '#dc2626';
    const statusTitle = isConfirmed ? 'Reservation Confirmed! 🎉' : 'Reservation Declined 🛑';
    const statusMsg = isConfirmed
      ? `You have successfully ACCEPTED the booking for <strong>${booking.listing.name}</strong>.`
      : `You have DECLINED the booking request for <strong>${booking.listing.name}</strong>.`;

    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${isConfirmed ? 'Booking Confirmed' : 'Booking Declined'}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box;">
        <div style="background: #1e293b; padding: 40px; border-radius: 20px; border: 1px solid #334155; text-align: center; max-width: 480px; width: 100%; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
          <div style="width: 64px; height: 64px; background: ${statusColor}20; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px;">
            <span style="font-size: 32px;">${isConfirmed ? '✅' : '❌'}</span>
          </div>
          <h1 style="font-size: 24px; color: ${statusColor}; margin: 0 0 12px 0;">${statusTitle}</h1>
          <p style="color: #cbd5e1; font-size: 16px; line-height: 1.5; margin-bottom: 28px;">${statusMsg}</p>
          <div style="background: #0f172a; padding: 16px; border-radius: 12px; border: 1px solid #334155; margin-bottom: 28px; text-align: left;">
            <div style="font-size: 13px; color: #94a3b8; margin-bottom: 4px;">Booking Reference ID</div>
            <div style="font-family: monospace; font-size: 15px; color: #38bdf8; font-weight: 600;">${updated.id}</div>
            <div style="font-size: 13px; color: #94a3b8; margin-top: 12px; margin-bottom: 4px;">Current Status</div>
            <div style="font-size: 14px; font-weight: 700; color: ${statusColor};">${updated.status}</div>
          </div>
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard" style="display: inline-block; background: #3b82f6; color: #ffffff; padding: 12px 28px; border-radius: 10px; font-weight: 600; text-decoration: none; box-shadow: 0 4px 14px 0 rgba(59, 130, 246, 0.39);">Return to Owner Dashboard</a>
        </div>
      </body>
      </html>
    `);
  } catch (error: any) {
    console.error('Handle Email Action Error:', error);
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Link Expired or Invalid</title></head>
      <body style="font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
        <div style="background: #1e293b; padding: 40px; border-radius: 16px; border: 1px solid #334155; text-align: center; max-width: 450px;">
          <h2 style="color: #ef4444; margin-top: 0;">⚠️ Action Link Expired</h2>
          <p style="color: #94a3b8;">This action token has expired or is invalid. Please log in to your owner dashboard to manage the booking.</p>
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard" style="display: inline-block; background: #3b82f6; color: #ffffff; padding: 10px 20px; border-radius: 8px; font-weight: 600; text-decoration: none; margin-top: 16px;">Go to Dashboard</a>
        </div>
      </body>
      </html>
    `);
  }
};

/**
 * @route GET /api/bookings/my-bookings
 * @desc  Get logged-in Foreigner's booking history (Foreigner Only)
 */
export const getMyBookings = async (req: Request, res: Response) => {
  try {
    const foreignerId = req.user?.userId;
    if (!foreignerId) {
      return res.status(401).json({ error: 'Unauthorized: User identity not found' });
    }

    const bookings = await prisma.booking.findMany({
      where: { foreignerId },
      include: {
        listing: {
          include: {
            business: {
              select: { id: true, name: true, type: true, address: true, imageUrls: true },
            },
          },
        },
        review: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ bookings });
  } catch (error: any) {
    console.error('Get My Bookings Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error?.message || 'Database error fetching bookings' });
  }
};

/**
 * @route GET /api/bookings/owner-bookings
 * @desc  Get incoming bookings for all listings owned by logged-in Owner (Owner Only)
 */
export const getOwnerBookings = async (req: Request, res: Response) => {
  try {
    const ownerId = req.user?.userId;
    if (!ownerId) {
      return res.status(401).json({ error: 'Unauthorized: User identity not found' });
    }

    const bookings = await prisma.booking.findMany({
      where: {
        listing: {
          business: {
            ownerId,
          },
        },
      },
      include: {
        foreigner: {
          select: { id: true, name: true, email: true, phone: true },
        },
        listing: {
          include: {
            business: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ bookings });
  } catch (error: any) {
    console.error('Get Owner Bookings Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error?.message || 'Database error fetching owner bookings' });
  }
};

/**
 * @route PATCH /api/bookings/:id/status
 * @desc  Update booking status / payment status (Owner or Traveler depending on action)
 */
export const updateBookingStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validate Input Body
    const validationResult = updateBookingStatusSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation Error',
        details: validationResult.error.flatten().fieldErrors,
      });
    }

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        listing: {
          include: { business: true },
        },
      },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const { status, paymentStatus } = validationResult.data;

    // Determine target paymentStatus if not explicitly supplied
    let targetPaymentStatus: PaymentStatus | undefined = paymentStatus as PaymentStatus | undefined;
    if (!targetPaymentStatus) {
      if (status === 'CONFIRMED' || status === 'COMPLETED' || status === 'NO_SHOW') {
        targetPaymentStatus = PaymentStatus.CAPTURED;
      } else if (status === 'DECLINED') {
        targetPaymentStatus = PaymentStatus.RELEASED;
      }
    }

    const updatedBooking = await prisma.booking.update({
      where: { id },
      data: {
        status: status as BookingStatus,
        ...(targetPaymentStatus && { paymentStatus: targetPaymentStatus }),
      },
    });

    return res.status(200).json({
      message: 'Booking status updated successfully',
      booking: updatedBooking,
    });
  } catch (error: any) {
    console.error('Update Booking Status Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error?.message || 'Database error updating booking status' });
  }
};

/**
 * @route POST /api/bookings/blocked-dates
 * @desc  Block dates for a listing (Owner Only - for maintenance, off-season, etc.)
 */
export const createBlockedDate = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized identity' });
    }

    const validationResult = createBlockedDateSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation Error',
        details: validationResult.error.flatten().fieldErrors,
      });
    }

    const { listingId, startDate, endDate, reason } = validationResult.data;

    // Check business ownership
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: { business: true },
    });

    if (!listing || listing.business.ownerId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this listing' });
    }

    const blockedDate = await prisma.blockedDate.create({
      data: {
        listingId,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason,
      },
    });

    return res.status(201).json({
      message: 'Dates blocked successfully',
      blockedDate,
    });
  } catch (error: any) {
    console.error('Create Blocked Date Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error?.message || 'Database error blocking dates' });
  }
};

/**
 * @route POST /api/bookings/:id/cancel
 * @desc  Cancel reservation with Moderate Policy refund calculation and email dispatch
 */
export const cancelBooking = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        listing: {
          include: {
            business: {
              include: { owner: true },
            },
          },
        },
        foreigner: true,
      },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking reservation not found' });
    }

    if (booking.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Booking is already cancelled' });
    }

    const refundCalc = calculateCancellationRefund(
      booking.checkIn,
      booking.totalPrice,
      booking.paymentStatus
    );

    const updatedBooking = await prisma.booking.update({
      where: { id },
      data: {
        status: BookingStatus.CANCELLED,
        paymentStatus: refundCalc.targetPaymentStatus,
      },
    });

    // Resolve owner & guest for email notification
    const owner = booking.listing.business.owner;
    const guestUser = booking.foreigner;

    if (owner && owner.email) {
      console.log(`[Booking] 📧 Sending cancellation email to owner: ${owner.email}`);
      sendBookingCancellationNotification({
        bookingId: booking.id,
        ownerEmail: owner.email,
        ownerName: owner.name || 'Property Host',
        guestName: guestUser?.name || 'Traveler Guest',
        guestEmail: guestUser?.email || 'guest@example.com',
        listingTitle: booking.listing.name || 'Your Room',
        businessName: booking.listing.business.name || 'Your Property',
        checkIn: booking.checkIn.toString(),
        checkOut: booking.checkOut.toString(),
        totalPrice: booking.totalPrice,
        refundAmount: refundCalc.refundAmount,
        refundPercent: refundCalc.refundPercent,
        policyDescription: refundCalc.policyDescription,
      }).catch((err) => console.error('[CancelEmailTriggerError]', err));
    }

    return res.status(200).json({
      message: 'Reservation cancelled successfully',
      booking: updatedBooking,
      cancellationSummary: {
        hoursUntilCheckIn: refundCalc.hoursUntilCheckIn,
        refundPercent: refundCalc.refundPercent,
        refundAmount: refundCalc.refundAmount,
        policyTier: refundCalc.policyTier,
        policyDescription: refundCalc.policyDescription,
        isEligibleForRefund: refundCalc.isEligibleForRefund,
        refundExecutionStatus: refundCalc.refundExecutionStatus,
        refundCompleted: refundCalc.refundCompleted,
      },
    });
  } catch (error: any) {
    console.error('Cancel Booking Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error?.message || 'Database error cancelling booking' });
  }
};
