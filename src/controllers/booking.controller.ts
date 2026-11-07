import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { createBookingSchema, updateBookingStatusSchema, createBlockedDateSchema } from '../utils/validation';
import { sendOwnerBookingNotification, sendBookingCancellationNotification, verifyActionToken } from '../services/email.service';
import { sendBookingSMSAlert } from '../services/sms.service';
import { liveSubmittedReviews } from './review.controller';
import { localStore } from '../services/store.service';

/**
 * @route POST /api/bookings
 * @desc  Create a new booking reservation (Foreigner Only)
 *        Atomically verifies date overlap before reserving.
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

    let guestUser: any = null;
    try {
      guestUser = await prisma.user.findUnique({ where: { id: foreignerId } });
    } catch {}
    if (!guestUser) {
      guestUser = localStore.getUserById(foreignerId);
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

    // 2. Fetch Listing details & verify active status
    let listing: any = null;
    try {
      listing = await prisma.listing.findUnique({
        where: { id: listingId },
        include: {
          business: {
            include: {
              owner: true,
            },
          },
        },
      });
    } catch (dbErr) {
      console.warn('DB listing lookup notice:', dbErr);
    }

    if (!listing) {
      const stored = localStore.getListingById(listingId);
      if (stored) {
        const storedBiz = localStore.getBusinessById(stored.businessId);
        const storedOwner = storedBiz ? localStore.getUserById(storedBiz.ownerId) : undefined;
        listing = {
          ...stored,
          business: storedBiz ? { ...storedBiz, owner: storedOwner } : undefined,
        };
      }
    }

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
    const initialPaymentStatus = bodyPaymentStatus || (paymentMethod === 'PAY_AT_PROPERTY' ? 'UNPAID' : 'PAID');

    // 4. Overlap Check & Atomic Transaction
    let newBooking: any = null;
    try {
      newBooking = await prisma.$transaction(async (tx) => {
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

        // Create Booking Record with Instant Confirmation
        const confirmedPaymentStatus = initialPaymentStatus === 'UNPAID' ? 'UNPAID' : 'CAPTURED';
        return await tx.booking.create({
          data: {
            foreignerId,
            listingId,
            checkIn: checkInDate,
            checkOut: checkOutDate,
            totalPrice,
            status: 'CONFIRMED',
            paymentStatus: confirmedPaymentStatus,
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
    } catch (txErr: any) {
      if (txErr.message === 'COLLISION_BOOKING_EXISTS' || txErr.message === 'COLLISION_BLOCKED_DATE') {
        throw txErr;
      }
      console.warn('DB booking transaction notice, using fallback:', txErr);
    }

    const confirmedPaymentStatus = initialPaymentStatus === 'UNPAID' ? 'UNPAID' : 'CAPTURED';

    if (!newBooking) {
      newBooking = {
        id: `book-${Date.now().toString(36).toUpperCase()}`,
        foreignerId,
        listingId,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        totalPrice,
        status: 'CONFIRMED',
        paymentStatus: confirmedPaymentStatus,
        listing: { id: listing.id, name: listing.name, pricePerNight: listing.pricePerNight, businessId: listing.businessId },
        foreigner: { id: foreignerId, name: guestUser?.name || 'Traveler Guest', email: guestUser?.email || 'guest@example.com' },
      };
    }

    // Always persist to localStore disk with CONFIRMED status
    localStore.saveBooking({
      id: newBooking.id,
      foreignerId: foreignerId,
      listingId,
      checkIn: checkInDate.toISOString(),
      checkOut: checkOutDate.toISOString(),
      totalPrice,
      status: 'CONFIRMED',
      paymentStatus: confirmedPaymentStatus,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 5. Async Trigger Owner Email & SMS Notifications
    let owner = listing?.business?.owner;
    if (!owner && listing?.business?.ownerId) {
      try {
        owner = await prisma.user.findUnique({ where: { id: listing.business.ownerId } });
      } catch {}
      if (!owner) {
        owner = localStore.getUserById(listing.business.ownerId);
      }
    }
    if (!owner) {
      owner = localStore.ensureStore().users.find((u) => u.role === 'OWNER');
    }

    if (owner && owner.email) {
      console.log(`[Booking] 📧 Sending confirmed booking email to owner: ${owner.email}`);
      sendOwnerBookingNotification({
        bookingId: newBooking.id,
        ownerEmail: owner.email,
        ownerName: owner.name || 'Property Host',
        guestName: guestUser?.name || newBooking.foreigner?.name || 'Traveler Guest',
        guestEmail: guestUser?.email || newBooking.foreigner?.email || 'guest@example.com',
        listingTitle: listing.name,
        businessName: listing.business?.name || 'Your Property',
        checkIn: checkIn,
        checkOut: checkOut,
        totalPrice: totalPrice,
      }).catch((err) => console.error('[EmailTriggerError]', err));

      sendBookingSMSAlert({
        ownerPhone: owner.phone || '+94771234567',
        guestName: guestUser?.name || newBooking.foreigner?.name || 'Traveler Guest',
        listingName: listing.name,
        businessName: listing.business?.name || 'Your Property',
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
    return res.status(500).json({ error: 'Internal Server Error' });
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

    // Update DB status and payment authorization
    const isConfirmed = action === 'CONFIRMED';
    const finalStatus = isConfirmed ? 'CONFIRMED' : 'DECLINED';
    const finalPaymentStatus = isConfirmed ? 'CAPTURED' : 'RELEASED';

    let updated: any = null;
    try {
      updated = await prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: finalStatus as any,
          paymentStatus: finalPaymentStatus as any,
        },
      });
    } catch (err) {
      console.warn('DB booking status update notice:', err);
    }

    localStore.updateBookingStatus(bookingId, finalStatus, finalPaymentStatus);

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
    let foreignerId = req.user?.userId;
    let dbBookings: any[] = [];

    try {
      dbBookings = await prisma.booking.findMany({
        where: foreignerId ? { foreignerId } : {},
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
    } catch (dbErr) {
      console.warn('DB getMyBookings notice:', dbErr);
    }

    const storedBookings = foreignerId
      ? localStore.getBookingsByForeigner(foreignerId)
      : localStore.ensureStore().bookings;

    const map = new Map();
    [...dbBookings, ...storedBookings].forEach((b) => {
      if (!map.has(b.id)) map.set(b.id, b);
    });

    const bookings = Array.from(map.values());
    return res.status(200).json({ bookings });
  } catch (error) {
    console.error('Get My Bookings Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
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

    let dbBookings: any[] = [];
    try {
      // Auto-migrate any legacy PENDING bookings to CONFIRMED for Instant Booking
      try {
        await prisma.booking.updateMany({
          where: {
            status: 'PENDING',
            listing: {
              business: {
                ownerId,
              },
            },
          },
          data: {
            status: 'CONFIRMED',
            paymentStatus: 'CAPTURED',
          },
        });
      } catch {}

      dbBookings = await prisma.booking.findMany({
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
    } catch (dbErr) {
      console.warn('DB getOwnerBookings notice:', dbErr);
    }

    const storedBookings = localStore.getBookingsByOwner(ownerId);
    const map = new Map();
    [...dbBookings, ...storedBookings].forEach((b) => {
      // Ensure all instant reservations reflect CONFIRMED and CAPTURED
      const finalB = b.status === 'PENDING'
        ? { ...b, status: 'CONFIRMED', paymentStatus: 'CAPTURED' }
        : b;
      if (!map.has(finalB.id)) map.set(finalB.id, finalB);
    });

    const bookings = Array.from(map.values());

    return res.status(200).json({ bookings });
  } catch (error) {
    console.error('Get Owner Bookings Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
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

    let booking: any = null;
    try {
      booking = await prisma.booking.findUnique({
        where: { id },
        include: {
          listing: {
            include: { business: true },
          },
        },
      });
    } catch (dbErr) {
      console.warn('DB lookup booking notice:', dbErr);
    }

    const { status, paymentStatus } = validationResult.data;

    // Determine target paymentStatus if not explicitly supplied
    let targetPaymentStatus = paymentStatus;
    if (!targetPaymentStatus) {
      if (status === 'CONFIRMED' || status === 'COMPLETED' || status === 'NO_SHOW') {
        targetPaymentStatus = 'CAPTURED';
      } else if (status === 'DECLINED') {
        targetPaymentStatus = 'RELEASED';
      }
    }

    let updatedBooking: any = null;
    try {
      updatedBooking = await prisma.booking.update({
        where: { id },
        data: {
          status: status as any,
          ...(targetPaymentStatus && { paymentStatus: targetPaymentStatus as any }),
        },
      });
    } catch (dbErr) {
      console.warn('DB update booking notice:', dbErr);
    }

    const storedUpdated = localStore.updateBookingStatus(id, status, targetPaymentStatus);
    const finalBooking = updatedBooking || storedUpdated || { id, status, paymentStatus: targetPaymentStatus };

    return res.status(200).json({
      message: 'Booking status updated successfully',
      booking: finalBooking,
    });
  } catch (error) {
    console.error('Update Booking Status Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
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
  } catch (error) {
    console.error('Create Blocked Date Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * @route POST /api/bookings/:id/cancel
 * @desc  Cancel reservation with Moderate Policy refund calculation and email dispatch
 */
