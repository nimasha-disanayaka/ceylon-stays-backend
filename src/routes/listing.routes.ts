import { Router } from 'express';
import {
  createListing,
  getMyListings,
  getListingsByBusiness,
  searchListings,
  getListingAvailability,
  updateListing,
  deleteListing,
  getBlockedDates,
  createBlockedDate,
  deleteBlockedDate,
} from '../controllers/listing.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

// Owner Protected Routes (Must be declared before parameterized routes)
router.get('/my-listings', authenticate, authorize(['OWNER']), getMyListings);

// Public Traveler Routes
router.get('/', searchListings);
router.get('/search', searchListings);
router.get('/business/:businessId', getListingsByBusiness);
router.get('/:id/availability', getListingAvailability);

// Blocked Dates / Maintenance Routes
router.get('/:id/blocked-dates', getBlockedDates);
router.post('/:id/blocked-dates', createBlockedDate);
router.delete('/:id/blocked-dates/:blockId', deleteBlockedDate);

// Owner Routes
router.post('/', authenticate, authorize(['OWNER']), createListing);
router.put('/:id', authenticate, authorize(['OWNER']), updateListing);
router.delete('/:id', authenticate, authorize(['OWNER']), deleteListing);

export default router;

