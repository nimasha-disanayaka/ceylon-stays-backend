import { z } from 'zod';

// --- AUTH SCHEMAS ---
export const registerSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  password: z.string().min(6, { message: 'Password must be at least 6 characters long' }),
  name: z.string().min(2, { message: 'Name must be at least 2 characters long' }),
  phone: z.string().optional(),
  role: z.enum(['OWNER', 'FOREIGNER'], {
    errorMap: () => ({ message: 'Role must be either OWNER or FOREIGNER' }),
  }),
});

export const loginSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  password: z.string().min(1, { message: 'Password is required' }),
});

// --- BUSINESS SCHEMAS ---
export const createBusinessSchema = z.object({
  name: z.string().min(2, { message: 'Business name must be at least 2 characters long' }),
  type: z.enum(['HOTEL', 'HOMESTAY', 'RESTAURANT'], {
    errorMap: () => ({ message: 'Type must be HOTEL, HOMESTAY, or RESTAURANT' }),
  }),
  description: z.string().optional(),
  address: z.string().min(3, { message: 'Address is required' }),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  imageUrls: z.array(z.string().url()).optional().default([]),
});

export const updateBusinessSchema = createBusinessSchema.partial();

// --- LISTING SCHEMAS ---
export const createListingSchema = z.object({
  businessId: z.string().uuid({ message: 'Valid Business ID is required' }),
  name: z.string().min(2, { message: 'Listing name must be at least 2 characters long' }),
  description: z.string().optional(),
  pricePerNight: z.number().positive({ message: 'Price per night must be positive' }),
  maxGuests: z.number().int().positive().default(1),
  amenities: z.array(z.string()).optional().default([]),
  isActive: z.boolean().optional().default(true),
});

export const updateListingSchema = createListingSchema.partial().omit({ businessId: true });

// --- BOOKING SCHEMAS ---
export const createBookingSchema = z
  .object({
    listingId: z.string().min(1, { message: 'Listing ID is required' }),
    checkIn: z.string().min(1, { message: 'Valid Check-in Date string is required' }),
    checkOut: z.string().min(1, { message: 'Valid Check-out Date string is required' }),
  })
  .refine((data) => new Date(data.checkOut) > new Date(data.checkIn), {
    message: 'Check-out date must be strictly after Check-in date',
    path: ['checkOut'],
  });

export const updateBookingStatusSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'DECLINED', 'NO_SHOW']),
  paymentStatus: z.string().optional(),
});

// --- BLOCKED DATE SCHEMA ---
export const createBlockedDateSchema = z
  .object({
    listingId: z.string().uuid({ message: 'Valid Listing ID is required' }),
    startDate: z.string().datetime({ message: 'Valid Start ISO Date string is required' }),
    endDate: z.string().datetime({ message: 'Valid End ISO Date string is required' }),
    reason: z.string().optional(),
  })
  .refine((data) => new Date(data.endDate) > new Date(data.startDate), {
    message: 'End date must be after start date',
    path: ['endDate'],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>;
export type CreateListingInput = z.infer<typeof createListingSchema>;
export type UpdateListingInput = z.infer<typeof updateListingSchema>;
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type UpdateBookingStatusInput = z.infer<typeof updateBookingStatusSchema>;
export type CreateBlockedDateInput = z.infer<typeof createBlockedDateSchema>;
