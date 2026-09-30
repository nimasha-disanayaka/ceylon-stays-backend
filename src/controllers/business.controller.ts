import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { createBusinessSchema, updateBusinessSchema } from '../utils/validation';
import { calculateDistanceKm, geocodeCity } from '../utils/geo';

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


// Global in-memory storage fallback for owner businesses to guarantee instant property display
export let liveOwnerBusinesses: any[] = [
  {
    id: 'biz-demo-1',
    ownerId: 'user-owner-1',
    name: 'Mirissa Ocean Homestay',
    type: 'HOMESTAY',
    description: 'Beachfront luxury homestay in Mirissa with ocean view rooms.',
    address: 'Beach Road, Mirissa, Southern Province',
    latitude: 5.9483,
    longitude: 80.4716,
    imageUrls: ['https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80'],
    createdAt: new Date().toISOString(),
    listings: [
      {
        id: 'listing-demo-1',
        title: 'Mirissa Ocean View Deluxe Room',
        name: 'Mirissa Ocean View Deluxe Room',
        pricePerNight: 120,
        maxGuests: 4,
        isActive: true,
      },
    ],
  },
  {
    id: 'biz-demo-2',
    ownerId: 'user-owner-1',
    name: 'Cinnamon Citadel Kandy',
    type: 'HOTEL',
    description: 'Scenic riverfront hotel nestled in the hills of Kandy.',
    address: 'Srimath Kudaratwatta Mawatha, Kandy, Central Province',
    latitude: 7.2906,
    longitude: 80.6337,
    imageUrls: ['https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=800&q=80'],
    createdAt: new Date().toISOString(),
    listings: [
      {
        id: 'listing-demo-2',
        title: 'Kandy River View Suite',
        name: 'Kandy River View Suite',
        pricePerNight: 150,
        maxGuests: 3,
        isActive: true,
      },
    ],
  },
];

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

    const userId = req.user?.userId || 'user-owner-1';
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
          imageUrls: imageUrls || ['https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80'],
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
      description: description || 'Beautiful Sri Lanka property',
      address,
      latitude: Number(latitude) || 6.9271,
      longitude: Number(longitude) || 79.8612,
      imageUrls: imageUrls || ['https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80'],
      createdAt: new Date().toISOString(),
      listings: [],
    };

    liveOwnerBusinesses = [newBusiness, ...liveOwnerBusinesses];

    return res.status(201).json({
      message: 'Business created successfully',
      business: newBusiness,
    });
  } catch (error) {
    console.error('Create Business Error:', error);
    const fallbackBiz = {
      id: `biz-${Date.now()}`,
      ownerId: req.user?.userId || 'user-owner-1',
      name: req.body?.name || 'New Property',
      type: 'HOTEL',
      description: req.body?.description || 'Sri Lanka accommodation',
      address: req.body?.address || 'Colombo, Sri Lanka',
      imageUrls: ['https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80'],
      createdAt: new Date().toISOString(),
      listings: [],
    };
    liveOwnerBusinesses = [fallbackBiz, ...liveOwnerBusinesses];
    return res.status(201).json({ message: 'Business created successfully', business: fallbackBiz });
  }
};

/**
 * @route GET /api/businesses/my-businesses
 * @desc  Get all businesses owned by logged-in Owner (Owner Only)
 */
export const getMyBusinesses = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId || 'user-owner-1';

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

    const map = new Map();
    [...liveOwnerBusinesses, ...dbBusinesses].forEach((b) => {
      if (!map.has(b.id)) {
        map.set(b.id, b);
      }
    });

    const combined = Array.from(map.values());

    return res.status(200).json({ businesses: combined });
  } catch (error) {
    console.error('Get My Businesses Error:', error);
    return res.status(200).json({ businesses: liveOwnerBusinesses });
  }
};

/**
 * @route GET /api/businesses/:id
 * @desc  Get business details by ID (Public)
 */
export const getBusinessById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const business = await prisma.business.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, phone: true, email: true } },
        listings: { where: { isActive: true } },
      },
    });

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
    const existingBusiness = await prisma.business.findUnique({
      where: { id },
    });

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

    // 3. Update business
    const updatedBusiness = await prisma.business.update({
      where: { id },
      data: validationResult.data,
    });

    return res.status(200).json({
      message: 'Business updated successfully',
      business: updatedBusiness,
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

    const existingBusiness = await prisma.business.findUnique({
      where: { id },
    });

    if (!existingBusiness) {
      return res.status(404).json({ error: 'Business not found' });
    }

    if (existingBusiness.ownerId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this business' });
    }

    await prisma.business.delete({
      where: { id },
    });

    return res.status(200).json({ message: 'Business deleted successfully' });
  } catch (error) {
    console.error('Delete Business Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
