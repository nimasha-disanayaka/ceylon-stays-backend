import { Request, Response } from 'express';
import { prisma } from '../config/db';

// Deprecated in-memory reference retained for backward compatibility
export const liveSubmittedReviews: any[] = [];

// Create a guest review
export const createReview = async (req: Request, res: Response) => {
  const { bookingId, rating, comment, authorName: bodyAuthorName } = req.body || {};
  try {
    const authorId = req.user?.userId;

    if (!rating) {
      return res.status(400).json({ error: 'rating is required' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    // Find valid booking in PostgreSQL
    let targetBooking = await prisma.booking.findFirst({
      where: bookingId ? { id: bookingId } : (authorId ? { foreignerId: authorId } : {}),
      include: {
        listing: { include: { business: true } },
        foreigner: true,
      },
    });

    if (!targetBooking) {
      targetBooking = await prisma.booking.findFirst({
        include: {
          listing: { include: { business: true } },
          foreigner: true,
        },
      });
    }

    if (!targetBooking) {
      return res.status(404).json({ error: 'No booking found to attach review to' });
    }

    const reviewResult = await prisma.review.upsert({
      where: { bookingId: targetBooking.id },
      update: {
        rating: Number(rating),
        comment: comment || '',
      },
      create: {
        bookingId: targetBooking.id,
        authorId: authorId || targetBooking.foreignerId,
        rating: Number(rating),
        comment: comment || '',
      },
    });

    const finalAuthorName = (bodyAuthorName || targetBooking.foreigner?.name || (req.user as any)?.name || 'Guest').trim();
    const nameParts = finalAuthorName.split(' ');
    const initials = nameParts.length > 1
      ? `${nameParts[0][0]}${nameParts[1][0]}`.toUpperCase()
      : `${finalAuthorName[0]}${finalAuthorName[1] || 'G'}`.toUpperCase();

    const formattedReview = {
      id: reviewResult.id,
      initials,
      authorName: finalAuthorName,
      businessName: targetBooking.listing?.business?.name || 'Property',
      rating: Number(reviewResult.rating),
      comment: reviewResult.comment,
      reply: reviewResult.reply || null,
      createdAt: reviewResult.createdAt,
    };

    return res.status(201).json({
      message: 'Review created successfully',
      review: formattedReview,
    });
  } catch (error: any) {
    console.error('Error creating review:', error);
    return res.status(500).json({ error: 'Failed to create review', message: error?.message || 'Database error creating review' });
  }
};

// Get reviews for property owner dashboard
export const getOwnerReviews = async (req: Request, res: Response) => {
  try {
    const ownerId = req.user?.userId;

    const dbReviews = await prisma.review.findMany({
      where: ownerId
        ? {
            booking: {
              listing: {
                business: {
                  ownerId,
                },
              },
            },
          }
        : undefined,
      include: {
        booking: {
          include: {
            listing: { include: { business: true } },
            foreigner: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const reviews = dbReviews.map((r: any) => {
      const authorName = r.booking?.foreigner?.name || 'Guest';
      const nameParts = authorName.trim().split(' ');
      const initials = nameParts.length > 1
        ? `${nameParts[0][0]}${nameParts[1][0]}`.toUpperCase()
        : `${authorName[0]}${authorName[1] || 'G'}`.toUpperCase();

      return {
        id: r.id,
        initials,
        authorName,
        businessName: r.booking?.listing?.business?.name || 'My Property',
        rating: r.rating,
        comment: r.comment,
        reply: r.reply || null,
        createdAt: r.createdAt,
      };
    });

    const totalReviews = reviews.length;
    const awaitingReply = reviews.filter((r) => !r.reply).length;
    const avgSum = reviews.reduce((acc, r) => acc + r.rating, 0);
    const averageRating = totalReviews > 0 ? (avgSum / totalReviews).toFixed(1) : '0.0';

    return res.status(200).json({
      summary: {
        averageRating: Number(averageRating),
        totalReviews,
        awaitingReply,
      },
      reviews,
    });
  } catch (error: any) {
    console.error('Error fetching owner reviews:', error);
    return res.status(500).json({ error: 'Failed to fetch owner reviews', message: error?.message || 'Database error fetching owner reviews' });
  }
};

// Owner reply to a review
export const replyToReview = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reply } = req.body;

    if (!reply || !reply.trim()) {
      return res.status(400).json({ error: 'Reply text is required' });
    }

    const review = await prisma.review.update({
      where: { id },
      data: { reply: reply.trim() },
    });

    return res.status(200).json({ message: 'Reply posted successfully', review });
  } catch (error: any) {
    console.error('Error replying to review:', error);
    return res.status(500).json({ error: 'Failed to reply to review', message: error?.message || 'Database error replying to review' });
  }
};

// Get reviews for a specific listing (for Mobile App DetailScreen)
export const getListingReviews = async (req: Request, res: Response) => {
  const { listingId } = req.params;
  try {
    const dbReviews = await prisma.review.findMany({
      where: {
        booking: {
          listingId: listingId,
        },
      },
      include: {
        booking: {
          include: {
            foreigner: true,
            listing: { include: { business: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const reviews = dbReviews.map((r: any) => ({
      id: r.id,
      listingId,
      authorName: r.booking?.foreigner?.name || 'Traveler Guest',
      rating: r.rating,
      comment: r.comment,
      reply: r.reply || null,
      createdAt: r.createdAt,
    }));

    const totalReviews = reviews.length;
    const avgSum = reviews.reduce((sum, r) => sum + r.rating, 0);
    const averageRating = totalReviews > 0 ? (avgSum / totalReviews).toFixed(1) : '0.0';

    return res.status(200).json({
      summary: {
        averageRating: Number(averageRating),
        totalReviews,
      },
      reviews,
    });
  } catch (err: any) {
    console.error('Error fetching listing reviews:', err);
    return res.status(500).json({
      error: 'Failed to fetch reviews',
      message: err?.message || 'Database error fetching listing reviews',
    });
  }
};