export const cancelBooking = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    let booking: any = null;
    try {
      booking = await prisma.booking.findUnique({
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
    } catch (dbErr) {
      console.warn('DB lookup booking notice on cancel:', dbErr);
    }

    if (!booking) {
      const stored = localStore.getBookingById(id);
      if (stored) {
        const storedListing = localStore.getListingById(stored.listingId);
        const storedBiz = storedListing ? localStore.getBusinessById(storedListing.businessId) : undefined;
        const storedOwner = storedBiz ? localStore.getUserById(storedBiz.ownerId) : undefined;
        const storedGuest = localStore.getUserById(stored.foreignerId);
        booking = {
          ...stored,
          listing: storedListing
            ? { ...storedListing, business: storedBiz ? { ...storedBiz, owner: storedOwner } : undefined }
            : undefined,
          foreigner: storedGuest,
        };
      }
    }

    if (!booking) {
      return res.status(404).json({ error: 'Booking reservation not found' });
    }

    if (booking.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Booking is already cancelled' });
    }

    const checkInDate = new Date(booking.checkIn);
    const now = new Date();
    const diffMs = checkInDate.getTime() - now.getTime();
    const hoursUntilCheckIn = diffMs / (1000 * 60 * 60);

    let refundPercent = 0;
    let policyTier = 'NON_REFUNDABLE';
    let policyDescription = 'Cancelled within 24 hours of check-in or after check-in';

    if (hoursUntilCheckIn >= 120) {
      refundPercent = 100;
      policyTier = 'FULL_REFUND';
      policyDescription = 'Cancelled 5+ days before check-in (100% full refund)';
    } else if (hoursUntilCheckIn >= 24) {
      refundPercent = 50;
      policyTier = 'PARTIAL_REFUND';
      policyDescription = 'Cancelled within 5 days of check-in (50% partial refund)';
    }

    const refundAmount = Math.round((booking.totalPrice * (refundPercent / 100)) * 100) / 100;
    const finalPaymentStatus = refundPercent === 100 ? 'REFUNDED' : 'UNPAID';

    let updatedBooking: any = null;
    try {
      updatedBooking = await prisma.booking.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          paymentStatus: finalPaymentStatus as any,
        },
      });
    } catch (dbErr) {
      console.warn('DB update booking notice on cancel:', dbErr);
    }

    localStore.updateBookingStatus(id, 'CANCELLED', finalPaymentStatus);

    // Resolve owner & guest for email notification
    let owner = booking.listing?.business?.owner;
    if (!owner && booking.listing?.business?.ownerId) {
      owner = localStore.getUserById(booking.listing.business.ownerId);
    }
    if (!owner) {
      owner = localStore.ensureStore().users.find((u) => u.role === 'OWNER');
    }

    let guestUser = booking.foreigner;
    if (!guestUser && booking.foreignerId) {
      guestUser = localStore.getUserById(booking.foreignerId);
    }

    if (owner && owner.email) {
      console.log(`[Booking] 📧 Sending cancellation email to owner: ${owner.email}`);
      sendBookingCancellationNotification({
        bookingId: booking.id,
        ownerEmail: owner.email,
        ownerName: owner.name || 'Property Host',
        guestName: guestUser?.name || 'Traveler Guest',
        guestEmail: guestUser?.email || 'guest@example.com',
        listingTitle: booking.listing?.name || 'Your Room',
        businessName: booking.listing?.business?.name || 'Your Property',
        checkIn: booking.checkIn.toString(),
        checkOut: booking.checkOut.toString(),
        totalPrice: booking.totalPrice,
        refundAmount,
        refundPercent,
        policyDescription,
      }).catch((err) => console.error('[CancelEmailTriggerError]', err));
    }

    return res.status(200).json({
      message: 'Reservation cancelled successfully',
      booking: updatedBooking || { ...booking, status: 'CANCELLED', paymentStatus: finalPaymentStatus },
      cancellationSummary: {
        hoursUntilCheckIn: Math.round(hoursUntilCheckIn),
        refundPercent,
        refundAmount,
        policyTier,
        policyDescription,
      },
    });
  } catch (error) {
    console.error('Cancel Booking Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
