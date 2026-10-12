import { Router } from 'express';
import {
  createListing,
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
router.post('/', createListing);
router.put('/:id', updateListing);
router.delete('/:id', deleteListing);

export default router;

