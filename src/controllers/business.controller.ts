import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { createBusinessSchema, updateBusinessSchema } from '../utils/validation';
import { calculateDistanceKm, geocodeCity } from '../utils/geo';
import { localStore } from '../services/store.service';

/**
 * @route GET /api/businesses/nearby
 * @desc  Search properties nearby a specific location (GPS coordinates or City name)
 *        Calculates distance in kilometers using Haversine formula and sorts closest-first.
 */
export const getNearbyBusinesses = async (req: Request, res: Response) => {
  try {
    let lat = req.query.lat ? Number(req.query.lat) : NaN;
    let lng = req.query.lng ? Number(req.query.lng) : NaN;
    const city = req.query.city ? String(req.query.city).trim() : '';
    const radius = req.query.radius ? Number(req.query.radius) : 50; // Default 50km radius
    const type = req.query.type ? String(req.query.type).toUpperCase() : undefined;
    const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : undefined;

    // 1. Resolve coordinates from city query if lat/lng not explicitly provided
    if ((isNaN(lat) || isNaN(lng)) && city) {
      const cityCoords = geocodeCity(city);
      if (cityCoords) {
        lat = cityCoords.lat;
        lng = cityCoords.lng;
      }
    }

    // 2. Fetch all active businesses with listings
    const businesses = await prisma.business.findMany({
      where: type ? { type: type as any } : undefined,
      include: {
        listings: {
          where: {
            isActive: true,
            ...(maxPrice ? { pricePerNight: { lte: maxPrice } } : {}),
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 3. Filter and Calculate Distances if coordinates are available
    let results = businesses.map((b) => {
      let distanceKm: number | null = null;
      if (!isNaN(lat) && !isNaN(lng) && b.latitude !== null && b.longitude !== null) {
        distanceKm = calculateDistanceKm(lat, lng, b.latitude, b.longitude);
      }
      return {
        ...b,
        distanceKm,
      };
    });

    // 4. If coordinates were provided, filter by radius and sort by distance (closest first)
    if (!isNaN(lat) && !isNaN(lng)) {
      results = results
        .filter((b) => b.distanceKm !== null && b.distanceKm <= radius)
        .sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0));
    }

    return res.status(200).json({
      queryLocation: {
        lat: isNaN(lat) ? null : lat,
        lng: isNaN(lng) ? null : lng,
        city: city || null,
        radiusKm: radius,
      },
      totalResults: results.length,
      businesses: results,
    });
  } catch (error) {
    console.error('Get Nearby Businesses Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};


// In-memory storage fallback for newly created owner businesses if DB has latency
export let liveOwnerBusinesses: any[] = [];

/**
 * @route POST /api/businesses
 * @desc  Create a new business (Owner Only)
 */
export const createBusiness = async (req: Request, res: Response) => {
  try {
    const { name, type, description, address, latitude, longitude, imageUrls } = req.body || {};

    if (!name || !address) {
      return res.status(400).json({ error: 'Property name and address are required' });
    }

    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized: User identity not found' });
    }

    let dbBusiness;

    try {
      dbBusiness = await prisma.business.create({
        data: {
          ownerId: userId,
          name,
          type: (type || 'HOTEL').toUpperCase() as any,
          description: description || '',
          address,
          latitude: Number(latitude) || 6.9271,
          longitude: Number(longitude) || 79.8612,
          imageUrls: imageUrls || [],
        },
        include: {
          listings: true,
        },
      });
    } catch (dbErr) {
      console.warn('DB create business notice:', dbErr);
    }

    const newBusiness = dbBusiness || {
      id: `biz-${Date.now()}`,
      ownerId: userId,
      name,
      type: (type || 'HOTEL').toUpperCase(),
      description: description || '',
      address,
      latitude: Number(latitude) || 6.9271,
      longitude: Number(longitude) || 79.8612,
      imageUrls: imageUrls || [],
      createdAt: new Date().toISOString(),
      listings: [],
    };

    // Always persist to localStore disk so it never disappears on restart
    localStore.saveBusiness({
      id: newBusiness.id,
      ownerId: newBusiness.ownerId,
      name: newBusiness.name,
      type: newBusiness.type,
      description: newBusiness.description,
      address: newBusiness.address,
      latitude: newBusiness.latitude,
      longitude: newBusiness.longitude,
      imageUrls: newBusiness.imageUrls,
      createdAt: newBusiness.createdAt instanceof Date ? newBusiness.createdAt.toISOString() : String(newBusiness.createdAt),
      updatedAt: new Date().toISOString(),
    });

    liveOwnerBusinesses = [newBusiness, ...liveOwnerBusinesses];

    return res.status(201).json({
      message: 'Business created successfully',
      business: newBusiness,
    });
  } catch (error) {
    console.error('Create Business Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * @route GET /api/businesses/my-businesses
 * @desc  Get all businesses owned by logged-in Owner (Owner Only)
 */
export const getMyBusinesses = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized: User identity not found' });
    }

    let dbBusinesses: any[] = [];
    try {
      dbBusinesses = await prisma.business.findMany({
        where: { ownerId: userId },
        include: {
          listings: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (dbErr) {
      console.warn('DB getMyBusinesses notice:', dbErr);
    }

    // Load persistent store businesses for this owner
    const storedBusinesses = localStore.getBusinessesByOwner(userId).map((b) => ({
      ...b,
      listings: localStore.getListingsByBusiness(b.id),
    }));

    // Filter memory fallback strictly by the logged-in owner's userId
    const userMemoryBusinesses = liveOwnerBusinesses.filter((b) => b.ownerId === userId);

    const map = new Map();
    [...dbBusinesses, ...storedBusinesses, ...userMemoryBusinesses].forEach((b) => {
      if (!map.has(b.id)) {
        map.set(b.id, b);
      }
    });

    const combined = Array.from(map.values());

    return res.status(200).json({ businesses: combined });
  } catch (error) {
    console.error('Get My Businesses Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * @route GET /api/businesses/:id
 * @desc  Get business details by ID (Public)
 */
export const getBusinessById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    let business: any = null;
    try {
      business = await prisma.business.findUnique({
        where: { id },
        include: {
          owner: { select: { id: true, name: true, phone: true, email: true } },
          listings: { where: { isActive: true } },
        },
      });
    } catch (dbErr) {
      console.warn('DB getBusinessById notice:', dbErr);
    }

    if (!business) {
      const stored = localStore.getBusinessById(id);
      if (stored) {
        const owner = localStore.getUserById(stored.ownerId);
        business = {
          ...stored,
          owner: owner ? { id: owner.id, name: owner.name, phone: owner.phone, email: owner.email } : undefined,
          listings: localStore.getListingsByBusiness(id),
        };
      }
    }

    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    return res.status(200).json({ business });
  } catch (error) {
    console.error('Get Business By Id Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * @route PUT /api/businesses/:id
 * @desc  Update a business (Owner Only - must own the business)
 */
export const updateBusiness = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized identity' });
    }

    const { id } = req.params;

    // 1. Verify business exists and belongs to logged-in owner
    let existingBusiness: any = null;
    try {
      existingBusiness = await prisma.business.findUnique({
        where: { id },
      });
    } catch (dbErr) {
      console.warn('DB lookup on update:', dbErr);
    }

    if (!existingBusiness) {
      existingBusiness = localStore.getBusinessById(id);
    }

    if (!existingBusiness) {
      return res.status(404).json({ error: 'Business not found' });
    }

    if (existingBusiness.ownerId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this business' });
    }

    // 2. Validate input
    const validationResult = updateBusinessSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation Error',
        details: validationResult.error.flatten().fieldErrors,
      });
    }

    // 3. Update in DB if reachable
    let updatedBusiness: any = null;
    try {
      updatedBusiness = await prisma.business.update({
        where: { id },
        data: validationResult.data,
      });
    } catch (dbErr) {
      console.warn('DB update business notice:', dbErr);
    }

    const finalUpdated = updatedBusiness || {
      ...existingBusiness,
      ...validationResult.data,
      updatedAt: new Date().toISOString(),
    };

    // Update in localStore
    localStore.saveBusiness(finalUpdated);

    return res.status(200).json({
      message: 'Business updated successfully',
      business: finalUpdated,
    });
  } catch (error) {
    console.error('Update Business Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * @route DELETE /api/businesses/:id
 * @desc  Delete a business (Owner Only - must own the business)
 */
export const deleteBusiness = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized identity' });
    }

    const { id } = req.params;

    let existingBusiness: any = null;
    try {
      existingBusiness = await prisma.business.findUnique({
        where: { id },
      });
    } catch (dbErr) {
      console.warn('DB lookup on delete:', dbErr);
    }

    if (!existingBusiness) {
      existingBusiness = localStore.getBusinessById(id);
    }

    if (!existingBusiness) {
      return res.status(404).json({ error: 'Business not found' });
    }

    if (existingBusiness.ownerId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this business' });
    }

    try {
      await prisma.business.delete({
        where: { id },
      });
    } catch (dbErr) {
      console.warn('DB delete business notice:', dbErr);
    }

    localStore.deleteBusiness(id);

    return res.status(200).json({ message: 'Business deleted successfully' });
  } catch (error) {
    console.error('Delete Business Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
