import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { createListingSchema, updateListingSchema } from '../utils/validation';
import { BusinessType } from '@prisma/client';

/**
 * @route POST /api/listings
 * @desc  Create a new listing room/item (Owner Only - must own the business)
 */
export const createListing = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized identity' });
    }

    // 1. Validate Input Body
    const validationResult = createListingSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation Error',
        details: validationResult.error.flatten().fieldErrors,
      });
    }

    const { businessId, name, description, pricePerNight, maxGuests, amenities, isActive } = validationResult.data;

    // 2. Verify business exists and belongs to logged-in owner
    const business = await prisma.business.findUnique({
      where: { id: businessId },
    });

    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    if (business.ownerId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this business' });
    }

    // 3. Create Listing
    const listing = await prisma.listing.create({
      data: {
        businessId,
        name,
        description,
        pricePerNight,
        maxGuests,
        amenities,
        isActive,
      },
    });

    return res.status(201).json({
      message: 'Listing created successfully',
      listing,
    });
  } catch (error) {
    console.error('Create Listing Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * @route GET /api/listings/business/:businessId
 * @desc  Get all listings for a business (Public)
 */
export const getListingsByBusiness = async (req: Request, res: Response) => {
  try {
    const { businessId } = req.params;

    const listings = await prisma.listing.findMany({
      where: { businessId, isActive: true },
      orderBy: { pricePerNight: 'asc' },
    });

    return res.status(200).json({ listings });
  } catch (error) {
    console.error('Get Listings By Business Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * @route GET /api/listings/search
 * @desc  Public Search API for Travelers (Filters: type, maxPrice, guests, query)
 */
export const searchListings = async (req: Request, res: Response) => {
  try {
    const { type, maxPrice, guests, query } = req.query;

    const whereClause: any = {
      isActive: true,
      business: {},
    };

    if (type) {
      whereClause.business.type = type as BusinessType;
    }

    if (maxPrice) {
      whereClause.pricePerNight = { lte: parseFloat(maxPrice as string) };
    }

    if (guests) {
      whereClause.maxGuests = { gte: parseInt(guests as string, 10) };
    }

    if (query) {
      whereClause.OR = [
        { name: { contains: query as string, mode: 'insensitive' } },
        { description: { contains: query as string, mode: 'insensitive' } },
        { business: { name: { contains: query as string, mode: 'insensitive' } } },
        { business: { address: { contains: query as string, mode: 'insensitive' } } },
      ];
    }

    const listings = await prisma.listing.findMany({
      where: whereClause,
      include: {
        business: {
          select: { id: true, name: true, type: true, address: true, latitude: true, longitude: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      count: listings.length,
      listings,
    });
  } catch (error) {
    console.error('Search Listings Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * @route PUT /api/listings/:id
 * @desc  Update a listing (Owner Only - must own the business)
 */
export const updateListing = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized identity' });
    }

    const { id } = req.params;

    // 1. Fetch listing and check business ownership
    const listing = await prisma.listing.findUnique({
      where: { id },
      include: { business: true },
    });

    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    if (listing.business.ownerId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this business' });
    }

    // 2. Validate Input
    const validationResult = updateListingSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation Error',
        details: validationResult.error.flatten().fieldErrors,
      });
    }

    // 3. Update Listing
    const updatedListing = await prisma.listing.update({
      where: { id },
      data: validationResult.data,
    });

    return res.status(200).json({
      message: 'Listing updated successfully',
      listing: updatedListing,
    });
  } catch (error) {
    console.error('Update Listing Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * @route DELETE /api/listings/:id
 * @desc  Deactivate/Delete a listing (Owner Only - must own the business)
 */
export const deleteListing = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized identity' });
    }

    const { id } = req.params;

    const listing = await prisma.listing.findUnique({
      where: { id },
      include: { business: true },
    });

    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    if (listing.business.ownerId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this business' });
    }

    // Soft delete (set isActive to false)
    await prisma.listing.update({
      where: { id },
      data: { isActive: false },
    });

    return res.status(200).json({ message: 'Listing deactivated successfully' });
  } catch (error) {
    console.error('Delete Listing Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
