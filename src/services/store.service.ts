import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

const DATA_DIR = path.join(__dirname, '../../data');
const DATA_FILE = path.join(DATA_DIR, 'db-store.json');

export interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  phone?: string | null;
  role: 'OWNER' | 'FOREIGNER';
  createdAt: string;
  updatedAt: string;
}

export interface StoredBusiness {
  id: string;
  ownerId: string;
  name: string;
  type: string;
  description?: string;
  address: string;
  latitude?: number;
  longitude?: number;
  imageUrls: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StoredListing {
  id: string;
  businessId: string;
  name: string;
  description?: string;
  pricePerNight: number;
  maxGuests: number;
  amenities: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoredBooking {
  id: string;
  foreignerId: string;
  listingId: string;
  checkIn: string;
  checkOut: string;
  totalPrice: number;
  status: string;
  paymentStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredReview {
  id: string;
  bookingId: string;
  authorId: string;
  rating: number;
  comment?: string;
  reply?: string | null;
  createdAt: string;
}

interface LocalStoreData {
  users: StoredUser[];
  businesses: StoredBusiness[];
  listings: StoredListing[];
  bookings: StoredBooking[];
  reviews: StoredReview[];
  blockedDates: any[];
}

function getDefaultData(): LocalStoreData {
  const now = new Date().toISOString();
  // Hash for 'password123'
  const defaultHash = bcrypt.hashSync('password123', 10);

  const ownerId = 'user-owner-default';
  const travelerId = 'user-traveler-default';
  const biz1Id = 'biz-mirissa-luxury';
  const biz2Id = 'biz-cinnamon-citadel';

  return {
    users: [
      {
        id: ownerId,
        email: 'nimuu1449disanayaka@gmail.com',
        passwordHash: defaultHash,
        name: 'Nimasha Disanayaka',
        phone: '+94771234567',
        role: 'OWNER',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: travelerId,
        email: 'traveler@gmail.com',
        passwordHash: defaultHash,
        name: 'John Traveler',
        phone: '+14155552671',
        role: 'FOREIGNER',
        createdAt: now,
        updatedAt: now,
      },
    ],
    businesses: [
      {
        id: biz1Id,
        ownerId: ownerId,
        name: 'Mirissa Luxury Hotel',
        type: 'HOTEL',
        description: 'Luxury beachfront hotel in Mirissa with ocean view rooms.',
        address: 'Beach Road, Mirissa, Sri Lanka',
        latitude: 5.9483,
        longitude: 80.4716,
        imageUrls: ['https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80'],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: biz2Id,
        ownerId: ownerId,
        name: 'Cinnamon Citadel Kandy',
        type: 'HOTEL',
        description: 'Riverside luxury resort in the hill capital of Kandy.',
        address: 'Kandy, Sri Lanka',
        latitude: 7.2906,
        longitude: 80.6337,
        imageUrls: ['https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=800&q=80'],
        createdAt: now,
        updatedAt: now,
      },
    ],
    listings: [
      {
        id: 'list-delux-1',
        businessId: biz1Id,
        name: 'delux',
        description: 'King bed with private balcony and panoramic ocean view',
        pricePerNight: 85.0,
        maxGuests: 2,
        amenities: ['WiFi', 'AC', 'Sea View'],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'list-delux-river-2',
        businessId: biz2Id,
        name: 'delux river',
        description: 'Riverside suite with king bed and balcony',
        pricePerNight: 103.0,
        maxGuests: 2,
        amenities: ['WiFi', 'AC', 'Sea View'],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    bookings: [],
    reviews: [],
    blockedDates: [],
  };
}

class StoreService {
  private ensureStore(): LocalStoreData {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (!fs.existsSync(DATA_FILE)) {
        const initialData = getDefaultData();
        fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
        return initialData;
      }

      const fileContent = fs.readFileSync(DATA_FILE, 'utf-8');
      if (!fileContent.trim()) {
        const initialData = getDefaultData();
        fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
        return initialData;
      }

      return JSON.parse(fileContent);
    } catch (err) {
      console.warn('[StoreService] Read warning, using defaults:', err);
      return getDefaultData();
    }
  }

  private saveStore(data: LocalStoreData): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[StoreService] Failed to save store file:', err);
    }
  }

  // --- USER OPERATIONS ---
  public getUserByEmail(email: string): StoredUser | undefined {
    const data = this.ensureStore();
    return data.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  }

  public getUserById(id: string): StoredUser | undefined {
    const data = this.ensureStore();
    return data.users.find((u) => u.id === id);
  }

  public saveUser(user: StoredUser): StoredUser {
    const data = this.ensureStore();
    const index = data.users.findIndex((u) => u.id === user.id || u.email.toLowerCase() === user.email.toLowerCase());
    if (index >= 0) {
      data.users[index] = { ...data.users[index], ...user, updatedAt: new Date().toISOString() };
    } else {
      data.users.push(user);
    }
    this.saveStore(data);
    return user;
  }

  // --- BUSINESS OPERATIONS ---
  public getBusinessesByOwner(ownerId: string): StoredBusiness[] {
    const data = this.ensureStore();
    const isDefault = ownerId === 'user-owner-1' || ownerId === 'user-owner-default';
    return data.businesses.filter(
      (b) => b.ownerId === ownerId || (isDefault && (b.ownerId === 'user-owner-1' || b.ownerId === 'user-owner-default'))
    );
  }

  public getAllBusinesses(): StoredBusiness[] {
    const data = this.ensureStore();
    return data.businesses;
  }

  public getBusinessById(id: string): StoredBusiness | undefined {
    const data = this.ensureStore();
    return data.businesses.find((b) => b.id === id);
  }

  public saveBusiness(biz: StoredBusiness): StoredBusiness {
    const data = this.ensureStore();
    const index = data.businesses.findIndex((b) => b.id === biz.id);
    if (index >= 0) {
      data.businesses[index] = { ...data.businesses[index], ...biz, updatedAt: new Date().toISOString() };
    } else {
      data.businesses.unshift(biz);
    }
    this.saveStore(data);
    return biz;
  }

  public deleteBusiness(id: string): boolean {
    const data = this.ensureStore();
    data.businesses = data.businesses.filter((b) => b.id !== id);
    data.listings = data.listings.filter((l) => l.businessId !== id);
    this.saveStore(data);
    return true;
  }

  // --- LISTING OPERATIONS ---
  public getListingsByOwner(ownerId: string): (StoredListing & { business?: StoredBusiness })[] {
    const data = this.ensureStore();
    const isDefault = ownerId === 'user-owner-1' || ownerId === 'user-owner-default';
    const ownerBusinesses = data.businesses.filter(
      (b) => b.ownerId === ownerId || (isDefault && (b.ownerId === 'user-owner-1' || b.ownerId === 'user-owner-default'))
    );
    const ownerBizIds = new Set(ownerBusinesses.map((b) => b.id));

    return data.listings
      .filter((l) => ownerBizIds.has(l.businessId))
      .map((l) => ({
        ...l,
        business: ownerBusinesses.find((b) => b.id === l.businessId),
      }));
  }

  public getListingsByBusiness(businessId: string): StoredListing[] {
    const data = this.ensureStore();
    return data.listings.filter((l) => l.businessId === businessId && l.isActive);
  }

  public getAllListings(): (StoredListing & { business?: StoredBusiness })[] {
    const data = this.ensureStore();
    return data.listings.map((l) => ({
      ...l,
      business: data.businesses.find((b) => b.id === l.businessId),
    }));
  }

  public getListingById(id: string): StoredListing | undefined {
    const data = this.ensureStore();
    return data.listings.find((l) => l.id === id);
  }

  public saveListing(listing: StoredListing): StoredListing {
    const data = this.ensureStore();
    const index = data.listings.findIndex((l) => l.id === listing.id);
    if (index >= 0) {
      data.listings[index] = { ...data.listings[index], ...listing, updatedAt: new Date().toISOString() };
    } else {
      data.listings.unshift(listing);
    }
    this.saveStore(data);
    return listing;
  }

  public deleteListing(id: string): boolean {
    const data = this.ensureStore();
    data.listings = data.listings.filter((l) => l.id !== id);
    this.saveStore(data);
    return true;
  }

  // --- BOOKING OPERATIONS ---
  public getBookingById(id: string): StoredBooking | undefined {
    const data = this.ensureStore();
    return data.bookings.find((b) => b.id === id);
  }

  public getBookingsByOwner(ownerId: string): any[] {
    const data = this.ensureStore();
    const ownerBusinesses = data.businesses.filter((b) => b.ownerId === ownerId);
    const ownerBizIds = new Set(ownerBusinesses.map((b) => b.id));
    const ownerListings = data.listings.filter((l) => ownerBizIds.has(l.businessId));
    const ownerListingIds = new Set(ownerListings.map((l) => l.id));

    return data.bookings
      .filter((b) => ownerListingIds.has(b.listingId))
      .map((b) => {
        const listing = ownerListings.find((l) => l.id === b.listingId);
        const foreigner = data.users.find((u) => u.id === b.foreignerId);
        return {
          ...b,
          listing: listing ? { ...listing, business: ownerBusinesses.find((biz) => biz.id === listing.businessId) } : undefined,
          foreigner: foreigner ? { id: foreigner.id, name: foreigner.name, email: foreigner.email, phone: foreigner.phone } : undefined,
        };
      });
  }

  public getBookingsByForeigner(foreignerId: string): any[] {
    const data = this.ensureStore();
    return data.bookings
      .filter((b) => b.foreignerId === foreignerId)
      .map((b) => {
        const listing = data.listings.find((l) => l.id === b.listingId);
        const biz = listing ? data.businesses.find((biz) => biz.id === listing.businessId) : undefined;
        return {
          ...b,
          listing: listing ? { ...listing, business: biz } : undefined,
        };
      });
  }

  public saveBooking(booking: StoredBooking): StoredBooking {
    const data = this.ensureStore();
    const index = data.bookings.findIndex((b) => b.id === booking.id);
    if (index >= 0) {
      data.bookings[index] = { ...data.bookings[index], ...booking, updatedAt: new Date().toISOString() };
    } else {
      data.bookings.unshift(booking);
    }
    this.saveStore(data);
    return booking;
  }

  public updateBookingStatus(id: string, status: string, paymentStatus?: string): any {
    const data = this.ensureStore();
    const index = data.bookings.findIndex((b) => b.id === id);
    if (index >= 0) {
      data.bookings[index].status = status;
      if (paymentStatus) {
        data.bookings[index].paymentStatus = paymentStatus;
      }
      data.bookings[index].updatedAt = new Date().toISOString();
      this.saveStore(data);
      return data.bookings[index];
    }
    return null;
  }

  // --- REVIEWS OPERATIONS ---
  public getReviewsByListing(listingId: string): any[] {
    const data = this.ensureStore();
    return data.reviews.filter((r) => {
      const b = data.bookings.find((bk) => bk.id === r.bookingId);
      return b && b.listingId === listingId;
    });
  }

  public getReviewsByOwner(ownerId: string): any[] {
    const data = this.ensureStore();
    const ownerBusinesses = data.businesses.filter((b) => b.ownerId === ownerId);
    const ownerBizIds = new Set(ownerBusinesses.map((b) => b.id));
    const ownerListings = data.listings.filter((l) => ownerBizIds.has(l.businessId));
    const ownerListingIds = new Set(ownerListings.map((l) => l.id));

    return data.reviews
      .filter((r) => {
        const b = data.bookings.find((bk) => bk.id === r.bookingId);
        return b && ownerListingIds.has(b.listingId);
      })
      .map((r) => {
        const b = data.bookings.find((bk) => bk.id === r.bookingId);
        const listing = b ? ownerListings.find((l) => l.id === b.listingId) : undefined;
        const biz = listing ? ownerBusinesses.find((biz) => biz.id === listing.businessId) : undefined;
        const author = data.users.find((u) => u.id === r.authorId);
        const authorName = author?.name || 'Guest Traveler';
        const nameParts = authorName.trim().split(' ');
        const initials = nameParts.length > 1
          ? `${nameParts[0][0]}${nameParts[1][0]}`.toUpperCase()
          : `${authorName[0]}${authorName[1] || 'G'}`.toUpperCase();

        return {
          id: r.id,
          initials,
          authorName,
          businessName: biz?.name || 'My Property',
          rating: r.rating,
          comment: r.comment,
          reply: r.reply || null,
          createdAt: r.createdAt,
        };
      });
  }

  public saveReview(review: StoredReview): StoredReview {
    const data = this.ensureStore();
    const index = data.reviews.findIndex((r) => r.id === review.id || r.bookingId === review.bookingId);
    if (index >= 0) {
      data.reviews[index] = { ...data.reviews[index], ...review };
    } else {
      data.reviews.unshift(review);
    }
    this.saveStore(data);
    return review;
  }

  public replyToReview(reviewId: string, reply: string): any {
    const data = this.ensureStore();
    const review = data.reviews.find((r) => r.id === reviewId);
    if (review) {
      review.reply = reply;
      this.saveStore(data);
      return review;
    }
    return null;
  }
}

export const localStore = new StoreService();

